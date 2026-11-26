import { randomUUID } from 'node:crypto';
import { Logger, runOnce } from 'graphile-worker';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  createCompany,
  createTestContext,
  platformTestUrl,
  type Company,
  type TestContext,
  type TestSession,
} from '../../../test/helpers';
import { workerConnectionString } from '../../jobs/install';
import { buildTaskList } from '../../jobs/tasks';
import { createMailerClient } from '../../services/mailer-client';

let ctx: TestContext;
const projects = '/v1/enterprise/projects';
const version = (revision: number) => ({ 'if-match': '"' + revision + '"' });

beforeAll(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from enterprise_suite.finance_budget_revision_decisions where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.finance_budget_revision_deltas where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.finance_budget_revision_requests where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.finance_budget_approvals where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.finance_budget_lines where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.finance_budget_baselines where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.finance_project_grants where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.purchase_cost_codes where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.audit_events where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.projects where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});

afterAll(async () => ctx?.close());

async function project(company: Company, name: string) {
  expect(
    (
      await call(ctx, 'PUT', '/v1/enterprise/status', {
        as: company.owner,
        body: { enabled: true },
      })
    ).statusCode,
  ).toBe(200);
  const saved = await call(ctx, 'POST', projects, {
    as: company.owner,
    body: { name, originalContractMinor: 100_000 },
  });
  expect(saved.statusCode, saved.body).toBe(201);
  return projects + '/' + saved.json().id;
}

