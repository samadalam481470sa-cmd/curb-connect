// AI Home Builder API: persisted projects, versioned designs, AI brief planning, IFC import/export.
// Tenant scope comes from the authenticated session (tenantTx / requireOrg), never from the body.
// Reads need estimate:read; writes need estimate:write. Designs are validated by @fieldline/building-schema
// and every stored version carries its deterministic issues and planning assumptions.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  acceptProposal,
  exportIfc,
  importIfc,
  planDesign,
  HomeDesign,
  type BuildingElement,
} from '@fieldline/building-schema';
import { z } from 'zod';
import { homeDesignVersions, homeProjects } from '../../db/schema/homeBuilder';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';

const Id = z.uuid();
const Project = z.object({
  id: z.uuid(),
  name: z.string(),
  brief: z.string(),
  targetAreaSqFt: z.number().int(),
  budgetCents: z.number().int(),
  createdAt: z.string(),
});
const VersionSummary = z.object({
  versionNumber: z.number().int(),
  issues: z.array(z.unknown()),
  assumptions: z.array(z.string()),
  createdAt: z.string(),
});
const VersionDetail = VersionSummary.extend({ design: z.unknown() });

const CreateFromBrief = z.object({
  name: z.string().trim().min(1).max(160),
  brief: z.string().trim().min(1).max(4000),
});
const AddVersion = z.object({ design: z.unknown() });
const ImportIfc = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  ifc: z.string().min(1).max(5 * 1024 * 1024),
});
const IFC_BODY_LIMIT = 6 * 1024 * 1024;
const JSON_BODY_LIMIT = 1024 * 1024;

const toProject = (row: typeof homeProjects.$inferSelect) => ({
  id: row.id,
  name: row.name,
  brief: row.brief,
  targetAreaSqFt: row.targetAreaSqFt,
  budgetCents: row.budgetCents,
  createdAt: row.createdAt.toISOString(),
});

/** Designs are stored as the validated object; keep the planner's issues with the version. */
function summarizeVersion(row: typeof homeDesignVersions.$inferSelect) {
  return {
    versionNumber: row.versionNumber,
    issues: row.issues as unknown[],
    assumptions: row.assumptions as string[],
    createdAt: row.createdAt.toISOString(),
  };
}

/** Wall-only IFC imports have no floor area, so use the walls' footprint times storeys. */
function footprintSqFt(elements: BuildingElement[], levels: number): number {
  const xs = elements.flatMap((e) => [e.start.x, e.end.x]);
  const ys = elements.flatMap((e) => [e.start.y, e.end.y]);
  if (xs.length === 0) return 1;
  const m2 = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  return Math.max(1, Math.round(m2 * levels * 10.763910416709722));
}

