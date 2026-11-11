// Traced roof measurement integration tests against the real fieldline_test database (PostGIS).
// Proves the persisted MANUAL-source roof workflow end to end:
//   - areas are measured on the server from lon/lat rings (a client-sent area is rejected);
//   - property, roof order (with immutable event trail), report, version, facets/vertices/edges
//     are written per company and another company gets 404 for every route;
//   - approval needs roof_report:approve and a pitch on every facet; approved versions are frozen
//     by the database and a correction becomes the next version, sending the order back to review;
//   - an estimate needs an approved version, recomputes money with the pricing engine, pins the
//     measurement version and a price book revision, is never binding, and moves the order to quoted.
import { CreateRoofEstimateRequestSchema, type TracedFacetInput } from '@fieldline/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeRoofEstimate } from '../../src/services/roof-estimate';
import { measureTrace } from '../../src/services/roof-trace';
import {
  auditRows,
  call,
  type Company,
  createCompany,
  createTestContext,
  type TestContext,
} from '../helpers';

const LAT = 32.78;
const M_PER_DEG_LAT = 110_950;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);
function rect(x0: number, y0: number, w: number, h: number) {
  const p = (x: number, y: number) => ({
    lon: -96.8 + x / M_PER_DEG_LON,
    lat: LAT + y / M_PER_DEG_LAT,
  });
  return [p(x0, y0), p(x0 + w, y0), p(x0 + w, y0 + h), p(x0, y0 + h)];
}
const FACETS: TracedFacetInput[] = [
  { key: 'front', label: 'Front', ring: rect(0, 0, 16, 6), pitchRise: 6 },
  { key: 'back', label: 'Back', ring: rect(0, 6, 16, 6), pitchRise: null },
];
const ESTIMATE = {
  wastePercent: 12,
  wasteReason: 'Gable with one valley',
  prices: { shingleBundleMinor: 4_298, underlaymentRollMinor: 8_997 },
  laborPerSquareMinor: 8_500,
  marginPercent: 15,
  taxPercent: 8.25,
  priceSource: 'Supplier quote (integration test)',
};

let keySeq = 0;
const key = () => ({ 'idempotency-key': `roof-int-${Date.now()}-${++keySeq}` });

let ctx: TestContext;
let a: Company;
let b: Company;
let measurementId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  a = await createCompany(ctx, { roles: ['estimator', 'reviewer', 'read_only'] });
  b = await createCompany(ctx);
});
afterAll(() => ctx?.close());

