// Roof insurance claims + agent time-saved tracking.
//
//   GET    /v1/roof-claims                 claims for this company (filter by status / job)
//   POST   /v1/roof-claims                 file a claim for a roof order
//   GET    /v1/roof-claims/:id             one claim with its evidence documents
//   PATCH  /v1/roof-claims/:id             status transitions only (invalid ones rejected)
//   POST   /v1/roof-claims/:id/documents   attach a stored media asset and/or the photo
//                                          inspection report id as evidence
//   GET    /v1/roof-agents/activity        per-agent hours saved (computed, labeled estimate)
//   POST   /v1/roof-agents/activity        internal log endpoint for agent automation
//
// The photo inspection report is the evidence a claim needs, but it lives in the browser
// as a draft (apps/web/src/features/roof/inspection/inspection.ts) with no server record,
// so the documents endpoint stores its inspection id as a reference, not a foreign key.
// Hours saved are computed from agent_activity_log.minutes_saved only where a duration
// was actually recorded; agents with no measured time report "not measured yet", never 0.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  agentActivityLog,
  mediaAssets,
  roofClaimDocuments,
  roofClaims,
  roofOrders,
} from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import {
  AgentActivitySchema,
  AgentActivityTotalsSchema,
  computeAgentHours,
  LogAgentActivitySchema,
} from './activity';
import { registerTimeBaselineRoutes, resolveBaselineMinutes } from './timeBaselines';
import {
  AttachClaimDocumentSchema,
  canTransitionClaim,
  ClaimListQuerySchema,
  claimDto,
  ClaimStatusSchema,
  CreateRoofClaimSchema,
  RoofClaimListSchema,
  RoofClaimSchema,
  UpdateRoofClaimStatusSchema,
  type ClaimStatus,
} from './claims';

const Params = z.object({ id: z.uuid() });

const roofClaimsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/roof-claims',
    {
      config: { permission: 'roof_order:read' },
      schema: {
        tags: ['roof'],
        summary: 'Insurance claims for this company, optionally filtered by status or roof job',
        querystring: ClaimListQuerySchema,
        response: { 200: RoofClaimListSchema },
      },
    },
    async (request) =>
      tenantTx(request, async (tx) => {
        const { status, roofOrderId } = request.query;
        const conditions = [
          ...(status ? [eq(roofClaims.status, status)] : []),
          ...(roofOrderId ? [eq(roofClaims.roofOrderId, roofOrderId)] : []),
        ];
        const rows = await tx
          .select()
          .from(roofClaims)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(roofClaims.updatedAt))
          .limit(100);
        const ids = rows.map((r) => r.id);
        const docs = ids.length
          ? await tx
              .select()
              .from(roofClaimDocuments)
              .where(inArray(roofClaimDocuments.claimId, ids))
          : [];
        const byClaim = new Map<string, typeof docs>();
        for (const d of docs) {
          const list = byClaim.get(d.claimId) ?? [];
          list.push(d);
          byClaim.set(d.claimId, list);
        }
        return { items: rows.map((r) => claimDto(r, byClaim.get(r.id) ?? [])) };
      }),
  );

  app.post(
    '/roof-claims',
    {
      config: { permission: 'roof_order:create', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'File an insurance claim for a roof order',
        body: CreateRoofClaimSchema,
        response: { 201: RoofClaimSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const claim = await tenantTx(request, async (tx) => {
        const [order] = await tx
          .select({ id: roofOrders.id })
          .from(roofOrders)
          .where(eq(roofOrders.id, request.body.roofOrderId))
          .limit(1);
        if (!order) throw problem('not_found', 'No roof order with that id for this company.');
        const [row] = await tx
          .insert(roofClaims)
          .values({
            orgId: org.orgId,
            roofOrderId: request.body.roofOrderId,
            carrier: request.body.carrier,
            adjusterName: request.body.adjusterName ?? null,
            adjusterContact: request.body.adjusterContact ?? null,
            claimNumber: request.body.claimNumber ?? null,
            status: 'filed',
            note: request.body.note ?? null,
          })
          .returning();
        if (!row) throw new Error('Insert returned no row.');
        return claimDto(row, []);
      });
      return reply.code(201).send(claim);
    },
  );

  app.get(
    '/roof-claims/:id',
    {
      config: { permission: 'roof_order:read' },
      schema: {
        tags: ['roof'],
        summary: 'One insurance claim with its evidence documents',
        params: Params,
        response: { 200: RoofClaimSchema },
      },
    },
    async (request) =>
      tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(roofClaims)
          .where(eq(roofClaims.id, request.params.id))
          .limit(1);
        if (!row) throw problem('not_found');
        const docs = await tx
          .select()
          .from(roofClaimDocuments)
          .where(eq(roofClaimDocuments.claimId, row.id))
          .orderBy(desc(roofClaimDocuments.createdAt));
        return claimDto(row, docs);
      }),
  );

  app.patch(
    '/roof-claims/:id',
    {
      config: {
        permission: 'roof_order:transition',
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['roof'],
        summary: 'Move a claim to its next status (invalid transitions are rejected)',
        params: Params,
        body: UpdateRoofClaimStatusSchema,
        response: { 200: RoofClaimSchema },
      },
    },
    async (request) =>
      tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(roofClaims)
          .where(eq(roofClaims.id, request.params.id))
          .limit(1);
        if (!row) throw problem('not_found');
        const from = ClaimStatusSchema.parse(row.status);
        const to: ClaimStatus = request.body.status;
        if (from === to) {
          throw problem('invalid_transition', `This claim is already ${from.replace('_', ' ')}.`);
        }
        if (!canTransitionClaim(from, to)) {
          throw problem(
            'invalid_transition',
            `A ${from.replace('_', ' ')} claim cannot move to ${to.replace('_', ' ')}.`,
          );
        }
        const [updated] = await tx
          .update(roofClaims)
          .set({ status: to, revision: sql`${roofClaims.revision} + 1` })
          .where(eq(roofClaims.id, row.id))
          .returning();
        if (!updated) throw new Error('Update returned no row.');
        const docs = await tx
          .select()
          .from(roofClaimDocuments)
          .where(eq(roofClaimDocuments.claimId, row.id))
          .orderBy(desc(roofClaimDocuments.createdAt));
        return claimDto(updated, docs);
      }),
  );

  app.post(
    '/roof-claims/:id/documents',
    {
      config: { permission: 'roof_order:create', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary:
          'Attach evidence to a claim: an already-stored media asset and/or the photo inspection report id',
        params: Params,
        body: AttachClaimDocumentSchema,
        response: { 201: RoofClaimSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const claim = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(roofClaims)
          .where(eq(roofClaims.id, request.params.id))
          .limit(1);
        if (!row) throw problem('not_found');
        if (request.body.mediaAssetId) {
          const [asset] = await tx
            .select({ id: mediaAssets.id })
            .from(mediaAssets)
            .where(eq(mediaAssets.id, request.body.mediaAssetId))
            .limit(1);
          if (!asset)
            throw problem('not_found', 'No stored media asset with that id for this company.');
        }
        const [doc] = await tx
          .insert(roofClaimDocuments)
          .values({
            orgId: org.orgId,
            claimId: row.id,
            mediaAssetId: request.body.mediaAssetId ?? null,
            inspectionReportId: request.body.inspectionReportId ?? null,
            kind: request.body.kind,
            label: request.body.label ?? null,
          })
          .returning();
        if (!doc) throw new Error('Insert returned no row.');
        const docs = await tx
          .select()
          .from(roofClaimDocuments)
          .where(eq(roofClaimDocuments.claimId, row.id))
          .orderBy(desc(roofClaimDocuments.createdAt));
        return claimDto(row, docs);
      });
      return reply.code(201).send(claim);
    },
  );

  app.get(
    '/roof-agents/activity',
    {
      config: { permission: 'roof_order:read' },
      schema: {
        tags: ['roof'],
        summary:
          'Per-agent hours saved, computed from logged action durations only (estimate; unmeasured agents show as not measured yet)',
        response: { 200: AgentActivityTotalsSchema },
      },
    },
    async (request) =>
      tenantTx(request, async (tx) => {
        const rows = await tx
          .select({ agent: agentActivityLog.agent, minutesSaved: agentActivityLog.minutesSaved })
          .from(agentActivityLog)
          .orderBy(desc(agentActivityLog.createdAt))
          .limit(1000);
        return computeAgentHours(rows);
      }),
  );

  app.post(
    '/roof-agents/activity',
    {
      config: { permission: 'roof_order:create', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary:
          'Log one agent action (internal: agent automation records what it did and any time measured)',
        body: LogAgentActivitySchema,
        response: { 201: AgentActivitySchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      // Auto-log: when the caller did not record a duration, fill it from the
      // contractor's saved time baseline for this task type (null when they
      // have not set one — never a template guess).
      const minutesSaved =
        request.body.minutesSaved ??
        (await resolveBaselineMinutes(request, org.orgId, request.body.action));
      const [row] = await tenantTx(request, async (tx) =>
        tx
          .insert(agentActivityLog)
          .values({
            orgId: org.orgId,
            agent: request.body.agent,
            action: request.body.action,
            minutesSaved,
            relatedType: request.body.relatedType ?? null,
            relatedId: request.body.relatedId ?? null,
          })
          .returning(),
      );
      if (!row) throw new Error('Insert returned no row.');
      return reply.code(201).send(
        AgentActivitySchema.parse({
          id: row.id,
          agent: row.agent,
          action: row.action,
          minutesSaved: row.minutesSaved,
          relatedType: row.relatedType,
          relatedId: row.relatedId,
          createdAt: row.createdAt.toISOString(),
        }),
      );
    },
  );

  // Time baselines (audit-gaps round 2): contractor-editable minutes per
  // task type that auto-fill minutes_saved when agent actions complete.
  registerTimeBaselineRoutes(app);
};

export default roofClaimsModule;