const homeBuilderModule: FastifyPluginAsyncZod = async (app) => {
  app.get('/home/projects', {
    config: { permission: 'estimate:read', rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: { tags: ['home builder'], summary: 'List home-builder projects in the active company', response: { 200: z.array(Project) } },
  }, async (request) => {
    requireOrg(request);
    const rows = await tenantTx(request, (tx) => tx.select().from(homeProjects).orderBy(desc(homeProjects.createdAt)).limit(100));
    return rows.map(toProject);
  });

  app.post('/home/projects', {
    config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    bodyLimit: JSON_BODY_LIMIT,
    schema: {
      tags: ['home builder'],
      summary: 'Create a project from a free-text brief; stores the preliminary design as version 1',
      body: CreateFromBrief,
      response: { 201: z.object({ project: Project, version: VersionDetail }) },
    },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const projectId = randomUUID();
    const plan = planDesign(request.body.brief, {
      design: randomUUID(),
      project: projectId,
      element: randomUUID,
    }, { name: request.body.name });

    const result = await tenantTx(request, async (tx) => {
      const [project] = await tx.insert(homeProjects).values({
        id: projectId,
        orgId: org.orgId,
        name: request.body.name,
        brief: request.body.brief,
        targetAreaSqFt: Math.round(plan.design.targetAreaSqFt),
        budgetCents: plan.design.budgetCents,
        createdByUserId: org.userId,
      }).returning();
      const [version] = await tx.insert(homeDesignVersions).values({
        orgId: org.orgId,
        projectId,
        versionNumber: 1,
        design: plan.design,
        assumptions: plan.assumptions,
        issues: plan.issues,
        createdByUserId: org.userId,
      }).returning();
      return { project: project!, version: version! };
    });
    reply.code(201);
    return {
      project: toProject(result.project),
      version: { ...summarizeVersion(result.version), design: plan.design },
    };
  });

  app.get('/home/projects/:id', {
    config: { permission: 'estimate:read' },
    schema: {
      tags: ['home builder'],
      summary: 'Read a project with its version history (summaries only)',
      params: z.object({ id: Id }),
      response: { 200: z.object({ project: Project, versions: z.array(VersionSummary) }) },
    },
  }, async (request) => {
    requireOrg(request);
    const { project, versions } = await tenantTx(request, async (tx) => {
      const [p] = await tx.select().from(homeProjects).where(eq(homeProjects.id, request.params.id)).limit(1);
      if (!p) throw problem('not_found', 'Home project not found.');
      const v = await tx.select().from(homeDesignVersions)
        .where(eq(homeDesignVersions.projectId, p.id))
        .orderBy(desc(homeDesignVersions.versionNumber));
      return { project: p, versions: v };
    });
    return { project: toProject(project), versions: versions.map(summarizeVersion) };
  });

  app.get('/home/projects/:id/versions/:version', {
    config: { permission: 'estimate:read' },
    schema: {
      tags: ['home builder'],
      summary: 'Read one design version in full',
      params: z.object({ id: Id, version: z.coerce.number().int().positive() }),
      response: { 200: VersionDetail },
    },
  }, async (request) => {
    requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      const [v] = await tx.select().from(homeDesignVersions)
        .where(and(eq(homeDesignVersions.projectId, request.params.id), eq(homeDesignVersions.versionNumber, request.params.version)))
        .limit(1);
      if (!v) throw problem('not_found', 'Design version not found.');
      return v;
    });
    return { ...summarizeVersion(row), design: row.design };
  });

  app.post('/home/projects/:id/versions', {
    config: { permission: 'estimate:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
    bodyLimit: JSON_BODY_LIMIT,
    schema: {
      tags: ['home builder'],
      summary: 'Append a design version. The design must validate and pass the checks with no errors.',
      params: z.object({ id: Id }),
      body: AddVersion,
      response: { 201: VersionSummary },
    },
  }, async (request, reply) => {
    const org = requireOrg(request);
    let accepted: ReturnType<typeof acceptProposal>;
    try {
      accepted = acceptProposal(request.body.design);
    } catch (err) {
      throw problem('validation_failed', err instanceof Error ? err.message : 'Design is invalid.');
    }
    if (accepted.design.projectId !== request.params.id) {
      throw problem('validation_failed', 'design.projectId does not match this project.');
    }
    const row = await tenantTx(request, async (tx) => {
      // Lock the project row so two saves cannot both claim the same next version number.
      const locked = await tx.execute(sql`SELECT id FROM public.home_projects WHERE id = ${request.params.id}::uuid FOR UPDATE`);
      if (locked.length === 0) throw problem('not_found', 'Home project not found.');
      const [latest] = await tx.select({ n: sql<number>`coalesce(max(${homeDesignVersions.versionNumber}), 0)` })
        .from(homeDesignVersions).where(eq(homeDesignVersions.projectId, request.params.id));
      const [inserted] = await tx.insert(homeDesignVersions).values({
        orgId: org.orgId,
        projectId: request.params.id,
        versionNumber: Number(latest?.n ?? 0) + 1,
        design: accepted.design,
        assumptions: [],
        issues: accepted.issues,
        createdByUserId: org.userId,
      }).returning();
      return inserted!;
    });
    reply.code(201);
    return summarizeVersion(row);
  });

  app.get('/home/projects/:id/export.ifc', {
    config: { permission: 'estimate:read', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['home builder'], summary: 'Export the latest design version as an IFC4 file', params: z.object({ id: Id }) },
  }, async (request, reply) => {
    requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      const [v] = await tx.select().from(homeDesignVersions)
        .where(eq(homeDesignVersions.projectId, request.params.id))
        .orderBy(desc(homeDesignVersions.versionNumber)).limit(1);
      if (!v) throw problem('not_found', 'No design version to export.');
      return v;
    });
    const design = HomeDesign.parse(row.design);
    const { text, skipped } = exportIfc(design);
    reply.header('cache-control', 'private, no-store');
    reply.header('content-disposition', `attachment; filename="home-v${row.versionNumber}.ifc"`);
    reply.header('x-ifc-skipped-elements', String(skipped.length));
    reply.type('application/x-step');
    return text;
  });

  app.post('/home/import-ifc', {
    config: { permission: 'estimate:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
    bodyLimit: IFC_BODY_LIMIT,
    schema: {
      tags: ['home builder'],
      summary: 'Create a project from an IFC file (walls and storeys). Unsupported geometry is reported.',
      body: ImportIfc,
      response: { 201: z.object({ project: Project, warnings: z.array(z.string()) }) },
    },
  }, async (request, reply) => {
    const org = requireOrg(request);
    let imported: ReturnType<typeof importIfc>;
    try {
      imported = importIfc(request.body.ifc);
    } catch (err) {
      throw problem('validation_failed', err instanceof Error ? `Could not read IFC: ${err.message}` : 'Could not read IFC.');
    }
    if (imported.levels.length === 0 && imported.walls.length === 0) {
      throw problem('validation_failed', 'The IFC file contains no walls or storeys this importer supports.');
    }
    const levels = (imported.levels.length > 0 ? imported.levels : [{ name: 'Ground floor', elevationM: 0 }]).map((l, index) => ({
      index,
      name: l.name || `Level ${index + 1}`,
      elevationM: l.elevationM,
      heightM: 3,
    }));
    const elements: BuildingElement[] = imported.walls.map((w) => ({
      id: randomUUID(),
      type: 'wall' as const,
      name: w.name || 'Imported wall',
      level: Math.min(w.level, levels.length - 1),
      start: w.start,
      end: w.end,
      heightM: w.heightM,
      thicknessM: w.thicknessM,
    }));
    const projectId = randomUUID();
    const name = request.body.name ?? (imported.name || 'Imported IFC model');
    const areaSqFt = footprintSqFt(elements, levels.length);
    const design = HomeDesign.parse({
      id: randomUUID(),
      projectId,
      name,
      targetAreaSqFt: areaSqFt,
      budgetCents: 0,
      levels,
      elements,
      version: 1,
    });
    const assumptions = ['Imported from IFC: walls and storeys only; openings, slabs and MEP are not imported.'];
    const issues = acceptProposal(design).issues;
    const project = await tenantTx(request, async (tx) => {
      const [p] = await tx.insert(homeProjects).values({
        id: projectId,
        orgId: org.orgId,
        name,
        brief: 'Imported from IFC',
        targetAreaSqFt: areaSqFt,
        budgetCents: 0,
        createdByUserId: org.userId,
      }).returning();
      await tx.insert(homeDesignVersions).values({
        orgId: org.orgId,
        projectId,
        versionNumber: 1,
        design,
        assumptions,
        issues,
        createdByUserId: org.userId,
      });
      return p!;
    });
    reply.code(201);
    return { project: toProject(project), warnings: [...imported.warnings] };
  });
};

export default homeBuilderModule;
