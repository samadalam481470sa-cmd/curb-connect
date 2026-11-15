// `estimates` module (CP-052, CP-057 D, CP-058, CP-059, OPS-065, ADD-017, ADD-060, COS-243): the
// shared roof + curb estimate. POST creates the estimate and revision 1; every later change is a
// command (EstimateLineItemQuantityChanged, EstimateInputChanged, EstimateSiteConditionChanged,
// EstimateRepriced) through the shared pipeline, producing a new immutable revision. Internal cost
// fields are visible only with estimate:view_cost. Approval lives in the approvals module.
import {
  CommandReceiptSchema,
  CreateSharedEstimateRequestSchema,
  EstimateRevisionSchema,
  EstimateSchema,
  type ProductLine,
  RepriceEstimateRequestSchema,
  UuidSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { estimateRevisions, estimates } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { idempotent } from '../../http/idempotency';
import { problem } from '../../http/problem';
import { setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { resolvePolicy } from '../approvals/policy';
import { executeResourceCommand } from '../commands/pipeline';
import { registerEstimateCommands } from './commands';
import {
  applyRevision,
  computeRevision,
  type EstimateRevisionRow,
  type EstimateRow,
  loadEstimate,
  nextEstimateNumber,
  subjectProperty,
} from './service';

registerEstimateCommands();

const IdParams = z.object({ id: UuidSchema });

export function signoffResolver(tx: Tx, orgId: string, productLine: ProductLine) {
  return async (q: { amountMinor: number | null; jurisdictionId: string | null }) =>
    (await resolvePolicy(tx, orgId, { subjectType: 'estimate_revision', productLine, ...q })).requiredSignoffs;
}

type Scen = { directMinor?: number; overheadMinor?: number; contingencyMinor?: number; marginMinor?: number; [k: string]: unknown };

export function revisionDto(r: EstimateRevisionRow, canViewCost: boolean) {
  const raw = r.scenarios as Record<string, Scen>;
  const hasScenarios = raw && 'base' in raw;
  const scenarios = hasScenarios
    ? (Object.fromEntries(
        (['low', 'base', 'high'] as const).map((k) => {
          const s = raw[k]!;
          if (canViewCost) return [k, s];
          // OPS-065 A: customers-facing roles see totals, not internal cost, margin or unit rates.
          const { directMinor: _d, overheadMinor: _o, contingencyMinor: _c, marginMinor: _m, lines: _l, ...rest } = s;
          return [k, { ...rest, lines: [] }];
        }),
      ) as never)
    : null;
  const gating = r.gatingResult as { quoteKind: string; blockers: unknown[]; warnings: unknown[]; requiredSignoffs: string[] };
  const snapshot = r.priceBookSnapshot as { selection?: unknown };
  return {
    id: r.id,
    estimateId: r.estimateId,
    revisionNumber: r.revisionNumber,
    status: r.status,
    priceBookRevisionId: r.priceBookRevisionId,
    currency: r.currency,
    inputs: r.inputs as never,
    scenarios,
    gating: gating as never,
    quoteKind: r.quoteKind,
    isBinding: r.isBinding,
    engineVersion: r.engineVersion,
    engineVersions: r.engineVersions as Record<string, string>,
    inputHash: r.inputHash,
    lineSpecs: r.lineSpecs as never,
    siteConditions: r.siteConditions as never,
    ...(snapshot.selection ? { priceSelection: snapshot.selection as never } : {}),
    assumptions: r.assumptions as string[],
    createdAt: r.createdAt.toISOString(),
  };
}

export async function estimateDto(tx: Tx, request: FastifyRequest, e: EstimateRow) {
  const org = requireOrg(request);
  const canViewCost = org.permissions.has('estimate:view_cost');
  const [current] = e.currentRevisionId
    ? await tx.select().from(estimateRevisions).where(and(eq(estimateRevisions.orgId, e.orgId), eq(estimateRevisions.id, e.currentRevisionId)))
    : [];
  return {
    id: e.id,
    orgId: e.orgId,
    revision: e.revision,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    number: e.number,
    productLine: e.productLine,
    curbProjectId: e.curbProjectId,
    roofOrderId: e.roofOrderId,
    jobId: e.jobId,
    status: e.status,
    currentRevision: current ? revisionDto(current, canViewCost) : null,
    approvedRevisionId: e.approvedRevisionId,
    propertyId: e.propertyId,
    stale: e.staleSince ? { since: e.staleSince.toISOString(), reason: e.staleReason ?? 'inputs_changed' } : null,
  };
}

const estimatesModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/estimates',
    {
      config: { permission: 'estimate:write' },
      schema: {
        tags: ['estimates'],
        summary: 'Create an estimate (roof or curb) and price revision 1 (Idempotency-Key required)',
        body: CreateSharedEstimateRequestSchema,
        response: { 201: EstimateSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const b = request.body;
      return idempotent(request, reply, { required: true }, async (tx) => {
        const subjectPropertyId = await subjectProperty(tx, org.orgId, b);
        const propertyId = b.propertyId ?? subjectPropertyId;
        const computed = await computeRevision(
          tx,
          org.orgId,
          { productLine: b.productLine, curbProjectId: b.curbProjectId ?? null, propertyId },
          { inputs: b.inputs, lineSpecs: b.lines, siteConditions: b.siteConditions, assumptions: b.assumptions, priceBookRevisionId: b.priceBookRevisionId ?? null },
          signoffResolver(tx, org.orgId, b.productLine),
        );
        const [e] = await tx
          .insert(estimates)
          .values({
            orgId: org.orgId,
            number: await nextEstimateNumber(tx, org.orgId),
            productLine: b.productLine,
            curbProjectId: b.curbProjectId ?? null,
            roofOrderId: b.roofOrderId ?? null,
            propertyId,
            status: 'draft_ai',
            revision: 0,
          })
          .returning();
        const applied = await applyRevision(tx, { orgId: org.orgId, userId: org.userId }, e!, computed);
        const out = await estimateDto(tx, request, applied.estimate);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'estimate.created',
          resourceType: 'estimate',
          resourceId: e!.id,
          after: { number: out.number, status: out.status, revisionId: applied.revision.id, inputHash: applied.revision.inputHash, quoteKind: applied.revision.quoteKind },
        });
        return { status: 201, body: out };
      });
    },
  );

  app.get(
    '/estimates',
    {
      config: { permission: 'estimate:read' },
      schema: {
        tags: ['estimates'],
        summary: 'Estimates (filter by subject)',
        querystring: z.object({ curbProjectId: UuidSchema.optional(), roofOrderId: UuidSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }),
        response: { 200: z.object({ items: z.array(EstimateSchema), nextCursor: z.string().nullable() }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const q = request.query;
        const rows = await tx
          .select()
          .from(estimates)
          .where(
            and(
              eq(estimates.orgId, org.orgId),
              q.curbProjectId ? eq(estimates.curbProjectId, q.curbProjectId) : undefined,
              q.roofOrderId ? eq(estimates.roofOrderId, q.roofOrderId) : undefined,
            ),
          )
          .orderBy(desc(estimates.createdAt))
          .limit(q.limit);
        const items = [];
        for (const r of rows) items.push(await estimateDto(tx, request, r));
        return { items, nextCursor: null };
      });
    },
  );

  app.get(
    '/estimates/:id',
    {
      config: { permission: 'estimate:read' },
      schema: { tags: ['estimates'], summary: 'Estimate with its current revision (read only: no events)', params: IdParams, response: { 200: EstimateSchema } },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const out = await tenantTx(request, async (tx) => {
        const e = await loadEstimate(tx, org.orgId, request.params.id);
        if (!e) throw problem('not_found');
        return estimateDto(tx, request, e);
      });
      setEtag(reply, out.revision);
      return out;
    },
  );

  app.get(
    '/estimates/:id/revisions',
    {
      config: { permission: 'estimate:read' },
      schema: { tags: ['estimates'], summary: 'Immutable revision trail', params: IdParams, response: { 200: z.object({ items: z.array(EstimateRevisionSchema) }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      const canViewCost = org.permissions.has('estimate:view_cost');
      return tenantTx(request, async (tx) => {
        const e = await loadEstimate(tx, org.orgId, request.params.id);
        if (!e) throw problem('not_found');
        const rows = await tx.select().from(estimateRevisions).where(and(eq(estimateRevisions.orgId, org.orgId), eq(estimateRevisions.estimateId, e.id))).orderBy(asc(estimateRevisions.revisionNumber));
        return { items: rows.map((r) => revisionDto(r, canViewCost)) };
      });
    },
  );

  app.post(
    '/estimates/:id/reprice',
    {
      config: { permission: 'estimate:write' },
      schema: {
        tags: ['estimates'],
        summary: 'Reprice (deterministic; a no-op when nothing changed). Shares the command pipeline.',
        params: IdParams,
        body: RepriceEstimateRequestSchema,
        response: { 200: z.object({ receipt: CommandReceiptSchema, estimate: EstimateSchema }) },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const { receipt } = await executeResourceCommand(request, reply, {
        type: 'EstimateRepriced',
        aggregateId: request.params.id,
        expectedRevision: request.body.expectedRevision,
        payload: request.body.priceBookRevisionId ? { price_book_revision_id: request.body.priceBookRevisionId } : {},
      });
      const estimate = await tenantTx(request, async (tx) => estimateDto(tx, request, (await loadEstimate(tx, org.orgId, request.params.id))!));
      return { receipt, estimate };
    },
  );
};

export default estimatesModule;
