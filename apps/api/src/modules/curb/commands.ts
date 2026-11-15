// Curb command handlers (ADD-014 command/receipt protocol). Every curb edit is a command on the
// `curb_project` aggregate: lock + load -> receipt lookup -> validate -> revision check -> apply +
// rule sync + dependent-estimate staleness + audit + outbox + receipt, all in one transaction.
import {
  type CommandType,
  CURB_INTAKE_QUESTIONS,
  type CurbObservationAnswer,
  type Measurement,
} from '@fieldline/contracts';
import {
  calibrateHomography,
  calibrateReferenceScale,
  CALIBRATION_VERSION,
  imageToPlane,
  measureLength,
  polylineLength,
  validateCurbSegments,
  type Calibration,
  type CurbSegment as GeoSegment,
} from '@fieldline/geometry';
import { and, desc, eq } from 'drizzle-orm';
import type { Action } from '@fieldline/contracts';
import { calibrations, curbMeasurements, curbObservations, curbSegments, permitRequirements, riskFlags, safetyReviews } from '../../db/schema';
import { assertCan } from '../../http/context';
import { problem } from '../../http/problem';
import { commandHandler, type CommandContext, type CommandHandler, type CommandOutcome, registerCommand } from '../commands/registry';
import { applyRevision, computeRevision, latestRevision, loadEstimate } from '../estimates/service';
import { resolvePolicy } from '../approvals/policy';
import { OVERRIDABLE_RULE_FLAGS } from './rules';
import { bumpProject, derivedSiteConditions, estimateInputs, loadProject, type ProjectRow, projectMedia, syncRules } from './service';

type Payloads = { [K in CommandType]: Parameters<CommandHandler<K>['execute']>[2] };

/** CV-045: calibrations looser than this are refused (no precise feet without a valid scale). */
export const MAX_RELATIVE_UNCERTAINTY = 0.05;
const NEVER_FROM_PHOTOS = new Set(['buried_depth', 'thickness', 'cut_depth']);
const UNTRUSTED = new Set(['imagery_derived', 'machine_estimated']);

interface ProjectState {
  project: ProjectRow;
}

async function loadState(ctx: CommandContext, id: string) {
  const project = await loadProject(ctx.tx, ctx.orgId, id, true);
  return project ? { revision: project.revision, state: { project } } : null;
}

interface Applied {
  action: string;
  before: unknown;
  after: unknown;
  event: string;
  set?: Parameters<typeof bumpProject>[3];
  payload?: Record<string, unknown>;
}

function projectCommand<T extends CommandType>(def: {
  type: T;
  permission: Action;
  validate?: (ctx: CommandContext, s: ProjectState, p: Payloads[T]) => Promise<void> | void;
  diff: (s: ProjectState, p: Payloads[T]) => { field: string; server: unknown; yours: unknown }[];
  apply: (ctx: CommandContext, s: ProjectState, p: Payloads[T]) => Promise<Applied>;
}): void {
  registerCommand<T, ProjectState>({
    type: def.type,
    aggregateType: 'curb_project',
    permission: def.permission,
    load: loadState,
    validate: async (ctx, s, p) => {
      if (s.project.status === 'cancelled' || s.project.status === 'completed') throw problem('invalid_transition', `The project is ${s.project.status}.`);
      await def.validate?.(ctx, s, p as Payloads[T]);
    },
    diff: (s, p) => def.diff(s, p as Payloads[T]),
    async execute(ctx, { state }, p): Promise<CommandOutcome> {
      const a = await def.apply(ctx, state, p as Payloads[T]);
      const updated = await bumpProject(ctx.tx, state.project, `curb:${def.type}`, a.set ?? {});
      const rules = await syncRules(ctx.tx, updated, ctx.userId);
      return {
        serverRevision: updated.revision,
        changed: true,
        audit: { action: a.action, before: a.before, after: { ...(a.after as object), rules } },
        event: { type: a.event, payload: { curbProjectId: updated.id, ...(a.payload ?? {}), rules } },
      };
    },
  });
}

// ------------------------------------------------------------------ calibration math (CV-045)
type Pt = { x: number; y: number };
const pt = ([x, y]: readonly [number, number]): Pt => ({ x, y });

