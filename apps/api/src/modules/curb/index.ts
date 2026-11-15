// `curb` module (Fieldline CV-041..CV-050, CP-051..CP-060; COS-226..COS-250; ADD-040..ADD-056):
// curb projects, typed intake observations with explicit unknown, guided capture with safety copy,
// photo quality + recognition through services/vision (abstain -> manual review), privacy
// redactions, calibrations, piecewise segments with versioned corrections, measurements with
// provenance, rule-engine risk flags, permits, safety reviews, curb estimates through the shared
// estimates engine, and approval/dispatch readiness. Every edit is a command (./commands.ts)
// through the shared pipeline; typed endpoints take { expectedRevision, payload }.
import {
  CaptureChecklistSchema,
  CommandReceiptSchema,
  CreateCurbEstimateRequestSchema,
  CreateCurbProjectRequestSchema,
  CURB_CAPTURE_PROTOCOL,
  CURB_CAPTURE_PROTOCOL_VERSION,
  CURB_COMMAND_PAYLOADS,
  CURB_INTAKE_QUESTIONS,
  CurbProjectSchema,
  type CurbCommandType,
  CurbReadinessSchema,
  CurbRecognitionOutcomeSchema,
  curbCommandBody,
  EstimateSchema,
  PhotoQualityOutcomeSchema,
  RedactionKindSchema,
  UuidSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { calibrations, curbProjects, estimates, mediaAssets, mediaRedactions } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { idempotent } from '../../http/idempotency';
import { problem } from '../../http/problem';
import { setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { mediaObjectKey } from '../../storage';
import { executeResourceCommand } from '../commands/pipeline';
import { estimateDto, signoffResolver } from '../estimates';
import { applyRevision, computeRevision, nextEstimateNumber } from '../estimates/service';
import { loadProperty } from '../properties/service';
import { visionClient } from '../vision/client';
import { registerCurbCommands } from './commands';
import {
  derivedSiteConditions,
  estimateInputs,
  jurisdictionRulesVersion,
  loadProject,
  nextProjectNumber,
  projectDetail,
  projectDto,
  projectMedia,
  readiness,
  syncRules,
} from './service';

registerCurbCommands();

const Id = z.object({ id: UuidSchema });

const VERDICT_CODE = { usable: 0, usable_with_warnings: 1, retake_required: 2 } as const;
/**
 * media_assets.quality_scores is numeric-only (MediaAssetSchema), so the 64-bit dHash is kept as
 * two 32-bit halves for the duplicate check; verdict details live in the audit trail.
 */
function qualityScores(r: { verdict: keyof typeof VERDICT_CODE; hashes: { dhash: string }; checks: { blur?: { laplacianVariance?: number | null } }; exif: { gpsPresent: boolean } }) {
  const d = r.hashes.dhash.padStart(16, '0');
  return {
    verdictCode: VERDICT_CODE[r.verdict],
    dhashHi: parseInt(d.slice(0, 8), 16),
    dhashLo: parseInt(d.slice(8, 16), 16),
    gpsPresent: r.exif.gpsPresent ? 1 : 0,
    ...(typeof r.checks.blur?.laplacianVariance === 'number' && { blurLaplacianVariance: r.checks.blur.laplacianVariance }),
  };
}
function dhashOf(q: Record<string, number> | null): string | null {
  if (!q || typeof q.dhashHi !== 'number' || typeof q.dhashLo !== 'number') return null;
  return q.dhashHi.toString(16).padStart(8, '0') + q.dhashLo.toString(16).padStart(8, '0');
}
const Row = z.record(z.string(), z.unknown());
const DetailSchema = z.object({
  project: CurbProjectSchema,
  observations: z.array(Row),
  calibrations: z.array(Row),
  segments: z.array(Row),
  measurements: z.array(Row),
  riskFlags: z.array(Row),
  permits: z.array(Row),
  safetyReviews: z.array(Row),
});
const CommandResponse = z.object({ receipt: CommandReceiptSchema, detail: DetailSchema });

async function detailOf(request: FastifyRequest, id: string) {
  const org = requireOrg(request);
  return tenantTx(request, async (tx) => {
    const p = await loadProject(tx, org.orgId, id);
    if (!p) throw problem('not_found');
    return projectDetail(tx, p);
  });
}

async function runProjectCommand(request: FastifyRequest, reply: FastifyReply, type: CurbCommandType, id: string, body: { expectedRevision: number; payload: Record<string, unknown> }) {
  const { receipt } = await executeResourceCommand(request, reply, { type, aggregateId: id, expectedRevision: body.expectedRevision, payload: body.payload });
  return { receipt, detail: await detailOf(request, id) };
}

/** Typed endpoints mapped onto curb commands (path suffix, command, summary). */
const TYPED: [string, CurbCommandType, string, 'post' | 'patch'][] = [
  ['', 'CurbProjectUpdated', 'Edit project fields (ownership/right-of-way, profile, service, cancel)', 'patch'],
  ['/observations', 'CurbObservationsAnswered', 'Answer intake questions (known or explicit unknown)', 'post'],
  ['/calibrations', 'CurbCalibrationRecorded', 'Calibrate a photo: 2-point reference, 4+ point homography, or field dimensions', 'post'],
  ['/segments', 'CurbSegmentSaved', 'Create or correct (versioned) a curb segment: saw-cut path, footprint, return, replacement, obstruction', 'post'],
  ['/measurements', 'CurbMeasurementRecorded', 'Record a dimension with provenance (field_verified needs curb_measurement:verify)', 'post'],
  ['/risk-flags', 'CurbRiskFlagRaised', 'Raise a manual risk flag', 'post'],
  ['/risk-flags/resolve', 'CurbRiskFlagResolved', 'Resolve a manual or overridable rule flag with a note', 'post'],
  ['/permits', 'CurbPermitUpdated', 'Update a permit requirement (status, reference, expiry, checklist)', 'post'],
  ['/safety-reviews', 'CurbSafetyReviewDecided', 'Sign a safety review with its checklist', 'post'],
];

const curbModule: FastifyPluginAsyncZod = async (app) => {
  app.get('/curb/intake-questions', { config: { permission: 'curb_project:read' }, schema: { tags: ['curb'], summary: 'Typed intake questions (every one accepts unknown)', response: { 200: z.object({ items: z.array(Row) }) } } }, async () => ({ items: CURB_INTAKE_QUESTIONS.map((q) => ({ ...q })) }));

  app.get('/curb/capture-protocol', { config: { permission: 'curb_project:read' }, schema: { tags: ['curb'], summary: 'Guided capture shot list with safety copy', response: { 200: z.object({ version: z.string(), shots: z.array(Row) }) } } }, async () => ({ version: CURB_CAPTURE_PROTOCOL_VERSION, shots: CURB_CAPTURE_PROTOCOL.map((s) => ({ ...s })) }));

  app.post(
    '/curb/projects',
    { config: { permission: 'curb_project:write' }, schema: { tags: ['curb'], summary: 'Create a curb project (jurisdiction from the property)', body: CreateCurbProjectRequestSchema, response: { 201: DetailSchema } } },
    async (request, reply) => {
      const org = requireOrg(request);
      const b = request.body;
      return idempotent(request, reply, { required: false }, async (tx) => {
        const property = await loadProperty(tx, org.orgId, b.propertyId);
        if (!property) throw problem('not_found', 'Property not found.');
        const [row] = await tx
          .insert(curbProjects)
          .values({
            orgId: org.orgId,
            number: await nextProjectNumber(tx, org.orgId),
            propertyId: b.propertyId,
            jobId: b.jobId ?? null,
            customerId: b.customerId ?? null,
            serviceCode: b.serviceCode,
            description: b.description ?? null,
            jurisdictionId: property.jurisdictionId,
            jurisdictionRulesVersion: await jurisdictionRulesVersion(tx, property.jurisdictionId),
            ...(b.siteLocation && { siteLocation: sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(b.siteLocation)}), 4326)` as never }),
          })
          .returning();
        const rules = await syncRules(tx, row!, org.userId);
        await auditRequest(request, tx, { orgId: org.orgId, action: 'curb_project.created', resourceType: 'curb_project', resourceId: row!.id, after: { number: row!.number, serviceCode: row!.serviceCode, rules } });
        return { status: 201, body: await projectDetail(tx, row!) };
      });
    },
  );

  app.get(
    '/curb/projects',
    { config: { permission: 'curb_project:read' }, schema: { tags: ['curb'], summary: 'Curb projects', querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }), response: { 200: z.object({ items: z.array(CurbProjectSchema), nextCursor: z.string().nullable() }) } } },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx.select().from(curbProjects).where(eq(curbProjects.orgId, org.orgId)).orderBy(desc(curbProjects.createdAt)).limit(request.query.limit);
        const items = [];
        for (const r of rows) items.push(await projectDto(tx, r));
        return { items, nextCursor: null };
      });
    },
  );

  app.get('/curb/projects/:id', { config: { permission: 'curb_project:read' }, schema: { tags: ['curb'], summary: 'Project with observations, calibrations, segments, measurements, flags, permits, reviews', params: Id, response: { 200: DetailSchema } } }, async (request, reply) => {
    const d = await detailOf(request, request.params.id);
    setEtag(reply, d.project.revision);
    return d;
  });

  for (const [suffix, type, summary, method] of TYPED) {
    const body = curbCommandBody(CURB_COMMAND_PAYLOADS[type] as unknown as z.ZodType<Record<string, unknown>>);
    app[method](
      `/curb/projects/:id${suffix}`,
      { config: { permission: 'curb_project:read' }, schema: { tags: ['curb'], summary: `${summary} (command ${type})`, params: Id, body, response: { 200: CommandResponse } } },
      async (request, reply) => runProjectCommand(request, reply, type, request.params.id, request.body as { expectedRevision: number; payload: Record<string, unknown> }),
    );
  }

  app.get('/curb/projects/:id/readiness', { config: { permission: 'curb_project:read' }, schema: { tags: ['curb'], summary: 'Firm-approval and dispatch gates (read only)', params: Id, response: { 200: CurbReadinessSchema } } }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      const p = await loadProject(tx, org.orgId, request.params.id);
      if (!p) throw problem('not_found');
      return readiness(tx, p) as never;
    });
  });

  // ---------------------------------------------------------------- guided capture (CV-043, CV-044)
  app.get('/curb/projects/:id/capture', { config: { permission: 'curb_project:read' }, schema: { tags: ['curb'], summary: 'Capture checklist: required shots, quality status and replace instructions', params: Id, response: { 200: CaptureChecklistSchema } } }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      const p = await loadProject(tx, org.orgId, request.params.id);
      if (!p) throw problem('not_found');
      const media = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.orgId, org.orgId), eq(mediaAssets.ownerType, 'curb_project'), eq(mediaAssets.ownerId, p.id), sql`${mediaAssets.deletedAt} is null`)).orderBy(asc(mediaAssets.createdAt));
      const instructions: string[] = [];
      const shots = CURB_CAPTURE_PROTOCOL.map((s) => {
        const mine = media.filter((m) => m.viewType === s.viewType);
        const usable = mine.filter((m) => m.qualityPassed === true);
        const status = usable.length ? 'captured' : mine.some((m) => m.qualityPassed === false) ? 'retake_required' : mine.length ? 'not_scored' : 'missing';
        if (s.required && status !== 'captured') {
          instructions.push(status === 'retake_required' ? `Retake "${s.label}": the photo failed the quality check. ${s.instructions}` : status === 'not_scored' ? `Run the photo check for "${s.label}".` : `Capture "${s.label}": ${s.instructions} ${s.safety}`);
        }
        return { ...s, status: status as 'missing' | 'captured' | 'retake_required' | 'not_scored', mediaAssetIds: mine.map((m) => m.id) };
      });
      if (shots.find((s) => s.viewType === 'scale_reference')?.status !== 'captured') instructions.push('Without a scale reference, measure the curb on site and enter field dimensions.');
      return { protocolVersion: CURB_CAPTURE_PROTOCOL_VERSION, complete: shots.every((s) => !s.required || s.status === 'captured'), shots, instructions };
    });
  });

  const PhotoParams = z.object({ id: UuidSchema, assetId: UuidSchema });

  app.post('/curb/projects/:id/photos/:assetId/quality', { config: { permission: 'curb_media:upload' }, schema: { tags: ['curb'], summary: 'Deterministic photo quality check via the vision worker', params: PhotoParams, response: { 200: PhotoQualityOutcomeSchema } } }, async (request) => {
    const org = requireOrg(request);
    const { asset, compare } = await tenantTx(request, async (tx) => {
      const p = await loadProject(tx, org.orgId, request.params.id);
      if (!p) throw problem('not_found');
      const asset = await projectMedia(tx, p, request.params.assetId);
      const others = await tx.select({ id: mediaAssets.id, q: mediaAssets.qualityScores, sha256: mediaAssets.sha256 }).from(mediaAssets).where(and(eq(mediaAssets.orgId, org.orgId), eq(mediaAssets.ownerType, 'curb_project'), eq(mediaAssets.ownerId, p.id), sql`${mediaAssets.id} <> ${asset.id}`));
      const compare = others.flatMap((o) => {
        const d = dhashOf(o.q as Record<string, number> | null);
        return d ? [{ id: o.id, dhash: d, sha256: o.sha256 }] : [];
      });
      return { asset, compare };
    });
    if (asset.kind !== 'photo') throw problem('validation_failed', 'Only photos are quality-checked.');
    const bytes = await request.server.storage.get(asset.originalObjectKey || mediaObjectKey(org.orgId, asset.id, 'original'));
    const r = await visionClient(request.server.config.vision.url).photoQuality({ bytes, mimeType: asset.mimeType, photoId: asset.id, viewType: asset.viewType, compareHashes: compare, rights: { analyze: true, source: 'contractor_upload' } });
    const duplicateOf = (r.checks.duplicate?.matches ?? []).filter((m) => m.match !== 'similar').map((m) => m.id);
    await tenantTx(request, async (tx) => {
      await tx
        .update(mediaAssets)
        .set({ qualityScores: qualityScores(r), qualityPassed: r.verdict !== 'retake_required', revision: asset.revision + 1 })
        .where(eq(mediaAssets.id, asset.id));
      await auditRequest(request, tx, { orgId: org.orgId, action: 'curb_photo.quality_checked', resourceType: 'media_asset', resourceId: asset.id, after: { verdict: r.verdict, reasons: r.reasons.map((x) => x.code), metricVersion: r.metricVersion } });
    });
    return {
      mediaAssetId: asset.id,
      viewType: asset.viewType,
      verdict: r.verdict,
      instructions: r.reasons.map((x) => ({ code: x.code, severity: x.severity, message: x.message, action: x.action })),
      duplicateOf,
      gpsPresent: r.exif.gpsPresent,
      metricVersion: r.metricVersion,
      thresholdsVersion: r.thresholdsVersion,
    };
  });

  app.post('/curb/projects/:id/photos/:assetId/recognize', { config: { permission: 'curb_project:read' }, schema: { tags: ['curb'], summary: 'Curb recognizer; an abstention is surfaced as manual review', params: PhotoParams, response: { 200: CurbRecognitionOutcomeSchema } } }, async (request) => {
    const org = requireOrg(request);
    const { asset, calibrationId } = await tenantTx(request, async (tx) => {
      const p = await loadProject(tx, org.orgId, request.params.id);
      if (!p) throw problem('not_found');
      const asset = await projectMedia(tx, p, request.params.assetId);
      const [cal] = await tx.select({ id: calibrations.id }).from(calibrations).where(and(eq(calibrations.orgId, org.orgId), eq(calibrations.mediaAssetId, asset.id), eq(calibrations.status, 'accepted')));
      return { asset, calibrationId: cal?.id ?? null };
    });
    const bytes = await request.server.storage.get(asset.originalObjectKey);
    const r = await visionClient(request.server.config.vision.url).recognizeCurb({ bytes, mimeType: asset.mimeType, photoId: asset.id, viewType: asset.viewType, scaleReferenceId: calibrationId, rights: { analyze: true, source: 'contractor_upload' } });
    const abstained = r.resultType !== 'prediction' || !r.model;
    const out = {
      mediaAssetId: asset.id,
      status: abstained ? ('manual_review' as const) : ('suggestion' as const),
      reason: abstained ? (r.abstention?.message ?? 'No validated model enabled; route to manual review.') : 'Model suggestion; a person must confirm before it is used.',
      model: r.model ? { modelId: r.model.modelId, version: r.model.version } : null,
      suggestions: abstained ? null : { geometries: r.geometries ?? [], measurements: r.measurements ?? null, confidence: r.confidence ?? null },
      neverInferred: ['reinforcement', 'buried_depth', 'section_thickness', 'utility_clearance', 'right_of_way_authorization', 'municipal_approval'],
    };
    await tenantTx(request, (tx) => auditRequest(request, tx, { orgId: org.orgId, action: 'curb_photo.recognition', resourceType: 'media_asset', resourceId: asset.id, after: { status: out.status, reason: r.abstention?.reasonCode ?? null, model: out.model } }));
    return out;
  });

  app.post(
    '/curb/projects/:id/photos/:assetId/redactions',
    {
      config: { permission: 'curb_media:upload' },
      schema: { tags: ['curb'], summary: 'Record a privacy redaction (face, plate, neighbour property, text)', params: PhotoParams, body: z.object({ kind: RedactionKindSchema, region: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]) }), response: { 201: z.object({ id: UuidSchema, mediaAssetId: UuidSchema, kind: RedactionKindSchema, region: z.array(z.number()), automatic: z.boolean() }) } },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const out = await tenantTx(request, async (tx) => {
        const p = await loadProject(tx, org.orgId, request.params.id);
        if (!p) throw problem('not_found');
        const asset = await projectMedia(tx, p, request.params.assetId);
        const [x, y, w, h] = request.body.region;
        if (x + w > 1 || y + h > 1 || w <= 0 || h <= 0) throw problem('validation_failed', 'The region must lie inside the image.');
        const [row] = await tx.insert(mediaRedactions).values({ orgId: org.orgId, mediaAssetId: asset.id, kind: request.body.kind, region: request.body.region, automatic: false, confirmedByUserId: org.userId }).returning();
        await auditRequest(request, tx, { orgId: org.orgId, action: 'media.redaction_recorded', resourceType: 'media_asset', resourceId: asset.id, after: { kind: row!.kind } });
        return { id: row!.id, mediaAssetId: asset.id, kind: row!.kind, region: row!.region as number[], automatic: row!.automatic };
      });
      reply.status(201);
      return out;
    },
  );

  // ---------------------------------------------------------------- estimates (CP-052, CP-058)
  app.post(
    '/curb/projects/:id/estimates',
    { config: { permission: 'estimate:write' }, schema: { tags: ['curb'], summary: 'Price a curb estimate from recorded measurements + derived site conditions (Idempotency-Key required)', params: Id, body: CreateCurbEstimateRequestSchema, response: { 201: EstimateSchema } } },
    async (request, reply) => {
      const org = requireOrg(request);
      const b = request.body;
      return idempotent(request, reply, { required: true }, async (tx) => {
        const p = await loadProject(tx, org.orgId, request.params.id, true);
        if (!p) throw problem('not_found');
        await syncRules(tx, p, org.userId);
        const lines = b.lines.map((l) => {
          if ((l.quantityKey === undefined) === (l.quantity === undefined)) throw problem('validation_failed', `${l.code}: give exactly one of quantityKey or quantity.`);
          return l.quantityKey ? { code: l.code, quantityKey: l.quantityKey, critical: l.critical } : { code: l.code, quantity: l.quantity!, critical: l.critical };
        });
        const computed = await computeRevision(
          tx,
          org.orgId,
          { productLine: 'curb', curbProjectId: p.id, propertyId: p.propertyId },
          { inputs: await estimateInputs(tx, p), lineSpecs: lines, siteConditions: await derivedSiteConditions(tx, p), assumptions: b.assumptions, priceBookRevisionId: b.priceBookRevisionId ?? null },
          signoffResolver(tx, org.orgId, 'curb'),
        );
        const [e] = await tx.insert(estimates).values({ orgId: org.orgId, number: await nextEstimateNumber(tx, org.orgId), productLine: 'curb', curbProjectId: p.id, propertyId: p.propertyId, status: 'draft_ai', revision: 0 }).returning();
        const applied = await applyRevision(tx, { orgId: org.orgId, userId: org.userId }, e!, computed);
        await auditRequest(request, tx, { orgId: org.orgId, action: 'estimate.created', resourceType: 'estimate', resourceId: e!.id, after: { curbProjectId: p.id, revisionId: applied.revision.id, quoteKind: applied.revision.quoteKind } });
        return { status: 201, body: await estimateDto(tx, request, applied.estimate) };
      });
    },
  );

  app.post(
    '/curb/projects/:id/estimates/:estimateId/sync',
    { config: { permission: 'estimate:write' }, schema: { tags: ['curb'], summary: 'Re-derive inputs/site conditions and reprice (command CurbEstimateSynced)', params: z.object({ id: UuidSchema, estimateId: UuidSchema }), body: z.object({ expectedRevision: z.number().int().positive() }), response: { 200: z.object({ receipt: CommandReceiptSchema, estimate: EstimateSchema }) } } },
    async (request, reply) => {
      const org = requireOrg(request);
      const ok = await tenantTx(request, async (tx) => {
        const [e] = await tx.select({ id: estimates.id }).from(estimates).where(and(eq(estimates.orgId, org.orgId), eq(estimates.id, request.params.estimateId), eq(estimates.curbProjectId, request.params.id)));
        return !!e;
      });
      if (!ok) throw problem('not_found');
      const { receipt } = await executeResourceCommand(request, reply, { type: 'CurbEstimateSynced', aggregateId: request.params.estimateId, expectedRevision: request.body.expectedRevision, payload: {} });
      const estimate = await tenantTx(request, async (tx) => {
        const [e] = await tx.select().from(estimates).where(eq(estimates.id, request.params.estimateId));
        return estimateDto(tx, request, e!);
      });
      return { receipt, estimate };
    },
  );
};

export default curbModule;
