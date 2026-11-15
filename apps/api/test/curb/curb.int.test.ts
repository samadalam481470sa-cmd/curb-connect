// Curb backend integration tests (CV-041..CV-050, CP-051..CP-060, COS-226..COS-250, ADD-040..ADD-056):
// command pipeline for every curb edit, rule-engine gates (public right-of-way, missing permit,
// unknown utilities, uncertain depth, accessibility route, missing safety review) blocking firm
// approval and dispatch, the page-60 worked example priced through the curb module, calibration
// (2-point, homography, explicit failure), versioned segment corrections, vision abstain -> manual
// review, photo quality replace instructions, and redaction records.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '../../src/db/runtime';
import { withTenant } from '../../src/db/runtime';
import { assertCurbDispatchReady } from '../../src/modules/curb/service';
import { setVisionClient, type VisionClient } from '../../src/modules/vision/client';
import { mediaObjectKey } from '../../src/storage';
import { call, type Company, createCompany, createTestContext, type Person, type TestContext } from '../helpers';
import { approvedBook, createProperty, fixtureCandidate, GOLDEN_LINES, insertJurisdiction, removeJurisdictions } from '../commerce/fixtures';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
  await insertJurisdiction(ctx, { name: 'Curb City', kind: 'city', lon: 0.01, lat: 0.01, h: 0.004 });
});
afterEach(() => {
  setVisionClient(null);
});
afterAll(async () => {
  await ctx?.cleanup();
  await removeJurisdictions(ctx);
  await ctx?.close();
});

const done = [{ item: 'Checked on site', done: true }];
const fieldM = (value: number, unit = 'm') => ({ state: 'known', value, unit, source: 'field_verified', measuredAt: new Date().toISOString(), precision: 0 });
// The clear-site fixture records facts verified by an authorized owner on site.
const ans = (value: boolean | string) => ({ state: 'known', value, source: 'field_verified' });

interface Setup {
  a: Company;
  projectId: string;
  rev: () => Promise<number>;
  cmd: (suffix: string, payload: Record<string, unknown>, as?: Person, method?: 'POST' | 'PATCH') => Promise<ReturnType<typeof call> extends Promise<infer R> ? R : never>;
}

async function setup(serviceCode = 'driveway_opening'): Promise<Setup> {
  const a = await createCompany(ctx, { roles: ['estimator', 'reviewer', 'finance', 'read_only', 'crew_manager', 'salesperson'] });
  await approvedBook(ctx, a.as('finance'), { name: 'Curb book' });
  const c = await fixtureCandidate(ctx, a.owner, '100 Fixture Way');
  const property = await createProperty(ctx, a.owner, { originalQuery: '100 Fixture Way', candidate: c });
  const res = await call(ctx, 'POST', '/v1/curb/projects', { as: a.as('estimator'), body: { propertyId: property.id, serviceCode } });
  expect(res.statusCode, res.body).toBe(201);
  const projectId = res.json().project.id as string;
  const rev = async () => (await call(ctx, 'GET', `/v1/curb/projects/${projectId}`, { as: a.owner })).json().project.revision as number;
  const cmd: Setup['cmd'] = async (suffix, payload, as = a.owner, method = 'POST') =>
    call(ctx, method, `/v1/curb/projects/${projectId}${suffix}`, { as, body: { expectedRevision: await rev(), payload }, headers: { 'idempotency-key': randomUUID() } });
  return { a, projectId, rev, cmd };
}

