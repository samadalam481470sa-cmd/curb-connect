// CV-042-QA / CV-048-QA / CV-049-QA / CP-055-QA / CP-056-QA / ADD-045-QA: curb rule engine.
import { describe, expect, it } from 'vitest';
import { computeCalibration } from './commands';
import { type CurbFacts, evaluateRuleFlags, requiredPermits, requiredReviews, rightOfWay, siteConditions, triOf } from './rules';

const now = new Date('2026-10-27T12:00:00Z');
const obs = (entries: Record<string, boolean | string | null>) =>
  new Map(Object.entries(entries).map(([k, v]) => [k, v === null ? { state: 'unknown' as const, value: null, source: null } : { state: 'known' as const, value: v, source: 'field_verified' }]));

function facts(over: Partial<CurbFacts> = {}): CurbFacts {
  return { serviceCode: 'driveway_opening', isPublicRightOfWay: null, jurisdictionStatus: 'resolved', observations: new Map(), permits: [], reviews: [], depthVerified: false, now, ...over };
}

const clear = (): CurbFacts =>
  facts({
    isPublicRightOfWay: false,
    observations: obs({ sidewalk_affected: false, curb_ramp_affected: false, drainage_affected: false, traffic_lane_affected: false, engineer_review_required: false, permit_known_required: false }),
    reviews: (['utility_clearance', 'silica_exposure_control', 'job_site_safety_plan'] as const).map((kind) => ({ kind, status: 'approved', expiresAt: null })),
    depthVerified: true,
  });

describe('curb rules', () => {
  it('CV-042-QA unknown is never false: an empty intake opens every blocking flag', () => {
    const kinds = evaluateRuleFlags(facts()).map((f) => f.kind).sort();
    expect(kinds).toEqual(['accessible_route', 'drainage_impact', 'external_engineering', 'public_right_of_way', 'silica_exposure', 'traffic_control', 'underground_utility_risk', 'unknown_depth'].sort());
    expect(siteConditions(facts())).toMatchObject({ public_right_of_way: { state: 'unknown' }, utilities_cleared: { state: 'unknown' }, depth_verified: { state: 'unknown' }, permit_required: { state: 'unknown' } });
  });

  it('CV-042-QA private-site work with every fact recorded has no flags and known site conditions', () => {
    expect(evaluateRuleFlags(clear())).toEqual([]);
    expect(siteConditions(clear())).toMatchObject({ permit_required: { value: false }, public_right_of_way: { value: false }, utilities_cleared: { value: true }, depth_verified: { value: true } });
  });

  it('CP-056-QA city right-of-way needs an approved, unexpired permit', () => {
    const f = { ...clear(), isPublicRightOfWay: true };
    expect(evaluateRuleFlags(f).map((x) => x.kind)).toContain('public_right_of_way');
    const approved = { ...f, permits: [{ permitType: 'right_of_way_permit', status: 'approved', expiresOn: '2027-01-01' }], reviews: [...f.reviews, { kind: 'traffic_control_plan' as const, status: 'approved', expiresAt: null }] };
    expect(evaluateRuleFlags(approved)).toEqual([]);
    const expired = { ...approved, permits: [{ permitType: 'right_of_way_permit', status: 'approved', expiresOn: '2026-01-01' }] };
    expect(evaluateRuleFlags(expired).map((x) => x.kind)).toEqual(['public_right_of_way', 'road_work_permit']);
    // Permit-implicated work stays non-binding even with the permit issued.
    expect(siteConditions(approved).permit_required).toMatchObject({ state: 'known', value: true });
  });

  it('ownership answer drives right-of-way when the project field is unset; photo answers are unknown', () => {
    expect(rightOfWay(facts({ observations: obs({ ownership: 'private' }) }))).toBe(false);
    expect(rightOfWay(facts({ observations: obs({ ownership: 'public' }) }))).toBe(true);
    const photo = new Map([['ownership', { state: 'known' as const, value: 'private', source: 'imagery_derived' }]]);
    expect(rightOfWay(facts({ observations: photo }))).toBeNull();
  });

  it.each([null, '', 'unknown', 'future_source', 'user_entered', 'machine_estimated', 'imagery_derived'])(
    'unverified source %s cannot settle ownership or safety answers',
    (source) => {
      const f = clear();
      f.isPublicRightOfWay = null;
      f.observations.set('ownership', { state: 'known', value: 'private', source });
      for (const observation of f.observations.values()) observation.source = source;
      expect(rightOfWay(f)).toBeNull();
      expect(triOf(f, 'drainage_affected')).toBeNull();
      expect(requiredPermits(f)).toEqual(['right_of_way_permit']);
      expect(requiredReviews(f)).toEqual(expect.arrayContaining(['traffic_control_plan', 'pedestrian_access']));
      expect(evaluateRuleFlags(f).map((flag) => flag.kind)).toEqual(expect.arrayContaining([
        'public_right_of_way', 'drainage_impact', 'external_engineering', 'accessible_route', 'traffic_control',
      ]));
      expect(siteConditions(f)).toMatchObject({
        public_right_of_way: { state: 'unknown' }, permit_required: { state: 'unknown' },
      });
      f.isPublicRightOfWay = false;
      expect(siteConditions(f).permit_required.state).toBe('unknown');
      f.observations.set('drainage_affected', { state: 'known', value: true, source });
      expect(triOf(f, 'drainage_affected')).toBeNull();
    },
  );

  it.each(['field_verified', 'survey_supplied'])('trusted source %s settles typed answers', (source) => {
    const f = clear();
    f.isPublicRightOfWay = null;
    f.observations.set('ownership', { state: 'known', value: 'private', source });
    for (const observation of f.observations.values()) observation.source = source;
    expect(rightOfWay(f)).toBe(false);
    expect(requiredPermits(f)).toEqual([]);
    expect(evaluateRuleFlags(f)).toEqual([]);
    expect(siteConditions(f).permit_required).toMatchObject({ state: 'known', value: false });
    f.observations.set('drainage_affected', { state: 'known', value: true, source });
    expect(triOf(f, 'drainage_affected')).toBe(true);
    for (const value of ['public', 'shared']) {
      f.observations.set('ownership', { state: 'known', value, source });
      expect(rightOfWay(f)).toBe(true);
    }
  });

  it.each([null, 'false', 'unknown', 0, 1])('trusted non-boolean answer %s remains unknown', (value) => {
    const f = clear();
    f.observations.set('drainage_affected', { state: 'known', value, source: 'field_verified' });
    expect(triOf(f, 'drainage_affected')).toBeNull();
    expect(evaluateRuleFlags(f).map((flag) => flag.kind)).toContain('drainage_impact');
  });

  it('unknown state cannot be settled by a trusted source and a stale value', () => {
    const f = clear();
    f.isPublicRightOfWay = null;
    f.observations.set('ownership', { state: 'unknown', value: 'private', source: 'field_verified' });
    f.observations.set('permit_known_required', { state: 'unknown', value: false, source: 'field_verified' });
    expect(rightOfWay(f)).toBeNull();
    expect(triOf(f, 'permit_known_required')).toBeNull();
    expect(siteConditions(f).permit_required.state).toBe('unknown');
  });

  it('CV-048-QA accessibility: a sidewalk/ramp needs the pedestrian access review', () => {
    const f = { ...clear(), observations: obs({ sidewalk_affected: true, curb_ramp_affected: false, drainage_affected: false, traffic_lane_affected: false, engineer_review_required: false }) };
    expect(requiredReviews(f)).toContain('pedestrian_access');
    expect(evaluateRuleFlags(f).map((x) => x.kind)).toEqual(['accessible_route']);
  });

  it('other_concrete_cut routes to human scoping', () => {
    expect(evaluateRuleFlags({ ...clear(), serviceCode: 'other_concrete_cut' }).map((x) => x.kind)).toEqual(['scope_ambiguous']);
  });
});

