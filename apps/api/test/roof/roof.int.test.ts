// RF-006-QA / RF-021-QA..RF-030-QA / RR-033-QA..RR-040-QA / COS-201-QA..COS-210-QA / ADD-022-QA,
// ADD-027-QA, ADD-030-QA, ADD-031-QA, ADD-033-QA..ADD-036-QA: the roof backend end to end on the
// six-facet L-shaped hip roof golden fixture (40x40 ft L, 20 ft arms, all 6/12):
//   plan 1,200 ft2; sloped = 1,200 x sqrt(1.25) = 1,341.64 ft2 = 13.4164 squares; 5 hips + 1 valley of
//   15 ft true length each; 2 ridges = 40 ft; eaves 160 ft.
// create order -> draw facets -> pitch -> submit -> two-person review -> takeoff -> PDF whose
// rendered snapshot reconciles with the database totals -> quote preview -> estimate.
import { randomUUID } from 'node:crypto';
import { PDF_TEMPLATES_VERSION, canonicalJson, collectText, documentFor, formatArea, sha256Hex, structureTotals } from '@fieldline/pdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/db/runtime';
import { awaitExport } from '../../src/modules/exports/service';
import { buildReportSnapshot } from '../../src/modules/roof/snapshot';
import { requireVersion } from '../../src/modules/roof/service';
import { call, type Company, createCompany, createTestContext, type Person, type TestContext } from '../helpers';
import { approvedBook, createProperty, fixtureCandidate } from '../commerce/fixtures';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx?.cleanup();
  await ctx?.close();
});

const FT = 0.3048;
const FT2 = FT * FT;
const PLAN_FT2 = 1200;
const SLOPED_FT2 = 1200 * Math.sqrt(1.25);

const V: Record<string, [number, number]> = { sw: [0, 0], se: [40, 0], ne1: [40, 20], inner: [20, 20], ne2: [20, 40], nw: [0, 40], r0: [10, 10], r1: [30, 10], r2: [10, 30] };
const FACETS: { id: string; v: string[]; down: [number, number] }[] = [
  { id: 'f1-south', v: ['sw', 'se', 'r1', 'r0'], down: [0, -1] },
  { id: 'f2-east', v: ['se', 'ne1', 'r1'], down: [1, 0] },
  { id: 'f3-north-east-arm', v: ['ne1', 'inner', 'r0', 'r1'], down: [0, 1] },
  { id: 'f4-east-north-arm', v: ['inner', 'ne2', 'r2', 'r0'], down: [1, 0] },
  { id: 'f5-north', v: ['ne2', 'nw', 'r2'], down: [0, 1] },
  { id: 'f6-west', v: ['nw', 'sw', 'r0', 'r2'], down: [-1, 0] },
];
const drawCommands = (structureId: string) => [
  ...Object.entries(V).map(([id, [x, y]]) => ({ type: 'add_vertex', id, x: x * FT, y: y * FT })),
  ...FACETS.map((f) => ({ type: 'add_facet', id: f.id, vertexIds: f.v, structureId, downslope: { x: f.down[0], y: f.down[1] } })),
];
const pitchCommands = (confidence: (id: string) => number) =>
  FACETS.map((f) => ({ type: 'set_pitch', facetId: f.id, pitch: { rise: 6, run: 12 }, downslope: { x: f.down[0], y: f.down[1] }, method: 'field_measured', source: 'field_verified', confidence: confidence(f.id) }));

const MATERIALS = [
  { code: 'SHINGLES', description: 'Architectural shingles', materialClass: 'shingles', basis: { kind: 'sloped_area' }, coveragePerPack: '100', packUnit: 'square' },
  { code: 'RIDGE_CAP', description: 'Hip and ridge cap', materialClass: 'ridge_cap', basis: { kind: 'edges', edgeTypes: ['ridge', 'hip'] }, coveragePerPack: '20', packUnit: 'bundle' },
  { code: 'STARTER', description: 'Starter strip (coverage not configured)', materialClass: 'starter', basis: { kind: 'edges', edgeTypes: ['eave'] }, coveragePerPack: null, packUnit: 'bundle' },
];

interface Setup {
  a: Company;
  est: Person;
  propertyId: string;
  structureId: string;
  fixtureImageryId: string;
  esriImageryId: string;
}