/** Records every fact a private-site driveway opening needs for a firm quote. */
async function clearProject(s: Setup) {
  const ok = (r: { statusCode: number; body: string }) => expect(r.statusCode, r.body).toBe(200);
  ok(await s.cmd('', { is_public_right_of_way: false }, s.a.owner, 'PATCH'));
  ok(
    await s.cmd('/observations', {
      answers: [
        { question_key: 'ownership', answer: ans('private') },
        ...['sidewalk_affected', 'curb_ramp_affected', 'drainage_affected', 'traffic_lane_affected', 'engineer_review_required', 'permit_known_required'].map((k) => ({ question_key: k, answer: ans(false) })),
      ],
    }),
  );
  for (const kind of ['utility_clearance', 'silica_exposure_control', 'job_site_safety_plan']) ok(await s.cmd('/safety-reviews', { kind, status: 'approved', checklist: done }, s.a.as('reviewer')));
  ok(await s.cmd('/measurements', { kind: 'cut_length', measurement: fieldM(5.4864) }, s.a.as('reviewer')));
  ok(await s.cmd('/measurements', { kind: 'cut_depth', measurement: fieldM(0.15) }, s.a.as('reviewer')));
}

const curbEstimate = (s: Setup, as: Person = s.a.as('estimator')) =>
  call(ctx, 'POST', `/v1/curb/projects/${s.projectId}/estimates`, { as, body: { lines: GOLDEN_LINES, assumptions: ['Synthetic page-60 rates'] }, headers: { 'idempotency-key': randomUUID() } });

const approve = (s: Setup, e: { id: string; currentRevision: { id: string } }) =>
  call(ctx, 'POST', `/v1/estimates/${e.id}/approve`, { as: s.a.as('reviewer'), body: { revisionId: e.currentRevision.id, signoffRole: 'estimator', acknowledgedWarnings: ['price_fallback_disclosed'] }, headers: { 'idempotency-key': randomUUID() } });

const blockers = (e: { currentRevision: { gating: { blockers: { code: string }[] } } }) => e.currentRevision.gating.blockers.map((b) => b.code);
const readiness = async (s: Setup) => (await call(ctx, 'GET', `/v1/curb/projects/${s.projectId}/readiness`, { as: s.a.owner })).json();
const dispatchCheck = (s: Setup) => withTenant(ctx.appDb.db, { orgId: s.a.orgId, userId: s.a.owner.userId }, (tx: Tx) => assertCurbDispatchReady(tx, s.a.orgId, s.projectId));

async function photo(s: Setup, viewType = 'scale_reference', bytes = Buffer.from(`fake-jpeg-${randomUUID()}`)) {
  const id = randomUUID();
  const key = mediaObjectKey(s.a.orgId, id, 'original');
  await ctx.storage.put(key, bytes);
  await ctx.owner.client`
    insert into media_assets (id, org_id, owner_type, owner_id, kind, view_type, status, original_object_key, sha256, mime_type, size_bytes)
    values (${id}, ${s.a.orgId}, 'curb_project', ${s.projectId}, 'photo', ${viewType}, 'ready', ${key}, ${randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')}, 'image/jpeg', ${bytes.length})`;
  return id;
}

