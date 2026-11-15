// Pure curb UI logic (no React): service taxonomy, the "questions before price" gate, calibration
// tolerance, segment confidence colours, scale bar, estimate banner rule, gate grouping and the
// shared autosave state machine. Everything here is unit tested in model.test.ts.
// Requirement IDs: CV-041/042 (intake, early questions), CV-043 (capture), CV-045 (calibration),
// CV-047 (segments), CP-058/059/060 (estimate + gates), ADD-040..ADD-056, COS-226..COS-250.
import {
  CURB_INTAKE_QUESTIONS,
  type CurbMeasurementKind,
  type CurbObservationAnswer,
  type CurbServiceCode,
  type MeasurementSource,
} from '@fieldline/contracts';

// ------------------------------------------------------------------ service taxonomy (CV-041)
export interface ServiceTaxon {
  code: CurbServiceCode;
  label: string;
  summary: string;
  /** Human scoping required before any quantity is priced (rule engine opens scope_ambiguous). */
  needsHumanScoping: boolean;
}

export const CURB_SERVICE_TAXONOMY: readonly ServiceTaxon[] = [
  { code: 'driveway_opening', label: 'Driveway opening', summary: 'Saw-cut and remove a curb length to open a new driveway, with return transitions at each end.', needsHumanScoping: false },
  { code: 'curb_shaving', label: 'Curb shaving / grinding', summary: 'Lower the curb face in place without full removal.', needsHumanScoping: false },
  { code: 'curb_removal_replacement', label: 'Curb removal and replacement', summary: 'Remove damaged curb and form and pour a new section.', needsHumanScoping: false },
  { code: 'gutter_replacement', label: 'Gutter replacement', summary: 'Replace the gutter pan; drainage review may be required.', needsHumanScoping: false },
  { code: 'sidewalk_ramp_transition', label: 'Sidewalk ramp / transition', summary: 'Ramp or transition on a pedestrian route; accessibility review applies.', needsHumanScoping: false },
  { code: 'private_curb_cut', label: 'Private curb cut', summary: 'Curb on private property (parking lot, private road).', needsHumanScoping: false },
  { code: 'other_concrete_cut', label: 'Other concrete cut', summary: 'Anything else. A person scopes it before any price is shown.', needsHumanScoping: true },
];

export function serviceTaxon(code: string): ServiceTaxon | undefined {
  return CURB_SERVICE_TAXONOMY.find((s) => s.code === code);
}

// ------------------------------------------------------------------ intake (CV-042)
export const EARLY_QUESTIONS = CURB_INTAKE_QUESTIONS.filter((q) => q.early);

export interface ObservationRow {
  questionKey: string;
  answer: CurbObservationAnswer | { state: string };
}

/**
 * CV-042 B: every early (permit / engineer / ownership / risk) question must have an explicit
 * answer, which may be `unknown`, before any price is shown or requested. Unanswered != unknown:
 * the person must actively choose Unknown. Unknown is never treated as false.
 */
export function earlyQuestionsAnswered(observations: readonly ObservationRow[]): { done: boolean; missing: string[] } {
  const answered = new Set(observations.map((o) => o.questionKey));
  const missing = EARLY_QUESTIONS.filter((q) => !answered.has(q.key)).map((q) => q.key);
  return { done: missing.length === 0, missing };
}

