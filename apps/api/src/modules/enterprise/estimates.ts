import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull, max } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApproveEnterpriseEstimate,
  CreateEnterpriseEstimate,
  CreateEnterpriseEstimateLine,
  EnterpriseEstimateDetail,
  EnterpriseEstimatePage,
  EnterpriseEstimateRevision,
} from '@fieldline/contracts';
import { dec } from '@fieldline/pricing';
import {
  enterpriseEstimates as estimates,
  enterpriseEstimateLines as lines,
  enterpriseEstimateRevisions as revisions,
} from '../../db/schema/enterpriseEstimates';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';

const Project = z.object({ projectId: z.uuid() });
const Revision = Project.extend({ revisionId: z.uuid() });
const path = '/enterprise/projects/:projectId/estimates';
const revisionPath = path + '/:revisionId';
const rateLimit = { max: 45, timeWindow: '1 minute' } as const;
const write = { permission: 'estimate:write', rateLimit } as const;

type ProjectScope = { orgId: string; projectId: string };
type RevisionEntry = { title: string; revision: typeof revisions.$inferSelect };
function projectScope(
  table: typeof estimates | typeof revisions | typeof lines,
  scope: ProjectScope,
) {
  return and(eq(table.orgId, scope.orgId), eq(table.projectId, scope.projectId));
}
export function revisionScope(scope: ProjectScope, revisionId: string) {
  return and(projectScope(revisions, scope), eq(revisions.id, revisionId));
}
export function lineScope(scope: ProjectScope, revisionId: string) {
  return and(projectScope(lines, scope), eq(lines.estimateRevisionId, revisionId));
}
function revisionDto({
  title,
  revision,
}: RevisionEntry): z.infer<typeof EnterpriseEstimateRevision> {
  return {
    id: revision.id,
    estimateId: revision.estimateId,
    title,
    revisionNumber: revision.revisionNumber,
    revision: revision.revision,
    currency: revision.currency,
    quantityPrecision: revision.quantityPrecision,
    status: revision.status,
    createdAt: revision.createdAt.toISOString(),
    approvedAt: revision.approvedAt?.toISOString() ?? null,
    approvedByUserId: revision.approvedByUserId,
    approvalReason: revision.approvalReason,
  };
}
function lineDto(row: typeof lines.$inferSelect) {
  return {
    id: row.id,
    ordinal: row.ordinal,
    description: row.description,
    unit: row.unit,
    quantity: row.quantity,
    sourceReviewId: row.sourceReviewId,
  };
}
export async function checkedRevision(
  tx: Tx,
  scope: ProjectScope,
  id: string,
  lock: 'share' | 'update',
) {
  const [revision] = await tx.select().from(revisions).where(revisionScope(scope, id)).for(lock);
  if (!revision) throw problem('not_found');
  const [estimate] = await tx
    .select({ title: estimates.title })
    .from(estimates)
    .where(and(projectScope(estimates, scope), eq(estimates.id, revision.estimateId)));
  if (!estimate) throw problem('not_found');
  return { title: estimate.title, revision };
}
async function detail(tx: Tx, scope: ProjectScope, row: RevisionEntry) {
  const items = await tx
    .select()
    .from(lines)
    .where(lineScope(scope, row.revision.id))
    .orderBy(asc(lines.ordinal));
  return { ...revisionDto(row), lines: items.map(lineDto) };
}