async function setup(): Promise<Setup> {
  const a = await createCompany(ctx, { roles: ['estimator', 'reviewer', 'admin', 'finance', 'read_only'] });
  const est = a.as('estimator');
  const c = await fixtureCandidate(ctx, est, '100 Fixture Way');
  const p = await createProperty(ctx, est, { originalQuery: '100 Fixture Way', candidate: c });
  const search = await call(ctx, 'POST', '/v1/imagery/search', { as: est, body: { propertyId: p.id } });
  expect(search.statusCode, search.body).toBe(200);
  const items = search.json().items as { id: string; provider: string }[];
  return {
    a,
    est,
    propertyId: p.id,
    structureId: p.structures[0]!.id,
    fixtureImageryId: items.find((i) => i.provider === 'fixture')!.id,
    esriImageryId: items.find((i) => i.provider === 'esri_world_imagery')!.id,
  };
}

async function grantCredits(orgId: string, n: number) {
  await ctx.owner.client`insert into usage_ledger (org_id, meter, kind, quantity, note) values (${orgId}, 'roof_report', 'granted', ${n}, 'test grant')`;
}

async function balance(orgId: string): Promise<number> {
  const [r] = await ctx.owner.client<{ n: number }[]>`select coalesce(sum(quantity),0)::int as n from usage_ledger where org_id = ${orgId} and meter = 'roof_report'`;
  return r!.n;
}

async function order(s: Setup, body: Record<string, unknown>, key = randomUUID()) {
  return call(ctx, 'POST', '/v1/roof/orders', { as: s.est, body: { propertyId: s.propertyId, structureIds: [s.structureId], ...body }, headers: { 'idempotency-key': key } });
}

async function edit(as: Person, reportId: string, revision: number, commands: unknown[]) {
  return call(ctx, 'PATCH', `/v1/roof/reports/${reportId}/geometry`, { as, body: { clientOpId: randomUUID(), commands }, headers: { 'if-match': `"${revision}"`, 'idempotency-key': randomUUID() } });
}

describe('RF-022-QA imagery rights engine', () => {
  it('fixture imagery is synthetic with full rights; Esri is visualization only; contractor rights are asserted', async () => {
    const s = await setup();
    const esri = await call(ctx, 'GET', `/v1/imagery/assets/${s.esriImageryId}/rights`, { as: s.est });
    expect(Object.fromEntries(esri.json().decisions.map((d: { use: string; allowed: boolean }) => [d.use, d.allowed]))).toEqual({ visualize: true, analyze: false, cache: false, embed_in_exports: false, redistribute: false });
    const fx = await call(ctx, 'GET', `/v1/imagery/assets/${s.fixtureImageryId}`, { as: s.est });
    expect(fx.json()).toMatchObject({ isSynthetic: true, calibrated: true, provider: 'fixture' });
    expect(fx.json().decisions.every((d: { allowed: boolean }) => d.allowed)).toBe(true);
    // RF-022 S: a visualization-only source can never back a measurement order.
    const denied = await order(s, { mode: 'diy', imageryAssetId: s.esriImageryId });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().code).toBe('imagery_rights_denied');
    const drone = await call(ctx, 'POST', '/v1/imagery/contractor', {
      as: s.est,
      body: { propertyId: s.propertyId, kind: 'drone_photo', attribution: 'Drone capture by contractor', rights: { analyze: true, cache: true, embedInExports: false, expiresAt: '2020-01-01T00:00:00Z' }, rightsStatement: 'I captured these images and hold all rights.' },
    });
    expect(drone.statusCode, drone.body).toBe(201);
    expect(drone.json().rights.assertedBy.userId).toBe(s.est.userId);
    expect(drone.json().decisions.find((d: { use: string }) => d.use === 'analyze')).toMatchObject({ allowed: false, reason: 'license_expired' });
    expect(drone.json().calibrated).toBe(false);
  });
});