describe('COS-226-API curb projects and intake', () => {
  it('CV-042-QA a new project opens rule gates, a permit to clarify and pending safety reviews; unknown is never false', async () => {
    const s = await setup();
    const d = (await call(ctx, 'GET', `/v1/curb/projects/${s.projectId}`, { as: s.a.as('read_only') })).json();
    expect(d.project).toMatchObject({ serviceCode: 'driveway_opening', status: 'intake', isPublicRightOfWay: null });
    expect(d.project.jurisdictionId).not.toBeNull();
    expect(d.riskFlags.map((f: { kind: string }) => f.kind).sort()).toEqual(
      ['accessible_route', 'drainage_impact', 'external_engineering', 'public_right_of_way', 'road_work_permit', 'silica_exposure', 'traffic_control', 'underground_utility_risk', 'unknown_depth'].sort(),
    );
    expect(d.riskFlags.every((f: { severity: string; evidenceSource: string }) => f.severity === 'blocking' && f.evidenceSource === 'rule_engine')).toBe(true);
    expect(d.permits).toMatchObject([{ permitType: 'right_of_way_permit', status: 'unknown' }]);
    expect(d.safetyReviews.map((r: { kind: string }) => r.kind).sort()).toEqual(['job_site_safety_plan', 'pedestrian_access', 'silica_exposure_control', 'traffic_control_plan', 'utility_clearance']);
    const r = await readiness(s);
    expect(r).toMatchObject({ canApproveFirm: false, canDispatch: false });
    const q = (await call(ctx, 'GET', '/v1/curb/intake-questions', { as: s.a.owner })).json();
    expect(q.items.filter((i: { early: boolean }) => i.early).map((i: { key: string }) => i.key)).toContain('engineer_review_required');
    const cap = (await call(ctx, 'GET', '/v1/curb/capture-protocol', { as: s.a.owner })).json();
    expect(cap.shots.filter((x: { roadwayRisk: boolean; required: boolean }) => x.roadwayRisk && x.required)).toEqual([]);
  });

  it('CV-041-QA unknown service routes to human scoping; typed answers are validated; read_only cannot edit', async () => {
    const s = await setup('other_concrete_cut');
    const d = (await call(ctx, 'GET', `/v1/curb/projects/${s.projectId}`, { as: s.a.owner })).json();
    expect(d.riskFlags.map((f: { kind: string }) => f.kind)).toContain('scope_ambiguous');
    const bad = await s.cmd('/observations', { answers: [{ question_key: 'sidewalk_affected', answer: ans('yes') }] });
    expect(bad.statusCode).toBe(400);
    const unknownAnswer = await s.cmd('/observations', { answers: [{ question_key: 'sidewalk_affected', answer: { state: 'unknown' } }] });
    expect(unknownAnswer.statusCode, unknownAnswer.body).toBe(200);
    expect(unknownAnswer.json().detail.observations[0].answer).toMatchObject({ state: 'unknown' });
    const ro = await s.cmd('/observations', { answers: [{ question_key: 'sidewalk_affected', answer: ans(false) }] }, s.a.as('read_only'));
    expect(ro.statusCode).toBe(403);
  });

  it('unverified answers keep safety gates closed and estimators cannot claim verification', async () => {
    const s = await setup();
    await clearProject(s);
    const initialRevision = await s.rev();
    const rejected = await s.cmd('/observations', {
      answers: [{ question_key: 'permit_known_required', answer: ans(false) }],
    }, s.a.as('estimator'));
    expect(rejected.statusCode).toBe(403);
    expect(await s.rev()).toBe(initialRevision);
    const recorded = await s.cmd('/observations', {
      answers: [{ question_key: 'permit_known_required', answer: { state: 'known', value: false, source: 'user_entered' } }],
    }, s.a.as('estimator'));
    expect(recorded.statusCode, recorded.body).toBe(200);
    const result = await readiness(s);
    expect(result.canApproveFirm).toBe(false);
    expect(result.canDispatch).toBe(false);
    expect(result.gates.map((g: { code: string }) => g.code)).toContain('unknown:permit_required');
  });

  it('ADD-014-QA commands: stale revision -> 409 with diff, replay returns the receipt, receipt + audit + outbox written', async () => {
    const s = await setup();
    const r0 = await s.rev();
    const key = randomUUID();
    const body = { expectedRevision: r0, payload: { curb_profile: 'barrier_curb' } };
    const first = await call(ctx, 'PATCH', `/v1/curb/projects/${s.projectId}`, { as: s.a.owner, body, headers: { 'idempotency-key': key } });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().receipt).toMatchObject({ command_id: key, status: 'committed', server_revision: r0 + 1 });
    const replay = await call(ctx, 'PATCH', `/v1/curb/projects/${s.projectId}`, { as: s.a.owner, body, headers: { 'idempotency-key': key } });
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json().receipt.server_revision).toBe(r0 + 1);
    const stale = await call(ctx, 'PATCH', `/v1/curb/projects/${s.projectId}`, { as: s.a.owner, body: { expectedRevision: r0, payload: { curb_profile: 'mountable_curb' } }, headers: { 'idempotency-key': randomUUID() } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().conflict).toMatchObject({ serverRevision: r0 + 1, diff: [{ field: 'curb_profile', server: 'barrier_curb', yours: 'mountable_curb' }] });
    const [n] = await ctx.owner.client<{ r: number; e: number }[]>`select (select count(*)::int from command_receipts where aggregate_id = ${s.projectId}) as r, (select count(*)::int from domain_events where aggregate_id = ${s.projectId}) as e`;
    expect(n).toMatchObject({ r: 1, e: 1 });
  });
});