describe('traced roof measurements', () => {
  it('rejects client-sent areas and invalid rings', async () => {
    const withArea = await call(ctx, 'POST', '/v1/roof/measurements', {
      as: a.as('estimator'),
      body: {
        address: '123 Test Ln, Dallas TX',
        facets: [{ ...FACETS[0], planSqFt: 99999 }],
      },
    });
    expect(withArea.statusCode).toBe(400);
    const r = rect(0, 0, 10, 10);
    const bowtie = await call(ctx, 'POST', '/v1/roof/measurements', {
      as: a.as('estimator'),
      body: {
        address: '123 Test Ln, Dallas TX',
        facets: [{ key: 'x', ring: [r[0], r[2], r[1], r[3]], pitchRise: 4 }],
      },
    });
    expect(bowtie.statusCode).toBe(400);
    expect(bowtie.json().code).toBe('validation_failed');
  });

  it('read-only members cannot create measurements', async () => {
    const res = await call(ctx, 'POST', '/v1/roof/measurements', {
      as: a.as('read_only'),
      body: { address: '123 Test Ln, Dallas TX', facets: FACETS },
    });
    expect(res.statusCode).toBe(403);
  });

  it('saves a trace as property, order, report and version 1 with server-measured areas', async () => {
    const res = await call(ctx, 'POST', '/v1/roof/measurements', {
      as: a.as('estimator'),
      body: { address: '123 Test Ln, Dallas TX', facets: FACETS, note: 'Front gable only' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    measurementId = body.id;
    expect(body).toMatchObject({
      number: expect.stringMatching(/^RM-\d{4}-0001$/),
      status: 'review_required',
      address: '123 Test Ln, Dallas TX',
      versionNumber: 1,
      versionStatus: 'draft',
    });
    const expected = measureTrace(FACETS);
    expect(body.version.totals.planSqFt).toBeCloseTo(expected.totals.planAreaM2 * 10.7639104, 0);
    expect(body.version.totals).toMatchObject({
      complete: false,
      slopedSqFt: null,
      squares: null,
      facetsMissingPitch: ['back'],
    });
    // Rings come back at the traced corners.
    expect(body.version.facets[0].ring[0].lon).toBeCloseTo(FACETS[0]!.ring[0]!.lon, 8);

    const [order] = await ctx.owner.client<{ status: string; mode: string }[]>`
      select status, mode from roof_orders where id = ${measurementId}`;
    expect(order).toMatchObject({ status: 'review_required', mode: 'diy' });
    const events = await ctx.owner.client<{ from_status: string | null; to_status: string }[]>`
      select from_status, to_status from roof_order_events where roof_order_id = ${measurementId}
      order by occurred_at, id`;
    expect(events.map((e) => `${e.from_status}->${e.to_status}`)).toEqual([
      'draft->ordered',
      'ordered->measuring',
      'measuring->review_required',
    ]);
    const counts = await ctx.owner.client<{ facets: number; vertices: number; edges: number }[]>`
      select (select count(*)::int from roof_facets f join roof_report_versions v on v.id = f.report_version_id
                join roof_reports r on r.id = v.roof_report_id where r.roof_order_id = ${measurementId}) as facets,
             (select count(*)::int from roof_vertices x join roof_report_versions v on v.id = x.report_version_id
                join roof_reports r on r.id = v.roof_report_id where r.roof_order_id = ${measurementId}) as vertices,
             (select count(*)::int from roof_edges e join roof_report_versions v on v.id = e.report_version_id
                join roof_reports r on r.id = v.roof_report_id where r.roof_order_id = ${measurementId}) as edges`;
    expect(counts[0]).toEqual({ facets: 2, vertices: 8, edges: 8 });
    const [prop] = await ctx.owner.client<{ lon: number; lat: number }[]>`
      select ST_X(p.confirmed_location::geometry) as lon, ST_Y(p.confirmed_location::geometry) as lat
      from properties p join roof_orders o on o.property_id = p.id where o.id = ${measurementId}`;
    expect(prop?.lon).toBeCloseTo(-96.8 + 8 / M_PER_DEG_LON, 6);
    expect(await auditRows(ctx, a.orgId, 'roof.measurement_created')).toHaveLength(1);
  });

  it('another company cannot see or change the measurement', async () => {
    for (const [method, url] of [
      ['GET', `/v1/roof/measurements/${measurementId}`],
      ['GET', `/v1/roof/measurements/${measurementId}/estimates`],
      ['POST', `/v1/roof/measurements/${measurementId}/approve`],
    ] as const) {
      const res = await call(ctx, method, url, { as: b.owner });
      expect(res.statusCode).toBe(404);
    }
    const revise = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/revisions`, {
      as: b.owner,
      body: { baseVersionNumber: 1, facets: FACETS },
    });
    expect(revise.statusCode).toBe(404);
    const list = await call(ctx, 'GET', '/v1/roof/measurements', { as: b.owner });
    expect(list.json().items).toEqual([]);
  });

  it('refuses approval while a facet has no pitch, and an estimate before approval', async () => {
    const approve = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/approve`, {
      as: a.as('reviewer'),
    });
    expect(approve.statusCode).toBe(412);
    expect(approve.json().detail).toMatch(/Back/);
    const estimate = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/estimates`, {
      as: a.as('estimator'),
      headers: key(),
      body: ESTIMATE,
    });
    expect(estimate.statusCode).toBe(412);
  });

  it('a revision with a stale base version is a conflict; a current one is version 2', async () => {
    const fixed = FACETS.map((f) => ({ ...f, pitchRise: 6 }));
    const stale = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/revisions`, {
      as: a.as('estimator'),
      body: { baseVersionNumber: 7, facets: fixed },
    });
    expect(stale.statusCode).toBe(409);
    const res = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/revisions`, {
      as: a.as('estimator'),
      body: { baseVersionNumber: 1, facets: fixed, note: 'Back pitch measured on site' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ versionNumber: 2, versionStatus: 'draft' });
    expect(res.json().version.totals.complete).toBe(true);
    const [old] = await ctx.owner.client<{ status: string }[]>`
      select v.status from roof_report_versions v join roof_reports r on r.id = v.roof_report_id
      where r.roof_order_id = ${measurementId} and v.version_number = 1`;
    expect(old?.status).toBe('superseded');
  });

  it('only approvers approve; approval freezes the version in the database', async () => {
    const denied = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/approve`, {
      as: a.as('estimator'),
    });
    expect(denied.statusCode).toBe(403);
    const res = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/approve`, {
      as: a.as('reviewer'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'approved', versionStatus: 'approved' });
    expect(res.json().version.approvedAt).toEqual(expect.any(String));
    const again = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/approve`, {
      as: a.as('reviewer'),
    });
    expect(again.statusCode).toBe(409);

    // The database itself refuses edits to an approved version's facets.
    await expect(
      ctx.owner.client`
        update roof_facets set plan_area_m2 = 1 where report_version_id = (
          select v.id from roof_report_versions v join roof_reports r on r.id = v.roof_report_id
          where r.roof_order_id = ${measurementId} and v.version_number = 2)`,
    ).rejects.toThrow(/immutable/);
  });

  it('prices the approved version with the pricing engine and moves the order to quoted', async () => {
    const forbidden = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/estimates`, {
      as: a.as('reviewer'),
      headers: key(),
      body: ESTIMATE,
    });
    expect(forbidden.statusCode).toBe(403);

    const noKey = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/estimates`, {
      as: a.as('estimator'),
      body: ESTIMATE,
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().code).toBe('idempotency_key_required');

    const headers = key();
    const res = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/estimates`, {
      as: a.as('estimator'),
      headers,
      body: ESTIMATE,
    });
    expect(res.statusCode).toBe(201);
    const est = res.json();
    // A retried submit with the same key replays the first estimate instead of creating another.
    const replay = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/estimates`, {
      as: a.as('estimator'),
      headers,
      body: ESTIMATE,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(est.id);
    const totals = measureTrace(FACETS.map((f) => ({ ...f, pitchRise: 6 }))).totals;
    const expected = computeRoofEstimate(totals, CreateRoofEstimateRequestSchema.parse(ESTIMATE), {
      priceRevisionLabel: 'x',
      actorUserId: 'x',
    });
    expect(est).toMatchObject({
      number: expect.stringMatching(/^EST-\d{4}-0001$/),
      status: 'pricing_ready',
      quoteKind: 'review_required',
      isBinding: false,
      measurementVersionNumber: 2,
      totalMinor: expected.totalMinor,
      taxMinor: expected.taxMinor,
    });
    expect(est.totalMinor).toBeGreaterThan(0);
    expect(est.lines.map((l: { code: string }) => l.code)).toEqual([
      'shingle_bundle',
      'underlayment_roll',
      'install_labor',
    ]);
    expect(est.warnings.join(' ')).toMatch(/not survey-grade/);

    const [order] = await ctx.owner.client<{ status: string }[]>`
      select status from roof_orders where id = ${measurementId}`;
    expect(order?.status).toBe('quoted');
    // Estimator cannot approve price books: the recorded prices wait for approval.
    const [pb] = await ctx.owner.client<{ status: string; items: number }[]>`
      select r.status, (select count(*)::int from price_items i where i.price_book_revision_id = r.id) as items
      from price_book_revisions r join estimate_revisions e on e.price_book_revision_id = r.id
      where e.estimate_id = ${est.id}`;
    expect(pb).toEqual({ status: 'pending_approval', items: 3 });
    const [takeoff] = await ctx.owner.client<{ waste_fraction: string; waste_source: string }[]>`
      select waste_fraction, waste_source from material_takeoffs where org_id = ${a.orgId}`;
    expect(takeoff).toEqual({ waste_fraction: '0.120000', waste_source: 'human_entered' });
    const audits = await auditRows(ctx, a.orgId, 'roof.estimate_created');
    expect((audits[0]?.after as { totalMinor: number }).totalMinor).toBe(expected.totalMinor);

    const list = await call(ctx, 'GET', `/v1/roof/measurements/${measurementId}/estimates`, {
      as: a.as('read_only'),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
  });

  it('owners record approved prices; editing a quoted measurement sends it back to review', async () => {
    const res = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/estimates`, {
      as: a.owner,
      headers: key(),
      body: { ...ESTIMATE, laborPerSquareMinor: null },
    });
    expect(res.statusCode).toBe(201);
    const [pb] = await ctx.owner.client<{ status: string }[]>`
      select r.status from price_book_revisions r join estimate_revisions e on e.price_book_revision_id = r.id
      where e.estimate_id = ${res.json().id}`;
    expect(pb?.status).toBe('approved');

    const revise = await call(ctx, 'POST', `/v1/roof/measurements/${measurementId}/revisions`, {
      as: a.as('estimator'),
      body: { baseVersionNumber: 2, facets: FACETS.map((f) => ({ ...f, pitchRise: 8 })) },
    });
    expect(revise.statusCode).toBe(201);
    expect(revise.json()).toMatchObject({ status: 'review_required', versionNumber: 3 });
    // Earlier estimates still point at version 2.
    const list = await call(ctx, 'GET', `/v1/roof/measurements/${measurementId}/estimates`, {
      as: a.owner,
    });
    expect(
      list
        .json()
        .items.map((e: { measurementVersionNumber: number }) => e.measurementVersionNumber),
    ).toEqual([2, 2]);
    const summary = await call(ctx, 'GET', '/v1/roof/measurements', { as: a.owner });
    expect(summary.json().items[0]).toMatchObject({ id: measurementId, versionNumber: 3 });
  });
});
