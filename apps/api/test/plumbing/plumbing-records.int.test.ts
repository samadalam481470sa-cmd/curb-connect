// PL-001/004/009/010/016/019/040 record layer: migration 0004's four tables, its RLS policies and
// tenant isolation are exercised against the real database (CI: the postgis container), not asserted
// from the SQL text. Also proves the approval freeze and the immutable revision numbering.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/db/runtime';
import { plumbingEstimates, plumbingProjects } from '../../src/db/schema';
import { call, type Company, createCompany, createTestContext, type TestContext } from '../helpers';

let ctx: TestContext;
let a: Company;
let b: Company;

const design = {
  fixtures: [{ id: 'fx-1', type: 'water_closet', quantity: 1 }],
  runs: [
    {
      id: 'run-1',
      label: 'Cold riser to bathroom',
      system: 'cold_water',
      material: 'pex_a',
      nominalSizeMm: 20,
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 7315, y: 0, z: 0 },
      ],
      wastePercent: 5,
      stockLengthMm: 6096,
      extraElbows: 0,
    },
  ],
};

const ids = {} as {
  project: string;
  revision: string;
  estimate: string;
  approvedEstimate: string;
};

beforeAll(async () => {
  ctx = await createTestContext();
  a = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
  b = await createCompany(ctx, { roles: ['reviewer'] });
});

afterAll(() => ctx?.close());