describe('CP-052-QA page-60 worked example through the curb module', () => {
  it('prices exactly $5,491.20 firm, approves, and only then becomes dispatchable', async () => {
    const s = await setup();
    await clearProject(s);
    const r = await readiness(s);
    expect(r.gates).toEqual([{ code: 'estimate_not_approved', message: expect.any(String), resolution: expect.any(String) }]);
    expect(r).toMatchObject({ canApproveFirm: true, canDispatch: false, quoteKind: 'firm' });
    await expect(dispatchCheck(s)).rejects.toMatchObject({ init: { code: 'dispatch_blocked' } });

    const res = await curbEstimate(s);
    expect(res.statusCode, res.body).toBe(201);
    const e = res.json();
    expect(e.currentRevision.quoteKind).toBe('firm');
    expect(blockers(e)).toEqual([]);
    expect(e.currentRevision.inputs.cut_length).toMatchObject({ value: 5.4864, source: 'field_verified' });
    expect(e.currentRevision.scenarios.base).toMatchObject({ directMinor: 374400, overheadMinor: 37440, subtotalMinor: 549120, totalMinor: 549120 });
    expect(e.currentRevision.scenarios.low.totalMinor).toBe(549120);
    expect(e.currentRevision.scenarios.high.totalMinor).toBe(549120);
    const lines = Object.fromEntries(e.currentRevision.scenarios.base.lines.map((l: { code: string; amountMinor: number }) => [l.code, l.amountMinor]));
    expect(lines).toMatchObject({ SAW_CUT: 36000, MOBILIZATION: 40000, BREAKOUT: 50400, DISPOSAL: 22000, REPLACE_CURB: 171000, TRAFFIC: 35000, PERMIT_ALLOW: 20000 });

    const ok = await approve(s, e);
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await readiness(s)).canDispatch).toBe(true);
    await expect(dispatchCheck(s)).resolves.toBeUndefined();

    // Any later curb edit makes the approved estimate stale and blocks dispatch again (CP-059 S).
    expect((await s.cmd('/measurements', { kind: 'cut_length', measurement: fieldM(6) }, s.a.as('reviewer'))).statusCode).toBe(200);
    const after = (await call(ctx, 'GET', `/v1/estimates/${e.id}`, { as: s.a.owner })).json();
    expect(after).toMatchObject({ status: 'review_required', approvedRevisionId: null });
    expect((await readiness(s)).canDispatch).toBe(false);
    const sync = await call(ctx, 'POST', `/v1/curb/projects/${s.projectId}/estimates/${e.id}/sync`, { as: s.a.as('estimator'), body: { expectedRevision: after.revision }, headers: { 'idempotency-key': randomUUID() } });
    expect(sync.statusCode, sync.body).toBe(200);
    expect(sync.json().estimate.currentRevision.inputs.cut_length.value).toBe(6);
    expect(sync.json().estimate.stale).toBeNull();
  });
});