export interface CalibrationOutcome {
  status: 'accepted' | 'failed';
  metersPerPixel: number | null;
  residualErrorM: number | null;
  uncertainty: number | null;
  failure: { reason: string; message: string; next: string } | null;
  calibration: Calibration | null;
}

const NEXT = 'Re-take the scale reference photo or enter field-measured dimensions (method field_dimensions).';

export function computeCalibration(p: Payloads['CurbCalibrationRecorded']): CalibrationOutcome {
  const failed = (reason: string, message: string): CalibrationOutcome => ({ status: 'failed', metersPerPixel: null, residualErrorM: null, uncertainty: null, failure: { reason, message, next: NEXT }, calibration: null });
  if (p.method === 'field_dimensions') {
    // No image scale: lengths must be entered as measured on site.
    return { status: 'accepted', metersPerPixel: null, residualErrorM: null, uncertainty: null, failure: null, calibration: null };
  }
  let cal: Calibration;
  let rel: number;
  if (p.method === 'two_point_reference') {
    if (p.image_points.length !== 2 || !p.reference_length_m) return failed('invalid_input', 'A two-point reference needs exactly 2 image points and the reference length in meters.');
    cal = calibrateReferenceScale(pt(p.image_points[0]!), pt(p.image_points[1]!), p.reference_length_m);
    if (cal.status !== 'valid') return { ...failed(cal.reason, cal.message), calibration: cal };
    rel = cal.method === 'reference_scale' ? cal.scaleRelativeSigma : 1;
  } else {
    const w = p.world_points_m ?? [];
    if (p.image_points.length < 4 || w.length !== p.image_points.length) return failed('invalid_input', 'A homography needs >= 4 image points with the same number of world points (meters).');
    cal = calibrateHomography(p.image_points.map(pt), w.map(pt));
    if (cal.status !== 'valid') return { ...failed(cal.reason, cal.message), calibration: cal };
    // Relative uncertainty over the reference's own span (first to farthest point).
    const far = p.image_points.reduce((best, q, i) => (Math.hypot(w[i]![0] - w[0]![0], w[i]![1] - w[0]![1]) > Math.hypot(w[best]![0] - w[0]![0], w[best]![1] - w[0]![1]) ? i : best), 1);
    const m = measureLength(cal, pt(p.image_points[0]!), pt(p.image_points[far]!));
    rel = m.state === 'known' && m.value > 0 ? m.sigma / m.value : 1;
  }
  if (rel > MAX_RELATIVE_UNCERTAINTY) {
    return { ...failed('uncertainty_too_high', `Scale uncertainty ${(rel * 100).toFixed(1)}% exceeds ${(MAX_RELATIVE_UNCERTAINTY * 100).toFixed(0)}%; the reference is unreliable.`), calibration: cal };
  }
  return {
    status: 'accepted',
    metersPerPixel: cal.method === 'reference_scale' ? cal.metersPerPixel : null,
    residualErrorM: cal.method === 'homography' ? cal.reprojectionRms : null,
    uncertainty: Number(rel.toFixed(4)),
    failure: null,
    calibration: cal,
  };
}

/** Accepted calibration row -> geometry Calibration (re-derived deterministically from its inputs). */
export function calibrationFromRow(row: typeof calibrations.$inferSelect): Calibration | null {
  if (row.status !== 'accepted') return null;
  const cp = row.controlPoints as { input?: Payloads['CurbCalibrationRecorded'] };
  if (!cp.input) return null;
  return computeCalibration(cp.input).calibration;
}