/** Text shown for an answer. Unknown is written out, never blank and never "No". */
export function answerText(answer: ObservationRow['answer'] | undefined): string {
  if (!answer) return 'Not answered';
  if (answer.state !== 'known') return 'Unknown';
  const v = (answer as { value: unknown }).value;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

// ------------------------------------------------------------------ calibration (CV-045)
/** The API refuses any calibration above this relative uncertainty. */
export const CALIBRATION_MAX_UNCERTAINTY = 0.05;

export type CalibrationMethod = 'two_point_reference' | 'four_point_homography' | 'field_dimensions';

export const CALIBRATION_POINTS_NEEDED: Record<CalibrationMethod, number> = {
  two_point_reference: 2,
  four_point_homography: 4,
  field_dimensions: 0,
};

export type ToleranceLevel = 'within' | 'marginal' | 'refused' | 'unknown';

/** Tolerance shown next to a calibration: within <= 2.5 %, marginal <= 5 %, refused above. */
export function toleranceLevel(uncertainty: number | null | undefined): ToleranceLevel {
  if (uncertainty === null || uncertainty === undefined || !Number.isFinite(uncertainty)) return 'unknown';
  if (uncertainty > CALIBRATION_MAX_UNCERTAINTY) return 'refused';
  if (uncertainty > CALIBRATION_MAX_UNCERTAINTY / 2) return 'marginal';
  return 'within';
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return 'unknown';
  return `±${(ratio * 100).toFixed(1)}%`;
}

/** Pixel distance between two image points. */
export function pixelDistance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// ------------------------------------------------------------------ segments (CV-047)
export type ConfidenceBand = 'verified' | 'high' | 'medium' | 'low' | 'unknown';

/**
 * Colour band for a segment on the photo. Field-verified/survey lengths are "verified"; otherwise
 * the band comes from the relative 1-sigma uncertainty of its length. No length = unknown (grey).
 */
export function segmentConfidence(seg: { source?: string; lengthM?: number | null; sigmaM?: number | null }): ConfidenceBand {
  if (seg.source === 'field_verified' || seg.source === 'survey_supplied') return 'verified';
  if (!seg.lengthM || seg.sigmaM === null || seg.sigmaM === undefined) return 'unknown';
  const rel = seg.sigmaM / seg.lengthM;
  if (rel <= 0.01) return 'high';
  if (rel <= 0.03) return 'medium';
  return 'low';
}

export const CONFIDENCE_STYLE: Record<ConfidenceBand, { label: string; colorVar: string; dash?: string }> = {
  verified: { label: 'Field verified', colorVar: 'var(--curb-conf-verified)' },
  high: { label: 'High confidence (≤1%)', colorVar: 'var(--curb-conf-high)' },
  medium: { label: 'Medium confidence (≤3%)', colorVar: 'var(--curb-conf-medium)', dash: '8 4' },
  low: { label: 'Low confidence (>3%), verify in field', colorVar: 'var(--curb-conf-low)', dash: '3 3' },
  unknown: { label: 'No calibrated length', colorVar: 'var(--curb-conf-unknown)', dash: '2 4' },
};

/** A curved piece needs at least 3 points (a two-point curve is just a chord; API rejects it). */
export function pieceProblem(shape: string, points: readonly unknown[]): string | null {
  if (points.length < 2) return 'Place at least two points.';
  if (shape === 'curved' && points.length < 3) return 'A curve needs at least three points; two points is only a chord.';
  return null;
}

/**
 * Scale bar for a photo with metersPerPixel: picks a round length (0.1, 0.25, 0.5, 1, 2, 5, 10 m)
 * whose on-screen width is closest to `targetPx` without exceeding twice it.
 */
export function scaleBar(metersPerPixel: number | null | undefined, displayScale = 1, targetPx = 120): { meters: number; px: number; label: string } | null {
  if (!metersPerPixel || metersPerPixel <= 0 || !Number.isFinite(metersPerPixel)) return null;
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20];
  let best = candidates[0]!;
  let bestDiff = Infinity;
  for (const m of candidates) {
    const px = (m / metersPerPixel) * displayScale;
    const diff = Math.abs(px - targetPx);
    if (px <= targetPx * 2 && diff < bestDiff) {
      best = m;
      bestDiff = diff;
    }
  }
  const px = (best / metersPerPixel) * displayScale;
  return { meters: best, px, label: best < 1 ? `${Math.round(best * 100)} cm` : `${best} m` };
}

// ------------------------------------------------------------------ measurements (CV-045 D)
/** Dimensions a photo can never establish: the form refuses photo-derived sources for these. */
export const NOT_FROM_PHOTO: ReadonlySet<CurbMeasurementKind> = new Set<CurbMeasurementKind>(['cut_depth', 'thickness', 'buried_depth']);