describe('CP-059-QA hard gates: cannot approve as firm, cannot dispatch', () => {
  async function gated(mutate: (s: Setup) => Promise<void>) {
    const s = await setup();
    await clearProject(s);
    await mutate(s);
    const res = await curbEstimate(s);
    expect(res.statusCode, res.body).toBe(201);
    const e = res.json();
    expect(e.currentRevision.quoteKind).not.toBe('firm');
    expect(e.currentRevision.isBinding).toBe(false);
    const ap = await approve(s, e);
    expect(ap.json().code).toBe('gate_blocked');
    const r = await readiness(s);
    expect(r.canApproveFirm).toBe(false);
    expect(r.canDispatch).toBe(false);
    await expect(dispatchCheck(s)).rejects.toMatchObject({ init: { code: 'dispatch_blocked' } });
    return { e, r, s };
  }
  const codes = (r: { gates: { code: string }[] }) => r.gates.map((g) => g.code);

  it('public right-of-way', async () => {
    const { e, r } = await gated(async (s) => void (await s.cmd('', { is_public_right_of_way: true }, s.a.owner, 'PATCH')));
    expect(blockers(e)).toEqual(expect.arrayContaining(['public_right_of_way', 'risk_flag_open']));
    expect(codes(r)).toEqual(expect.arrayContaining(['risk_flag:public_right_of_way', 'risk_flag:road_work_permit', 'risk_flag:traffic_control']));
  });

  it('missing permit (required, not approved) and an expired permit', async () => {
    const { r, s } = await gated(async (s) => void (await s.cmd('/permits', { permit_type: 'curb_cut_permit', status: 'required' }, s.a.as('estimator'))));
    expect(codes(r)).toContain('risk_flag:road_work_permit');
    expect((await s.cmd('/permits', { permit_type: 'curb_cut_permit', status: 'approved' }, s.a.as('estimator'))).statusCode).toBe(400);
    expect((await s.cmd('/permits', { permit_type: 'curb_cut_permit', status: 'approved', application_reference: 'CC-1', expires_on: '2099-01-01' }, s.a.as('estimator'))).statusCode).toBe(200);
    expect(codes(await readiness(s))).not.toContain('risk_flag:road_work_permit');
    expect(codes(await readiness(s))).toContain('permit_implicated');
  });

  it('unknown utilities', async () => {
    const { e, r } = await gated(async (s) => void (await s.cmd('/safety-reviews', { kind: 'utility_clearance', status: 'rejected', checklist: [{ item: 'Locate ticket', done: false }] }, s.a.as('reviewer'))));
    expect(blockers(e)).toContain('utilities_not_cleared');
    expect(codes(r)).toContain('risk_flag:underground_utility_risk');
  });

  it('uncertain depth: photos cannot set depth; an unknown depth blocks', async () => {
    const { e, r, s } = await gated(async (s) => void (await s.cmd('/measurements', { kind: 'cut_depth', measurement: { state: 'unknown', reason: 'not_observable' } }, s.a.as('reviewer'))));
    expect(blockers(e)).toContain('depth_uncertain');
    expect(codes(r)).toContain('risk_flag:unknown_depth');
    const photoDepth = await s.cmd('/measurements', { kind: 'cut_depth', measurement: { state: 'known', value: 0.15, unit: 'm', source: 'imagery_derived', measuredAt: new Date().toISOString(), precision: 0.02 } }, s.a.as('reviewer'));
    expect(photoDepth.json().code).toBe('measurement_unknown');
  });

  it('accessibility route without a pedestrian access review', async () => {
    const { r, s } = await gated(async (s) => void (await s.cmd('/observations', { answers: [{ question_key: 'curb_ramp_affected', answer: ans(true) }] })));
    expect(codes(r)).toContain('risk_flag:accessible_route');
    // Not closable by a note: only the review evidence closes it.
    const flag = (await call(ctx, 'GET', `/v1/curb/projects/${s.projectId}`, { as: s.a.owner })).json().riskFlags.find((f: { kind: string; status: string }) => f.kind === 'accessible_route' && f.status === 'open');
    const note = await s.cmd('/risk-flags/resolve', { risk_flag_id: flag.id, status: 'resolved', resolution_note: 'looks fine' }, s.a.as('reviewer'));
    expect(note.json().code).toBe('gate_blocked');
    expect((await s.cmd('/safety-reviews', { kind: 'pedestrian_access', status: 'approved', checklist: done }, s.a.as('reviewer'))).statusCode).toBe(200);
    expect(codes(await readiness(s))).not.toContain('risk_flag:accessible_route');
  });

  it('missing safety review (silica exposure control pending)', async () => {
    const { r } = await gated(async (s) => void (await s.cmd('/safety-reviews', { kind: 'silica_exposure_control', status: 'rejected', checklist: [{ item: 'Wet cutting', done: false }] }, s.a.as('reviewer'))));
    expect(codes(r)).toContain('risk_flag:silica_exposure');
  });

  it('an overridable rule flag (drainage) can be mitigated by a reviewer and stays closed while evidence is unchanged', async () => {
    const s = await setup();
    await clearProject(s);
    await s.cmd('/observations', { answers: [{ question_key: 'drainage_affected', answer: ans(true) }] });
    const flag = (await call(ctx, 'GET', `/v1/curb/projects/${s.projectId}`, { as: s.a.owner })).json().riskFlags.find((f: { kind: string; status: string }) => f.kind === 'drainage_impact' && f.status === 'open');
    expect((await s.cmd('/risk-flags/resolve', { risk_flag_id: flag.id, status: 'mitigated', resolution_note: 'Flow line kept; engineer letter on file' }, s.a.as('estimator'))).statusCode).toBe(403);
    expect((await s.cmd('/risk-flags/resolve', { risk_flag_id: flag.id, status: 'mitigated', resolution_note: 'Flow line kept; engineer letter on file' }, s.a.as('reviewer'))).statusCode).toBe(200);
    await s.cmd('', { curb_profile: 'barrier_curb' }, s.a.owner, 'PATCH');
    expect((await readiness(s)).gates.map((g: { code: string }) => g.code)).toEqual(['estimate_not_approved']);
  });
});