// ------------------------------------------------------------------ segment geometry (CV-047)
export function segmentLength(geometry: Payloads['CurbSegmentSaved']['geometry'], cal: Calibration | null) {
  const pieces: GeoSegment[] = [];
  let variance = 0;
  geometry.pieces.forEach((piece, i) => {
    let pts: Pt[];
    if (geometry.space === 'image_px') {
      if (!cal) throw problem('calibration_failed', 'Image-space geometry needs an accepted calibration of this photo; no precise length without a valid scale.');
      pts = piece.points.map((q) => {
        const m = imageToPlane(cal, pt(q));
        if (!m) throw problem('calibration_failed', 'A point lies outside the calibrated plane.');
        return m;
      });
      for (let k = 1; k < piece.points.length; k++) {
        const m = measureLength(cal, pt(piece.points[k - 1]!), pt(piece.points[k]!));
        if (m.state !== 'known') throw problem('calibration_failed', m.reason);
        variance += m.sigma * m.sigma;
      }
    } else {
      pts = piece.points.map(pt);
    }
    pieces.push({ id: `piece-${i}`, kind: piece.shape, points: pts });
  });
  const issues = validateCurbSegments(pieces);
  if (issues.length) {
    throw problem('geometry_invalid', 'The segment geometry is invalid.', { errors: issues.map((x) => ({ path: 'body.payload.geometry', message: x.message, code: x.code })) });
  }
  const lengthM = pieces.reduce((s, q) => s + polylineLength(q.points), 0);
  return { lengthM: Number(lengthM.toFixed(6)), sigmaM: Number(Math.sqrt(variance).toFixed(6)), planePieces: pieces.map((q) => ({ shape: q.kind, points: q.points.map((m) => [Number(m.x.toFixed(6)), Number(m.y.toFixed(6))]) })) };
}

// ------------------------------------------------------------------ handlers
function storeAnswer(a: CurbObservationAnswer) {
  if (a.state === 'unknown') return { state: 'unknown', valueText: null, valueNumber: null, valueBoolean: null, unit: null, unknownReason: a.reason, source: null, evidenceSource: null };
  return {
    state: 'known',
    valueText: typeof a.value === 'string' ? a.value : null,
    valueNumber: typeof a.value === 'number' ? String(a.value) : null,
    valueBoolean: typeof a.value === 'boolean' ? a.value : null,
    unit: a.unit ?? null,
    unknownReason: null,
    source: a.source,
    evidenceSource: a.evidence_source ?? null,
  };
}

async function writeMeasurement(ctx: CommandContext, p: ProjectRow, input: { kind: string; segmentId: string | null; measurement: Measurement; calibrationId: string | null; mediaAssetId: string | null; low?: number | null; high?: number | null }) {
  const m = input.measurement;
  const [existing] = await ctx.tx
    .select()
    .from(curbMeasurements)
    .where(and(eq(curbMeasurements.orgId, p.orgId), eq(curbMeasurements.curbProjectId, p.id), eq(curbMeasurements.kind, input.kind as never), input.segmentId ? eq(curbMeasurements.segmentId, input.segmentId) : undefined))
    .orderBy(desc(curbMeasurements.createdAt));
  const sameScope = existing && (existing.segmentId ?? null) === input.segmentId ? existing : null;
  const values = {
    state: m.state,
    value: m.state === 'known' ? String(m.value) : null,
    unit: m.state === 'known' ? m.unit : null,
    low: m.state === 'known' ? String(input.low ?? m.value - m.precision) : null,
    high: m.state === 'known' ? String(input.high ?? m.value + m.precision) : null,
    source: m.state === 'known' ? m.source : null,
    calibrationId: input.calibrationId,
    mediaAssetId: input.mediaAssetId,
    unknownReason: m.state === 'unknown' ? m.reason : null,
    measuredAt: m.state === 'known' ? new Date(m.measuredAt) : null,
    measuredByUserId: ctx.userId,
  };
  if (sameScope) {
    await ctx.tx.update(curbMeasurements).set({ ...values, revision: sameScope.revision + 1 }).where(eq(curbMeasurements.id, sameScope.id));
    return { before: { value: sameScope.value, source: sameScope.source, state: sameScope.state }, id: sameScope.id };
  }
  const [row] = await ctx.tx.insert(curbMeasurements).values({ orgId: p.orgId, curbProjectId: p.id, segmentId: input.segmentId, kind: input.kind as never, ...values }).returning();
  return { before: null, id: row!.id };
}

const LENGTH_KINDS = new Set(['saw_cut_path', 'return_transition']);

