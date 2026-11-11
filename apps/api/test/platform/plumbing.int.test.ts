// Plumbing Pro integration tests against the real fieldline_test database (migration 0004 applied).
// Proves the persisted records layer, not just the contract schemas:
//   - the plumbing tables have forced RLS and another company can neither read nor write them;
//   - plan calibration stores the measured pixels and the scale derived from exactly those pixels;
//   - revisions are immutable, numbered snapshots and estimates pin the revision they priced;
//   - estimates are recomputed on the server (a client-sent total is rejected) and drafts are
//     superseded by newer computations while approved estimates are frozen;
//   - approval requires plumbing:approve, is refused while any line is unpriced, cannot be repeated
//     and writes the total to the audit trail.
import type { PlumbingDesign } from '@fieldline/contracts';
import { computeEstimate } from '@fieldline/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plumbingProjects } from '../../src/db/schema';
import { withTenant } from '../../src/db/runtime';
import {
  auditRows,
  call,
  type Company,
  createCompany,
  createTestContext,
  type Person,
  type TestContext,
} from '../helpers';

const DESIGN: PlumbingDesign = {
  fixtures: [{ id: 'fx-wc', type: 'water_closet', quantity: 1 }],
  runs: [
    {
      id: 'run-cold',
      label: 'Cold riser to bathroom',
      system: 'cold_water',
      material: 'pex_a',
      nominalSizeMm: 20,
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 6_000, y: 0, z: 0 },
      ],
      wastePercent: 5,
      stockLengthMm: 6_000,
      extraElbows: 0,
    },
  ],
};

/** Prices every takeoff line from the engine, and the totals the API must reproduce. */
function pricedDesign(design: PlumbingDesign = DESIGN) {
  const base = {
    name: 'Integration estimate',
    jurisdiction: '',
    fixtures: design.fixtures,
    runs: design.runs,
    laborRateMinorPerHour: 9_500,
    equipmentMinor: 0,
    contingencyPercent: 5,
    overheadPercent: 10,
    markupPercent: 15,
    taxPercent: 7,
  };
  const unpriced = computeEstimate({ ...base, prices: {} });
  const prices = Object.fromEntries(unpriced.takeoff.lines.map((line) => [line.key, 1_250]));
  const expected = computeEstimate({ ...base, prices });
  return { prices, expected, expectedUnpriced: unpriced, inputs: base };
}

let ctx: TestContext;
let a: Company;
let b: Company;
let projectId: string;
let revisionOneId: string;
let planId: string;
let estimatePricedId: string;
let approvedEstimateId: string;
const priced = pricedDesign();

beforeAll(async () => {
  ctx = await createTestContext();
  a = await createCompany(ctx, { roles: ['estimator', 'reviewer', 'read_only'] });
  b = await createCompany(ctx);
});
afterAll(() => ctx?.close());