describe('CV-045-QA calibration', () => {
  const base = { media_asset_id: '00000000-0000-4000-8000-000000000000', image_points: [] as [number, number][] };
  it('accepts a reliable 2-point reference with uncertainty', () => {
    const r = computeCalibration({ ...base, method: 'two_point_reference', image_points: [[100, 500], [900, 500]], reference_length_m: 1.2192 });
    expect(r.status).toBe('accepted');
    expect(r.metersPerPixel).toBeCloseTo(1.2192 / 800, 9);
    expect(r.uncertainty).toBeGreaterThan(0);
    expect(r.uncertainty).toBeLessThan(0.05);
  });
  it('fails explicitly for a reference too short to be reliable', () => {
    const r = computeCalibration({ ...base, method: 'two_point_reference', image_points: [[100, 500], [110, 500]], reference_length_m: 1 });
    expect(r).toMatchObject({ status: 'failed', failure: { reason: 'reference_too_short' } });
    expect(r.failure!.next).toMatch(/field_dimensions/);
  });
  it('fails when the scale uncertainty is too high', () => {
    const r = computeCalibration({ ...base, method: 'two_point_reference', image_points: [[100, 500], [125, 500]], reference_length_m: 0.15 });
    expect(r).toMatchObject({ status: 'failed', failure: { reason: 'uncertainty_too_high' } });
  });
  it('fits a 4-point homography; degenerate points fail', () => {
    const ok = computeCalibration({ ...base, method: 'four_point_homography', image_points: [[100, 100], [900, 120], [880, 700], [120, 680]], world_points_m: [[0, 0], [3, 0], [3, 2], [0, 2]] });
    expect(ok.status).toBe('accepted');
    const bad = computeCalibration({ ...base, method: 'four_point_homography', image_points: [[100, 100], [200, 100], [300, 100], [400, 100]], world_points_m: [[0, 0], [1, 0], [2, 0], [3, 0]] });
    expect(bad.status).toBe('failed');
  });
});
