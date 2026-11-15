// CP-052-QA / CP-058-QA / CP-059-QA / OPS-065-QA / ADD-017-QA / ADD-060-QA: shared estimates with
// immutable revisions (input snapshot, price-book snapshot, engine versions, scenarios, gating,
// binding flag), the page-60 golden figure, deterministic repricing, dependent staleness, and
// server-side approval gates: hard blockers, warnings acknowledgment, policies by jurisdiction,
// named sign-offs, separation of duties, delegation and withdrawal.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Company, createCompany, createTestContext, type Person, type TestContext } from '../helpers';
import {
  approvedBook,
  CLEAR_SITE,
  countRows,
  createEstimate,
  createProperty,
  curbProject,
  fieldVerifiedCut,
  fixtureCandidate,
  GOLDEN_LINES,
  insertJurisdiction,
  known,
  photoCut,
  removeJurisdictions,
  roofOrder,
} from './fixtures';

let ctx: TestContext;
let cityA: string;
beforeAll(async () => {
  ctx = await createTestContext();
  cityA = await insertJurisdiction(ctx, { name: 'Estimate City', kind: 'city', lon: 0.01, lat: 0.01, h: 0.004 });
});
afterAll(async () => {
  await ctx?.cleanup();
  await removeJurisdictions(ctx);
  await ctx?.close();
});

const pin = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });

async function curbSetup(roles: Parameters<typeof createCompany>[1] = {}) {
  const a = await createCompany(ctx, { roles: ['estimator', 'reviewer', 'finance', 'read_only', 'crew_manager', ...(roles.roles ?? [])] });
  await approvedBook(ctx, a.as('finance'), { name: 'Default curb' });
  const c = await fixtureCandidate(ctx, a.owner, '100 Fixture Way');
  const property = await createProperty(ctx, a.owner, { originalQuery: '100 Fixture Way', candidate: c });
  const projectId = await curbProject(ctx, a, property.id);
  return { a, property, projectId };
}

