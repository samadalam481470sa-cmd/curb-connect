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
import {
  type BriefField,
  type HouseBriefSpec,
  HouseBriefRequestSchema,
  HouseBriefResponseSchema,
  briefQuestions,
  normalizeHouseBrief,
  parseBriefExtras,
  parseHouseBriefText,
  parsePlanText,
  type PlanGeometryReading,
  planReadingSpec,
} from '@fieldline/contracts';
import { z } from 'zod';
import { askOpenModelWithFallback } from '../../services/open-model';
import { homeDesignVersions, homeProjects } from '../../db/schema/homeBuilder';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { dwgToDxf, looksLikeDwg } from '../../services/plan-dwg';
import { analyzeDxfPlan, analyzePlanGeometry, extractPlanGeometry } from '../../services/plan-geometry';
import { extractPlanPdfText, hasReadableText } from '../../services/plan-pdf';
import marketRoutes from './market';
import studioHouseRoutes from './studioHouses';

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

/** Starting point for anything a brief does not say (matches the House Builder default). */
const BRIEF_DEFAULTS: HouseBriefSpec = {
  lengthFt: 50,
  widthFt: 32,
  stories: 1,
  bedrooms: 3,
  bathrooms: 2,
  garage: 'two_car',
  wallHeightFt: 9,
  roofPitch: 6,
};

