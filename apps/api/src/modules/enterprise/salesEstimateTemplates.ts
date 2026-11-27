import { createHash } from 'node:crypto';
import {
  ApproveSalesEstimateTemplate,
  EstimateTemplateSchema,
  SalesEstimateTemplateControls,
} from '@fieldline/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Tx } from '../../db/runtime';
import { salesEstimateTemplateRevisions as approvals } from '../../db/schema/enterpriseSalesEstimates';
import { estimateTemplates as sources } from '../../db/schema/templates';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';

const path = '/enterprise/sales/estimate-templates';
const config = { permission: 'estimate:approve' } as const;
const tags = ['enterprise'];
const approvedDto = SalesEstimateTemplateControls.shape.approved.element;
type Approval = typeof approvals.$inferSelect;

export function approvedTemplateList(tx: Tx, orgId: string) {
  return tx
    .select({ row: approvals })
    .from(approvals)
    .innerJoin(
      sources,
      and(
        eq(sources.orgId, approvals.orgId),
        eq(sources.id, approvals.sourceTemplateId),
        eq(sources.active, true),
      ),
    )
    .where(eq(approvals.orgId, orgId))
    .orderBy(desc(approvals.createdAt), desc(approvals.id));
}

export function templateSnapshot(row: Approval) {
  const { id, revision, sourceTemplateId } = row;
  return { id, revision, sourceTemplateId, ...row.approvedSnapshot };
}

const salesEstimateTemplates: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    { config, schema: { tags, response: { 200: SalesEstimateTemplateControls } } },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const data = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const [active, approved] = await Promise.all([
          tx
            .select({ id: sources.id, name: sources.name })
            .from(sources)
            .where(and(eq(sources.orgId, orgId), eq(sources.active, true)))
            .orderBy(asc(sources.name)),
          approvedTemplateList(tx, orgId),
        ]);
        return { sources: active, approved: approved.map(({ row }) => templateSnapshot(row)) };
      });
      return reply.header('cache-control', 'private, no-store').send(data);
    },
  );

  app.post(
    path + '/approval',
    {
      config,
      schema: {
        tags,
        body: ApproveSalesEstimateTemplate,
        response: { 200: approvedDto, 201: approvedDto },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { sourceTemplateId, laborAssumptions, reason, clientRequestId } = request.body;
      const expected = parseIfMatch(request);
      const requestHash = createHash('sha256')
        .update(JSON.stringify([request.body, expected]))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const [source] = await tx
          .select()
          .from(sources)
          .where(and(eq(sources.orgId, orgId), eq(sources.id, sourceTemplateId)))
          .for('update');
        if (!source?.active) throw problem('not_found', 'Choose an active estimate template.');
        const [receipt] = await tx
          .select()
          .from(approvals)
          .where(and(eq(approvals.orgId, orgId), eq(approvals.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.approvedByUserId !== userId || receipt.requestHash !== requestHash)
            throw problem(
              'conflict',
              'This request already approved a different template revision.',
            );
          return { created: false, data: templateSnapshot(receipt) };
        }
        const [current] = await tx
          .select({ revision: approvals.revision })
          .from(approvals)
          .where(and(eq(approvals.orgId, orgId), eq(approvals.sourceTemplateId, sourceTemplateId)))
          .orderBy(desc(approvals.revision))
          .limit(1);
        assertRevision(current?.revision ?? 0, expected);
        const snapshot = EstimateTemplateSchema.pick({
          name: true,
          budgetLines: true,
          scheduleTasks: true,
          questionnaire: true,
        }).parse(source);
        const [saved] = await tx
          .insert(approvals)
          .values({
            orgId,
            sourceTemplateId,
            revision: expected + 1,
            reason,
            clientRequestId,
            requestHash,
            approvedByUserId: userId,
            approvedSnapshot: {
              name: snapshot.name,
              lines: snapshot.budgetLines,
              tasks: snapshot.scheduleTasks,
              questions: snapshot.questionnaire,
              laborAssumptions,
            },
          })
          .returning();
        if (!saved) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.estimate_template_approved',
          resourceType: 'enterprise_sales_estimate_template',
          resourceId: saved.id,
          after: { sourceTemplateId, revision: saved.revision },
          reason,
        });
        return { created: true, data: templateSnapshot(saved) };
      });
      setEtag(reply, result.data.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};
export default salesEstimateTemplates;