async function createProject(owner: Person, name: string): Promise<string> {
  const res = await call(ctx, 'POST', '/v1/plumbing/projects', {
    as: owner,
    body: { name, jurisdiction: 'Fictionville' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function addRevision(owner: Person, id: string, design = DESIGN) {
  const res = await call(ctx, 'POST', `/v1/plumbing/projects/${id}/revisions`, {
    as: owner,
    body: { design },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; revisionNumber: number };
}

async function compute(
  owner: Person,
  id: string,
  revisionId: string,
  prices: Record<string, number>,
) {
  return call(ctx, 'POST', `/v1/plumbing/projects/${id}/estimates`, {
    as: owner,
    body: {
      revisionId,
      prices,
      laborRateMinorPerHour: priced.inputs.laborRateMinorPerHour,
      equipmentMinor: priced.inputs.equipmentMinor,
      contingencyPercent: priced.inputs.contingencyPercent,
      overheadPercent: priced.inputs.overheadPercent,
      markupPercent: priced.inputs.markupPercent,
      taxPercent: priced.inputs.taxPercent,
    },
  });
}

describe('schema and calibration', () => {
  it('forces RLS on all four plumbing tables (migration 0004)', async () => {
    const rows = await ctx.owner.client<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
        and relname like 'plumbing_%' order by relname`;
    expect(rows.map((r) => r.relname)).toEqual([
      'plumbing_estimates',
      'plumbing_plan_versions',
      'plumbing_projects',
      'plumbing_revisions',
    ]);
    for (const row of rows)
      expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('stores the pixel count and the scale derived from exactly those pixels', async () => {
    projectId = await createProject(a.owner, 'Bathroom rough-in (integration)');
    expect(projectId).toEqual(expect.any(String));
    const res = await call(ctx, 'POST', `/v1/plumbing/projects/${projectId}/plan`, {
      as: a.owner,
      body: { filename: 'floor-plan.pdf', pageNumber: 2, referenceFeet: 10, measuredPixels: 500.4 },
    });
    expect(res.statusCode).toBe(201);
    planId = res.json().id;
    // The stored integer is the one the scale was derived from: 10 ft / 500 px = 0.02 ft/px.
    expect(res.json()).toMatchObject({ measuredPixels: 500, feetPerPixel: 0.02, pageNumber: 2 });
    const [row] = await ctx.owner.client<
      { measured_pixels: number; feet_per_pixel: string }[]
    >`select measured_pixels, feet_per_pixel from plumbing_plan_versions where id = ${planId}`;
    expect(row?.measured_pixels).toBe(500);
    expect(Number(row?.feet_per_pixel)).toBeCloseTo(0.02, 8);
    const audits = await auditRows(ctx, a.orgId, 'plumbing.plan_calibrated');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.resource_id).toBe(planId);
  });

  it('creates immutable, consecutively numbered revisions', async () => {
    const first = await addRevision(a.owner, projectId);
    revisionOneId = first.id;
    expect(first.revisionNumber).toBe(1);
    const second = await addRevision(a.owner, projectId);
    expect(second.revisionNumber).toBe(2);

    const detail = await call(ctx, 'GET', `/v1/plumbing/projects/${projectId}`, { as: a.owner });
    expect(detail.statusCode).toBe(200);
    const numbers = (detail.json().revisions as { revisionNumber: number }[]).map(
      (r) => r.revisionNumber,
    );
    expect(numbers).toEqual([2, 1]);
    expect(detail.json().plans).toHaveLength(1);
    // The first revision still holds exactly what was written; nothing rewrote it.
    expect(detail.json().revisions[1]).toMatchObject({ id: revisionOneId, revisionNumber: 1 });
    expect(detail.json().revisions[1].fixtures).toEqual(DESIGN.fixtures);
    const [count] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from plumbing_revisions where project_id = ${projectId}`;
    expect(count?.n).toBe(2);
  });
});

describe('server computation', () => {
  it('rejects a client-supplied total (the client may only send inputs)', async () => {
    const res = await call(ctx, 'POST', `/v1/plumbing/projects/${projectId}/estimates`, {
      as: a.owner,
      body: {
        revisionId: revisionOneId,
        prices: {},
        laborRateMinorPerHour: 9_500,
        totals: { totalMinor: 1 },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('recomputes the totals from the stored revision and records unpriced lines', async () => {
    const res = await compute(a.owner, projectId, revisionOneId, {});
    expect(res.statusCode).toBe(201);
    const estimate = res.json();
    expect(estimate.revisionId).toBe(revisionOneId);
    expect(estimate.revisionNumber).toBe(1);
    expect(estimate.unpricedLineKeys.length).toBeGreaterThan(0);
    // Without prices the server still computes the same unpriced takeoff the engine does.
    expect(estimate.totals).toEqual(priced.expectedUnpriced.totals);
    // ...and approval is refused while a line is unpriced (checked before any supersede below).
    const approve = await call(
      ctx,
      'POST',
      `/v1/plumbing/projects/${projectId}/estimates/${estimate.id}/approve`,
      { as: a.owner },
    );
    // The request is well formed, so the taxonomy reports validation_failed (HTTP 400), the same
    // status other domain preconditions use in this API, rather than a schema error.
    expect(approve.statusCode).toBe(400);
    expect(approve.json().code).toBe('validation_failed');
    const [row] = await ctx.owner.client<{ totals: { totalMinor: number }; labor_hours: string }[]>`
      select totals, labor_hours from plumbing_estimates where id = ${estimate.id}`;
    expect(row?.totals.totalMinor).toBe(estimate.totals.totalMinor);
  });

  it('stores the engine totals exactly when every line is priced', async () => {
    const res = await compute(a.owner, projectId, revisionOneId, priced.prices);
    expect(res.statusCode).toBe(201);
    estimatePricedId = res.json().id;
    expect(res.json().unpricedLineKeys).toEqual([]);
    expect(res.json().totals).toEqual(priced.expected.totals);
    // A newer estimate supersedes the older draft, but only drafts.
    const superseded = await call(ctx, 'GET', `/v1/plumbing/projects/${projectId}`, {
      as: a.owner,
    });
    const byId = Object.fromEntries(
      (superseded.json().estimates as { id: string; status: string }[]).map((e) => [
        e.id,
        e.status,
      ]),
    );
    expect(Object.values(byId)).toContain('superseded');
    expect(byId[estimatePricedId]).toBe('draft');
  });
});

describe('approval rules', () => {
  it('requires plumbing:approve, not just plumbing:estimate', async () => {
    const res = await call(
      ctx,
      'POST',
      `/v1/plumbing/projects/${projectId}/estimates/${estimatePricedId}/approve`,
      { as: a.as('estimator') },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
    const reader = await call(
      ctx,
      'POST',
      `/v1/plumbing/projects/${projectId}/estimates/${estimatePricedId}/approve`,
      { as: a.as('read_only') },
    );
    expect(reader.statusCode).toBe(403);
  });

  it('a reviewer can approve a priced estimate and the audit records the grand total', async () => {
    const res = await call(
      ctx,
      'POST',
      `/v1/plumbing/projects/${projectId}/estimates/${estimatePricedId}/approve`,
      { as: a.as('reviewer') },
    );
    expect(res.statusCode).toBe(200);
    const approved = res.json();
    approvedEstimateId = approved.id;
    expect(approved).toMatchObject({
      status: 'approved',
      revisionNumber: 1,
      totals: priced.expected.totals,
    });
    expect(approved.approvedAt).toEqual(expect.any(String));

    const [row] = await ctx.owner.client<
      { approved_by_user_id: string; approved_at: string | Date | null; status: string }[]
    >`select approved_by_user_id, approved_at, status from plumbing_estimates where id = ${approved.id}`;
    expect(row?.approved_by_user_id).toBe(a.as('reviewer').userId);
    expect(row?.approved_at).toBeTruthy();
    expect(Number.isNaN(new Date(String(row?.approved_at)).getTime())).toBe(false);
    expect(row?.status).toBe('approved');

    const audits = await auditRows(ctx, a.orgId, 'plumbing.estimate_approved');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.resource_id).toBe(approved.id);
    expect(audits[0]?.actor_user_id).toBe(a.as('reviewer').userId);
    expect((audits[0]?.after as { totalMinor?: number }).totalMinor).toBe(
      priced.expected.totals.totalMinor,
    );
  });

  it('cannot approve the same estimate twice', async () => {
    const res = await call(
      ctx,
      'POST',
      `/v1/plumbing/projects/${projectId}/estimates/${approvedEstimateId}/approve`,
      { as: a.owner },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('conflict');
  });

  it('freezes approved estimates while newer drafts supersede each other', async () => {
    const second = await compute(a.owner, projectId, revisionOneId, priced.prices);
    expect(second.statusCode).toBe(201);
    // The approved estimate is untouched by the new computation.
    const detail = await call(ctx, 'GET', `/v1/plumbing/projects/${projectId}`, { as: a.owner });
    const statuses = Object.fromEntries(
      (detail.json().estimates as { id: string; status: string }[]).map((e) => [e.id, e.status]),
    );
    expect(statuses[approvedEstimateId]).toBe('approved');
    expect(statuses[second.json().id]).toBe('draft');

    const third = await compute(a.owner, projectId, revisionOneId, priced.prices);
    expect(third.statusCode).toBe(201);
    const again = await call(ctx, 'GET', `/v1/plumbing/projects/${projectId}`, { as: a.owner });
    const after = Object.fromEntries(
      (again.json().estimates as { id: string; status: string }[]).map((e) => [e.id, e.status]),
    );
    expect(after[second.json().id]).toBe('superseded');

    const approveSuperseded = await call(
      ctx,
      'POST',
      `/v1/plumbing/projects/${projectId}/estimates/${second.json().id}/approve`,
      { as: a.owner },
    );
    expect(approveSuperseded.statusCode).toBe(409);
  });
});

describe('tenant isolation', () => {
  it('another company gets 404 for every plumbing record it asks for by id', async () => {
    const cases: Promise<{ statusCode: number; json: () => { code?: string } }>[] = [
      call(ctx, 'GET', `/v1/plumbing/projects/${projectId}`, { as: b.owner }),
      call(ctx, 'GET', `/v1/plumbing/projects/${projectId}/estimates`, { as: b.owner }),
      call(ctx, 'POST', `/v1/plumbing/projects/${projectId}/plan`, {
        as: b.owner,
        body: { filename: 'x.pdf', referenceFeet: 10, measuredPixels: 100 },
      }),
      call(ctx, 'POST', `/v1/plumbing/projects/${projectId}/revisions`, {
        as: b.owner,
        body: { design: DESIGN },
      }),
      call(ctx, 'POST', `/v1/plumbing/projects/${projectId}/estimates`, {
        as: b.owner,
        body: { revisionId: revisionOneId, prices: {}, laborRateMinorPerHour: 1 },
      }),
      call(
        ctx,
        'POST',
        `/v1/plumbing/projects/${projectId}/estimates/${approvedEstimateId}/approve`,
        {
          as: b.owner,
        },
      ),
    ];
    for (const pending of cases) {
      const res = await pending;
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('not_found');
    }
  });

  it('lists only the caller company projects and estimates', async () => {
    const list = await call(ctx, 'GET', '/v1/plumbing/projects', { as: b.owner });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual([]);
    const own = await call(ctx, 'GET', '/v1/plumbing/projects', { as: a.owner });
    expect((own.json().items as { id: string }[]).map((p) => p.id)).toEqual([projectId]);
  });

  it('RLS hides the rows from the restricted runtime role', async () => {
    const asB = await withTenant(ctx.appDb.db, { orgId: b.orgId, userId: b.owner.userId }, (tx) =>
      tx.select().from(plumbingProjects),
    );
    expect(asB).toEqual([]);
    const asA = await withTenant(ctx.appDb.db, { orgId: a.orgId, userId: a.owner.userId }, (tx) =>
      tx.select().from(plumbingProjects),
    );
    expect(asA.map((p) => p.id)).toEqual([projectId]);
  });

  it('the database rejects a cross-company insert even with a valid foreign key', async () => {
    const error = await withTenant(ctx.appDb.db, { orgId: b.orgId, userId: b.owner.userId }, (tx) =>
      tx.insert(plumbingProjects).values({ orgId: a.orgId, name: 'hijack' }),
    ).catch((e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code);
    expect(error).toBe('42501');
    const [row] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from plumbing_projects where id = ${projectId} and name = 'hijack'`;
    expect(row?.n).toBe(0);
  });
});