describe('RF-021-QA roof orders', () => {
  it('assisted: credit required, one order per duplicate submit, honest SLA, credit released exactly once on failure', async () => {
    const s = await setup();
    const none = await order(s, { mode: 'assisted', imageryAssetId: s.fixtureImageryId });
    expect(none.statusCode, none.body).toBeGreaterThanOrEqual(400);
    expect(none.json().code).toBe('entitlement_exceeded');
    await grantCredits(s.a.orgId, 1);
    const key = randomUUID();
    const first = await order(s, { mode: 'assisted', imageryAssetId: s.fixtureImageryId, deliverySpeed: 'standard' }, key);
    expect(first.statusCode, first.body).toBe(201);
    const again = await order(s, { mode: 'assisted', imageryAssetId: s.fixtureImageryId, deliverySpeed: 'standard' }, key);
    expect(again.json().id).toBe(first.json().id);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const o = first.json();
    expect(o).toMatchObject({ status: 'measuring', deliveryState: 'in_review', mode: 'assisted' });
    expect(o.sla).toMatchObject({ slaClass: 'assisted_queued', guaranteed: false, targetBusinessHours: 16 });
    expect(o.sla.disclosure).toMatch(/not a guarantee/);
    expect(await balance(s.a.orgId)).toBe(0);
    const events = await call(ctx, 'GET', `/v1/roof/orders/${o.id}/events`, { as: s.est });
    expect(events.json().items.map((e: { toStatus: string }) => e.toStatus)).toEqual(['draft', 'ordered', 'measuring']);
    expect(events.json().items[0].data.input).toMatchObject({ mode: 'assisted' });
    // Transitions are immutable rows.
    await expect(ctx.owner.client`update roof_order_events set reason = 'x' where roof_order_id = ${o.id}`).rejects.toThrow();
    // Manual shortcuts around review are refused.
    const skip = await call(ctx, 'POST', `/v1/roof/orders/${o.id}/transition`, { as: s.est, body: { to: 'approved', expectedRevision: o.revision } });
    expect(skip.json().code).toBe('invalid_transition');
    const fail = await call(ctx, 'POST', `/v1/roof/orders/${o.id}/transition`, { as: s.est, body: { to: 'failed', reason: 'building obscured', expectedRevision: o.revision } });
    expect(fail.statusCode, fail.body).toBe(200);
    expect(await balance(s.a.orgId)).toBe(1);
    const refund = await call(ctx, 'POST', `/v1/roof/orders/${o.id}/transition`, { as: s.est, body: { to: 'refunded', expectedRevision: fail.json().revision } });
    expect(refund.statusCode, refund.body).toBe(200);
    expect(await balance(s.a.orgId)).toBe(1); // released once, never twice
  });

  it('assisted without licensed imagery waits in imagery_pending; DIY is instant with no credit', async () => {
    const s = await setup();
    await grantCredits(s.a.orgId, 1);
    const pending = await order(s, { mode: 'assisted' });
    expect(pending.json()).toMatchObject({ status: 'imagery_pending', deliveryState: 'waiting_for_licensed_image' });
    const attach = await call(ctx, 'POST', `/v1/roof/orders/${pending.json().id}/imagery`, { as: s.est, body: { imageryAssetId: s.fixtureImageryId, expectedRevision: pending.json().revision } });
    expect(attach.json()).toMatchObject({ status: 'measuring' });
    expect(attach.json().reportId).toBeTruthy();
    const diy = await order(s, { mode: 'diy' });
    expect(diy.json()).toMatchObject({ status: 'measuring', deliverySpeed: 'instant_diy', creditReservationId: null });
    expect(diy.json().sla).toMatchObject({ slaClass: 'diy_instant', guaranteed: false, dueAt: null });
    const foreign = await createCompany(ctx);
    const other = await call(ctx, 'GET', `/v1/roof/orders/${diy.json().id}`, { as: foreign.owner });
    expect(other.statusCode).toBe(404);
  });
});

