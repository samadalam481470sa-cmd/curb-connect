// `plumbing` module (ConstructionOS module 10, "Plumbing Pro"). Persists the plumbing project, its
// calibrated plan pages, immutable design revisions and computed estimates, and records the approval
// that freezes an estimate. Estimates are always recomputed on the server by the deterministic engine
// in @fieldline/contracts: the client may send inputs, never totals.
//
// Scope is deliberately narrow: this is the records and estimating backbone. Design drawing, BIM,
// routing, AI analysis, procurement, field/service and integrations are not implemented here.
import {
  CalibratePlanRequestSchema,
  ComputeEstimateRequestSchema,
  CreatePlumbingProjectRequestSchema,
  CreateRevisionRequestSchema,
  EstimateTotalsSchema,
  PlumbingDesignSchema,
  PlumbingEstimateRecordListSchema,
  PlumbingEstimateRecordSchema,
  PlumbingProjectDetailSchema,
  PlumbingProjectListSchema,
  PlumbingProjectSchema,
  PlumbingRevisionSchema,
  PlanVersionSchema,
  UuidSchema,
  computeEstimate,
  planScale,
} from '@fieldline/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  plumbingEstimates,
  plumbingPlanVersions,
  plumbingProjects,
  plumbingRevisions,
} from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';

const ProjectParams = z.object({ projectId: UuidSchema });
const EstimateParams = z.object({ projectId: UuidSchema, estimateId: UuidSchema });

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function mapProject(row: typeof plumbingProjects.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    jurisdiction: row.jurisdiction,
    status: row.status as 'draft' | 'active' | 'archived',
    revision: row.revision,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

function mapPlan(row: typeof plumbingPlanVersions.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    filename: row.filename,
    pageNumber: row.pageNumber,
    referenceFeet: Number(row.referenceFeet),
    measuredPixels: row.measuredPixels,
    feetPerPixel: Number(row.feetPerPixel),
    note: row.note,
    createdAt: iso(row.createdAt)!,
  };
}

function mapRevision(row: typeof plumbingRevisions.$inferSelect) {
  // Parse stored geometry instead of trusting the column type: a revision written by an older or
  // broken writer must fail loudly rather than reach the client as unreadable JSON.
  const design = PlumbingDesignSchema.parse({ fixtures: row.fixtures, runs: row.runs });
  return {
    id: row.id,
    projectId: row.projectId,
    revisionNumber: row.revisionNumber,
    fixtures: design.fixtures,
    runs: design.runs,
    note: row.note,
    approvedAt: iso(row.approvedAt),
    createdAt: iso(row.createdAt)!,
  };
}

function mapEstimate(row: typeof plumbingEstimates.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    revisionId: row.revisionId,
    revisionNumber: 0,
    status: row.status as 'draft' | 'approved' | 'superseded',
    totals: EstimateTotalsSchema.parse(row.totals),
    laborHours: Number(row.laborHours),
    materialMinor: row.materialMinor,
    unpricedLineKeys: z.array(z.string()).parse(row.unpricedLineKeys),
    prices: z.record(z.string(), z.number().int().min(0)).parse(row.prices),
    approvedAt: iso(row.approvedAt),
    createdAt: iso(row.createdAt)!,
  };
}

const plumbingModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/plumbing/projects',
    {
      config: { permission: 'plumbing:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['plumbing'],
        summary: 'Create a plumbing project for this company',
        body: CreatePlumbingProjectRequestSchema,
        response: { 201: PlumbingProjectSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const project = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .insert(plumbingProjects)
          .values({
            orgId: org.orgId,
            name: request.body.name,
            jurisdiction: request.body.jurisdiction,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw new Error('Insert or update returned no row.');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'plumbing.project_created',
          resourceType: 'plumbing_project',
          resourceId: row.id,
          after: { name: row.name },
        });
        return mapProject(row);
      });
      return reply.code(201).send(project);
    },
  );

  app.get(
    '/plumbing/projects',
    {
      config: { permission: 'plumbing:read' },
      schema: {
        tags: ['plumbing'],
        summary: 'List this company’s plumbing projects',
        response: { 200: PlumbingProjectListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(plumbingProjects)
          .where(eq(plumbingProjects.orgId, org.orgId))
          .orderBy(desc(plumbingProjects.updatedAt))
          .limit(100);
        return { items: rows.map(mapProject) };
      });
    },
  );

  app.get(
    '/plumbing/projects/:projectId',
    {
      config: { permission: 'plumbing:read' },
      schema: {
        tags: ['plumbing'],
        summary: 'Project detail with its plans, revisions and estimates',
        params: ProjectParams,
        response: { 200: PlumbingProjectDetailSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [project] = await tx
          .select()
          .from(plumbingProjects)
          .where(
            and(
              eq(plumbingProjects.id, request.params.projectId),
              eq(plumbingProjects.orgId, org.orgId),
            ),
          );
        if (!project) throw problem('not_found');
        const plans = await tx
          .select()
          .from(plumbingPlanVersions)
          .where(eq(plumbingPlanVersions.projectId, project.id))
          .orderBy(desc(plumbingPlanVersions.createdAt));
        const revisions = await tx
          .select()
          .from(plumbingRevisions)
          .where(eq(plumbingRevisions.projectId, project.id))
          .orderBy(desc(plumbingRevisions.revisionNumber));
        const estimates = await tx
          .select()
          .from(plumbingEstimates)
          .where(eq(plumbingEstimates.projectId, project.id))
          .orderBy(desc(plumbingEstimates.createdAt));
        const revisionNumbers = new Map(revisions.map((r) => [r.id, r.revisionNumber]));
        return {
          project: mapProject(project),
          plans: plans.map(mapPlan),
          revisions: revisions.map(mapRevision),
          estimates: estimates.map((row) => ({
            ...mapEstimate(row),
            revisionNumber: revisionNumbers.get(row.revisionId) ?? 0,
          })),
        };
      });
    },
  );

  /** PL-002: record the calibration inputs and the scale they imply. Binary plan storage is not here. */
  app.post(
    '/plumbing/projects/:projectId/plan',
    {
      config: { permission: 'plumbing:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['plumbing'],
        summary: 'Record a calibrated plan page (reference distance and pixels)',
        params: ProjectParams,
        body: CalibratePlanRequestSchema,
        response: { 201: PlanVersionSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      // Derive the scale from the integer pixel count that is actually stored, so the recorded
      // measurement and the recorded scale always describe the same reference line.
      const measuredPixels = Math.max(1, Math.round(request.body.measuredPixels));
      const scale = planScale({ referenceFeet: request.body.referenceFeet, measuredPixels });
      const plan = await tenantTx(request, async (tx) => {
        const [project] = await tx
          .select({ id: plumbingProjects.id })
          .from(plumbingProjects)
          .where(
            and(
              eq(plumbingProjects.id, request.params.projectId),
              eq(plumbingProjects.orgId, org.orgId),
            ),
          );
        if (!project) throw problem('not_found');
        const [row] = await tx
          .insert(plumbingPlanVersions)
          .values({
            orgId: org.orgId,
            projectId: project.id,
            filename: request.body.filename,
            pageNumber: request.body.pageNumber,
            referenceFeet: request.body.referenceFeet.toFixed(3),
            measuredPixels,
            feetPerPixel: scale.feetPerPixel.toFixed(8),
            note: request.body.note ?? null,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw new Error('Insert or update returned no row.');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'plumbing.plan_calibrated',
          resourceType: 'plumbing_plan',
          resourceId: row.id,
          after: { feetPerPixel: row.feetPerPixel },
        });
        return mapPlan(row);
      });
      return reply.code(201).send(plan);
    },
  );

  /** A revision is immutable; saving again creates the next revision number. */
  app.post(
    '/plumbing/projects/:projectId/revisions',
    {
      config: { permission: 'plumbing:estimate', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['plumbing'],
        summary: 'Save the current fixtures and pipe runs as a new design revision',
        params: ProjectParams,
        body: CreateRevisionRequestSchema,
        response: { 201: PlumbingRevisionSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const revision = await tenantTx(request, async (tx) => {
        const [project] = await tx
          .select({ id: plumbingProjects.id })
          .from(plumbingProjects)
          .where(
            and(
              eq(plumbingProjects.id, request.params.projectId),
              eq(plumbingProjects.orgId, org.orgId),
            ),
          );
        if (!project) throw problem('not_found');
        // Serialise revision numbering per project: two concurrent saves must not read the same
        // maximum and then race the unique (org, project, revision_number) constraint.
        await tx
          .select({ id: plumbingProjects.id })
          .from(plumbingProjects)
          .where(eq(plumbingProjects.id, project.id))
          .for('update');
        const [latest] = await tx
          .select({ revisionNumber: plumbingRevisions.revisionNumber })
          .from(plumbingRevisions)
          .where(eq(plumbingRevisions.projectId, project.id))
          .orderBy(desc(plumbingRevisions.revisionNumber))
          .limit(1);
        const [row] = await tx
          .insert(plumbingRevisions)
          .values({
            orgId: org.orgId,
            projectId: project.id,
            revisionNumber: (latest?.revisionNumber ?? 0) + 1,
            fixtures: request.body.design.fixtures,
            runs: request.body.design.runs,
            note: request.body.note ?? null,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw new Error('Insert or update returned no row.');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'plumbing.revision_created',
          resourceType: 'plumbing_revision',
          resourceId: row.id,
          after: { revisionNumber: row.revisionNumber },
        });
        return mapRevision(row);
      });
      return reply.code(201).send(revision);
    },
  );

  /** Recomputes from the stored revision; totals in the request body are impossible by contract. */
  app.post(
    '/plumbing/projects/:projectId/estimates',
    {
      config: { permission: 'plumbing:estimate', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['plumbing'],
        summary: 'Compute and store an estimate for a design revision',
        params: ProjectParams,
        body: ComputeEstimateRequestSchema,
        response: { 201: PlumbingEstimateRecordSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const estimate = await tenantTx(request, async (tx) => {
        const [project] = await tx
          .select()
          .from(plumbingProjects)
          .where(
            and(
              eq(plumbingProjects.id, request.params.projectId),
              eq(plumbingProjects.orgId, org.orgId),
            ),
          );
        if (!project) throw problem('not_found');
        const [revision] = await tx
          .select()
          .from(plumbingRevisions)
          .where(
            and(
              eq(plumbingRevisions.id, request.body.revisionId),
              eq(plumbingRevisions.projectId, project.id),
            ),
          );
        if (!revision) throw problem('not_found');

        const design = PlumbingDesignSchema.parse({
          fixtures: revision.fixtures,
          runs: revision.runs,
        });
        const computed = computeEstimate({
          name: project.name,
          jurisdiction: project.jurisdiction,
          fixtures: design.fixtures,
          runs: design.runs,
          prices: request.body.prices,
          laborRateMinorPerHour: request.body.laborRateMinorPerHour,
          equipmentMinor: request.body.equipmentMinor,
          contingencyPercent: request.body.contingencyPercent,
          overheadPercent: request.body.overheadPercent,
          markupPercent: request.body.markupPercent,
          taxPercent: request.body.taxPercent,
        });

        // A newer estimate supersedes older drafts; approved estimates are never rewritten.
        await tx
          .update(plumbingEstimates)
          .set({ status: 'superseded', revision: sql`${plumbingEstimates.revision} + 1` })
          .where(
            and(eq(plumbingEstimates.projectId, project.id), eq(plumbingEstimates.status, 'draft')),
          );

        const [row] = await tx
          .insert(plumbingEstimates)
          .values({
            orgId: org.orgId,
            projectId: project.id,
            revisionId: revision.id,
            status: 'draft',
            prices: request.body.prices,
            totals: computed.totals,
            laborHours: computed.labor.hours.toFixed(2),
            materialMinor: computed.materialMinor,
            unpricedLineKeys: computed.unpricedLineKeys,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw new Error('Insert or update returned no row.');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'plumbing.estimate_computed',
          resourceType: 'plumbing_estimate',
          resourceId: row.id,
          after: { totalMinor: computed.totals.totalMinor },
        });
        return { ...mapEstimate(row), revisionNumber: revision.revisionNumber };
      });
      return reply.code(201).send(estimate);
    },
  );

  app.get(
    '/plumbing/projects/:projectId/estimates',
    {
      config: { permission: 'plumbing:read' },
      schema: {
        tags: ['plumbing'],
        summary: 'List stored estimates for a project',
        params: ProjectParams,
        response: { 200: PlumbingEstimateRecordListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const revisions = await tx
          .select({ id: plumbingRevisions.id, revisionNumber: plumbingRevisions.revisionNumber })
          .from(plumbingRevisions)
          .where(eq(plumbingRevisions.projectId, request.params.projectId));
        const revisionNumbers = new Map(revisions.map((r) => [r.id, r.revisionNumber]));
        const rows = await tx
          .select()
          .from(plumbingEstimates)
          .where(
            and(
              eq(plumbingEstimates.projectId, request.params.projectId),
              eq(plumbingEstimates.orgId, org.orgId),
            ),
          )
          .orderBy(desc(plumbingEstimates.createdAt));
        return {
          items: rows.map((row) => ({
            ...mapEstimate(row),
            revisionNumber: revisionNumbers.get(row.revisionId) ?? 0,
          })),
        };
      });
    },
  );

  /** Approval freezes the estimate, requires every line to be priced, and is audited. */
  app.post(
    '/plumbing/projects/:projectId/estimates/:estimateId/approve',
    {
      config: { permission: 'plumbing:approve', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['plumbing'],
        summary: 'Approve a priced estimate (freezes it and writes an audit event)',
        params: EstimateParams,
        response: { 200: PlumbingEstimateRecordSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(plumbingEstimates)
          .where(
            and(
              eq(plumbingEstimates.id, request.params.estimateId),
              eq(plumbingEstimates.projectId, request.params.projectId),
              eq(plumbingEstimates.orgId, org.orgId),
            ),
          );
        if (!existing) throw problem('not_found');
        if (existing.status !== 'draft') throw problem('conflict');
        if (z.array(z.string()).parse(existing.unpricedLineKeys).length > 0) {
          throw problem('validation_failed');
        }

        const [row] = await tx
          .update(plumbingEstimates)
          .set({
            status: 'approved',
            approvedAt: new Date(),
            approvedByUserId: org.userId,
            revision: sql`${plumbingEstimates.revision} + 1`,
          })
          .where(eq(plumbingEstimates.id, existing.id))
          .returning();
        if (!row) throw new Error('Insert or update returned no row.');
        const [revision] = await tx
          .select({ revisionNumber: plumbingRevisions.revisionNumber })
          .from(plumbingRevisions)
          .where(eq(plumbingRevisions.id, row.revisionId));
        const totals = EstimateTotalsSchema.parse(row.totals);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'plumbing.estimate_approved',
          resourceType: 'plumbing_estimate',
          resourceId: row.id,
          after: { totalMinor: totals.totalMinor },
        });
        return { ...mapEstimate(row), revisionNumber: revision?.revisionNumber ?? 0 };
      });
    },
  );
};

export default plumbingModule;