describe('CV-045-QA / CV-047-QA calibration, segments and provenance', () => {
  it('2-point calibration -> photo-derived cut length is a range, never firm; failures are explicit', async () => {
    const s = await setup();
    await clearProject(s);
    const media = await photo(s);
    const failed = await s.cmd('/calibrations', { media_asset_id: media, method: 'two_point_reference', image_points: [[100, 500], [108, 500]], reference_length_m: 1.2192 }, s.a.as('estimator'));
    expect(failed.statusCode, failed.body).toBe(200);
    const fcal = failed.json().detail.calibrations[0];
    expect(fcal).toMatchObject({ status: 'failed', failure: { reason: 'reference_too_short' } });
    const noScale = await s.cmd('/segments', { kind: 'saw_cut_path', media_asset_id: media, calibration_id: fcal.id, geometry: { space: 'image_px', pieces: [{ shape: 'straight', points: [[100, 500], [900, 500]] }] } }, s.a.as('estimator'));
    expect(noScale.json().code).toBe('calibration_failed');

    const okCal = await s.cmd('/calibrations', { media_asset_id: media, method: 'two_point_reference', image_points: [[100, 500], [900, 500]], reference_length_m: 1.2192 }, s.a.as('estimator'));
    const cal = okCal.json().detail.calibrations.find((c: { status: string }) => c.status === 'accepted');
    expect(cal.uncertainty).toBeGreaterThan(0);
    // 3600 px at 1.2192 m / 800 px = 5.4864 m (18 ft), plus a curved return piece.
    const seg = await s.cmd('/segments', { kind: 'saw_cut_path', media_asset_id: media, calibration_id: cal.id, geometry: { space: 'image_px', pieces: [{ shape: 'straight', points: [[0, 500], [3600, 500]] }] } }, s.a.as('estimator'));
    expect(seg.statusCode, seg.body).toBe(200);
    const segRow = seg.json().detail.segments[0];
    expect(segRow.geometry).toMatchObject({ lengthM: 5.4864, version: 1, calibrationId: cal.id, mediaAssetId: media });
    // Drop the project-level field measurement so the photo-derived segment length drives pricing.
    await ctx.owner.client`delete from curb_measurements where curb_project_id = ${s.projectId} and kind = 'cut_length' and segment_id is null`;
    const e = (await curbEstimate(s)).json();
    expect(e.currentRevision.inputs.cut_length).toMatchObject({ source: 'imagery_derived' });
    expect(e.currentRevision.quoteKind).not.toBe('firm');
    expect(blockers(e)).toContain('quantities_unverified');

    // Versioned correction keeps the previous version tied to its image + calibration.
    const fix = await s.cmd('/segments', { segment_id: segRow.id, kind: 'saw_cut_path', media_asset_id: media, calibration_id: cal.id, correction_reason: 'End point was on the joint', geometry: { space: 'image_px', pieces: [{ shape: 'straight', points: [[0, 500], [3200, 500]] }] } }, s.a.as('estimator'));
    expect(fix.statusCode, fix.body).toBe(200);
    const g = fix.json().detail.segments[0].geometry;
    expect(g).toMatchObject({ version: 2, correctionReason: 'End point was on the joint', lengthM: 4.8768 });
    expect(g.history).toMatchObject([{ version: 1, lengthM: 5.4864, calibrationId: cal.id }]);
    const noReason = await s.cmd('/segments', { segment_id: segRow.id, kind: 'saw_cut_path', geometry: { space: 'plane_m', pieces: [{ shape: 'straight', points: [[0, 0], [5, 0]] }] } }, s.a.as('estimator'));
    expect(noReason.statusCode).toBe(400);
  });

  it('homography calibration; curved pieces need >= 3 points; plane geometry; field_verified needs the verify permission', async () => {
    const s = await setup();
    const media = await photo(s);
    const h = await s.cmd('/calibrations', { media_asset_id: media, method: 'four_point_homography', image_points: [[100, 100], [900, 120], [880, 700], [120, 680]], world_points_m: [[0, 0], [3, 0], [3, 2], [0, 2]] }, s.a.as('estimator'));
    expect(h.json().detail.calibrations[0]).toMatchObject({ method: 'four_point_homography', status: 'accepted' });
    const chord = await s.cmd('/segments', { kind: 'return_transition', geometry: { space: 'plane_m', pieces: [{ shape: 'curved', points: [[0, 0], [1, 1]] }] } }, s.a.as('estimator'));
    expect(chord.json().code).toBe('geometry_invalid');
    const curved = await s.cmd('/segments', { kind: 'return_transition', geometry: { space: 'plane_m', pieces: [{ shape: 'straight', points: [[0, 0], [2, 0]] }, { shape: 'curved', points: [[2, 0], [2.7071, 0.2929], [3, 1]] }] } }, s.a.as('estimator'));
    expect(curved.statusCode, curved.body).toBe(200);
    expect(curved.json().detail.segments[0].geometry.lengthM).toBeGreaterThan(3.5);
    const obstacle = await s.cmd('/segments', { kind: 'obstruction', label: 'Water meter', geometry: { space: 'plane_m', pieces: [{ shape: 'straight', points: [[1, 0.5], [1.3, 0.5]] }] } }, s.a.as('estimator'));
    expect(obstacle.statusCode).toBe(200);
    expect((await s.cmd('/measurements', { kind: 'cut_length', measurement: fieldM(5) }, s.a.as('salesperson'))).statusCode).toBe(403);
    expect((await s.cmd('/measurements', { kind: 'cut_length', measurement: fieldM(5) }, s.a.as('estimator'))).statusCode).toBe(403);
    const noCal = await s.cmd('/measurements', { kind: 'curb_height', measurement: { state: 'known', value: 0.15, unit: 'm', source: 'imagery_derived', measuredAt: new Date().toISOString(), precision: 0.02 } }, s.a.as('estimator'));
    expect(noCal.json().code).toBe('calibration_failed');
  });
});

