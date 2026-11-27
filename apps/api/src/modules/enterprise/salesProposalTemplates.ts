import { createHash } from 'node:crypto';
import {
  ApproveSalesProposalTemplate,
  SalesProposalTemplate,
  SalesProposalTemplateList,
} from '@fieldline/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Tx } from '../../db/runtime';
import { salesProposalTemplateRevisions as templates } from '../../db/schema/enterpriseSalesProposals';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';

const route = '/enterprise/sales/proposal-templates';
const approval = { permission: 'estimate:approve' } as const;
const tags = ['enterprise'];

export function salesProposalTemplates(tx: Tx, orgId: string) {
  return tx
    .select()
    .from(templates)
    .where(eq(templates.orgId, orgId))
    .orderBy(desc(templates.createdAt), desc(templates.id))
    .limit(100);
}

export function salesProposalTemplateDto(row: typeof templates.$inferSelect) {
  const { id, name, revision, terms, paymentTerms, taxTreatment, reason, createdAt } = row;
  return {
    id,
    name,
    revision,
    terms,
    paymentTerms,
    taxTreatment,
    reason,
    approvedAt: createdAt.toISOString(),
  };
}

const salesProposalTemplateRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    route,
    { config: approval, schema: { tags, response: { 200: SalesProposalTemplateList } } },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const data = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        return { items: (await salesProposalTemplates(tx, orgId)).map(salesProposalTemplateDto) };
      });
      return reply.header('cache-control', 'private, no-store').send(data);
    },
  );

  app.post(
    route + '/approval',
    {
      config: approval,
      schema: {
        tags,
        body: ApproveSalesProposalTemplate,
        response: { 200: SalesProposalTemplate, 201: SalesProposalTemplate },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const expected = parseIfMatch(request);
      const input = request.body;
      const hash = createHash('sha256')
        .update(JSON.stringify([input, expected]))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const guard = 'proposal-template:' + orgId + ':' + input.name.toLowerCase();
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${guard}, 0))`);
        const [receipt] = await tx
          .select()
          .from(templates)
          .where(
            and(eq(templates.orgId, orgId), eq(templates.clientRequestId, input.clientRequestId)),
          );
        if (receipt) {
          if (receipt.approvedByUserId !== userId || receipt.requestHash !== hash)
            throw problem(
              'conflict',
              'This request already approved a different proposal template.',
            );
          return { created: false, data: salesProposalTemplateDto(receipt) };
        }
        const [current] = await tx
          .select({ revision: templates.revision })
          .from(templates)
          .where(
            and(eq(templates.orgId, orgId), sql`lower(${templates.name}) = lower(${input.name})`),
          )
          .orderBy(desc(templates.revision))
          .limit(1);
        assertRevision(current?.revision ?? 0, expected);
        const [saved] = await tx
          .insert(templates)
          .values({
            ...input,
            orgId,
            revision: expected + 1,
            approvedByUserId: userId,
            requestHash: hash,
          })
          .returning();
        if (!saved) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.proposal_template_approved',
          resourceType: 'enterprise_sales_proposal_template',
          resourceId: saved.id,
          after: { name: saved.name, revision: saved.revision },
          reason: input.reason,
        });
        return { created: true, data: salesProposalTemplateDto(saved) };
      });
      setEtag(reply, result.data.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default salesProposalTemplateRoutes;
