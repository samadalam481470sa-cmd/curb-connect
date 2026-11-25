import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EnterprisePurchaseCostCode,
  EnterprisePurchaseOrder,
  EnterprisePurchaseOrderDetails,
  EnterprisePurchaseOrderLookup,
  EnterprisePurchasingPage,
} from '@fieldline/contracts';
import { enterpriseBidQuotes as quotes } from '../../db/schema/enterpriseBidding';
import {
  enterprisePurchaseCostCodes as costCodes,
  enterprisePurchaseOrders as orders,
} from '../../db/schema/enterprisePurchasing';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';
import { getPackage } from './bidding';

const ProjectParams = z.object({ projectId: z.uuid() });
const BidParams = ProjectParams.extend({ packageId: z.uuid() });
const OrderParams = ProjectParams.extend({ orderId: z.uuid() });
const projectPath = '/enterprise/projects/:projectId';
const ordersPath = projectPath + '/purchase-orders';
const bidPath = projectPath + '/bid-packages/:packageId/purchase-order';
const orderPath = ordersPath + '/:orderId';
const read = { permission: 'supplier_order:read' } as const;
const write = {
  permission: 'org:settings_update',
  rateLimit: { max: 30, timeWindow: '1 minute' },
} as const;

function orderScope(orgId: string, projectId: string) {
  return and(eq(orders.orgId, orgId), eq(orders.projectId, projectId));
}

function codeScope(orgId: string, projectId: string) {
  return and(eq(costCodes.orgId, orgId), eq(costCodes.projectId, projectId));
}

type Order = typeof orders.$inferSelect;
function orderDto(order: Order) {
  return {
    ...order,
    createdAt: order.createdAt.toISOString(),
    issuedAt: order.issuedAt?.toISOString() ?? null,
  };
}

async function lockOrder(tx: Tx, orgId: string, projectId: string, orderId: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(orderScope(orgId, projectId), eq(orders.id, orderId)))
    .for('update');
  if (!order) throw problem('not_found');
  return order;
}

async function requireCostCode(tx: Tx, orgId: string, projectId: string, code: string) {
  const [mapping] = await tx
    .select({ code: costCodes.code })
    .from(costCodes)
    .where(and(codeScope(orgId, projectId), eq(costCodes.code, code)));
  if (!mapping)
    throw problem('validation_failed', 'Choose a purchase cost code configured for this project.');
}

const enterprisePurchasingModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    ordersPath,
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          costCode: EnterprisePurchaseCostCode.shape.code.optional(),
        }),
        response: { 200: EnterprisePurchasingPage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      const { costCode } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const scope = orderScope(orgId, projectId);
        const limit = 30;
        const rows = await tx
          .select()
          .from(orders)
          .where(
            and(
              scope,
              costCode ? eq(orders.costCode, costCode) : undefined,
              beforeCursor(orders.createdAt, orders.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(orders.createdAt)), desc(orders.id))
          .limit(limit + 1);
        const mappings = await tx
          .select({ code: costCodes.code, label: costCodes.label })
          .from(costCodes)
          .where(codeScope(orgId, projectId))
          .orderBy(asc(costCodes.code));
        const commitments = await tx
          .select({
            costCode: orders.costCode,
            amountMinor: sql<string>`sum(${orders.amountMinor})::text`,
          })
          .from(orders)
          .where(and(scope, eq(orders.status, 'issued')))
          .groupBy(orders.costCode)
          .orderBy(asc(orders.costCode));
        return {
          ...pageResult(rows, limit, (row) => ({ at: row.createdAt, id: row.id }), orderDto),
          costCodes: mappings,
          commitments,
          committedTotalMinor: commitments
            .reduce((total, { amountMinor }) => total + BigInt(amountMinor), 0n)
            .toString(),
        };
      });
    },
  );

  app.post(
    projectPath + '/purchase-cost-codes',
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        body: EnterprisePurchaseCostCode.strict(),
        response: { 200: EnterprisePurchaseCostCode, 201: EnterprisePurchaseCostCode },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const [created] = await tx
          .insert(costCodes)
          .values({ ...request.body, orgId, projectId })
          .onConflictDoNothing()
          .returning();
        if (created) {
          await audit(
            tx,
            orgId,
            userId,
            'project',
            projectId,
            'purchase_cost_code.created',
            null,
            created,
          );
          return { row: created, created: true };
        }
        const [prior] = await tx
          .select()
          .from(costCodes)
          .where(and(codeScope(orgId, projectId), eq(costCodes.code, request.body.code)));
        if (!prior || prior.label !== request.body.label)
          throw problem('conflict', 'This project already uses that purchase cost code.');
        return { row: prior, created: false };
      });
      return reply.code(result.created ? 201 : 200).send(result.row);
    },
  );

  app.get(
    bidPath,
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: BidParams,
        response: { 200: EnterprisePurchaseOrderLookup },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const { projectId, packageId } = request.params;
      const order = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await getPackage(tx, orgId, projectId, packageId);
        const [row] = await tx
          .select()
          .from(orders)
          .where(and(orderScope(orgId, projectId), eq(orders.bidPackageId, packageId)));
        return row ? orderDto(row) : null;
      });
      if (order) setEtag(reply, order.revision);
      return { order };
    },
  );

  app.post(
    bidPath,
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: BidParams,
        body: EnterprisePurchaseOrderDetails.strict(),
        response: { 200: EnterprisePurchaseOrder, 201: EnterprisePurchaseOrder },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, packageId } = request.params;
      const revision = parseIfMatch(request);
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const pack = await getPackage(tx, orgId, projectId, packageId, true);
        const [prior] = await tx
          .select()
          .from(orders)
          .where(and(orderScope(orgId, projectId), eq(orders.bidPackageId, packageId)));
        if (prior) return { row: prior, created: false };

        assertRevision(pack.revision, revision);
        if (pack.status !== 'awarded' || !pack.awardedQuoteId)
          throw problem('conflict', 'Confirm a bid award before creating a purchase order.');
        await requireCostCode(tx, orgId, projectId, request.body.costCode);
        const [quote] = await tx
          .select()
          .from(quotes)
          .where(
            and(
              eq(quotes.orgId, orgId),
              eq(quotes.projectId, projectId),
              eq(quotes.packageId, packageId),
              eq(quotes.id, pack.awardedQuoteId),
            ),
          );
        if (!quote) throw problem('conflict', 'The awarded quote is unavailable.');
        const [row] = await tx
          .insert(orders)
          .values({
            ...request.body,
            orgId,
            projectId,
            bidPackageId: packageId,
            quoteId: quote.id,
            awardRevision: pack.revision,
            title: pack.title,
            scope: pack.scope,
            vendorName: quote.vendorName,
            amountMinor: quote.amountMinor,
            quoteValidThrough: quote.validThrough,
            createdByUserId: userId,
          })
          .returning();
        if (!row) throw new Error('Purchase order insertion failed.');
        await audit(
          tx,
          orgId,
          userId,
          'purchase_order',
          row.id,
          'purchase_order.drafted',
          null,
          row,
        );
        return { row, created: true };
      });
      setEtag(reply, result.row.revision);
      return reply.code(result.created ? 201 : 200).send(orderDto(result.row));
    },
  );

  app.patch(
    orderPath,
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: OrderParams,
        body: EnterprisePurchaseOrderDetails.strict(),
        response: { 200: EnterprisePurchaseOrder },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, orderId } = request.params;
      const revision = parseIfMatch(request);
      const order = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const prior = await lockOrder(tx, orgId, projectId, orderId);
        assertRevision(prior.revision, revision);
        if (prior.status !== 'draft') throw problem('conflict', 'Issued orders cannot be edited.');
        await requireCostCode(tx, orgId, projectId, request.body.costCode);
        const [updated] = await tx
          .update(orders)
          .set({ ...request.body, revision: prior.revision + 1 })
          .where(and(orderScope(orgId, projectId), eq(orders.id, orderId)))
          .returning();
        if (!updated) throw problem('not_found');
        await audit(
          tx,
          orgId,
          userId,
          'purchase_order',
          orderId,
          'purchase_order.updated',
          prior,
          updated,
        );
        return orderDto(updated);
      });
      setEtag(reply, order.revision);
      return order;
    },
  );

  app.post(
    orderPath + '/issue',
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: OrderParams,
        response: { 200: EnterprisePurchaseOrder },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, orderId } = request.params;
      const revision = parseIfMatch(request);
      const order = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const prior = await lockOrder(tx, orgId, projectId, orderId);
        if (prior.status === 'issued' && prior.revision === revision + 1) return orderDto(prior);
        assertRevision(prior.revision, revision);
        if (prior.status === 'issued') return orderDto(prior);

        const pack = await getPackage(tx, orgId, projectId, prior.bidPackageId);
        if (
          pack.status !== 'awarded' ||
          pack.awardedQuoteId !== prior.quoteId ||
          pack.revision !== prior.awardRevision
        )
          throw problem('conflict', 'The order no longer matches the confirmed bid award.');
        const [updated] = await tx
          .update(orders)
          .set({
            status: 'issued',
            revision: prior.revision + 1,
            issuedByUserId: userId,
            issuedAt: new Date(),
          })
          .where(and(orderScope(orgId, projectId), eq(orders.id, orderId)))
          .returning();
        if (!updated) throw problem('not_found');
        await audit(
          tx,
          orgId,
          userId,
          'purchase_order',
          orderId,
          'purchase_order.issued',
          prior,
          updated,
        );
        return orderDto(updated);
      });
      setEtag(reply, order.revision);
      return order;
    },
  );
};

export default enterprisePurchasingModule;
