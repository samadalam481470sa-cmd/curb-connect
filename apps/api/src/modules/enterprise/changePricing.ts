import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  canEditChangePricing,
  ChangePricingHistory,
  ChangePricingInput,
  ChangePricingRevision,
  priceChangeLines,
} from '@fieldline/contracts';
import { enterpriseChangeOrders as orders } from '../../db/schema/enterprise';
import { enterpriseDocumentVersions as documents } from '../../db/schema/enterpriseDocuments';
import { enterpriseChangePricingRevisions as revisions } from '../../db/schema/enterpriseChangePricing';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { audit, checkEnabled } from './access';

const Params = z.object({ id: z.uuid() });
type Pricing = typeof revisions.$inferSelect;

function dto(row: Pricing) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

const enterpriseChangePricingModule: FastifyPluginAsyncZod = async (app) => {
  const path = '/enterprise/change-orders/:id/pricing';
  app.get(
    path,
    {
      config: { permission: 'job:read' },
      schema: { tags: ['enterprise'], params: Params, response: { 200: ChangePricingHistory } },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { id } = request.params;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const [order] = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.orgId, orgId), eq(orders.id, id)));
        if (!order) throw problem('not_found');
        const items = await tx
          .select()
          .from(revisions)
          .where(and(eq(revisions.orgId, orgId), eq(revisions.changeOrderId, id)))
          .orderBy(desc(revisions.orderRevision))
          .limit(25);
        return { items: items.map(dto) };
      });
    },
  );

  app.post(
    path,
    {
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: Params,
        body: ChangePricingInput,
        response: { 200: ChangePricingRevision, 201: ChangePricingRevision },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { id } = request.params;
      const expected = parseIfMatch(request);
      const body = request.body;
      const lines = priceChangeLines(body.lines);
      const totalMinor = lines.reduce((total, line) => total + line.totalMinor, 0);
      if (
        lines.some((line) => Math.abs(line.totalMinor) > 1_000_000_000_000) ||
        Math.abs(totalMinor) > 1_000_000_000_000
      )
        throw problem(
          'validation_failed',
          'A line or the change order total exceeds the allowed range.',
        );

      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const scope = and(eq(orders.orgId, orgId), eq(orders.id, id));
        const [order] = await tx.select().from(orders).where(scope).for('update');
        if (!order) throw problem('not_found');
        const [existing] = await tx
          .select()
          .from(revisions)
          .where(
            and(
              eq(revisions.orgId, orgId),
              eq(revisions.changeOrderId, id),
              eq(revisions.clientRequestId, body.clientRequestId),
            ),
          );
        if (existing) {
          if (existing.orderRevision !== expected + 1)
            throw problem('conflict', 'This request ID belongs to another pricing revision.');
          return { created: false, pricing: existing };
        }
        assertRevision(order.revision, expected);
        if (!canEditChangePricing(order.status))
          throw problem(
            'conflict',
            'Pricing is locked once a change order is submitted for review.',
          );

        if (body.evidenceVersionId) {
          const [evidence] = await tx
            .select({ id: documents.id })
            .from(documents)
            .where(
              and(
                eq(documents.orgId, orgId),
                eq(documents.projectId, order.projectId),
                eq(documents.id, body.evidenceVersionId),
              ),
            );
          if (!evidence)
            throw problem('validation_failed', 'Select a document version from this project.');
        }

        const orderRevision = order.revision + 1;
        const [pricing] = await tx
          .insert(revisions)
          .values({
            ...body,
            lines,
            totalMinor,
            orderRevision,
            orgId,
            projectId: order.projectId,
            changeOrderId: id,
            createdByUserId: userId,
          })
          .returning();
        if (!pricing) throw new Error('Pricing revision insertion failed.');
        await tx
          .update(orders)
          .set({
            description: body.scope,
            scheduleImpactDays: body.scheduleImpactDays,
            amountDeltaMinor: totalMinor,
            revision: orderRevision,
            updatedAt: new Date(),
          })
          .where(scope);
        await audit(
          tx,
          orgId,
          userId,
          'change_order',
          id,
          'co.pricing_saved',
          { revision: order.revision, amountDeltaMinor: order.amountDeltaMinor },
          { revision: orderRevision, amountDeltaMinor: totalMinor, pricingId: pricing.id },
        );
        return { created: true, pricing };
      });
      return reply.code(result.created ? 201 : 200).send(dto(result.pricing));
    },
  );
};

export default enterpriseChangePricingModule;