describe('plumbing records (migration 0004)', () => {
  it('created four tenant tables with RLS enabled and forced', async () => {
    const rows = await ctx.owner.client<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relname in ('plumbing_projects', 'plumbing_plan_versions', 'plumbing_revisions', 'plumbing_estimates')`;
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect({
        relname: row.relname,
        rls: row.relrowsecurity,
        forced: row.relforcerowsecurity,
      }).toEqual({ relname: row.relname, rls: true, forced: true });
    }
    const policies = await ctx.owner.client<{ tablename: string }[]>`
      select tablename from pg_policies
      where schemaname = 'public' and policyname = 'tenant_isolation'
        and tablename like 'plumbing_%'`;
    expect(new Set(policies.map((p) => p.tablename))).toEqual(
      new Set([
        'plumbing_projects',
        'plumbing_plan_versions',
        'plumbing_revisions',
        'plumbing_estimates',
      ]),
    );
  });

  it('records a project, a calibrated plan, an immutable revision and a server-computed estimate', async () => {
    const project = await call(ctx, 'POST', '/v1/plumbing/projects', {
      as: a.owner,
      body: { name: 'Bathroom rough-in', jurisdiction: 'Seattle' },
    });
    expect(project.statusCode).toBe(201);
    ids.project = project.json().id;

    const plan = await call(ctx, 'POST', `/v1/plumbing/projects/${ids.project}/plan`, {
      as: a.as('estimator'),
      body: { filename: 'floor-2.pdf', pageNumber: 1, referenceFeet: 30, measuredPixels: 600 },
    });
    expect(plan.statusCode).toBe(201);
    // The scale is derived on the server from the integer pixels it stored.
    expect(plan.json().feetPerPixel).toBeCloseTo(0.05, 8);

    const first = await call(ctx, 'POST', `/v1/plumbing/projects/${ids.project}/revisions`, {
      as: a.as('estimator'),
      body: { design },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().revisionNumber).toBe(1);
    ids.revision = first.json().id;

    const second = await call(ctx, 'POST', `/v1/plumbing/projects/${ids.project}/revisions`, {
      as: a.as('estimator'),
      body: { design },
    });
    expect(second.json().revisionNumber).toBe(2);

    const estimate = await call(ctx, 'POST', `/v1/plumbing/projects/${ids.project}/estimates`, {
      as: a.as('estimator'),
      body: { revisionId: ids.revision, prices: {}, laborRateMinorPerHour: 9500 },
    });
    expect(estimate.statusCode).toBe(201);
    ids.estimate = estimate.json().id;
    expect(estimate.json().totals.totalMinor).toBeGreaterThan(0);

    const detail = await call(ctx, 'GET', `/v1/plumbing/projects/${ids.project}`, { as: a.owner });
    expect(detail.json().plans).toHaveLength(1);
    expect(detail.json().revisions).toHaveLength(2);
    expect(detail.json().estimates).toHaveLength(1);
  });

  it('refuses approval while a line is unpriced, then freezes a priced estimate', async () => {
    const blocked = await call(
      ctx,
      'POST',
      `/v1/plumbing/projects/${ids.project}/estimates/${ids.estimate}/approve`,
      { as: a.as('reviewer') },
    );
    expect(blocked.statusCode).toBeGreaterThanOrEqual(400);
    expect(blocked.json().code).toBe('validation_failed');

    const priced = await call(ctx, 'POST', `/v1/plumbing/projects/${ids.project}/estimates`, {
      as: a.as('estimator'),
      body: {
        revisionId: ids.revision,
        prices: { 'cold_water|pex_a|20|pipe': 1500 },
        laborRateMinorPerHour: 9500,
      },
    });
    expect(priced.statusCode).toBe(201);
    // Prices are stored per estimate, not merged server-side, so every line must be re-sent.
    const keys: string[] = priced.json().unpricedLineKeys;
    const prices = {
      'cold_water|pex_a|20|pipe': 1500,
      ...Object.fromEntries(keys.map((key) => [key, 1200])),
    };
    const complete = await call(ctx, 'POST', `/v1/plumbing/projects/${ids.project}/estimates`, {
      as: a.as('estimator'),
      body: { revisionId: ids.revision, prices, laborRateMinorPerHour: 9500 },
    });
    expect(complete.json().unpricedLineKeys).toEqual([]);
    ids.approvedEstimate = complete.json().id;

    // Computing a newer estimate supersedes the older drafts but never rewrites an approval.
    const approved = await call(
      ctx,
      'POST',
      `/v1/plumbing/projects/${ids.project}/estimates/${ids.approvedEstimate}/approve`,
      { as: a.as('reviewer') },
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('approved');
    expect(approved.json().approvedAt).not.toBeNull();

    const again = await call(
      ctx,
      'POST',
      `/v1/plumbing/projects/${ids.project}/estimates/${ids.approvedEstimate}/approve`,
      { as: a.as('reviewer') },
    );
    expect(again.json().code).toBe('conflict');
  });

  it('another company gets 404 from every record route and sees none of the rows', async () => {
    const cases: [string, () => Promise<{ statusCode: number; json: () => { code?: string } }>][] =
      [
        [
          'GET project',
          () => call(ctx, 'GET', `/v1/plumbing/projects/${ids.project}`, { as: b.owner }),
        ],
        [
          'POST plan',
          () =>
            call(ctx, 'POST', `/v1/plumbing/projects/${ids.project}/plan`, {
              as: b.owner,
              body: { filename: 'x.pdf', pageNumber: 1, referenceFeet: 10, measuredPixels: 100 },
            }),
        ],
        [
          'POST revision',
          () =>
            call(ctx, 'POST', `/v1/plumbing/projects/${ids.project}/revisions`, {
              as: b.owner,
              body: { design },
            }),
        ],
        [
          'POST estimate',
          () =>
            call(ctx, 'POST', `/v1/plumbing/projects/${ids.project}/estimates`, {
              as: b.owner,
              body: { revisionId: ids.revision, prices: {}, laborRateMinorPerHour: 100 },
            }),
        ],
        [
          'POST approve',
          () =>
            call(
              ctx,
              'POST',
              `/v1/plumbing/projects/${ids.project}/estimates/${ids.estimate}/approve`,
              { as: b.owner },
            ),
        ],
      ];

    for (const [label, run] of cases) {
      const res = await run();
      expect({ label, status: res.statusCode, code: res.json().code }).toEqual({
        label,
        status: 404,
        code: 'not_found',
      });
    }

    const list = await call(ctx, 'GET', '/v1/plumbing/projects', { as: b.owner });
    expect(list.json().items).toEqual([]);
    const estimates = await call(ctx, 'GET', `/v1/plumbing/projects/${ids.project}/estimates`, {
      as: b.owner,
    });
    expect(estimates.json().items).toEqual([]);
  });

  it('the restricted runtime role is filtered by RLS on the new tables', async () => {
    const context = { orgId: b.orgId, userId: b.owner.userId };
    const foreign = await withTenant(ctx.appDb.db, context, (tx) =>
      tx.select().from(plumbingEstimates).where(eq(plumbingEstimates.orgId, a.orgId)),
    );
    expect(foreign).toEqual([]);
    const foreignProjects = await withTenant(ctx.appDb.db, context, (tx) =>
      tx.select().from(plumbingProjects).where(eq(plumbingProjects.orgId, a.orgId)),
    );
    expect(foreignProjects).toEqual([]);

    const denied = await withTenant(ctx.appDb.db, context, (tx) =>
      tx.insert(plumbingProjects).values({ orgId: a.orgId, name: 'cross tenant' }),
    ).catch(
      (error: { cause?: { code?: string }; code?: string }) => error.cause?.code ?? error.code,
    );
    expect(denied).toBe('42501');

    const none = await withTenant(ctx.appDb.db, { orgId: null, userId: null }, (tx) =>
      tx.select().from(plumbingProjects),
    );
    expect(none).toEqual([]);
  });
});
