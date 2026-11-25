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
  LandFeasibilityProjectListSchema,
  SaveLandFeasibilityProjectRequestSchema,
  SavedLandFeasibilityProjectSchema,
} from '@fieldline/contracts';
import { renderToBuffer, type ConceptSitePlanSnapshot } from '@fieldline/pdf';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { landFeasibilityProjects } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
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