describe('Enterprise project budget baseline', () => {
  it('uses the company calendar day for the budget as-of date and historical cutoff', async () => {
    const company = await createCompany(ctx);
    const projectPath = await project(company, 'Budget company calendar');
    const now = new Date();
    const utcDate = now.toISOString().slice(0, 10);
    const timeZone = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].find(
      (zone) => calendarDay(now, zone) !== utcDate,
    );
    if (!timeZone) throw new Error('The test requires a calendar day distinct from UTC.');
    await ctx.owner.client`
      update public.organizations set timezone = ${timeZone} where id = ${company.orgId}
    `;
    const budget = projectPath + '/budget';
    const current = await call(ctx, 'GET', budget, { as: company.owner });
    expect(current.statusCode, current.body).toBe(200);
    const { asOf, readAt } = current.json();
    expect(asOf).toBe(calendarDay(new Date(readAt), timeZone));
    const drafted = await call(ctx, 'POST', budget, {
      as: company.owner,
      headers: version(0),
      body: { currency: 'USD', effectiveOn: asOf, clientRequestId: randomUUID() },
    });
    expect(drafted.statusCode, drafted.body).toBe(201);
    const prior = new Date(asOf + 'T00:00:00.000Z');
    prior.setUTCDate(prior.getUTCDate() - 1);
    const previous = await call(ctx, 'GET', budget + '?asOf=' + prior.toISOString().slice(0, 10), {
      as: company.owner,
    });
    expect(previous.statusCode, previous.body).toBe(200);
    expect(previous.json()).toMatchObject({ baseline: null, canCreate: false });
    const nowVisible = await call(ctx, 'GET', budget, { as: company.owner });
    expect(nowVisible.json()).toMatchObject({
      asOf,
      baseline: { id: drafted.json().id, status: 'draft', effectiveOn: asOf },
    });
  });

  it('grants a project estimator access, drills into exact draft lines, and seals the approved baseline', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'finance', 'crew_manager'] });
    const other = await createCompany(ctx);
    const projectPath = await project(company, 'Bridge budget baseline');
    const otherPath = await project(other, 'Another company budget');
    const estimator = company.as('estimator');
    const finance = company.as('finance');
    const path = projectPath + '/budget';

    async function addCode(as: TestSession, target: string, code: string, label: string) {
      return call(ctx, 'POST', target + '/purchase-cost-codes', { as, body: { code, label } });
    }

    expect((await addCode(company.owner, projectPath, '03-30', 'Concrete')).statusCode).toBe(201);
    expect((await addCode(company.owner, projectPath, '06-10', 'Framing')).statusCode).toBe(201);
    expect((await addCode(other.owner, otherPath, '52-51', 'Outside scope')).statusCode).toBe(201);
    const get = (as = company.owner, search = '') => call(ctx, 'GET', path + search, { as });
    const initial = await get();
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.headers['cache-control']).toBe('private, no-store');
    expect(initial.json()).toMatchObject({
      baseline: null,
      canCreate: true,
      availableCostCodes: [
        { id: expect.any(String), code: '03-30', label: 'Concrete' },
        { id: expect.any(String), code: '06-10', label: 'Framing' },
      ],
    });
    const {
      availableCostCodes: [concrete, framing],
      asOf: today,
    } = initial.json();
    expect((await get(estimator)).statusCode).toBe(404);
    expect((await get(finance)).statusCode).toBe(404);
    expect((await get(company.as('crew_manager'))).statusCode).toBe(403);
    expect((await get(other.owner)).statusCode).toBe(404);
    const otherBudget = await call(ctx, 'GET', otherPath + '/budget', { as: other.owner });
    expect(otherBudget.statusCode, otherBudget.body).toBe(200);
    const outsideCodeId = otherBudget.json().availableCostCodes[0].id;

    async function grant(membershipId: string, base: number, active: boolean) {
      const result = await call(ctx, 'PUT', path + '/grants/' + membershipId, {
        as: company.owner,
        headers: version(base),
        body: { active, reason: 'Assign project budget access.', clientRequestId: randomUUID() },
      });
      expect(result.statusCode, result.body).toBe(200);
    }
    await grant(estimator.membershipId, 0, true);
    await grant(finance.membershipId, 0, true);

    const baseline = { currency: 'USD', effectiveOn: today, clientRequestId: randomUUID() };
    const create = (as = company.owner) =>
      call(ctx, 'POST', path, { as, headers: version(0), body: baseline });
    expect((await create(estimator)).statusCode).toBe(403);
    const [created, replayed] = await Promise.all([create(), create()]);
    expect([created.statusCode, replayed.statusCode].sort(), created.body).toEqual([200, 201]);
    expect(created.json()).toEqual(replayed.json());
    expect(created.json()).toMatchObject({ currency: 'USD', effectiveOn: today, revision: 1 });
    const budgetId = created.json().id as string;
    const command = path + '/' + budgetId;
    const line = {
      costCodeId: concrete.id,
      description: 'Bridge footing concrete',
      amountMinor: 21_057_021,
      currency: 'USD',
      unit: 'cubic_yd',
      phase: 'Structure',
      fundingSource: 'Base contract',
      clientRequestId: randomUUID(),
    };

    function add(data = line, revision = 1, as = estimator) {
      return call(ctx, 'POST', command + '/lines', { as, headers: version(revision), body: data });
    }
    expect((await add(line, 1, finance)).statusCode).toBe(403);
    expect((await add({ ...line, costCodeId: outsideCodeId })).statusCode).toBe(400);
    expect((await add({ ...line, currency: 'CAD' })).statusCode).toBe(400);
    expect((await add(line, 0)).statusCode).toBe(412);
    const [saved, repeat] = await Promise.all([add(), add()]);
    expect([saved.statusCode, repeat.statusCode].sort(), saved.body).toEqual([200, 201]);
    expect(saved.json()).toEqual(repeat.json());
    expect(saved.json()).toMatchObject({
      revision: 2,
      line: { amountMinor: 21_057_021, costCode: concrete },
    });
    expect((await add({ ...line, clientRequestId: randomUUID() }, 2)).statusCode).toBe(409);
    const frame = await add(
      {
        ...line,
        costCodeId: framing.id,
        description: 'Framing materials',
        amountMinor: 159_026,
        unit: 'lump_sum',
        clientRequestId: randomUUID(),
      },
      2,
    );
    expect(frame.statusCode, frame.body).toBe(201);

    const filtered = await get(estimator, '?costCodeId=' + concrete.id);
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json()).toMatchObject({
      canApprove: false,
      canEditDraft: true,
      baseline: {
        status: 'draft',
        revision: 3,
        amountMinor: '21216047',
        lines: [{ id: saved.json().line.id, amountMinor: 21_057_021 }],
      },
    });
    expect(filtered.json().baseline.lines).toHaveLength(1);

    const prior = new Date(today + 'T00:00:00.000Z');
    prior.setUTCDate(prior.getUTCDate() - 1);
    const historic = await get(estimator, '?asOf=' + prior.toISOString().slice(0, 10));
    expect(historic.json()).toMatchObject({
      baseline: null,
      canCreate: false,
      canEditDraft: false,
    });

    const approval = {
      reason: 'Checked the two approved estimating allowances.',
      clientRequestId: randomUUID(),
    };
    const seal = (as = company.owner) =>
      call(ctx, 'POST', command + '/approval', { as, headers: version(3), body: approval });
    expect((await seal(estimator)).statusCode).toBe(403);
    const [sealed, duplicate] = await Promise.all([seal(), seal()]);
    expect([sealed.statusCode, duplicate.statusCode].sort(), sealed.body).toEqual([200, 201]);
    expect(sealed.json()).toEqual(duplicate.json());
    expect(sealed.json()).toMatchObject({ budgetId, revision: 4, amountMinor: '21216047' });
    expect((await add({ ...line, clientRequestId: randomUUID() }, 4)).statusCode).toBe(409);
    const available = await get(finance);
    expect(available.statusCode, available.body).toBe(200);
    expect(available.json()).toMatchObject({
      canEditDraft: false,
      baseline: {
        revision: 4,
        status: 'approved',
        amountMinor: '21216047',
        lines: [{ id: saved.json().line.id }, { id: frame.json().line.id }],
      },
    });

    await grant(estimator.membershipId, 1, false);
    expect((await get(estimator)).statusCode).toBe(404);
    const approvals = await ctx.owner.client`
      select action, resource_id from public.audit_events
      where org_id = ${company.orgId} and action = 'budget.baseline_approved'
    `;
    expect(approvals).toEqual([{ action: 'budget.baseline_approved', resource_id: budgetId }]);
    const purchasing = await call(ctx, 'GET', projectPath + '/purchase-orders', {
      as: company.owner,
    });
    expect(purchasing.statusCode, purchasing.body).toBe(200);
    expect(purchasing.json().costCodes).toEqual([
      { code: '03-30', label: 'Concrete' },
      { code: '06-10', label: 'Framing' },
    ]);
  }, 60_000);
});