describe('RF-023-QA / RF-025-QA geometry topology', () => {
  it('self-intersecting and zero-area facets are flagged before quantities; command log is append-only', async () => {
    const s = await setup();
    const o = (await order(s, { mode: 'diy' })).json();
    const bow = await edit(s.est, o.reportId, 0, [
      { type: 'add_vertex', id: 'a', x: 0, y: 0 },
      { type: 'add_vertex', id: 'b', x: 10, y: 10 },
      { type: 'add_vertex', id: 'c', x: 10, y: 0 },
      { type: 'add_vertex', id: 'd', x: 0, y: 10 },
      { type: 'add_facet', id: 'bowtie', vertexIds: ['a', 'b', 'c', 'd'], pitch: { rise: 4, run: 12 }, downslope: { x: 0, y: -1 } },
    ]);
    expect(bow.statusCode, bow.body).toBe(200);
    const g = bow.json().geometry;
    expect(g.valid).toBe(false);
    expect(g.issues.some((i: { severity: string }) => i.severity === 'error')).toBe(true);
    const report = await call(ctx, 'GET', `/v1/roof/reports/${o.reportId}`, { as: s.est });
    const versionId = report.json().versionId;
    const takeoff = await call(ctx, 'POST', `/v1/roof/report-versions/${versionId}/takeoff`, { as: s.est, body: { materials: MATERIALS } });
    expect(takeoff.json().code).toBe('geometry_invalid');
    const submit = await call(ctx, 'POST', `/v1/roof/reports/${o.reportId}/submit`, { as: s.est, body: { expectedGeometryRevision: 1 } });
    expect(submit.json().code).toBe('geometry_invalid');
    await expect(ctx.owner.client`update roof_geometry_ops set op = 'x' where report_version_id = ${versionId}`).rejects.toThrow();
    // Facets may only belong to an in-scope structure.
    const wrong = await edit(s.est, o.reportId, 1, [{ type: 'add_facet', id: 'x1', vertexIds: ['a', 'c', 'b'], structureId: randomUUID() }]);
    expect(wrong.json().code).toBe('validation_failed');
  });
});