export const MEASUREMENT_UNIT: Record<CurbMeasurementKind, 'm' | 'm2' | 'm3' | 'count' | 'ratio'> = {
  cut_length: 'm', cut_depth: 'm', saw_pass_count: 'count', curb_height: 'm', curb_width: 'm', gutter_width: 'm',
  thickness: 'm', buried_depth: 'm', removal_area: 'm2', removal_volume: 'm3', replacement_length: 'm',
  restoration_area: 'm2', roadway_grade: 'ratio', cross_slope: 'ratio', driveway_rise: 'm',
};

export function allowedSources(kind: CurbMeasurementKind, canVerify: boolean): MeasurementSource[] {
  const all: MeasurementSource[] = ['user_entered', 'field_verified', 'survey_supplied', 'imagery_derived'];
  return all.filter((s) => {
    if (!canVerify && (s === 'field_verified' || s === 'survey_supplied')) return false;
    if (NOT_FROM_PHOTO.has(kind) && s === 'imagery_derived') return false;
    return true;
  });
}

// ------------------------------------------------------------------ estimate banner (CP-058)
/**
 * The PRELIMINARY / BUDGETARY banner is shown, without a dismiss control, whenever the revision
 * is not binding, not firm, has no priced scenarios, or the estimate is stale.
 */
export function estimateBanner(rev: { isBinding: boolean; quoteKind: string; scenarios: unknown } | null, stale: unknown): { show: boolean; title: string } {
  if (!rev) return { show: true, title: 'PRELIMINARY: not priced yet' };
  if (stale) return { show: true, title: 'PRELIMINARY: inputs changed since pricing, reprice before use' };
  if (rev.scenarios === null) return { show: true, title: 'REVIEW REQUIRED: pricing pending review, no amount shown' };
  if (rev.quoteKind === 'review_required') return { show: true, title: 'PRELIMINARY: review required before this becomes a quote' };
  if (!rev.isBinding || rev.quoteKind !== 'firm') return { show: true, title: 'BUDGETARY RANGE: not a binding quote' };
  return { show: false, title: '' };
}

/** Inputs split into recorded values and unknowns (unknowns are listed, never priced as zero). */
export function splitInputs(inputs: Record<string, { state: string }>): { known: string[]; unknown: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(inputs)) (v.state === 'known' ? known : unknown).push(k);
  return { known: known.sort(), unknown: unknown.sort() };
}

// ------------------------------------------------------------------ gates (CP-059/060)
export interface Gate {
  code: string;
  message: string;
  resolution?: string;
}

/** Which tab fixes a gate, so the approval panel can link straight to it. */
export function gateTarget(code: string): 'intake' | 'capture' | 'measure' | 'risks' | 'estimate' {
  if (/permit|right_of_way|utility|review|safety|traffic|silica|drainage|engineer|accessible|jurisdiction|flag|risk/.test(code)) return 'risks';
  if (/calibrat|segment|measure|depth|length/.test(code)) return 'measure';
  if (/photo|capture|shot/.test(code)) return 'capture';
  if (/intake|question|scope|answer/.test(code)) return 'intake';
  return 'estimate';
}

// ------------------------------------------------------------------ autosave (shared with roof)
export type AutosaveState = 'saved' | 'unsaved' | 'saving' | 'offline' | 'conflict' | 'error';

export const AUTOSAVE_LABEL: Record<AutosaveState, string> = {
  saved: 'All changes saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  offline: 'Offline: changes kept on this device, will retry',
  conflict: 'Someone else changed this project. Review and re-apply.',
  error: 'Not saved. Retry.',
};

export type AutosaveEvent = 'edit' | 'save_start' | 'save_ok' | 'save_offline' | 'save_conflict' | 'save_error' | 'reload';

export function autosaveReducer(state: AutosaveState, event: AutosaveEvent): AutosaveState {
  switch (event) {
    case 'edit':
      return state === 'conflict' ? 'conflict' : 'unsaved';
    case 'save_start':
      return 'saving';
    case 'save_ok':
      return 'saved';
    case 'save_offline':
      return 'offline';
    case 'save_conflict':
      return 'conflict';
    case 'save_error':
      return 'error';
    case 'reload':
      return 'saved';
  }
}
