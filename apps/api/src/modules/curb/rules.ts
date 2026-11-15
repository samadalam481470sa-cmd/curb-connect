// Curb rule engine (CV-042, CV-048, CV-049, CP-055, CP-056, CP-059, CP-060; COS-226..COS-250;
// ADD-040..ADD-056). Pure evaluation of a project's typed facts into:
//   - required permits and safety reviews (created as `unknown` / `pending`, never assumed done),
//   - rule-engine risk flags (every one is blocking: an open flag blocks firm approval + dispatch),
//   - the four curb site conditions the shared estimate gating reads.
// Unknown is never false: an unanswered or photo/model-derived answer counts as unknown.
import type { CurbServiceCode, RiskFlagKind, SafetyReviewKind, SiteCondition } from '@fieldline/contracts';

export const CURB_RULES_VERSION = 'curb-rules@1.0.0';
export const ROW_PERMIT = 'right_of_way_permit';

/** Rule flags a reviewer may mitigate with a note (sticks until the evidence changes). */
export const OVERRIDABLE_RULE_FLAGS: ReadonlySet<RiskFlagKind> = new Set(['drainage_impact', 'external_engineering', 'scope_ambiguous']);

export type Tri = boolean | null;

export interface ObservationFact {
  state: 'known' | 'unknown';
  value: string | number | boolean | null;
  source: string | null;
}

export interface PermitFact {
  permitType: string;
  status: string;
  expiresOn: string | null;
}

export interface ReviewFact {
  kind: SafetyReviewKind;
  status: string;
  expiresAt: Date | null;
}

export interface CurbFacts {
  serviceCode: CurbServiceCode;
  isPublicRightOfWay: boolean | null;
  jurisdictionStatus: string | null;
  observations: Map<string, ObservationFact>;
  permits: PermitFact[];
  reviews: ReviewFact[];
  /** A cut depth / thickness recorded from a trusted source (field_verified, survey_supplied). */
  depthVerified: boolean;
  now: Date;
}

// Only explicit verification may settle safety observations; new sources fail closed.
const TRUSTED = new Set(['field_verified', 'survey_supplied']);

/** Known boolean answer from a trusted source; anything else is unknown (null). */
export function triOf(facts: CurbFacts, key: string): Tri {
  const o = facts.observations.get(key);
  if (!o || o.state !== 'known' || typeof o.value !== 'boolean') return null;
  if (o.source === null || !TRUSTED.has(o.source)) return null;
  return o.value;
}

/** CV-042: right-of-way from the project field, else the ownership answer, else unknown. */
export function rightOfWay(facts: CurbFacts): Tri {
  if (facts.isPublicRightOfWay !== null) return facts.isPublicRightOfWay;
  const o = facts.observations.get('ownership');
  if (!o || o.state !== 'known' || o.source === null || !TRUSTED.has(o.source)) return null;
  if (o.value === 'private') return false;
  if (o.value === 'public' || o.value === 'shared') return true;
  return null;
}

const today = (d: Date) => d.toISOString().slice(0, 10);

export function permitSettled(p: PermitFact, now: Date): boolean {
  if (p.status === 'not_required') return true;
  return p.status === 'approved' && (p.expiresOn === null || p.expiresOn >= today(now));
}

export function reviewSettled(r: ReviewFact | undefined, now: Date): boolean {
  if (!r) return false;
  if (r.status === 'not_applicable') return true;
  return r.status === 'approved' && (r.expiresAt === null || r.expiresAt > now);
}

export function requiredPermits(facts: CurbFacts): string[] {
  // CP-056: public or unknown right-of-way always implies a permit requirement to clarify.
  return rightOfWay(facts) === false ? [] : [ROW_PERMIT];
}

export function requiredReviews(facts: CurbFacts): SafetyReviewKind[] {
  const out: SafetyReviewKind[] = ['utility_clearance', 'silica_exposure_control', 'job_site_safety_plan'];
  if (rightOfWay(facts) !== false || triOf(facts, 'traffic_lane_affected') !== false) out.push('traffic_control_plan');
  if (pedestrianRoute(facts)) out.push('pedestrian_access');
  return out;
}

function pedestrianRoute(facts: CurbFacts): boolean {
  return (
    facts.serviceCode === 'sidewalk_ramp_transition' ||
    triOf(facts, 'sidewalk_affected') !== false ||
    triOf(facts, 'curb_ramp_affected') !== false
  );
}

export interface RuleFlag {
  kind: RiskFlagKind;
  message: string;
  /** Evidence fingerprint: a mitigated overridable flag stays closed while it is unchanged. */
  evidence: string;
}