describe('RR-034-QA golden six-facet hip roof end to end', () => {
  it('order -> draw -> pitch -> submit -> second review -> takeoff -> PDF reconciles -> quote', async () => {
    const s = await setup();
    await grantCredits(s.a.orgId, 1);
    const o = (await order(s, { mode: 'assisted', imageryAssetId: s.fixtureImageryId })).json();
    const reportId = o.reportId as string;
    const r0 = await call(ctx, 'GET', `/v1/roof/reports/${reportId}`, { as: s.est });
    expect(r0.headers.etag).toBe('"0"');

    // Draw facets (pitch unknown): plan area known, sloped area unresolved -- never guessed.
    const drawn = await edit(s.est, reportId, 0, drawCommands(s.structureId));
    expect(drawn.statusCode, drawn.body).toBe(200);
    expect(drawn.json().receipt).toMatchObject({ status: 'committed', aggregate_id: reportId, server_revision: 1 });
    const g1 = drawn.json().geometry;
    expect(g1.facets).toHaveLength(6);
    expect(g1.property.netPlanAreaM2).toBeCloseTo(PLAN_FT2 * FT2, 4);
    expect(g1.property.slopedAreaM2).toBeNull();

    // Stale If-Match: 409 with a non-sensitive diff (offline editor cannot overwrite).
    const stale = await edit(s.est, reportId, 0, [{ type: 'move_vertex', id: 'r0', x: 1, y: 1 }]);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'revision_conflict', conflict: { serverRevision: 1, expectedRevision: 0 } });
    // RF-027 S: a single overhead photo cannot establish pitch.
    const photo = await edit(s.est, reportId, 1, [{ type: 'set_pitch', facetId: 'f1-south', pitch: { rise: 6, run: 12 }, method: 'single_overhead_photo', source: 'imagery_derived' }]);
    expect(photo.json().code).toBe('measurement_unknown');

    // Per-facet pitch with method + confidence (f6 low confidence -> second review required).
    const pitched = await edit(s.est, reportId, 1, pitchCommands((id) => (id === 'f6-west' ? 0.6 : 0.95)));
    expect(pitched.statusCode, pitched.body).toBe(200);
    const g2 = pitched.json().geometry;
    expect(g2.valid).toBe(true);
    expect(g2.property.slopedAreaM2).toBeCloseTo(SLOPED_FT2 * FT2, 4);
    expect(g2.property.squares).toBeCloseTo(SLOPED_FT2 / 100, 4);
    expect(g2.facets.find((f: { id: string }) => f.id === 'f6-west').pitch).toMatchObject({ risePer12: 6, method: 'field_measured', source: 'field_verified', confidence: 0.6 });
    // RF-028: shared edges counted once and classified from adjoining facets.
    expect(g2.edgeTotals.hip.count).toBe(5);
    expect(g2.edgeTotals.valley.count).toBe(1);
    expect(g2.edgeTotals.hip.trueLengthM).toBeCloseTo(75 * FT, 4);
    expect(g2.edgeTotals.ridge.trueLengthM).toBeCloseTo(40 * FT, 4);
    expect(g2.edgeTotals.eave.trueLengthM).toBeCloseTo(160 * FT, 4);
    expect(g2.edges.every((e: { conflict: string | null }) => e.conflict === null)).toBe(true);

    // Undo / redo are log entries; reload replays to exactly the same totals.
    const undone = await edit(s.est, reportId, 2, [{ type: 'undo' }]);
    expect(undone.json().geometry.property.slopedAreaM2).toBeNull();
    const redone = await edit(s.est, reportId, 3, [{ type: 'redo' }]);
    expect(redone.json().geometry.property.slopedAreaM2).toBe(g2.property.slopedAreaM2);
    const reloaded = await call(ctx, 'GET', `/v1/roof/reports/${reportId}`, { as: s.est });
    expect(reloaded.json().property).toEqual(g2.property);
    expect(reloaded.json().edgeTotals).toEqual(g2.edgeTotals);

    // Raw command bus path works for the same aggregate (same pipeline, receipt).
    const types = await call(ctx, 'GET', '/v1/commands/types', { as: s.est });
    expect(types.json().types).toContain('RoofGeometryEdited');

    // Submit freezes the version and queues a review that needs two different reviewers.
    const submitted = await call(ctx, 'POST', `/v1/roof/reports/${reportId}/submit`, { as: s.est, body: { expectedGeometryRevision: 4 } });
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().requiresSecondReview).toBe(true);
    const taskId = submitted.json().reviewTaskId;
    const versionId = submitted.json().version.versionId;
    const locked = await edit(s.est, reportId, 4, [{ type: 'move_vertex', id: 'r0', x: 1, y: 1 }]);
    expect(locked.json().code).toBe('immutable_record');
    await expect(ctx.owner.client`update roof_report_versions set geometry_revision = 99 where id = ${versionId}`).rejects.toThrow();

    const reviewer = s.a.as('reviewer');
    const admin = s.a.as('admin');
    const checklist = { facets_match_imagery: true, pitches_supported: true, edges_classified: true, scope_confirmed: true };
    const c1 = await call(ctx, 'POST', `/v1/review-tasks/${taskId}/claim`, { as: reviewer });
    expect(c1.json()).toMatchObject({ status: 'claimed', claimedByMembershipId: reviewer.membershipId });
    const busy = await call(ctx, 'POST', `/v1/review-tasks/${taskId}/claim`, { as: admin });
    expect(busy.statusCode).toBe(409);
    const d1 = await call(ctx, 'POST', `/v1/review-tasks/${taskId}/decide`, { as: reviewer, body: { decision: 'approved', expectedRevision: c1.json().revision, checklist } });
    expect(d1.statusCode, d1.body).toBe(200);
    expect(d1.json()).toMatchObject({ final: false, task: { status: 'awaiting_second_review' } });
    const self = await call(ctx, 'POST', `/v1/review-tasks/${taskId}/claim`, { as: reviewer });
    expect(self.json().code).toBe('approval_separation_of_duties');
    const c2 = await call(ctx, 'POST', `/v1/review-tasks/${taskId}/claim`, { as: admin });
    expect(c2.statusCode, c2.body).toBe(200);
    const offline = await call(ctx, 'POST', `/v1/review-tasks/${taskId}/decide`, { as: admin, body: { decision: 'approved', expectedRevision: c1.json().revision, checklist } });
    expect(offline.json().code).toBe('revision_conflict');
    const d2 = await call(ctx, 'POST', `/v1/review-tasks/${taskId}/decide`, { as: admin, body: { decision: 'approved', expectedRevision: c2.json().revision, checklist } });
    expect(d2.json()).toMatchObject({ final: true, task: { status: 'completed', decision: 'approved' } });
    const approvedOrder = await call(ctx, 'GET', `/v1/roof/orders/${o.id}`, { as: s.est });
    expect(approvedOrder.json()).toMatchObject({ status: 'approved', deliveryState: 'complete' });
    expect(await balance(s.a.orgId)).toBe(0); // consumed
    const kinds = await ctx.owner.client<{ kind: string }[]>`select kind from usage_ledger where org_id = ${s.a.orgId} order by created_at, kind`;
    expect(kinds.map((k) => k.kind).sort()).toEqual(['consumed', 'granted', 'released', 'reserved']);

    // Takeoff: waste 12% (hip rule) applied once; exact vs pack quantities; unknown coverage unresolved.
    const t = await call(ctx, 'POST', `/v1/roof/report-versions/${versionId}/takeoff`, { as: s.est, body: { roofType: 'hip', materials: MATERIALS } });
    expect(t.statusCode, t.body).toBe(201);
    const tk = t.json();
    expect(tk).toMatchObject({ wasteFraction: '0.12', wasteSource: 'rule_recommendation', unresolvedCount: 1 });
    expect(Number(tk.area.squares)).toBeCloseTo(SLOPED_FT2 / 100, 6);
    const shingles = tk.lines.find((l: { code: string }) => l.code === 'SHINGLES');
    expect(Number(shingles.exactPacks)).toBeCloseTo((SLOPED_FT2 * 1.12) / 100, 6);
    expect(shingles.orderPacks).toBe('16');
    const ridge = tk.lines.find((l: { code: string }) => l.code === 'RIDGE_CAP');
    expect(Number(ridge.baseQuantity)).toBeCloseTo(115, 4);
    expect(ridge.orderPacks).toBe('7');
    expect(tk.lines.find((l: { code: string }) => l.code === 'STARTER')).toMatchObject({ status: 'unresolved', orderPacks: null });

    // PDF: asynchronous, from the frozen snapshot, with checksum + template version; imagery embedded
    // only because the (synthetic) fixture license allows it.
    const ex = await call(ctx, 'POST', `/v1/roof/reports/${reportId}/exports`, { as: s.est, body: { format: 'pdf', versionId } });
    expect(ex.statusCode, ex.body).toBe(202);
    expect(ex.json().status).toBe('pending');
    await awaitExport(ex.json().id);
    const done = (await call(ctx, 'GET', `/v1/exports/${ex.json().id}`, { as: s.est })).json();
    expect(done).toMatchObject({ status: 'completed', templateVersion: PDF_TEMPLATES_VERSION });
    expect(done.sha256).toMatch(/^[0-9a-f]{64}$/);
    const [rec] = await ctx.owner.client<{ object_key: string }[]>`select object_key from export_records where id = ${done.id}`;
    const pdfBytes = await ctx.storage.get(rec!.object_key);
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha256Hex(pdfBytes)).toBe(done.sha256);
    const bundle = await withTenant(ctx.app.db, { orgId: s.a.orgId, userId: s.est.userId }, async (tx) => buildReportSnapshot(tx, s.a.orgId, await requireVersion(tx, s.a.orgId, versionId)));
    // The stored content checksum proves the PDF was rendered from exactly this snapshot...
    expect(done.options.contentChecksum).toBe(sha256Hex(`${PDF_TEMPLATES_VERSION}\n${canonicalJson(bundle.snapshot)}`));
    // ...and the snapshot's totals reconcile with the database totals.
    const pdfTotals = structureTotals(bundle.snapshot.structures);
    const [dbTotals] = await ctx.owner.client<{ totals: { property: { netPlanAreaM2: number; slopedAreaM2: number } } }[]>`select totals from roof_report_versions where id = ${versionId}`;
    expect(pdfTotals.planAreaSqM).toBeCloseTo(dbTotals!.totals.property.netPlanAreaM2, 6);
    expect(pdfTotals.slopedAreaSqM).toBeCloseTo(dbTotals!.totals.property.slopedAreaM2, 6);
    const text = collectText(documentFor(bundle.snapshot));
    expect(text).toContain(formatArea(dbTotals!.totals.property.slopedAreaM2, 'imperial'));
    expect(bundle.snapshot.imagery).toMatchObject({ exportAllowed: true, provider: 'fixture' });
    expect(bundle.snapshot.imagery.imageSrc).toMatch(/^data:image\/png;base64,/);
    expect(bundle.snapshot.disclaimers.join(' ')).toMatch(/SYNTHETIC/);

    // CSV/JSON carry the schema version; ESX is explicitly unsupported.
    const js = await call(ctx, 'POST', `/v1/roof/reports/${reportId}/exports`, { as: s.est, body: { format: 'json', versionId } });
    await awaitExport(js.json().id);
    const [jrec] = await ctx.owner.client<{ object_key: string }[]>`select object_key from export_records where id = ${js.json().id}`;
    const json = JSON.parse((await ctx.storage.get(jrec!.object_key)).toString('utf8'));
    expect(json).toMatchObject({ schemaVersion: 'field-pro.roof-export@1', units: { area: 'm2' } });
    expect(json.totals.slopedAreaM2).toBeCloseTo(SLOPED_FT2 * FT2, 4);
    const esx = await call(ctx, 'POST', `/v1/roof/reports/${reportId}/exports`, { as: s.est, body: { format: 'esx', versionId } });
    expect(esx.json()).toMatchObject({ status: 'unsupported' });
    expect(esx.json().error).toMatch(/not available/);

    // Quote preview good/better/best, then convert one tier into a shared roof estimate.
    await approvedBook(ctx, s.a.as('finance'), {
      name: 'Roof book',
      productLine: 'roof',
      items: [
        { code: 'SHINGLE_GOOD', label: '3-tab', category: 'material', costComponent: 'roof_material', unit: 'roofing_square', unitRate: '110', fixedAmountMinor: null, minimumQuantity: null, taxable: true },
        { code: 'SHINGLE_BETTER', label: 'Architectural', category: 'material', costComponent: 'roof_material', unit: 'roofing_square', unitRate: '140', fixedAmountMinor: null, minimumQuantity: null, taxable: true },
        { code: 'SHINGLE_BEST', label: 'Designer', category: 'material', costComponent: 'roof_material', unit: 'roofing_square', unitRate: '190', fixedAmountMinor: null, minimumQuantity: null, taxable: true },
      ],
    });
    const quoteBody = {
      versionId,
      confirmations: { pricingDate: true, waste: true },
      tiers: [
        { tier: 'good', label: 'Good', lines: [{ code: 'SHINGLE_GOOD', quantityKey: 'roof_order_area' }] },
        { tier: 'better', label: 'Better', lines: [{ code: 'SHINGLE_BETTER', quantityKey: 'roof_order_area' }] },
        { tier: 'best', label: 'Best', lines: [{ code: 'SHINGLE_BEST', quantityKey: 'roof_order_area' }] },
      ],
    };
    const noConfirm = await call(ctx, 'POST', `/v1/roof/reports/${reportId}/quote-preview`, { as: s.est, body: { ...quoteBody, confirmations: { pricingDate: true, waste: false } } });
    expect(noConfirm.json().code).toBe('validation_failed');
    const preview = await call(ctx, 'POST', `/v1/roof/reports/${reportId}/quote-preview`, { as: s.est, body: quoteBody });
    expect(preview.statusCode, preview.body).toBe(200);
    const tiers = preview.json().tiers as { tier: string; totalMinor: number }[];
    expect(tiers.map((x) => x.tier)).toEqual(['good', 'better', 'best']);
    expect(tiers[0]!.totalMinor).toBeLessThan(tiers[1]!.totalMinor);
    expect(tiers[1]!.totalMinor).toBeLessThan(tiers[2]!.totalMinor);
    expect(preview.json().inputs.roof_order_area.value).toBeCloseTo(SLOPED_FT2 * FT2 * 1.12, 4);
    const ckey = randomUUID();
    const conv = await call(ctx, 'POST', `/v1/roof/reports/${reportId}/convert`, { as: s.est, body: { ...quoteBody, selectedTier: 'better' }, headers: { 'idempotency-key': ckey } });
    expect(conv.statusCode, conv.body).toBe(201);
    expect(conv.json()).toMatchObject({ productLine: 'roof', roofOrderId: o.id, tier: 'better', reportVersionId: versionId });
    expect(conv.json().currentRevision.scenarios.base.totalMinor).toBe(tiers[1]!.totalMinor);
    const conv2 = await call(ctx, 'POST', `/v1/roof/reports/${reportId}/convert`, { as: s.est, body: { ...quoteBody, selectedTier: 'better' }, headers: { 'idempotency-key': ckey } });
    expect(conv2.json().id).toBe(conv.json().id);
    expect((await call(ctx, 'GET', `/v1/roof/orders/${o.id}`, { as: s.est })).json().status).toBe('quoted');

    // RR-037: a corrected revision keeps history, makes the estimate stale, and compares visibly.
    const rev = await call(ctx, 'POST', `/v1/roof/reports/${reportId}/revisions`, { as: s.est, body: { reason: 'customer reports steeper rear slope' } });
    expect(rev.statusCode, rev.body).toBe(201);
    expect(rev.json()).toMatchObject({ versionNumber: 2, versionStatus: 'draft' });
    expect(rev.json().property).toEqual(g2.property); // identical replay of the reviewed log
    const steeper = await edit(s.est, reportId, 0, [{ type: 'set_pitch', facetId: 'f6-west', pitch: { rise: 8, run: 12 }, downslope: { x: -1, y: 0 }, method: 'field_measured', source: 'field_verified' }]);
    expect(steeper.statusCode, steeper.body).toBe(200);
    const cmp = await call(ctx, 'GET', `/v1/roof/reports/${reportId}/compare?from=${versionId}&to=${rev.json().versionId}`, { as: s.est });
    expect(cmp.json().facets).toEqual([expect.objectContaining({ id: 'f6-west', change: 'modified', risePer12: { before: 6, after: 8 } })]);
    const est = await call(ctx, 'GET', `/v1/estimates/${conv.json().id}`, { as: s.est });
    expect(est.json().stale).toMatchObject({ reason: 'roof_report_revised' });
    const v1 = await call(ctx, 'GET', `/v1/roof/report-versions/${versionId}`, { as: s.est });
    expect(v1.json()).toMatchObject({ versionStatus: 'approved', property: g2.property });
  });
});