async function goldenEstimate(a: Company, projectId: string, as: Person, over: Record<string, unknown> = {}) {
  const res = await createEstimate(ctx, as, {
    productLine: 'curb',
    curbProjectId: projectId,
    inputs: { cut_length: fieldVerifiedCut() },
    lines: GOLDEN_LINES,
    siteConditions: CLEAR_SITE,
    assumptions: ['Synthetic page-60 rates'],
    ...over,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

const sign = (as: Person, estimateId: string, body: Record<string, unknown>, key = randomUUID()) =>
  call(ctx, 'POST', `/v1/estimates/${estimateId}/approve`, { as, body, headers: { 'idempotency-key': key } });

describe('CP-052-QA shared estimates', () => {
  it('golden page-60 fixture: $3,744 direct, $4,118.40 with overhead, $5,491.20 at 25% target margin', async () => {
    const { a, projectId, property } = await curbSetup();
    const e = await goldenEstimate(a, projectId, a.as('estimator'));
    const rev = e.currentRevision;
    expect(e).toMatchObject({ status: 'pricing_ready', propertyId: property.id, stale: null });
    expect(rev.quoteKind).toBe('firm');
    expect(rev.isBinding).toBe(true);
    expect(rev.scenarios.base).toMatchObject({ directMinor: 374400, overheadMinor: 37440, subtotalMinor: 549120, totalMinor: 549120 });
    expect(rev.scenarios.low.totalMinor).toBe(549120);
    expect(rev.scenarios.base.lines.find((l: { code: string }) => l.code === 'SAW_CUT')).toMatchObject({ quantity: '18', amountMinor: 36000 });
    expect(rev.engineVersions).toMatchObject({ pricing: expect.any(String), gating: 'gating@1.0.0' });
    expect(rev.priceSelection).toMatchObject({ match: 'company_default', fallback: true });
    expect(rev.gating.blockers).toEqual([]);
    // The full catalog snapshot is stored with the revision (CP-057 D).
    const [snap] = await ctx.owner.client<{ snap: { items: unknown[] } }[]>`select price_book_snapshot as snap from estimate_revisions where id = ${rev.id}`;
    expect(snap!.snap.items).toHaveLength(7);
  });

  it('photo-derived quantities and unknown site conditions give a budgetary range only (never firm)', async () => {
    const { a, projectId } = await curbSetup();
    const e = await goldenEstimate(a, projectId, a.as('estimator'), { inputs: { cut_length: photoCut() }, siteConditions: { permit_required: known(true) } });
    expect(e.status).toBe('field_check_required');
    const rev = e.currentRevision;
    expect(rev.quoteKind).toBe('budgetary_range');
    expect(rev.isBinding).toBe(false);
    expect(rev.scenarios.low.totalMinor).toBeLessThan(rev.scenarios.high.totalMinor);
    const codes = rev.gating.blockers.map((b: { code: string }) => b.code);
    expect(codes).toEqual(expect.arrayContaining(['permit_required', 'right_of_way_unknown', 'utilities_unknown', 'depth_uncertain', 'quantities_unverified']));
    // A model/photo "answer" about utilities is treated as unknown.
    const photoUtil = await goldenEstimate(a, projectId, a.as('estimator'), { siteConditions: { ...CLEAR_SITE, utilities_cleared: { ...known(true), source: 'imagery_derived' } } });
    expect(photoUtil.currentRevision.gating.blockers.map((b: { code: string }) => b.code)).toContain('utilities_unknown');
    // An unknown critical measurement is pending review with no totals, never $0.
    const unknownCut = await goldenEstimate(a, projectId, a.as('estimator'), { inputs: { cut_length: { state: 'unknown', reason: 'not_measured_yet' } } });
    expect(unknownCut.currentRevision).toMatchObject({ quoteKind: 'review_required', scenarios: null });
    expect(unknownCut.status).toBe('review_required');
  });

  it('idempotent create, deterministic reprice, line-quantity command, cost redaction, tenancy', async () => {
    const { a, projectId } = await curbSetup();
    const b = await createCompany(ctx);
    const key = randomUUID();
    const body = { productLine: 'curb', curbProjectId: projectId, inputs: { cut_length: fieldVerifiedCut() }, lines: GOLDEN_LINES, siteConditions: CLEAR_SITE };
    const first = await createEstimate(ctx, a.as('estimator'), body, key);
    const second = await createEstimate(ctx, a.as('estimator'), body, key);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json().id).toBe(first.json().id);
    expect((await call(ctx, 'POST', '/v1/estimates', { as: a.as('estimator'), body })).json().code).toBe('idempotency_key_required');
    const e = first.json();

    // Deterministic: repricing unchanged inputs is a committed no-op with the same revision.
    const re = await call(ctx, 'POST', `/v1/estimates/${e.id}/reprice`, { as: a.as('estimator'), body: { expectedRevision: e.revision }, headers: { 'idempotency-key': randomUUID() } });
    expect(re.statusCode, re.body).toBe(200);
    expect(re.json().receipt.server_revision).toBe(e.revision);
    expect(re.json().estimate.currentRevision.id).toBe(e.currentRevision.id);

    // The starter's example command through POST /v1/commands.
    const cmdId = randomUUID();
    const cmd = await call(ctx, 'POST', '/v1/commands', {
      as: a.as('estimator'),
      body: { command_type: 'EstimateLineItemQuantityChanged', command_id: cmdId, aggregate_id: e.id, expected_revision: e.revision, payload: { item_id: 'SAW_CUT', quantity: '20', unit: 'linear_ft' } },
      headers: { 'idempotency-key': cmdId },
    });
    expect(cmd.statusCode, cmd.body).toBe(201);
    const after = (await call(ctx, 'GET', `/v1/estimates/${e.id}`, { as: a.as('estimator') })).json();
    expect(after.currentRevision.revisionNumber).toBe(2);
    expect(after.currentRevision.scenarios.base.directMinor).toBe(374400 + 4000);
    const revs = (await call(ctx, 'GET', `/v1/estimates/${e.id}/revisions`, { as: a.as('estimator') })).json().items;
    expect(revs.map((r: { revisionNumber: number }) => r.revisionNumber)).toEqual([1, 2]);
    expect(revs[0].scenarios.base.totalMinor).toBe(549120); // revision 1 is immutable
    const wrongUnit = randomUUID();
    const unitRes = await call(ctx, 'POST', '/v1/commands', {
      as: a.as('estimator'),
      body: { command_type: 'EstimateLineItemQuantityChanged', command_id: wrongUnit, aggregate_id: e.id, expected_revision: after.revision, payload: { item_id: 'SAW_CUT', quantity: '6', unit: 'linear_m' } },
      headers: { 'idempotency-key': wrongUnit },
    });
    expect(unitRes.statusCode).toBe(400);

    // OPS-065 A: read_only sees totals but no internal cost, margin or rates.
    const ro = (await call(ctx, 'GET', `/v1/estimates/${e.id}`, { as: a.as('read_only') })).json();
    expect(ro.currentRevision.scenarios.base.totalMinor).toBe(after.currentRevision.scenarios.base.totalMinor);
    expect(ro.currentRevision.scenarios.base.directMinor).toBeUndefined();
    expect(ro.currentRevision.scenarios.base.lines).toEqual([]);
    expect((await call(ctx, 'GET', `/v1/estimates/${e.id}`, { as: b.owner })).statusCode).toBe(404);
    expect((await createEstimate(ctx, a.as('read_only'), body)).statusCode).toBe(403);
    // Reads emit nothing.
    const audits = await countRows(ctx, 'audit_events', a.orgId);
    await call(ctx, 'GET', `/v1/estimates/${e.id}/revisions`, { as: a.owner });
    expect(await countRows(ctx, 'audit_events', a.orgId)).toBe(audits);
  });
});

describe('CP-059-QA approval gates', () => {
  it('blocks approval server-side while any gate is open; blockers cannot be overridden', async () => {
    const { a, projectId } = await curbSetup();
    const e = await goldenEstimate(a, projectId, a.as('estimator'), { siteConditions: { ...CLEAR_SITE, public_right_of_way: known(true) } });
    const res = await sign(a.as('reviewer'), e.id, { revisionId: e.currentRevision.id, signoffRole: 'estimator', acknowledgedWarnings: ['price_fallback_disclosed', 'public_right_of_way'] });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('gate_blocked');
    expect(res.json().errors.map((x: { code: string }) => x.code)).toContain('public_right_of_way');
    // An open risk flag added AFTER pricing is caught at decision time.
    const clean = await goldenEstimate(a, projectId, a.as('estimator'));
    await ctx.owner.client`insert into risk_flags (org_id, curb_project_id, kind, severity, evidence_source, message) values (${a.orgId}, ${projectId}, 'underground_utility_risk', 'blocking', 'customer_answer', 'Gas line reported near the curb')`;
    const late = await sign(a.as('reviewer'), clean.id, { revisionId: clean.currentRevision.id, signoffRole: 'estimator', acknowledgedWarnings: ['price_fallback_disclosed'] });
    expect(late.statusCode).toBe(409);
    expect(late.json().errors.map((x: { code: string }) => x.code)).toContain('risk_flag_open');
  });

  it('stale prices block a firm quote and approval', async () => {
    const a = await createCompany(ctx, { roles: ['estimator', 'reviewer', 'finance'] });
    await approvedBook(ctx, a.as('finance'), { name: 'Old book', priceDate: '2019-06-01', maxPriceAgeDays: 90 });
    const p = await createProperty(ctx, a.owner, { originalQuery: 'Old pricing lot', confirmedLocation: pin(0.0101, 0.0101) });
    const projectId = await curbProject(ctx, a, p.id);
    const e = await goldenEstimate(a, projectId, a.as('estimator'));
    expect(e.currentRevision.quoteKind).toBe('review_required');
    expect(e.currentRevision.isBinding).toBe(false);
    expect(e.currentRevision.gating.blockers.map((b: { code: string }) => b.code)).toContain('price_stale');
    const res = await sign(a.as('reviewer'), e.id, { revisionId: e.currentRevision.id, signoffRole: 'estimator', acknowledgedWarnings: ['price_fallback_disclosed'] });
    expect(res.json().code).toBe('gate_blocked');
  });

  it('separation of duties, warnings acknowledgment, permission denial, approval, duplicate, withdrawal', async () => {
    const { a, projectId } = await curbSetup();
    const e = await goldenEstimate(a, projectId, a.as('estimator'));
    const body = { revisionId: e.currentRevision.id, signoffRole: 'estimator', acknowledgedWarnings: ['price_fallback_disclosed'] };
    const self = await sign(a.as('estimator'), e.id, body);
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe('approval_separation_of_duties');
    expect((await sign(a.as('read_only'), e.id, body)).json().code).toBe('forbidden');
    const unack = await sign(a.as('reviewer'), e.id, { ...body, acknowledgedWarnings: [] });
    expect(unack.statusCode).toBe(400);
    const wrongRole = await sign(a.as('reviewer'), e.id, { ...body, signoffRole: 'permit_reviewer' });
    expect(wrongRole.statusCode).toBe(400);

    const ok = await sign(a.as('reviewer'), e.id, { ...body, evidenceRefs: ['photo:front-curb'] });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ outstandingSignoffs: [], estimate: { status: 'approved', approvedRevisionId: e.currentRevision.id }, policy: { ruleVersion: 'default-estimate-policy@1' } });
    const approval = ok.json().approval;
    expect(approval.evidence).toMatchObject({ inputHash: e.currentRevision.inputHash, priceBookRevisionId: e.currentRevision.priceBookRevisionId, evidenceRefs: ['photo:front-curb'] });
    // Immutable record: only a single withdrawal is allowed, even for the owner connection.
    await expect(ctx.owner.client`update approvals set comment = 'edited' where id = ${approval.id}`).rejects.toThrow();
    await expect(ctx.owner.client`delete from approvals where id = ${approval.id}`).rejects.toThrow();
    expect((await sign(a.owner, e.id, body)).json().code).toBe('duplicate');

    const withdraw = await call(ctx, 'POST', `/v1/approvals/${approval.id}/withdraw`, { as: a.as('reviewer'), body: { reason: 'Customer changed the driveway width' } });
    expect(withdraw.statusCode, withdraw.body).toBe(200);
    expect(withdraw.json().withdrawnReason).toBe('Customer changed the driveway width');
    const reverted = (await call(ctx, 'GET', `/v1/estimates/${e.id}`, { as: a.owner })).json();
    expect(reverted).toMatchObject({ status: 'review_required', approvedRevisionId: null });
    expect((await call(ctx, 'POST', `/v1/approvals/${approval.id}/withdraw`, { as: a.as('reviewer'), body: { reason: 'again please' } })).statusCode).toBe(409);
    const list = (await call(ctx, 'GET', `/v1/approvals?subjectId=${e.currentRevision.id}`, { as: a.as('read_only') })).json().items;
    expect(list).toHaveLength(1);
  });

  it('jurisdiction policy requires named sign-offs; delegation lends a capacity; one person one sign-off', async () => {
    const { a, projectId } = await curbSetup();
    const policy = await call(ctx, 'POST', '/v1/approval-policies', {
      as: a.owner,
      body: { name: 'Estimate City curb', productLine: 'curb', jurisdictionId: cityA, requiredSignoffs: ['estimator', 'permit_reviewer', 'project_manager'] },
    });
    expect(policy.statusCode, policy.body).toBe(201);
    expect((await call(ctx, 'POST', '/v1/approval-policies', { as: a.as('estimator'), body: { name: 'x', requiredSignoffs: ['owner'] } })).statusCode).toBe(403);
    const e = await goldenEstimate(a, projectId, a.as('estimator'));
    expect(e.currentRevision.gating.requiredSignoffs).toEqual(['estimator', 'permit_reviewer', 'project_manager']);
    const base = { revisionId: e.currentRevision.id, acknowledgedWarnings: ['price_fallback_disclosed'] };
    const s1 = await sign(a.as('reviewer'), e.id, { ...base, signoffRole: 'estimator' });
    expect(s1.statusCode, s1.body).toBe(201);
    expect(s1.json().outstandingSignoffs).toEqual(['permit_reviewer', 'project_manager']);
    expect(s1.json().approval.ruleVersion).toBe(policy.json().ruleVersion);
    // The same reviewer may not also be the permit reviewer.
    expect((await sign(a.as('reviewer'), e.id, { ...base, signoffRole: 'permit_reviewer' })).json().code).toBe('approval_separation_of_duties');
    // A crew manager is not eligible as permit reviewer...
    expect((await sign(a.as('crew_manager'), e.id, { ...base, signoffRole: 'permit_reviewer' })).statusCode).toBe(403);
    const s2 = await sign(a.owner, e.id, { ...base, signoffRole: 'permit_reviewer' });
    expect(s2.statusCode, s2.body).toBe(201);
    // ...but signs as project manager, which completes the policy.
    const s3 = await sign(a.as('crew_manager'), e.id, { ...base, signoffRole: 'project_manager' });
    expect(s3.statusCode, s3.body).toBe(201);
    expect(s3.json().estimate.status).toBe('approved');

    // Delegation: a finance member lends nothing by default; the owner's delegation to finance lets
    // finance sign as project manager in the owner's capacity on another estimate.
    const e2 = await goldenEstimate(a, projectId, a.as('estimator'));
    const fin = a.as('finance');
    expect((await sign(fin, e2.id, { revisionId: e2.currentRevision.id, acknowledgedWarnings: ['price_fallback_disclosed'], signoffRole: 'project_manager' })).statusCode).toBe(403);
    const [d] = await ctx.owner.client<{ id: string }[]>`
      insert into approval_delegations (org_id, from_membership_id, to_membership_id, subject_types, starts_at, ends_at, reason)
      values (${a.orgId}, ${a.owner.membershipId}, ${fin.membershipId}, '{estimate_revision}', now() - interval '1 hour', now() + interval '1 day', 'Owner on leave')
      returning id`;
    const viaDelegation = await sign(fin, e2.id, { revisionId: e2.currentRevision.id, acknowledgedWarnings: ['price_fallback_disclosed'], signoffRole: 'project_manager', delegationId: d!.id });
    expect(viaDelegation.statusCode, viaDelegation.body).toBe(201);
    expect(viaDelegation.json().approval).toMatchObject({ delegationId: d!.id, actingForMembershipId: a.owner.membershipId });
  });

  it('a later input change (pin move) makes the approved estimate stale and reverts it to review', async () => {
    const { a, projectId, property } = await curbSetup();
    const e = await goldenEstimate(a, projectId, a.as('estimator'));
    const ok = await sign(a.as('reviewer'), e.id, { revisionId: e.currentRevision.id, signoffRole: 'estimator', acknowledgedWarnings: ['price_fallback_disclosed'] });
    expect(ok.json().estimate.status).toBe('approved');
    const moved = await call(ctx, 'POST', `/v1/properties/${property.id}/pin`, { as: a.owner, body: { expectedRevision: property.revision, location: pin(0.0102, 0.0102) } });
    expect(moved.statusCode, moved.body).toBe(200);
    const stale = (await call(ctx, 'GET', `/v1/estimates/${e.id}`, { as: a.owner })).json();
    expect(stale).toMatchObject({ status: 'review_required', approvedRevisionId: null, stale: { reason: 'property_pin_relocated' } });
    const blocked = await sign(a.owner, e.id, { revisionId: e.currentRevision.id, signoffRole: 'estimator', acknowledgedWarnings: ['price_fallback_disclosed'] });
    expect(blocked.statusCode).toBe(409);
    // Repricing clears staleness (inputs unchanged -> same revision) and allows a fresh approval.
    const re = await call(ctx, 'POST', `/v1/estimates/${e.id}/reprice`, { as: a.as('estimator'), body: { expectedRevision: stale.revision }, headers: { 'idempotency-key': randomUUID() } });
    expect(re.json().estimate.stale).toBeNull();
  });

  it('roof estimates need confirmed structure scope', async () => {
    const a = await createCompany(ctx, { roles: ['estimator', 'finance'] });
    await approvedBook(ctx, a.as('finance'), {
      name: 'Roof default',
      productLine: 'roof',
      items: [{ code: 'SHINGLES', label: 'Shingles', category: 'material', costComponent: 'roof_material', unit: 'roofing_square', unitRate: '120', fixedAmountMinor: null, minimumQuantity: null, taxable: true }],
    });
    const c = await fixtureCandidate(ctx, a.owner, '200 Campus Loop');
    const p = await createProperty(ctx, a.owner, { originalQuery: '200 Campus Loop', candidate: c });
    const orderId = await roofOrder(ctx, a, p.id);
    const area = { state: 'known', value: 185.80608, unit: 'm2', source: 'field_verified', measuredAt: new Date().toISOString(), precision: 0 };
    const res = await createEstimate(ctx, a.as('estimator'), { productLine: 'roof', roofOrderId: orderId, inputs: { roof_area: area }, lines: [{ code: 'SHINGLES', quantityKey: 'roof_area' }] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().currentRevision.gating.blockers.map((b: { code: string }) => b.code)).toContain('structure_scope_unconfirmed');
    expect(res.json().currentRevision.scenarios.base.lines[0].quantity).toBe('20');
  });
});
