// `landFeasibility` module: saved feasibility projects. A project is a named snapshot of one
// land-feasibility run (the inputs the builder entered plus the client-computed summary), so
// the builder can flip between saved projects instead of re-entering a parcel. Persistence
// reuses the Land Scout saved-buy-box pattern (org-scoped, tenantTx, auditRequest, zod
// schemas) with its own table — Land Scout buy boxes are a different feature. The
// `land_feasibility:read` / `land_feasibility:write` actions live in the contracts RBAC
// POLICY (packages/contracts/src/rbac.ts), mirroring land_scout.
import {
  ConceptPlanRequestSchema,
  ConceptPlanResponseSchema,
  CreateCommunityFromFeasibilityRequestSchema,
  CreateCommunityFromFeasibilityResponseSchema,
  LandFeasibilityProjectListSchema,
  LandFeasibilitySummarySchema,
  SaveLandFeasibilityProjectRequestSchema,
  SavedLandFeasibilityProjectSchema,
} from '@fieldline/contracts';
import { renderToBuffer, type ConceptSitePlanSnapshot } from '@fieldline/pdf';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { landCommunities, landFeasibilityProjects, landLots, landPhases } from '../../db/schema';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { planCommunityMaterialization } from './materialize';
import { projectDto } from './projects';

// The land_feasibility actions live in the RBAC POLICY; the route config below uses them directly.
const READ = 'land_feasibility:read';
const WRITE = 'land_feasibility:write';

const landFeasibilityModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/land-feasibility/projects',
    {
      config: { permission: READ },
      schema: {
        tags: ['land-feasibility'],
        summary: 'Saved feasibility projects for this company, newest first',
        response: { 200: LandFeasibilityProjectListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(landFeasibilityProjects)
          .where(eq(landFeasibilityProjects.orgId, orgId))
          .orderBy(desc(landFeasibilityProjects.createdAt))
          .limit(100),
      );
      return { items: rows.map(projectDto) };
    },
  );

  app.post(
    '/land-feasibility/projects',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-feasibility'],
        summary: 'Save the current feasibility run as a named project',
        body: SaveLandFeasibilityProjectRequestSchema,
        response: { 201: SavedLandFeasibilityProjectSchema },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(landFeasibilityProjects)
          .values({
            orgId,
            name: request.body.name,
            inputs: request.body.inputs,
            summary: request.body.summary,
            createdByUserId: userId,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'land_feasibility.project_saved',
          resourceType: 'land_feasibility_project',
          resourceId: created.id,
          after: { name: created.name },
        });
        return created;
      });
      reply.code(201);
      return projectDto(row);
    },
  );

  app.delete(
    '/land-feasibility/projects/:id',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['land-feasibility'],
        summary: 'Delete a saved feasibility project',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      await tenantTx(request, async (tx) => {
        const deleted = await tx
          .delete(landFeasibilityProjects)
          .where(
            and(
              eq(landFeasibilityProjects.orgId, orgId),
              eq(landFeasibilityProjects.id, request.params.id),
            ),
          )
          .returning({ id: landFeasibilityProjects.id });
        if (deleted.length === 0) throw problem('not_found');
        await auditRequest(request, tx, {
          orgId,
          action: 'land_feasibility.project_deleted',
          resourceType: 'land_feasibility_project',
          resourceId: request.params.id,
        });
      });
      return { ok: true };
    },
  );

  app.post(
    '/land-feasibility/projects/:id/create-community',
    {
      config: { permission: WRITE, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-feasibility'],
        summary:
          'Create a Land Management community (phases + lots) from this feasibility project; converting again returns the same community',
        params: z.object({ id: z.uuid() }),
        body: CreateCommunityFromFeasibilityRequestSchema,
        response: { 200: CreateCommunityFromFeasibilityResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      // Conversion writes into Land Management — that permission is required too.
      assertCan(request, 'land_management:write');
      return tenantTx(request, async (tx) => {
        const [project] = await tx
          .select()
          .from(landFeasibilityProjects)
          .where(
            and(
              eq(landFeasibilityProjects.orgId, orgId),
              eq(landFeasibilityProjects.id, request.params.id),
            ),
          )
          .for('update');
        if (!project) throw problem('not_found');

        // Idempotent: a converted project returns its community, creating nothing.
        if (project.communityId) {
          const [community] = await tx
            .select()
            .from(landCommunities)
            .where(
              and(eq(landCommunities.orgId, orgId), eq(landCommunities.id, project.communityId)),
            )
            .limit(1);
          if (community) {
            const [phaseCount] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(landPhases)
              .where(and(eq(landPhases.orgId, orgId), eq(landPhases.communityId, community.id)));
            const [lotCount] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(landLots)
              .where(and(eq(landLots.orgId, orgId), eq(landLots.communityId, community.id)));
            return {
              projectId: project.id,
              communityId: community.id,
              communityName: community.name,
              created: false,
              phasesCreated: Number(phaseCount?.count ?? 0),
              lotsCreated: Number(lotCount?.count ?? 0),
              lotSource: 'none' as const,
              note: 'This project was already converted — returning its existing community. Nothing was duplicated.',
            };
          }
        }

        const summary = LandFeasibilitySummarySchema.parse(project.summary);
        const plan = planCommunityMaterialization({
          layout: request.body.layout ?? null,
          lotCount: summary.lotCount,
        });
        const [community] = await tx
          .insert(landCommunities)
          .values({
            orgId,
            name: request.body.name ?? project.name,
            status: 'planning',
            notes: `Created from feasibility project "${project.name}" (summary client-computed at save time).`,
          })
          .returning();
        if (!community) throw problem('internal');

        const phaseIdByName = new Map<string, string>();
        for (const phase of plan.phases) {
          const [created] = await tx
            .insert(landPhases)
            .values({
              orgId,
              communityId: community.id,
              name: phase.name,
              status: 'planned',
              plannedLotCount: phase.plannedLotCount,
            })
            .returning();
          if (!created) throw problem('internal');
          phaseIdByName.set(phase.name, created.id);
        }
        for (const lot of plan.lots) {
          await tx.insert(landLots).values({
            orgId,
            communityId: community.id,
            phaseId: lot.phaseName ? (phaseIdByName.get(lot.phaseName) ?? null) : null,
            lotNumber: lot.lotNumber,
            status: 'held',
            widthFt: lot.widthFt != null ? String(lot.widthFt) : null,
            depthFt: lot.depthFt != null ? String(lot.depthFt) : null,
          });
        }
        await tx
          .update(landFeasibilityProjects)
          .set({ communityId: community.id, updatedAt: new Date() })
          .where(eq(landFeasibilityProjects.id, project.id));
        await auditRequest(request, tx, {
          orgId,
          action: 'land_feasibility.community_created',
          resourceType: 'land_feasibility_project',
          resourceId: project.id,
          after: {
            communityId: community.id,
            phasesCreated: plan.phases.length,
            lotsCreated: plan.lots.length,
            lotSource: plan.lotSource,
          },
        });
        return {
          projectId: project.id,
          communityId: community.id,
          communityName: community.name,
          created: true,
          phasesCreated: plan.phases.length,
          lotsCreated: plan.lots.length,
          lotSource: plan.lotSource,
          note: plan.lotCountTooLarge
            ? 'Community created without lots: the stored lot count is too large to materialize — add phases and lots in Land Management.'
            : plan.lotSource === 'layout'
              ? 'Community, phases and lots created from the layout you sent (client-computed). Lot prices are not set — price them in Land Management.'
              : plan.lotSource === 'summary_lot_count'
                ? 'Community and lots created from the stored lot count (client-computed at save time). Add phases, dimensions and prices in Land Management.'
                : 'Community created. Add phases and lots in Land Management.',
        };
      });
    },
  );

  app.post(
    '/land-feasibility/concept-plan',
    {
      bodyLimit: 2 * 1024 * 1024,
      config: { permission: 'export:create', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-feasibility'],
        summary: 'Render the current run as a Concept for Discussion site-plan PDF (never a survey)',
        body: ConceptPlanRequestSchema,
        response: { 200: ConceptPlanResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const body = request.body;
      const now = new Date();
      const documentId = `CONCEPT-${now.toISOString().slice(0, 10)}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
      const snapshot: ConceptSitePlanSnapshot = {
        kind: 'concept_site_plan',
        meta: {
          documentId,
          revision: 1,
          issuedAt: now.toISOString(),
          organization: { name: body.organizationName },
          productName: 'Field Pro',
        },
        projectName: body.projectName,
        parcelWidthFt: body.parcelWidthFt,
        parcelDepthFt: body.parcelDepthFt,
        acres: body.acres,
        road: body.road,
        lots: body.lots,
        homeFootprint: body.homeFootprint,
        exitPlanLabel: body.exitPlanLabel,
        summaryLines: body.summaryLines,
        assumptions: body.assumptions,
        disclaimers: [
          'Concept for discussion only. This sheet is not a survey, plat, zoning approval or engineering design. Confirm boundaries with a surveyor, zoning with the city, and every price with your cost book before relying on it.',
        ],
      };
      const rendered = await renderToBuffer(snapshot);
      return {
        filename: `${documentId}.pdf`,
        contentBase64: rendered.buffer.toString('base64'),
        sha256Hex: rendered.sha256,
        pages: rendered.pageCount,
      };
    },
  );
};

export default landFeasibilityModule;