const estimatesApi: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'estimate:read' },
      schema: {
        tags: ['enterprise'],
        params: Project,
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: EnterpriseEstimatePage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId);
        const limit = 30;
        const rows = await tx
          .select({ title: estimates.title, revision: revisions })
          .from(revisions)
          .innerJoin(
            estimates,
            and(projectScope(estimates, scope), eq(estimates.id, revisions.estimateId)),
          )
          .where(
            and(
              projectScope(revisions, scope),
              beforeCursor(revisions.createdAt, revisions.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(revisions.createdAt)), desc(revisions.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          ({ revision }) => ({ at: revision.createdAt, id: revision.id }),
          revisionDto,
        );
      });
    },
  );

  app.get(
    revisionPath,
    {
      config: { permission: 'estimate:read' },
      schema: {
        tags: ['enterprise'],
        params: Revision,
        response: { 200: EnterpriseEstimateDetail },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const { projectId, revisionId } = request.params;
      const scope = { orgId, projectId };
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        return detail(tx, scope, await checkedRevision(tx, scope, revisionId, 'share'));
      });
      setEtag(reply, result.revision);
      return result;
    },
  );

  app.post(
    path,
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: Project,
        body: CreateEnterpriseEstimate,
        response: { 200: EnterpriseEstimateRevision, 201: EnterpriseEstimateRevision },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const { title, currency, quantityPrecision, clientRequestId } = request.body;
      const saved = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        const [prior] = await tx
          .select({ estimate: estimates, revision: revisions })
          .from(estimates)
          .innerJoin(
            revisions,
            and(
              projectScope(revisions, scope),
              eq(revisions.estimateId, estimates.id),
              eq(revisions.revisionNumber, 1),
            ),
          )
          .where(
            and(projectScope(estimates, scope), eq(estimates.clientRequestId, clientRequestId)),
          );
        if (prior) {
          if (
            prior.estimate.createdByUserId !== userId ||
            prior.estimate.title !== title ||
            prior.revision.currency !== currency ||
            prior.revision.quantityPrecision !== quantityPrecision
          ) {
            throw problem('conflict', 'This request already created a different estimate draft.');
          }
          return { created: false, entry: revisionDto({ title, revision: prior.revision }) };
        }
        const [estimate] = await tx
          .insert(estimates)
          .values({ ...scope, title, createdByUserId: userId, clientRequestId })
          .returning();
        if (!estimate) throw new Error('Estimate creation failed.');
        const [revision] = await tx
          .insert(revisions)
          .values({
            ...scope,
            estimateId: estimate.id,
            revisionNumber: 1,
            currency,
            quantityPrecision,
            createdByUserId: userId,
          })
          .returning();
        if (!revision) throw new Error('Estimate revision creation failed.');
        const entry = revisionDto({ title, revision });
        await audit(
          tx,
          orgId,
          userId,
          'project_estimate',
          estimate.id,
          'estimating.draft_created',
          null,
          entry,
        );
        return { created: true, entry };
      });
      setEtag(reply, saved.entry.revision);
      return reply.code(saved.created ? 201 : 200).send(saved.entry);
    },
  );

  app.post(
    revisionPath + '/lines',
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: Revision,
        body: CreateEnterpriseEstimateLine,
        response: { 200: EnterpriseEstimateDetail, 201: EnterpriseEstimateDetail },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, revisionId } = request.params;
      const scope = { orgId, projectId };
      const expected = parseIfMatch(request);
      const { description, unit, quantity, clientRequestId } = request.body;
      const value = quantity === null ? null : dec(quantity).toFixed();
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ description, unit, value, expected }))
        .digest('hex');
      const saved = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const base = await checkedRevision(tx, scope, revisionId, 'update');
        const [prior] = await tx
          .select()
          .from(lines)
          .where(and(lineScope(scope, revisionId), eq(lines.clientRequestId, clientRequestId)));
        if (prior) {
          if (prior.createdByUserId !== userId || prior.requestHash !== requestHash) {
            throw problem('conflict', 'This request already created a different estimate line.');
          }
          return { created: false, entry: await detail(tx, scope, base) };
        }
        assertRevision(base.revision.revision, expected);
        if (base.revision.status !== 'draft')
          throw problem('conflict', 'Approved estimates require a new revision.');
        const [last] = await tx
          .select({ ordinal: max(lines.ordinal) })
          .from(lines)
          .where(lineScope(scope, revisionId));
        const [line] = await tx
          .insert(lines)
          .values({
            ...scope,
            estimateRevisionId: revisionId,
            ordinal: (last?.ordinal ?? 0) + 1,
            description,
            unit,
            quantity: value,
            clientRequestId,
            requestHash,
            createdByUserId: userId,
          })
          .returning();
        const [revision] = await tx
          .update(revisions)
          .set({ revision: expected + 1 })
          .where(revisionScope(scope, revisionId))
          .returning();
        if (!line || !revision) throw new Error('Estimate line creation failed.');
        await audit(
          tx,
          orgId,
          userId,
          'project_estimate_revision',
          revisionId,
          'estimating.line_added',
          null,
          lineDto(line),
        );
        return { created: true, entry: await detail(tx, scope, { ...base, revision }) };
      });
      setEtag(reply, saved.entry.revision);
      return reply.code(saved.created ? 201 : 200).send(saved.entry);
    },
  );

  app.post(
    revisionPath + '/approve',
    {
      config: { permission: 'review_task:decide', rateLimit },
      schema: {
        tags: ['enterprise'],
        params: Revision,
        body: ApproveEnterpriseEstimate,
        response: { 200: EnterpriseEstimateDetail },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, revisionId } = request.params;
      const scope = { orgId, projectId };
      const expected = parseIfMatch(request);
      const { reason } = request.body;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const base = await checkedRevision(tx, scope, revisionId, 'update');
        const current = base.revision;
        if (
          current.status === 'approved' &&
          current.revision === expected + 1 &&
          current.approvedByUserId === userId &&
          current.approvalReason === reason
        ) {
          return detail(tx, scope, base);
        }
        assertRevision(current.revision, expected);
        if (current.status !== 'draft')
          throw problem('conflict', 'This estimate revision is already approved.');
        const [anyLine] = await tx
          .select({ id: lines.id })
          .from(lines)
          .where(lineScope(scope, revisionId))
          .limit(1);
        const [blankLine] = await tx
          .select({ id: lines.id })
          .from(lines)
          .where(and(lineScope(scope, revisionId), isNull(lines.quantity)))
          .limit(1);
        if (!anyLine || blankLine)
          throw problem(
            'validation_failed',
            'Enter a quantity for each line before requesting approval.',
          );
        const [revision] = await tx
          .update(revisions)
          .set({
            status: 'approved',
            revision: expected + 1,
            approvedAt: new Date(),
            approvedByUserId: userId,
            approvalReason: reason,
          })
          .where(revisionScope(scope, revisionId))
          .returning();
        if (!revision) throw new Error('Estimate approval failed.');
        await audit(
          tx,
          orgId,
          userId,
          'project_estimate_revision',
          revisionId,
          'estimating.quantity_revision_approved',
          revisionDto(base),
          revisionDto({ ...base, revision }),
        );
        return detail(tx, scope, { ...base, revision });
      });
      setEtag(reply, result.revision);
      return result;
    },
  );
};

export default estimatesApi;