function calendarDay(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

describe('Enterprise budget revisions', () => {
  it('applies only assigned approved deltas, keeps the baseline, and delivers each review notice once', async () => {
    const company = await createCompany(ctx, { roles: ['admin', 'estimator'] });
    const other = await createCompany(ctx);
    const projectPath = await project(company, 'Structural budget revisions');
    await project(other, 'Outside revision portfolio');
    const manager = company.as('admin');
    const estimator = company.as('estimator');
    const budget = projectPath + '/budget';
    const read = () => call(ctx, 'GET', budget, { as: company.owner });
    for (const [code, label] of [
      ['03-30', 'Concrete'],
      ['06-10', 'Framing'],
    ] as const) {
      const result = await call(ctx, 'POST', projectPath + '/purchase-cost-codes', {
        as: company.owner,
        body: { code, label },
      });
      expect(result.statusCode, result.body).toBe(201);
    }
    const initial = await read();
    const {
      asOf,
      availableCostCodes: [concrete, framing],
    } = initial.json();
    const created = await call(ctx, 'POST', budget, {
      as: company.owner,
      headers: version(0),
      body: { currency: 'USD', effectiveOn: asOf, clientRequestId: randomUUID() },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const resource = budget + '/' + id;
    for (const [index, code] of [concrete, framing].entries()) {
      const line = await call(ctx, 'POST', resource + '/lines', {
        as: company.owner,
        headers: version(index + 1),
        body: {
          costCodeId: code.id,
          description: code.label,
          amountMinor: index === 0 ? 100_000 : 200_000,
          currency: 'USD',
          unit: 'lump_sum',
          phase: 'Structure',
          fundingSource: 'Base contract',
          clientRequestId: randomUUID(),
        },
      });
      expect(line.statusCode, line.body).toBe(201);
    }
    const baseline = await call(ctx, 'POST', resource + '/approval', {
      as: company.owner,
      headers: version(3),
      body: { reason: 'Initial project allocation.', clientRequestId: randomUUID() },
    });
    expect(baseline.statusCode, baseline.body).toBe(201);
    const original = (await read()).json().baseline;
    const url = resource + '/revisions';
    const change = {
      kind: 'allocation_change',
      reviewerMembershipId: manager.membershipId,
      reason: 'Add the revised material allowance.',
      deltas: [{ costCodeId: concrete.id, deltaMinor: 25_015 }],
      clientRequestId: randomUUID(),
    };
    function propose(body = change, base = 4, as: TestSession = company.owner) {
      return call(ctx, 'POST', url, { as, headers: version(base), body });
    }
    expect((await propose(change, 4, estimator)).statusCode).toBe(403);
    expect((await propose(change, 4, other.owner)).statusCode).toBe(404);
    expect(
      (await propose({ ...change, reviewerMembershipId: estimator.membershipId })).statusCode,
    ).toBe(400);
    expect((await propose({ ...change, kind: 'transfer' })).statusCode).toBe(400);
    expect(
      (await propose({ ...change, deltas: [{ costCodeId: concrete.id, deltaMinor: -100_001 }] }))
        .statusCode,
    ).toBe(400);
    const [opened, repeated] = await Promise.all([propose(), propose()]);
    expect([opened.statusCode, repeated.statusCode].sort(), opened.body).toEqual([200, 201]);
    expect(opened.json()).toEqual(repeated.json());
    expect(opened.json()).toMatchObject({
      baseVersion: 4,
      state: 'pending',
      canDecide: false,
      deltas: [
        { costCode: concrete, priorMinor: '100000', deltaMinor: 25_015, proposedMinor: '125015' },
      ],
    });
    const first = opened.json().id as string;
    const transfer = {
      ...change,
      kind: 'transfer',
      reason: 'Move an allowance to framing.',
      deltas: [
        { costCodeId: concrete.id, deltaMinor: -15_000 },
        { costCodeId: framing.id, deltaMinor: 15_000 },
      ],
      clientRequestId: randomUUID(),
    };
    const stale = await propose(transfer);
    expect(stale.statusCode, stale.body).toBe(201);
    const staleId = stale.json().id as string;
    const page = await call(ctx, 'GET', url + '?limit=1', { as: manager });
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json()).toMatchObject({
      activeVersion: 4,
      items: [{ id: staleId, canDecide: true }],
      nextCursor: expect.any(String),
    });
    const older = await call(
      ctx,
      'GET',
      url + '?limit=1&cursor=' + encodeURIComponent(page.json().nextCursor),
      { as: manager },
    );
    expect(older.json()).toMatchObject({
      items: [{ id: first, canDecide: true }],
      nextCursor: null,
    });
    expect((await read()).json().allocation).toMatchObject({ version: 4, currentMinor: '300000' });

    async function drainBudgetEvents() {
      await runOnce({
        connectionString: workerConnectionString(platformTestUrl()),
        taskList: buildTaskList({
          platformDb: ctx.platformDb.db,
          mail: ctx.mail,
          mailer: createMailerClient(null),
          config: ctx.config,
        }),
        noHandleSignals: true,
        logger: new Logger(() => () => {}),
      });
    }

    await drainBudgetEvents();
    const receipt = {
      outcome: 'approved',
      reason: 'Reviewed the new allowance.',
      clientRequestId: randomUUID(),
    };
    function decide(target: string, data = receipt, base = 4, as: TestSession = manager) {
      return call(ctx, 'POST', url + '/' + target + '/decision', {
        as,
        headers: version(base),
        body: data,
      });
    }
    expect((await decide(first, receipt, 4, company.owner)).statusCode).toBe(404);
    const [accepted, acceptedAgain] = await Promise.all([decide(first), decide(first)]);
    expect([accepted.statusCode, acceptedAgain.statusCode].sort(), accepted.body).toEqual([
      200, 201,
    ]);
    expect(accepted.json()).toEqual(acceptedAgain.json());
    expect(accepted.json()).toMatchObject({ state: 'approved', decision: { activatedVersion: 5 } });
    const after = (await read()).json();
    expect(after.baseline).toEqual(original);
    expect(after.allocation).toMatchObject({
      version: 5,
      baselineMinor: '300000',
      approvedChangeMinor: '25015',
      currentMinor: '325015',
    });
    expect((await propose()).json()).toEqual(opened.json());
    expect((await decide(staleId, { ...receipt, clientRequestId: randomUUID() })).statusCode).toBe(
      412,
    );
    const moved = await propose({ ...transfer, clientRequestId: randomUUID() }, 5);
    expect(moved.statusCode, moved.body).toBe(201);
    const movedId = moved.json().id as string;
    await drainBudgetEvents();
    const balance = await decide(movedId, { ...receipt, clientRequestId: randomUUID() }, 5);
    expect(balance.statusCode, balance.body).toBe(201);
    const closed = await decide(staleId, {
      ...receipt,
      outcome: 'rejected',
      clientRequestId: randomUUID(),
    });
    expect(closed.statusCode, closed.body).toBe(201);
    expect(closed.json()).toMatchObject({
      state: 'rejected',
      decision: { activatedVersion: null },
    });
    const saved = (await read()).json();
    expect(saved.baseline).toEqual(original);
    expect(saved.allocation).toEqual({
      version: 6,
      baselineMinor: '300000',
      approvedChangeMinor: '25015',
      currentMinor: '325015',
      byCostCode: [
        { costCodeId: concrete.id, amountMinor: '110015' },
        { costCodeId: framing.id, amountMinor: '215000' },
      ],
    });
    await drainBudgetEvents();
    const events = await ctx.owner.client`
      select event_type, status from public.domain_events
      where org_id = ${company.orgId} and aggregate_type = 'enterprise_budget_revision'
      order by event_type
    `;
    expect(events).toHaveLength(5);
    expect(
      events.filter(({ event_type }) => event_type === 'budget.revision_requested'),
    ).toHaveLength(3);
    expect(
      events.filter(({ event_type }) => event_type === 'budget.revision_approved'),
    ).toHaveLength(2);
    expect(events.every(({ status }) => status === 'dispatched')).toBe(true);
    const notices = await ctx.owner.client`
      select recipient_membership_id, dedupe_key from public.notifications
      where org_id = ${company.orgId} and dedupe_key like 'budget.revision_%'
    `;
    expect(
      notices.filter(
        ({ recipient_membership_id }) => recipient_membership_id === manager.membershipId,
      ),
    ).toHaveLength(3);
    expect(
      notices.filter(
        ({ recipient_membership_id }) => recipient_membership_id === company.owner.membershipId,
      ),
    ).toHaveLength(2);
    expect(new Set(notices.map(({ dedupe_key }) => dedupe_key)).size).toBe(5);
  }, 60_000);
});