const homeBuilderModule: FastifyPluginAsyncZod = async (app) => {
  // Saved studio houses, official price indexes, store prices and lot surroundings.
  await app.register(studioHouseRoutes);
  await app.register(marketRoutes);

  // "AI build": a written brief or an uploaded plan sheet -> the house program. Deterministic parts
  // run without any AI: the typed brief (parser), a plan PDF's text layer (labels, areas, dimension
  // strings), and the budget / lot / on-hand extras. The server's Anthropic key (shared with roof
  // damage photos) adds reading of pictures and scanned sheets. Math always stays outside the AI.
  app.post('/home/brief', {
    bodyLimit: 12 * 1024 * 1024,
    config: { permission: 'estimate:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['home-builder'],
      summary: 'Read a house brief or plan into a house program',
      body: HouseBriefRequestSchema,
      response: { 200: HouseBriefResponseSchema },
    },
  }, async (request) => {
    requireOrg(request);
    const { text, file } = request.body;
    const { anthropicApiKey, model } = request.server.config.roofDamage;
    const openModel = request.server.config.openModel;
    const extras = text ? parseBriefExtras(text) : { budgetCents: null, lot: null, onHand: [], notes: [] };
    const finish = (
      result: { spec: HouseBriefSpec; notes: string[]; read: BriefField[] },
      source: 'ai' | 'rules',
      reading: 'text' | 'pdf_text' | 'pdf_geometry' | 'ai' | 'pdf_text_and_ai',
    ) => ({
      plan: geometry,
      spec: result.spec,
      notes: [...result.notes, ...extras.notes].slice(0, 12),
      source,
      reading,
      questions: briefQuestions(result.read, extras),
      budgetCents: extras.budgetCents,
      lot: extras.lot,
      onHand: extras.onHand,
    });

    // A plan PDF exported from CAD carries its labels and dimensions as text.
    let planText = '';
    let geometry: PlanGeometryReading | null = null;
    if (file?.mediaType === 'application/dxf' || file?.mediaType === 'image/vnd.dwg') {
      // AutoCAD DXF: the drawing units give the scale exactly. A DWG is converted to DXF first
      // (GNU LibreDWG, server-side). Neither is sent to the AI as a file.
      let dxfText: string | null = null;
      if (file.mediaType === 'image/vnd.dwg') {
        const bytes = new Uint8Array(Buffer.from(file.data, 'base64'));
        if (!looksLikeDwg(bytes)) throw problem('validation_failed', 'That file is not an AutoCAD DWG drawing.');
        try {
          dxfText = await dwgToDxf(bytes);
        } catch (err) {
          request.log.info({ err: (err as Error).message }, 'dwg conversion failed');
        }
        if (!dxfText) {
          throw problem('validation_failed', 'That DWG could not be opened. In AutoCAD use Save As → DXF and upload the .dxf file.');
        }
      }
      try {
        const read = analyzeDxfPlan(dxfText ?? Buffer.from(file.data, 'base64').toString('latin1'));
        if (read.footprint || read.rooms.length) geometry = read;
      } catch (err) {
        request.log.info({ err: (err as Error).message }, 'dxf plan could not be read');
      }
      if (!geometry) throw problem('validation_failed', 'That drawing has no walls or room labels that could be read. Check that it is a floor plan.');
    }
    if (file?.mediaType === 'application/pdf') {
      // Walls, outline, rooms and door swings measured from the drawn lines.
      try {
        const read = analyzePlanGeometry(await extractPlanGeometry(new Uint8Array(Buffer.from(file.data, 'base64'))));
        if (read.footprint || read.rooms.length) geometry = read;
      } catch (err) {
        request.log.info({ err: (err as Error).message }, 'plan pdf geometry could not be read');
      }
      try {
        // pdf.js wants a plain Uint8Array, not a Node Buffer.
        const pdf = await extractPlanPdfText(new Uint8Array(Buffer.from(file.data, 'base64')));
        if (hasReadableText(pdf.text)) planText = pdf.text;
      } catch (err) {
        request.log.info({ err: (err as Error).message }, 'plan pdf has no readable text layer');
      }
    }
    const rulesRead = (prefix: string[]) => {
      // Measured lines first, then the plan's own text, then what the person typed.
      const geo = geometry ? planReadingSpec(geometry, BRIEF_DEFAULTS) : null;
      const plan = planText ? parsePlanText(planText, geo?.spec ?? BRIEF_DEFAULTS) : null;
      const typed = text ? parseHouseBriefText(text, plan?.spec ?? geo?.spec ?? BRIEF_DEFAULTS) : null;
      const read = Array.from(new Set([...(geo?.read ?? []), ...(plan?.read ?? []), ...(typed?.read ?? [])]));
      const spec = typed?.spec ?? plan?.spec ?? geo?.spec ?? BRIEF_DEFAULTS;
      const notes = [
        ...prefix,
        ...(geometry?.footprint && geo ? ['Measured the plan\'s drawn lines (no AI needed). Check each value in the plan reading table.', ...geo.notes.slice(0, 4)] : []),
        ...(plan ? ['Read the plan file\'s text (no AI needed). Check each value below.', ...plan.notes] : []),
        ...(typed?.notes ?? []),
      ];
      return { result: { spec, notes, read }, reading: geometry?.footprint ? ('pdf_geometry' as const) : plan ? ('pdf_text' as const) : ('text' as const) };
    };

    if (!anthropicApiKey && !openModel) {
      if (!text && !planText && !geometry) {
        throw problem(
          'dependency_unavailable',
          file?.mediaType === 'application/pdf'
            ? 'This PDF is a scan or picture with no text to read. Reading scans needs AI, which is not set up on this server yet. Type the size, bedrooms and bathrooms, or upload a PDF exported from CAD.'
            : 'Reading a photo of a plan needs AI, which is not set up on this server yet. Type the size, bedrooms and bathrooms, or upload a PDF exported from CAD.',
          { retryable: false },
        );
      }
      const prefix = [
        'Read with the built-in parser (AI is not set up on this server).',
        ...(file && !planText && !geometry ? ['The plan file is a picture or scan; reading it needs AI. Your description was read instead.'] : []),
      ];
      const { result, reading } = rulesRead(prefix);
      return finish(result, 'rules', reading);
    }

    const content: unknown[] = [];
    if (file && file.mediaType !== 'application/dxf' && file.mediaType !== 'image/vnd.dwg') {
      content.push(
        file.mediaType === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: file.mediaType, data: file.data } }
          : { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } },
      );
    }
    content.push({
      type: 'text',
      text: `${text ? `Client brief: ${text}\n\n` : ''}${planText ? `Text found on the plan sheet (may be out of order): ${planText.slice(0, 6000)}\n\n` : ''}${geometry?.footprint ? `Measured from the drawn wall lines: outline ${geometry.footprint.lengthFt} ft by ${geometry.footprint.widthFt} ft (confidence ${geometry.footprint.confidence.toFixed(2)}), ${geometry.rooms.length} labeled rooms, ${geometry.doors} door swings.\n\n` : ''}Read the house described${file && file.mediaType !== 'application/dxf' && file.mediaType !== 'image/vnd.dwg' ? ' in the attached plan' : ''}. Reply with JSON only, no prose, with these keys: lengthFt (overall house length without garage, feet), widthFt (house depth, feet), stories (1 or 2), bedrooms, bathrooms (whole number), garage ("none", "one_car" or "two_car"), wallHeightFt (8, 9 or 10), roofPitch (rise per 12), areaSqFt (conditioned area if stated), notes (array of short plain sentences: what you read from the plan and what you assumed). Use null for anything not given. Do not invent dimensions that are not shown or stated.`,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      let reply: string;
      let openModelUsed: string | null = null;
      if (anthropicApiKey) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': anthropicApiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 800, messages: [{ role: 'user', content }] }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
        reply = body.content?.find((b) => b.type === 'text')?.text ?? '';
      } else {
        // Open model (Qwen): pictures go as images; PDFs go as the text and lines read above.
        const prompt = (content.find((c) => (c as { type: string }).type === 'text') as { text: string }).text;
        const isImage = !!file && file.mediaType.startsWith('image/');
        if (file && !isImage && !planText && !geometry) throw new Error('scanned pdf needs a picture-reading model');
        const answered = await askOpenModelWithFallback(openModel!, {
          text: prompt,
          image: isImage ? { mediaType: file!.mediaType, data: file!.data } : null,
        });
        reply = answered.reply;
        openModelUsed = answered.model;
      }
      const json = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
      const raw = JSON.parse(json) as Record<string, unknown>;
      const normalized = normalizeHouseBrief(raw as Parameters<typeof normalizeHouseBrief>[0], BRIEF_DEFAULTS);
      const aiNotes = Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === 'string').map((n) => n.slice(0, 240)) : [];
      const given = (k: string) => raw[k] !== null && raw[k] !== undefined;
      const read: BriefField[] = [];
      if (given('bedrooms')) read.push('bedrooms');
      if (given('bathrooms')) read.push('bathrooms');
      if (given('lengthFt') || given('areaSqFt')) read.push('size');
      if (given('stories')) read.push('stories');
      if (given('garage')) read.push('garage');
      const by = anthropicApiKey ? [] : [`Read by the open model ${openModelUsed ?? openModel!.model}.`];
      return finish({ spec: normalized.spec, notes: [...by, ...aiNotes, ...normalized.notes], read }, 'ai', planText ? 'pdf_text_and_ai' : 'ai');
    } catch (err) {
      request.log.warn({ err: (err as Error).message }, 'house brief AI failed');
      if (text || planText || geometry) {
        const { result, reading } = rulesRead(['The AI did not answer, so the built-in reader was used.']);
        return finish(result, 'rules', reading);
      }
      throw problem('dependency_unavailable', 'The AI could not read that plan right now. Try again, or type a description.', { retryable: true });
    } finally {
      clearTimeout(timer);
    }
  });

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