export function evaluateRuleFlags(facts: CurbFacts): RuleFlag[] {
  const flags: RuleFlag[] = [];
  const add = (kind: RiskFlagKind, message: string, evidence: string = message) => flags.push({ kind, message, evidence });
  const review = (k: SafetyReviewKind) => facts.reviews.find((r) => r.kind === k);
  const row = rightOfWay(facts);

  // Right-of-way / permits (CP-056).
  if (row === null) add('public_right_of_way', 'Whether the work is in the public right-of-way is unknown; confirm ownership with the jurisdiction.');
  else if (row) {
    const p = facts.permits.find((x) => x.permitType === ROW_PERMIT);
    if (!p || !permitSettled(p, facts.now)) add('public_right_of_way', 'Work in the public right-of-way needs an approved, unexpired municipal permit.');
  }
  const open = facts.permits.filter((p) => !permitSettled(p, facts.now));
  if (open.length) add('road_work_permit', `Permit requirements not settled: ${open.map((p) => `${p.permitType} (${p.status})`).join(', ')}.`);

  // Utilities (CV-049): a locate is required before any cut; photos never clear utilities.
  if (!reviewSettled(review('utility_clearance'), facts.now)) add('underground_utility_risk', 'Utility clearance is not recorded (locate ticket and field check required before cutting).');

  // Depth / buried thickness is never inferred from photos.
  if (!facts.depthVerified) add('unknown_depth', 'Cut depth / section thickness is not field-verified; photos cannot establish buried thickness.');

  // Drainage + engineering (CV-049, CP-056): unknown counts as possibly affected.
  const drainage = triOf(facts, 'drainage_affected');
  if (drainage !== false || facts.serviceCode === 'gutter_replacement') {
    add('drainage_impact', drainage === null ? 'Drainage impact is unknown; review gutter flow before pricing as firm.' : 'Gutter flow or drainage may be affected; drainage review required.', `drainage:${String(drainage)}:${facts.serviceCode}`);
  }
  const engineer = triOf(facts, 'engineer_review_required');
  if (engineer !== false) add('external_engineering', engineer ? 'An engineer review was requested.' : 'Whether an engineer review is required is unknown.', `engineer:${String(engineer)}`);

  // Accessibility (CV-048): pedestrian routes and ramps need an approved access review.
  if (pedestrianRoute(facts) && !reviewSettled(review('pedestrian_access'), facts.now)) add('accessible_route', 'A sidewalk, ramp or pedestrian route may be affected; an accessible-route / pedestrian access review is required.');

  // Traffic + silica (CP-055).
  if (requiredReviews(facts).includes('traffic_control_plan') && !reviewSettled(review('traffic_control_plan'), facts.now)) add('traffic_control', 'A traffic control plan is required and not approved.');
  if (!reviewSettled(review('silica_exposure_control'), facts.now)) add('silica_exposure', 'Saw cutting creates silica dust; an exposure control plan must be approved.');

  // Jurisdiction (RF-077): no automatic regulatory conclusions without a resolved locality.
  if (facts.jurisdictionStatus !== 'resolved' && facts.jurisdictionStatus !== 'manual') add('jurisdiction_unresolved', 'The jurisdiction is not resolved; select the locality before permit conclusions are drawn.');

  // CV-041: unknown service -> human scoping.
  if (facts.serviceCode === 'other_concrete_cut') add('scope_ambiguous', 'Service type is not in the standard taxonomy; a person must scope this job.', 'service:other_concrete_cut');
  return flags;
}

const known = (value: boolean, at: Date): SiteCondition => ({ state: 'known', value, source: 'user_entered', recordedAt: at.toISOString() });
const unknownSc = (note: string): SiteCondition => ({ state: 'unknown', reason: 'not_provided', note });

/** The four curb site conditions the shared estimate gating reads (CURB_SITE_CONDITION_KEYS). */
export function siteConditions(facts: CurbFacts): Record<string, SiteCondition> {
  const row = rightOfWay(facts);
  const permitAnswer = triOf(facts, 'permit_known_required');
  let permit: SiteCondition;
  if (facts.permits.some((p) => p.status === 'unknown') || row === null) permit = unknownSc('permit requirement not confirmed');
  else if (permitAnswer === true || facts.permits.some((p) => p.status !== 'not_required')) permit = known(true, facts.now);
  else if (permitAnswer === null) permit = unknownSc('permit question unanswered');
  else permit = known(false, facts.now);
  const util = facts.reviews.find((r) => r.kind === 'utility_clearance');
  return {
    permit_required: permit,
    public_right_of_way: row === null ? unknownSc('right-of-way not confirmed') : known(row, facts.now),
    utilities_cleared: reviewSettled(util, facts.now) ? known(true, facts.now) : util?.status === 'rejected' ? known(false, facts.now) : unknownSc('utility clearance not recorded'),
    depth_verified: facts.depthVerified ? known(true, facts.now) : unknownSc('depth not field-verified'),
  };
}