describe('RF-030-QA overrides', () => {
  it('append-only overrides with reason and approver feed the takeoff', async () => {
    const s = await setup();
    const o = (await order(s, { mode: 'diy' })).json();
    await edit(s.est, o.reportId, 0, [...drawCommands(s.structureId), ...pitchCommands(() => 0.9)]);
    const versionId = (await call(ctx, 'GET', `/v1/roof/reports/${o.reportId}`, { as: s.est })).json().versionId;
    const m = (v: number) => ({ state: 'known', value: v, unit: 'm', source: 'field_verified', measuredAt: new Date().toISOString(), precision: 0.01 });
    const first = await call(ctx, 'POST', `/v1/roof/report-versions/${versionId}/overrides`, { as: s.est, body: { field: 'edges.lengthM', target: 'eave', newValue: m(50), reason: 'tape measured on site' } });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({ supersedesId: null, approvedByUserId: null });
    const second = await call(ctx, 'POST', `/v1/roof/report-versions/${versionId}/overrides`, { as: s.a.as('reviewer'), body: { field: 'edges.lengthM', target: 'eave', newValue: m(48.768), reason: 'remeasured: 160 ft' } });
    expect(second.json()).toMatchObject({ supersedesId: first.json().id, approvedByUserId: s.a.as('reviewer').userId });
    const noReason = await call(ctx, 'POST', `/v1/roof/report-versions/${versionId}/overrides`, { as: s.est, body: { field: 'edges.lengthM', target: 'eave', newValue: m(1), reason: '' } });
    expect(noReason.json().code).toBe("validation_failed");
    const ro = await call(ctx, 'POST', `/v1/roof/report-versions/${versionId}/overrides`, { as: s.a.as('read_only'), body: { field: 'edges.lengthM', target: 'eave', newValue: m(1), reason: 'nope nope' } });
    expect(ro.statusCode).toBe(403);
    await expect(ctx.owner.client`update measurement_overrides set reason = 'x' where subject_id = ${versionId}`).rejects.toThrow();
    const t = await call(ctx, 'POST', `/v1/roof/report-versions/${versionId}/takeoff`, { as: s.est, body: { roofType: 'hip', materials: [{ code: 'DRIP', description: 'Drip edge', materialClass: 'drip_edge', basis: { kind: 'edges', edgeTypes: ['eave'] }, coveragePerPack: '10', packUnit: 'piece' }] } });
    expect(t.statusCode, t.body).toBe(201);
    expect(t.json().overridesApplied).toEqual(['edges.lengthM:eave']);
    expect(Number(t.json().edgeLf.eave)).toBeCloseTo(160, 6);
    // No validated waste rule for an unknown roof type -> a human value with explanation is required.
    const flat = await call(ctx, 'POST', `/v1/roof/report-versions/${versionId}/takeoff`, { as: s.est, body: { roofType: 'mansard', materials: MATERIALS } });
    expect(flat.json().code).toBe('measurement_unknown');
    const human = await call(ctx, 'POST', `/v1/roof/report-versions/${versionId}/takeoff`, { as: s.est, body: { roofType: 'mansard', materials: MATERIALS, wasteOverride: { wasteRate: '0.15', reason: 'crew lead estimate' } } });
    expect(human.json()).toMatchObject({ wasteFraction: '0.15', wasteSource: 'human_entered' });
  });
});