describe('CV-044-QA / CV-046-QA vision adapter, capture checklist and privacy', () => {
  it('photo quality returns replace instructions; recognizer abstain is surfaced as manual review; redactions recorded', async () => {
    const s = await setup();
    const media = await photo(s);
    const calls: string[] = [];
    const stub: VisionClient = {
      async photoQuality(i) {
        calls.push(`quality:${i.viewType}`);
        return {
          resultType: 'photo_quality',
          metricVersion: 'pq@1',
          thresholdsVersion: 'th@1',
          verdict: 'retake_required',
          reasons: [{ code: 'blur_fail', check: 'blur', severity: 'fail', message: 'The photo is blurry.', action: 'Hold the phone steady and retake.' }],
          checks: { duplicate: { matches: [] }, blur: { laplacianVariance: 12.5 } },
          exif: { gpsPresent: true },
          hashes: { sha256: 'a'.repeat(64), dhash: '0f0f0f0f0f0f0f0f', dhashAlgorithm: 'dhash-8x8' },
        };
      },
      async recognizeCurb() {
        calls.push('recognize');
        return { resultType: 'abstain', model: null, abstention: { reasonCode: 'no_model_enabled', message: 'No validated model enabled; route to manual review.', route: 'manual_review' } };
      },
    };
    setVisionClient(stub);
    const q = await call(ctx, 'POST', `/v1/curb/projects/${s.projectId}/photos/${media}/quality`, { as: s.a.as('crew_manager') });
    expect(q.statusCode, q.body).toBe(200);
    expect(q.json()).toMatchObject({ verdict: 'retake_required', gpsPresent: true, instructions: [{ code: 'blur_fail', action: 'Hold the phone steady and retake.' }] });
    const cap = (await call(ctx, 'GET', `/v1/curb/projects/${s.projectId}/capture`, { as: s.a.owner })).json();
    expect(cap.complete).toBe(false);
    expect(cap.shots.find((x: { viewType: string }) => x.viewType === 'scale_reference').status).toBe('retake_required');
    expect(cap.instructions.join(' ')).toMatch(/Retake "Known-length reference/);
    // The media DTO still validates (numeric-only quality scores).
    expect((await call(ctx, 'GET', `/v1/media/${media}`, { as: s.a.owner })).statusCode).toBe(200);

    const r = await call(ctx, 'POST', `/v1/curb/projects/${s.projectId}/photos/${media}/recognize`, { as: s.a.owner });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ status: 'manual_review', model: null, suggestions: null });
    expect(r.json().neverInferred).toContain('buried_depth');

    const red = await call(ctx, 'POST', `/v1/curb/projects/${s.projectId}/photos/${media}/redactions`, { as: s.a.owner, body: { kind: 'license_plate', region: [0.1, 0.1, 0.2, 0.1] } });
    expect(red.statusCode, red.body).toBe(201);
    expect((await call(ctx, 'POST', `/v1/curb/projects/${s.projectId}/photos/${media}/redactions`, { as: s.a.owner, body: { kind: 'face', region: [0.9, 0.9, 0.2, 0.2] } })).statusCode).toBe(400);
    expect(calls).toEqual(['quality:scale_reference', 'recognize']);
  });

  it('worker unavailable is an explicit dependency error, never a fake score; other tenants cannot reach the photo', async () => {
    const s = await setup();
    const media = await photo(s);
    const prev = process.env.VISION_SERVICE_TOKEN;
    delete process.env.VISION_SERVICE_TOKEN;
    try {
      const q = await call(ctx, 'POST', `/v1/curb/projects/${s.projectId}/photos/${media}/quality`, { as: s.a.owner });
      expect(q.json().code).toBe('dependency_unavailable');
    } finally {
      if (prev !== undefined) process.env.VISION_SERVICE_TOKEN = prev;
    }
    const other = await createCompany(ctx, {});
    expect((await call(ctx, 'GET', `/v1/curb/projects/${s.projectId}`, { as: other.owner })).statusCode).toBe(404);
    expect((await call(ctx, 'POST', `/v1/curb/projects/${s.projectId}/photos/${media}/quality`, { as: other.owner })).statusCode).toBe(404);
  });
});