export function registerCurbCommands(): void {
  if (commandHandler('CurbProjectUpdated')) return;

  projectCommand({
    type: 'CurbProjectUpdated',
    permission: 'curb_project:write',
    validate(_ctx, s, p) {
      if (p.status && p.status !== s.project.status) {
        const allowed: Record<string, string[]> = { cancelled: ['*'] };
        if (!allowed[p.status]) throw problem('invalid_transition', 'Status moves with the workflow (estimate approval, dispatch); only cancellation is a direct edit.');
      }
    },
    diff: (s, p) => Object.keys(p).map((k) => ({ field: k, server: (s.project as Record<string, unknown>)[k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())] ?? null, yours: (p as Record<string, unknown>)[k] })),
    async apply(_ctx, s, p) {
      const set = {
        ...(p.service_code && { serviceCode: p.service_code }),
        ...(p.curb_profile && { curbProfile: p.curb_profile }),
        ...(p.is_public_right_of_way !== undefined && { isPublicRightOfWay: p.is_public_right_of_way }),
        ...(p.description !== undefined && { description: p.description }),
        ...(p.status && { status: p.status }),
      };
      const before = { serviceCode: s.project.serviceCode, curbProfile: s.project.curbProfile, isPublicRightOfWay: s.project.isPublicRightOfWay, status: s.project.status };
      return { action: 'curb_project.updated', before, after: set, event: 'curb_project.updated', set };
    },
  });

  projectCommand({
    type: 'CurbObservationsAnswered',
    permission: 'curb_project:write',
    async validate(ctx, s, p) {
      const known = new Map(CURB_INTAKE_QUESTIONS.map((q) => [q.key, q]));
      for (const a of p.answers) {
        const q = known.get(a.question_key);
        if (!q) throw problem('validation_failed', `Unknown question ${a.question_key}.`, { errors: [{ path: 'body.payload.answers', message: 'not an intake question', code: 'unknown_question' }] });
        if (a.answer.state === 'known') {
          if (a.answer.source === 'field_verified' || a.answer.source === 'survey_supplied') {
            assertCan(ctx.request, 'curb_measurement:verify');
          }
          const v = a.answer.value;
          const ok = q.type === 'boolean' ? typeof v === 'boolean' : q.type === 'number' ? typeof v === 'number' : q.type === 'choice' ? typeof v === 'string' && (q.choices ?? []).includes(v) : typeof v === 'string';
          if (!ok) throw problem('validation_failed', `${q.key} expects a ${q.type}${q.choices ? ` (${q.choices.join('|')})` : ''} or unknown.`, { errors: [{ path: `body.payload.answers.${q.key}`, message: `expected ${q.type}` }] });
        }
        for (const id of a.media_asset_ids) await projectMedia(ctx.tx, s.project, id);
      }
    },
    diff: (_s, p) => p.answers.map((a) => ({ field: `observations.${a.question_key}`, server: null, yours: a.answer })),
    async apply(ctx, s, p) {
      const before: Record<string, unknown> = {};
      for (const a of p.answers) {
        const [ex] = await ctx.tx.select().from(curbObservations).where(and(eq(curbObservations.orgId, ctx.orgId), eq(curbObservations.curbProjectId, s.project.id), eq(curbObservations.questionKey, a.question_key)));
        const v = { ...storeAnswer(a.answer), mediaAssetIds: a.media_asset_ids, answeredByUserId: ctx.userId };
        if (ex) {
          before[a.question_key] = { state: ex.state, text: ex.valueText, bool: ex.valueBoolean, number: ex.valueNumber };
          await ctx.tx.update(curbObservations).set({ ...v, revision: ex.revision + 1 }).where(eq(curbObservations.id, ex.id));
        } else {
          before[a.question_key] = null;
          await ctx.tx.insert(curbObservations).values({ orgId: ctx.orgId, curbProjectId: s.project.id, questionKey: a.question_key, ...v });
        }
      }
      return { action: 'curb_project.observations_answered', before, after: Object.fromEntries(p.answers.map((a) => [a.question_key, a.answer])), event: 'curb_project.observations_answered' };
    },
  });

  projectCommand({
    type: 'CurbCalibrationRecorded',
    permission: 'curb_calibration:write',
    validate: async (ctx, s, p) => void (await projectMedia(ctx.tx, s.project, p.media_asset_id)),
    diff: (_s, p) => [{ field: 'calibrations', server: null, yours: p.method }],
    async apply(ctx, s, p) {
      const out = computeCalibration(p);
      const [prev] = await ctx.tx
        .select()
        .from(calibrations)
        .where(and(eq(calibrations.orgId, ctx.orgId), eq(calibrations.curbProjectId, s.project.id), eq(calibrations.mediaAssetId, p.media_asset_id), eq(calibrations.status, 'accepted')));
      if (prev && out.status === 'accepted') await ctx.tx.update(calibrations).set({ status: 'superseded' }).where(eq(calibrations.id, prev.id));
      const [row] = await ctx.tx
        .insert(calibrations)
        .values({
          orgId: ctx.orgId,
          curbProjectId: s.project.id,
          mediaAssetId: p.media_asset_id,
          method: p.method,
          status: out.status,
          referenceLabel: p.reference_label ?? null,
          referenceLengthM: p.reference_length_m === undefined ? null : String(p.reference_length_m),
          controlPoints: { input: p, failure: out.failure, engineVersion: `geometry-calibration@${CALIBRATION_VERSION}`, homography: out.calibration?.status === 'valid' && out.calibration.method === 'homography' ? out.calibration.h : null },
          metersPerPixel: out.metersPerPixel === null ? null : out.metersPerPixel.toFixed(6),
          residualErrorM: out.residualErrorM === null ? null : out.residualErrorM.toFixed(6),
          uncertainty: out.uncertainty === null ? null : String(out.uncertainty),
          createdByUserId: ctx.userId,
          supersedesId: out.status === 'accepted' && prev ? prev.id : null,
        })
        .returning();
      return { action: 'curb_calibration.recorded', before: prev ? { id: prev.id } : null, after: { id: row!.id, status: out.status, uncertainty: out.uncertainty, failure: out.failure?.reason ?? null }, event: 'curb_calibration.recorded', payload: { calibrationId: row!.id, status: out.status } };
    },
  });

  projectCommand({
    type: 'CurbSegmentSaved',
    permission: 'curb_measurement:write',
    async validate(ctx, s, p) {
      if (p.media_asset_id) await projectMedia(ctx.tx, s.project, p.media_asset_id);
      if (p.geometry.space === 'image_px' && (!p.calibration_id || !p.media_asset_id)) throw problem('calibration_failed', 'Image-space geometry needs the photo and an accepted calibration of it.');
      if (p.segment_id && !p.correction_reason) throw problem('validation_failed', 'A correction needs a reason (kept with the version history).', { errors: [{ path: 'body.payload.correction_reason', message: 'required for corrections' }] });
    },
    diff: (_s, p) => [{ field: p.segment_id ? `segments.${p.segment_id}` : 'segments', server: null, yours: p.kind }],
    async apply(ctx, s, p) {
      let cal: Calibration | null = null;
      if (p.calibration_id) {
        const [c] = await ctx.tx.select().from(calibrations).where(and(eq(calibrations.orgId, ctx.orgId), eq(calibrations.curbProjectId, s.project.id), eq(calibrations.id, p.calibration_id)));
        if (!c) throw problem('not_found', 'Calibration not found on this project.');
        if (p.media_asset_id && c.mediaAssetId !== p.media_asset_id) throw problem('calibration_failed', 'The calibration belongs to another photo.');
        cal = calibrationFromRow(c);
        if (p.geometry.space === 'image_px' && !cal) throw problem('calibration_failed', `Calibration is ${c.status}; no precise length without a valid scale.`);
      }
      const measured = segmentLength(p.geometry, cal);
      const source = p.geometry.space === 'image_px' ? 'imagery_derived' : 'user_entered';
      const version = { space: p.geometry.space, pieces: p.geometry.pieces, planePieces: measured.planePieces, lengthM: measured.lengthM, sigmaM: measured.sigmaM, mediaAssetId: p.media_asset_id ?? null, calibrationId: p.calibration_id ?? null, savedAt: ctx.now.toISOString(), savedByUserId: ctx.userId };
      let segmentId: string;
      let before: unknown = null;
      if (p.segment_id) {
        const [ex] = await ctx.tx.select().from(curbSegments).where(and(eq(curbSegments.orgId, ctx.orgId), eq(curbSegments.curbProjectId, s.project.id), eq(curbSegments.id, p.segment_id)));
        if (!ex) throw problem('not_found', 'Segment not found on this project.');
        const old = (ex.imageGeometry ?? {}) as { history?: unknown[] } & Record<string, unknown>;
        const { history = [], ...current } = old;
        before = { revision: ex.revision, lengthM: current.lengthM ?? null };
        await ctx.tx
          .update(curbSegments)
          .set({ kind: p.kind, label: p.label ?? ex.label, mediaAssetId: p.media_asset_id ?? null, calibrationId: p.calibration_id ?? null, source, imageGeometry: { ...version, version: ex.revision + 1, correctionReason: p.correction_reason, history: [...history, { ...current, version: ex.revision }] }, revision: ex.revision + 1 })
          .where(eq(curbSegments.id, ex.id));
        segmentId = ex.id;
      } else {
        const [row] = await ctx.tx
          .insert(curbSegments)
          .values({ orgId: ctx.orgId, curbProjectId: s.project.id, kind: p.kind, label: p.label ?? null, mediaAssetId: p.media_asset_id ?? null, calibrationId: p.calibration_id ?? null, source, imageGeometry: { ...version, version: 1, history: [] } })
          .returning();
        segmentId = row!.id;
      }
      if (LENGTH_KINDS.has(p.kind)) {
        // A photo-derived length is an advisory range (CV-045 D): value +/- 2 sigma.
        const two = 2 * measured.sigmaM;
        await writeMeasurement(ctx, s.project, {
          kind: 'cut_length',
          segmentId,
          measurement: { state: 'known', value: measured.lengthM, unit: 'm', source, measuredAt: ctx.now.toISOString(), precision: Number(two.toFixed(6)) },
          calibrationId: p.calibration_id ?? null,
          mediaAssetId: p.media_asset_id ?? null,
        });
      }
      return { action: p.segment_id ? 'curb_segment.corrected' : 'curb_segment.created', before, after: { segmentId, kind: p.kind, lengthM: measured.lengthM, sigmaM: measured.sigmaM, source }, event: 'curb_segment.saved', payload: { segmentId } };
    },
  });

  projectCommand({
    type: 'CurbMeasurementRecorded',
    permission: 'curb_measurement:write',
    async validate(ctx, s, p) {
      const m = p.measurement;
      if (m.state === 'known') {
        // Trusted sources need the verify permission (documented site check).
        if (m.source === 'field_verified' || m.source === 'survey_supplied') assertCan(ctx.request, 'curb_measurement:verify');
        if (UNTRUSTED.has(m.source) && NEVER_FROM_PHOTOS.has(p.kind)) throw problem('measurement_unknown', `${p.kind} cannot be established from photographs; record it as unknown or field-verify it.`);
        if (m.source === 'imagery_derived' && !p.calibration_id) throw problem('calibration_failed', 'A photo-derived dimension needs an accepted calibration; no precise feet without a valid scale.');
      }
      if (p.calibration_id) {
        const [c] = await ctx.tx.select().from(calibrations).where(and(eq(calibrations.orgId, ctx.orgId), eq(calibrations.curbProjectId, s.project.id), eq(calibrations.id, p.calibration_id)));
        if (!c) throw problem('not_found', 'Calibration not found on this project.');
        if (c.status !== 'accepted') throw problem('calibration_failed', `Calibration is ${c.status}; no precise length without a valid scale.`);
      }
      if (p.segment_id) {
        const [seg] = await ctx.tx.select({ id: curbSegments.id }).from(curbSegments).where(and(eq(curbSegments.orgId, ctx.orgId), eq(curbSegments.curbProjectId, s.project.id), eq(curbSegments.id, p.segment_id)));
        if (!seg) throw problem('not_found', 'Segment not found on this project.');
      }
    },
    diff: (_s, p) => [{ field: `measurements.${p.kind}`, server: null, yours: p.measurement.state }],
    async apply(ctx, s, p) {
      const w = await writeMeasurement(ctx, s.project, { kind: p.kind, segmentId: p.segment_id ?? null, measurement: p.measurement, calibrationId: p.calibration_id ?? null, mediaAssetId: null });
      return { action: 'curb_measurement.recorded', before: w.before, after: { id: w.id, kind: p.kind, state: p.measurement.state, source: p.measurement.state === 'known' ? p.measurement.source : null }, event: 'curb_measurement.recorded', payload: { measurementId: w.id, kind: p.kind } };
    },
  });

  projectCommand({
    type: 'CurbRiskFlagRaised',
    permission: 'risk_flag:write',
    validate(_c, _s, p) {
      if (p.evidence_source === 'rule_engine') throw problem('validation_failed', 'rule_engine flags are raised by the server only.');
    },
    diff: (_s, p) => [{ field: 'riskFlags', server: null, yours: p.kind }],
    async apply(ctx, s, p) {
      const [row] = await ctx.tx.insert(riskFlags).values({ orgId: ctx.orgId, curbProjectId: s.project.id, kind: p.kind, severity: p.severity, status: 'open', evidenceSource: p.evidence_source, message: p.message }).returning();
      return { action: 'risk_flag.raised', before: null, after: { id: row!.id, kind: p.kind, severity: p.severity }, event: 'risk_flag.raised', payload: { riskFlagId: row!.id } };
    },
  });

  projectCommand({
    type: 'CurbRiskFlagResolved',
    permission: 'risk_flag:resolve',
    async validate(ctx, s, p) {
      const [f] = await ctx.tx.select().from(riskFlags).where(and(eq(riskFlags.orgId, ctx.orgId), eq(riskFlags.curbProjectId, s.project.id), eq(riskFlags.id, p.risk_flag_id)));
      if (!f) throw problem('not_found', 'Risk flag not found on this project.');
      if (f.status !== 'open') throw problem('invalid_transition', `The flag is already ${f.status}.`);
      if (f.evidenceSource === 'rule_engine' && !OVERRIDABLE_RULE_FLAGS.has(f.kind)) {
        throw problem('gate_blocked', `A ${f.kind} flag closes only when its evidence is recorded (permit, review, utility locate or field measurement), not by a note.`);
      }
    },
    diff: (_s, p) => [{ field: `riskFlags.${p.risk_flag_id}.status`, server: 'open', yours: p.status }],
    async apply(ctx, _s, p) {
      const [f] = await ctx.tx.select().from(riskFlags).where(eq(riskFlags.id, p.risk_flag_id));
      await ctx.tx.update(riskFlags).set({ status: p.status, resolutionNote: p.resolution_note, resolvedByUserId: ctx.userId, resolvedAt: ctx.now, revision: f!.revision + 1 }).where(eq(riskFlags.id, f!.id));
      return { action: 'risk_flag.resolved', before: { status: 'open' }, after: { id: f!.id, kind: f!.kind, status: p.status }, event: 'risk_flag.resolved', payload: { riskFlagId: f!.id } };
    },
  });

  projectCommand({
    type: 'CurbPermitUpdated',
    permission: 'permit:manage',
    validate(_c, _s, p) {
      if (p.status === 'approved' && !p.application_reference) throw problem('validation_failed', 'An approved permit needs its permit/application reference.', { errors: [{ path: 'body.payload.application_reference', message: 'required when approved' }] });
      if (p.status === 'approved' && p.expires_on && p.expires_on < new Date().toISOString().slice(0, 10)) throw problem('validation_failed', 'The permit has already expired; record status expired.');
    },
    diff: (_s, p) => [{ field: `permits.${p.permit_type}.status`, server: null, yours: p.status }],
    async apply(ctx, s, p) {
      const [ex] = await ctx.tx.select().from(permitRequirements).where(and(eq(permitRequirements.orgId, ctx.orgId), eq(permitRequirements.curbProjectId, s.project.id), eq(permitRequirements.permitType, p.permit_type)));
      const v = {
        status: p.status,
        applicationReference: p.application_reference ?? ex?.applicationReference ?? null,
        expiresOn: p.expires_on ?? ex?.expiresOn ?? null,
        notes: p.notes ?? ex?.notes ?? null,
        evidence: { checklist: p.checklist ?? (ex?.evidence as { checklist?: unknown } | null)?.checklist ?? [] },
        ...(p.status === 'submitted' && { submittedAt: ctx.now }),
        ...(p.status === 'approved' && { approvedAt: ctx.now }),
      };
      if (ex) await ctx.tx.update(permitRequirements).set({ ...v, revision: ex.revision + 1 }).where(eq(permitRequirements.id, ex.id));
      else await ctx.tx.insert(permitRequirements).values({ orgId: ctx.orgId, curbProjectId: s.project.id, permitType: p.permit_type, jurisdictionId: s.project.jurisdictionId, rulesVersion: s.project.jurisdictionRulesVersion, ...v });
      return { action: 'permit.updated', before: ex ? { status: ex.status } : null, after: { permitType: p.permit_type, status: p.status }, event: 'permit.updated' };
    },
  });

  projectCommand({
    type: 'CurbSafetyReviewDecided',
    permission: 'safety_review:sign',
    validate(_c, _s, p) {
      if (p.status === 'not_applicable' && ['utility_clearance', 'silica_exposure_control', 'job_site_safety_plan'].includes(p.kind)) {
        throw problem('validation_failed', `${p.kind} is always required before saw cutting.`);
      }
      if (p.status === 'approved' && p.checklist.some((c) => !c.done)) throw problem('validation_failed', 'Every checklist item must be done to approve the review.', { errors: [{ path: 'body.payload.checklist', message: 'incomplete' }] });
    },
    diff: (_s, p) => [{ field: `safetyReviews.${p.kind}.status`, server: null, yours: p.status }],
    async apply(ctx, s, p) {
      const [ex] = await ctx.tx.select().from(safetyReviews).where(and(eq(safetyReviews.orgId, ctx.orgId), eq(safetyReviews.curbProjectId, s.project.id), eq(safetyReviews.kind, p.kind)));
      const v = { status: p.status, reviewerMembershipId: ctx.membershipId, checklist: p.checklist, evidence: p.note ? { note: p.note } : null, reviewedAt: ctx.now, expiresAt: p.expires_at ? new Date(p.expires_at) : null };
      if (ex) await ctx.tx.update(safetyReviews).set({ ...v, revision: ex.revision + 1 }).where(eq(safetyReviews.id, ex.id));
      else await ctx.tx.insert(safetyReviews).values({ orgId: ctx.orgId, curbProjectId: s.project.id, kind: p.kind, ...v });
      return { action: 'safety_review.decided', before: ex ? { status: ex.status } : null, after: { kind: p.kind, status: p.status }, event: 'safety_review.decided' };
    },
  });

  // Estimate aggregate: re-derive inputs + site conditions from the project and reprice.
  registerCommand<'CurbEstimateSynced', { estimate: NonNullable<Awaited<ReturnType<typeof loadEstimate>>> }>({
    type: 'CurbEstimateSynced',
    aggregateType: 'estimate',
    permission: 'estimate:write',
    async load(ctx, id) {
      const estimate = await loadEstimate(ctx.tx, ctx.orgId, id, true);
      return estimate ? { revision: estimate.revision, state: { estimate } } : null;
    },
    validate(_c, s) {
      if (!s.estimate.curbProjectId) throw problem('validation_failed', 'Not a curb estimate.');
      if (s.estimate.status === 'rejected') throw problem('invalid_transition', 'The estimate was rejected.');
    },
    diff: (s) => [{ field: 'currentRevisionId', server: s.estimate.currentRevisionId, yours: 'sync' }],
    async execute(ctx, { state }) {
      const e = state.estimate;
      const project = (await loadProject(ctx.tx, ctx.orgId, e.curbProjectId!))!;
      await syncRules(ctx.tx, project, ctx.userId);
      const latest = (await latestRevision(ctx.tx, ctx.orgId, e.id))!;
      const computed = await computeRevision(
        ctx.tx,
        ctx.orgId,
        { productLine: 'curb', curbProjectId: e.curbProjectId, propertyId: e.propertyId },
        { inputs: await estimateInputs(ctx.tx, project), lineSpecs: latest.lineSpecs as never, siteConditions: await derivedSiteConditions(ctx.tx, project), assumptions: latest.assumptions as string[], priceBookRevisionId: null },
        async (q) => (await resolvePolicy(ctx.tx, ctx.orgId, { subjectType: 'estimate_revision', productLine: 'curb', ...q })).requiredSignoffs,
      );
      const applied = await applyRevision(ctx.tx, { orgId: ctx.orgId, userId: ctx.userId }, e, computed);
      return {
        serverRevision: applied.estimate.revision,
        changed: applied.changed,
        audit: { action: 'estimate.curb_synced', before: { revisionId: latest.id, quoteKind: latest.quoteKind }, after: { revisionId: applied.revision.id, quoteKind: applied.revision.quoteKind, status: applied.estimate.status } },
        event: { type: 'estimate.revised', payload: { estimateId: e.id, revisionId: applied.revision.id, status: applied.estimate.status } },
      };
    },
  });
}
