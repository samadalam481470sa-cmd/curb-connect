import { createHash, randomUUID } from 'node:crypto';
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
const match = (revision: number) => ({ 'if-match': String(revision) });

beforeAll(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  const ids = [...ctx.tracked.orgIds];
  if (ids.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from enterprise_suite.wip_reports where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.cost_scenarios where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.cost_forecast_lines where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.cost_forecast_snapshots where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.finance_budget_approvals where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.finance_budget_lines where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.finance_budget_baselines where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.actual_bill_allocations where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.actual_bill_postings where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.cost_period_revisions where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.finance_project_grants where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.purchase_cost_codes where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.audit_events where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.projects where org_id = any(${ids}::uuid[])`;
      await tx`delete from enterprise_suite.settings where org_id = any(${ids}::uuid[])`;
    });
  }
  await ctx.cleanup();
});

afterAll(async () => {
  await ctx?.close();
});

async function project(company: Company, name: string, originalContractMinor = 0) {
  if (!(await call(ctx, 'GET', '/v1/enterprise/status', { as: company.owner })).json().enabled) {
    const enabled = await call(ctx, 'PUT', '/v1/enterprise/status', {
      as: company.owner,
      body: { enabled: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
  }
  const result = await call(ctx, 'POST', projects, {
    as: company.owner,
    body: { name, originalContractMinor },
  });
  expect(result.statusCode, result.body).toBe(201);
  return projects + '/' + result.json().id;
}

async function preferInbox(as: TestSession) {
  const response = await call(ctx, 'PUT', '/v1/notifications/preferences', {
    as,
    body: {
      preferences: ['system', 'invoice_received', 'invoice_approved', 'invoice_paid'].map(
        (category) => ({ category, channel: 'email', enabled: false }),
      ),
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function connectPayer(vendor: Company, buyer: Company) {
  const optIn = await call(ctx, 'PATCH', '/v1/network/listing', {
    as: buyer.owner,
    body: { directoryOptIn: true },
  });
  expect(optIn.statusCode, optIn.body).toBe(200);
  const request = await call(ctx, 'POST', '/v1/network/connections', {
    as: vendor.owner,
    body: { partnerOrgId: buyer.orgId, scopes: ['invoices'] },
  });
  expect(request.statusCode, request.body).toBe(201);
  const connections = await call(ctx, 'GET', '/v1/network/connections', { as: buyer.owner });
  expect(connections.statusCode, connections.body).toBe(200);
  const connection = connections
    .json()
    .items.find((row: { partnerOrgId: string }) => row.partnerOrgId === vendor.orgId);
  const accept = await call(ctx, 'POST', '/v1/network/connections/' + connection.id + '/accept', {
    as: buyer.owner,
    body: {},
  });
  expect(accept.statusCode, accept.body).toBe(200);
}

async function deliverBill(vendor: Company, buyer: Company, amountMinor: number) {
  const drafted = await call(ctx, 'POST', '/v1/invoices', {
    as: vendor.owner,
    body: {
      recipientOrgId: buyer.orgId,
      dueOn: '2099-09-01',
      lines: [
        {
          description: 'Subcontract labor and materials',
          quantity: '1',
          unit: 'each',
          unitPriceMinor: amountMinor,
        },
      ],
    },
  });
  expect(drafted.statusCode, drafted.body).toBe(201);
  const invoiceId = drafted.json().id as string;
  const delivered = await call(ctx, 'POST', '/v1/invoices/' + invoiceId + '/send', {
    as: vendor.owner,
    body: {},
  });
  expect(delivered.statusCode, delivered.body).toBe(200);
  const bills = await call(ctx, 'GET', '/v1/bills', { as: buyer.owner });
  expect(bills.statusCode, bills.body).toBe(200);
  const bill = bills.json().items.find((row: { invoiceId: string }) => row.invoiceId === invoiceId);
  expect(bill).toMatchObject({ totalMinor: amountMinor, status: 'received' });
  return { billId: bill.id as string, invoiceId };
}

async function forecastFixture() {
  const buyer = await createCompany(ctx, { roles: ['estimator', 'finance'] });
  const vendor = await createCompany(ctx);
  const foreign = await createCompany(ctx);
  const as = buyer.owner;
  const path = await project(buyer, 'Forecast contract progress', 15_000_000);
  const unrelated = await project(buyer, 'Unrelated forecast scope');
  await project(foreign, 'Other company forecasts');
  await preferInbox(as);
  await preferInbox(buyer.as('finance'));
  await preferInbox(vendor.owner);
  await connectPayer(vendor, buyer);

  for (const [scope, code, label] of [
    [path, '03-30', 'Concrete'],
    [path, '06-10', 'Framing'],
    [unrelated, '09-10', 'Other job'],
  ]) {
    const codeResult = await call(ctx, 'POST', scope + '/purchase-cost-codes', {
      as,
      body: { code, label },
    });
    expect(codeResult.statusCode, codeResult.body).toBe(201);
  }
  const summary = await call(ctx, 'GET', path + '/budget', { as });
  expect(summary.statusCode, summary.body).toBe(200);
  const {
    asOf,
    availableCostCodes: [concrete, framing],
  } = summary.json();
  const other = (await call(ctx, 'GET', unrelated + '/budget', { as })).json()
    .availableCostCodes[0];
  const budget = await call(ctx, 'POST', path + '/budget', {
    as,
    headers: match(0),
    body: {
      currency: 'USD',
      effectiveOn: asOf,
      clientRequestId: randomUUID(),
    },
  });
  expect(budget.statusCode, budget.body).toBe(201);
  const budgetId = budget.json().id as string;
  const root = path + '/budget/' + budgetId;
  for (const [index, [costCodeId, amountMinor]] of [
    [concrete.id, 6_000_000],
    [framing.id, 2_000_000],
  ].entries()) {
    const saved = await call(ctx, 'POST', root + '/lines', {
      as,
      headers: match(index + 1),
      body: {
        costCodeId,
        amountMinor,
        currency: 'USD',
        description: 'Approved budget allowance',
        unit: 'lump_sum',
        phase: 'Structure',
        fundingSource: 'Base contract',
        clientRequestId: randomUUID(),
      },
    });
    expect(saved.statusCode, saved.body).toBe(201);
  }
  const url = path + '/forecasts';
  const inputs = {
    asOf,
    assumptions: 'Current vendor rates and approved structural scope.',
    assumptionsApproved: true,
    remainingCostByCode: [
      { costCodeId: concrete.id, method: 'remaining_cost', remainingMinor: 4_500_000 },
      { costCodeId: framing.id, method: 'percent_complete', percentCompleteBps: 2500 },
    ],
    clientRequestId: randomUUID(),
  };
  function forecast(body = inputs, version = 4, actor = as) {
    return call(ctx, 'POST', url, { as: actor, headers: match(version), body });
  }
  async function approveBudget() {
    const approved = await call(ctx, 'POST', root + '/approval', {
      as,
      headers: match(3),
      body: { reason: 'Scope and funding reviewed.', clientRequestId: randomUUID() },
    });
    expect(approved.statusCode, approved.body).toBe(201);
  }

  const month = asOf.slice(0, 7) + '-01';
  const actuals = path + '/actual-costs';
  const opened = await call(ctx, 'PUT', actuals + '/periods/' + month, {
    as,
    headers: match(0),
    body: { state: 'open', reason: 'Forecast period open.', clientRequestId: randomUUID() },
  });
  expect(opened.statusCode, opened.body).toBe(200);
  async function recordCost(
    amountMinor: number,
    target = { path, costCodeId: concrete.id, postingDate: asOf },
  ) {
    const actualPath = target.path + '/actual-costs';
    const delivered = await deliverBill(vendor, buyer, amountMinor);
    const approved = await call(ctx, 'POST', '/v1/bills/' + delivered.billId + '/approve', {
      as,
      body: { comment: 'Reviewed actual material expense.' },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const sources = await call(ctx, 'GET', actualPath + '/sources', { as });
    expect(sources.statusCode, sources.body).toBe(200);
    const source = sources
      .json()
      .items.find((item: { sourceId: string }) => item.sourceId === delivered.billId);
    expect(source).toBeDefined();
    const posted = await call(ctx, 'POST', actualPath, {
      as,
      headers: match(1),
      body: {
        sourceId: source.sourceId,
        sourceRevisionId: source.sourceRevisionId,
        postingDate: target.postingDate,
        allocations: [{ costCodeId: target.costCodeId, amountMinor }],
        clientRequestId: randomUUID(),
      },
    });
    expect(posted.statusCode, posted.body).toBe(201);
    return delivered;
  }

  return {
    buyer,
    vendor,
    foreign,
    as,
    path,
    unrelated,
    concrete,
    framing,
    other,
    budgetId,
    asOf,
    url,
    inputs,
    forecast,
    approveBudget,
    recordCost,
  };
}

describe('Enterprise actual bill costs', () => {
  it('posts one approved bill in an open period and preserves the exact actual cost after settlement', async () => {
    const buyer = await createCompany(ctx, { roles: ['finance', 'estimator'] });
    const vendor = await createCompany(ctx);
    const outsider = await createCompany(ctx);
    const controller = buyer.as('finance');
    const estimator = buyer.as('estimator');
    const target = await project(buyer, 'Approved material and labor postings');
    const otherProject = await project(buyer, 'Separate project allocations');
    await project(outsider, 'Foreign job cost portfolio');
    const root = target + '/actual-costs';
    await preferInbox(buyer.owner);
    await preferInbox(controller);
    await preferInbox(vendor.owner);
    await connectPayer(vendor, buyer);

    for (const [scope, code, label] of [
      [target, '03-30', 'Concrete'],
      [target, '06-10', 'Framing'],
      [otherProject, '09-10', 'Other allowance'],
    ]) {
      const created = await call(ctx, 'POST', scope + '/purchase-cost-codes', {
        as: buyer.owner,
        body: { code, label },
      });
      expect(created.statusCode, created.body).toBe(201);
    }
    const mapped = await ctx.owner.client`
      select id, code from enterprise_suite.purchase_cost_codes where org_id = ${buyer.orgId}
    `;
    const code = (value: string) => mapped.find((item) => item.code === value)?.id as string;
    const budget = await call(ctx, 'GET', target + '/budget', { as: buyer.owner });
    expect(budget.statusCode, budget.body).toBe(200);
    const postingDate = budget.json().asOf as string;
    const periodStart = postingDate.slice(0, 7) + '-01';
    const periodPath = root + '/periods/' + periodStart;
    const grants = target + '/budget/grants/' + controller.membershipId;

    expect((await call(ctx, 'GET', periodPath, { as: controller })).statusCode).toBe(404);
    const grant = await call(ctx, 'PUT', grants, {
      as: buyer.owner,
      headers: match(0),
      body: {
        active: true,
        reason: 'Controller assigned to this project.',
        clientRequestId: randomUUID(),
      },
    });
    expect(grant.statusCode, grant.body).toBe(200);
    expect((await call(ctx, 'GET', root, { as: outsider.owner })).statusCode).toBe(404);
    const first = await deliverBill(vendor, buyer, 500_002);

    const receipt = {
      state: 'open',
      reason: 'Monthly job-cost posting window.',
      clientRequestId: randomUUID(),
    };
    const changePeriod = (body = receipt, version = 0, as = controller) =>
      call(ctx, 'PUT', periodPath, { as, headers: match(version), body });
    expect((await changePeriod(receipt, 0, estimator)).statusCode).toBe(403);
    const opened = await changePeriod();
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json().period).toMatchObject({
      monthStart: periodStart,
      revision: 1,
      state: 'open',
    });
    expect((await changePeriod()).json()).toEqual(opened.json());
    expect((await changePeriod({ ...receipt, clientRequestId: randomUUID() })).statusCode).toBe(
      412,
    );
    const sources = () => call(ctx, 'GET', root + '/sources', { as: controller });
    expect((await sources()).json().items).toEqual([]);
    const data = {
      sourceId: first.billId,
      sourceRevisionId: randomUUID(),
      postingDate,
      allocations: [
        { costCodeId: code('03-30'), amountMinor: 300_000 },
        { costCodeId: code('06-10'), amountMinor: 200_002 },
      ],
      clientRequestId: randomUUID(),
    };
    const post = (body = data, expected = 1, as: TestSession = controller, route = root) =>
      call(ctx, 'POST', route, { as, headers: match(expected), body });
    expect((await post()).statusCode).toBe(404);
    const approve = async (billId: string) => {
      const approved = await call(ctx, 'POST', '/v1/bills/' + billId + '/approve', {
        as: controller,
        body: { comment: 'Vendor invoice checked against received items.' },
      });
      expect(approved.statusCode, approved.body).toBe(200);
    };
    await approve(first.billId);
    const available = await sources();
    expect(available.statusCode, available.body).toBe(200);
    expect(available.json().items).toEqual([
      expect.objectContaining({
        sourceId: first.billId,
        totalMinor: 500_002,
        status: 'approved',
        sourceRevisionId: expect.any(String),
      }),
    ]);
    data.sourceRevisionId = available.json().items[0].sourceRevisionId;
    expect((await post(data, 0)).statusCode).toBe(412);
    expect((await post(data, 1, estimator)).statusCode).toBe(403);
    expect((await post(data, 1, controller, otherProject + '/actual-costs')).statusCode).toBe(404);
    expect(
      (await post({ ...data, allocations: [{ costCodeId: code('09-10'), amountMinor: 500_002 }] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post({ ...data, allocations: [{ costCodeId: code('03-30'), amountMinor: 500_001 }] }))
        .statusCode,
    ).toBe(400);

    const [saved, repeated] = await Promise.all([post(), post()]);
    expect([saved.statusCode, repeated.statusCode].sort(), saved.body + repeated.body).toEqual([
      200, 201,
    ]);
    expect(saved.json()).toEqual(repeated.json());
    expect(saved.json()).toMatchObject({
      sourceId: first.billId,
      sourceRevisionId: data.sourceRevisionId,
      totalMinor: 500_002,
      periodStart,
      postingDate,
    });
    expect((await sources()).json().items).toEqual([]);

    const settlement = await call(ctx, 'POST', '/v1/bills/' + first.billId + '/settle', {
      as: buyer.owner,
      body: { method: 'check', reference: 'SYNTHETIC-SETTLEMENT' },
    });
    expect(settlement.statusCode, settlement.body).toBe(200);
    expect(settlement.json().status).toBe('paid');
    expect((await post()).json()).toEqual(saved.json());
    expect((await post({ ...data, clientRequestId: randomUUID() })).statusCode).toBe(409);
    const issuerLedger = await call(ctx, 'GET', '/v1/ledger', { as: vendor.owner });
    expect(issuerLedger.statusCode, issuerLedger.body).toBe(200);
    expect(
      issuerLedger
        .json()
        .entries.filter((item: { invoiceId: string }) => item.invoiceId === first.invoiceId),
    ).toHaveLength(2);
    const readCosts = await call(ctx, 'GET', target + '/budget', { as: controller });
    expect(readCosts.statusCode, readCosts.body).toBe(200);
    expect(readCosts.json().actualBillCosts).toEqual([
      {
        currency: 'USD',
        totalMinor: '500002',
        rows: [
          { costCodeId: code('03-30'), costCode: '03-30', amountMinor: '300000' },
          { costCodeId: code('06-10'), costCode: '06-10', amountMinor: '200002' },
        ],
      },
    ]);
    const postings = await call(ctx, 'GET', root, { as: controller });
    expect(postings.json().items).toEqual([saved.json()]);

    const another = await deliverBill(vendor, buyer, 120_000);
    await approve(another.billId);
    const next = (await sources()).json().items[0];
    expect(next.sourceId).toBe(another.billId);
    const closed = await changePeriod(
      {
        state: 'closed',
        reason: 'Verified reconciled period totals.',
        clientRequestId: randomUUID(),
      },
      1,
    );
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().period).toMatchObject({ state: 'closed', revision: 2 });
    expect(
      (
        await post({
          sourceId: next.sourceId,
          sourceRevisionId: next.sourceRevisionId,
          postingDate,
          allocations: [{ costCodeId: code('03-30'), amountMinor: 120_000 }],
          clientRequestId: randomUUID(),
        })
      ).statusCode,
    ).toBe(409);
    expect((await changePeriod({ ...receipt, clientRequestId: randomUUID() }, 2)).statusCode).toBe(
      409,
    );
    expect((await post()).json()).toEqual(saved.json());

    const handlers = buildTaskList({
      platformDb: ctx.platformDb.db,
      mail: ctx.mail,
      mailer: createMailerClient(null),
      config: ctx.config,
    });
    await runOnce({
      connectionString: workerConnectionString(platformTestUrl()),
      taskList: { 'cost.actual_posted': handlers['cost.actual_posted'] },
      noHandleSignals: true,
      logger: new Logger(() => () => {}),
    });
    const events = await ctx.owner.client`
      select aggregate_id, event_type, status from public.domain_events
      where org_id = ${buyer.orgId} and event_type = 'cost.actual_posted'
    `;
    expect(events).toEqual([
      { aggregate_id: saved.json().id, event_type: 'cost.actual_posted', status: 'dispatched' },
    ]);
    const notices = await ctx.owner.client`
      select recipient_membership_id from public.notifications
      where org_id = ${buyer.orgId} and dedupe_key = ${'cost.actual_posted:' + saved.json().id + ':in_app'}
    `;
    expect(notices).toEqual([{ recipient_membership_id: controller.membershipId }]);
  }, 60_000);
  it('forecasts $100,000 from $40,000 actual and $60,000 remaining and preserves the frozen result', async () => {
    const {
      buyer,
      foreign,
      as,
      framing,
      other,
      budgetId,
      asOf,
      url,
      inputs,
      forecast,
      approveBudget,
      recordCost,
    } = await forecastFixture();
    expect((await forecast()).statusCode).toBe(409);
    await approveBudget();
    expect((await forecast(inputs, 3)).statusCode).toBe(412);
    expect((await forecast(inputs, 4, buyer.as('estimator'))).statusCode).toBe(403);
    expect((await forecast({ ...inputs, assumptionsApproved: false })).statusCode).toBe(400);
    expect(
      (
        await forecast({
          ...inputs,
          remainingCostByCode: [
            { costCodeId: other.id, method: 'remaining_cost', remainingMinor: 900 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect((await call(ctx, 'GET', url, { as: foreign.owner })).statusCode).toBe(404);

    await recordCost(4_000_000);

    const incomplete = await forecast({
      ...inputs,
      remainingCostByCode: [inputs.remainingCostByCode[0]!],
      clientRequestId: randomUUID(),
    });
    expect(incomplete.statusCode, incomplete.body).toBe(201);
    expect(incomplete.json()).toMatchObject({
      status: 'incomplete',
      eacMinor: null,
      marginMinor: null,
      actualMinor: '4000000',
      knownRemainingMinor: '4500000',
      lines: expect.arrayContaining([
        {
          costCode: framing,
          method: 'missing',
          actualMinor: '0',
          approvedBudgetMinor: '2000000',
          remainingMinor: null,
          percentCompleteBps: null,
        },
      ]),
    });
    const [a, b] = await Promise.all([forecast(), forecast()]);
    expect([a.statusCode, b.statusCode].sort(), a.body + b.body).toEqual([200, 201]);
    expect(a.json()).toEqual(b.json());
    const saved = a.json();
    expect(saved).toMatchObject({
      budgetId,
      budgetVersion: 4,
      status: 'complete',
      currency: 'USD',
      actualMinor: '4000000',
      knownRemainingMinor: '6000000',
      eacMinor: '10000000',
      contractMinor: '15000000',
      marginMinor: '5000000',
      assumptions: inputs.assumptions,
      createdByUserId: as.userId,
      lines: expect.arrayContaining([
        expect.objectContaining({
          costCode: framing,
          method: 'percent_complete',
          percentCompleteBps: 2500,
          remainingMinor: '1500000',
        }),
      ]),
    });

    await recordCost(100_000);
    const updated = await forecast({ ...inputs, clientRequestId: randomUUID() });
    expect(updated.statusCode, updated.body).toBe(201);
    expect(updated.json()).toMatchObject({ actualMinor: '4100000', eacMinor: '10100000' });
    const recent = await call(ctx, 'GET', url + '?limit=2', { as });
    expect(recent.statusCode, recent.body).toBe(200);
    const page = recent.json();
    expect(page.items).toEqual([updated.json(), saved]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const next = await call(ctx, 'GET', url + '?cursor=' + encodeURIComponent(page.nextCursor), {
      as,
    });
    expect(next.json().items).toEqual([incomplete.json()]);
    const earlier = new Date(asOf + 'T00:00:00Z');
    earlier.setUTCDate(earlier.getUTCDate() - 1);
    const historical = await call(ctx, 'GET', url + '?asOf=' + earlier.toISOString().slice(0, 10), {
      as,
    });
    expect(historical.statusCode, historical.body).toBe(200);
    expect(historical.json().items).toEqual([]);
    expect((await forecast()).json()).toEqual(saved);

    const handlers = buildTaskList({
      platformDb: ctx.platformDb.db,
      mail: ctx.mail,
      mailer: createMailerClient(null),
      config: ctx.config,
    });
    await runOnce({
      connectionString: workerConnectionString(platformTestUrl()),
      taskList: { 'forecast.snapshot_created': handlers['forecast.snapshot_created'] },
      noHandleSignals: true,
      logger: new Logger(() => () => {}),
    });
    const events = await ctx.owner.client`
      select status from public.domain_events
      where org_id = ${buyer.orgId} and event_type = 'forecast.snapshot_created'
    `;
    expect(events).toEqual([
      { status: 'dispatched' },
      { status: 'dispatched' },
      { status: 'dispatched' },
    ]);
    const notices = await ctx.owner.client`
      select recipient_membership_id, title from public.notifications
      where org_id = ${buyer.orgId} and dedupe_key like 'forecast.snapshot_created:%:in_app'
    `;
    expect(notices).toHaveLength(3);
    expect(notices.every((notice) => notice.recipient_membership_id === as.membershipId)).toBe(
      true,
    );
    expect(
      notices.filter((notice) => notice.title === 'Project cost forecast needs estimates'),
    ).toHaveLength(1);
  }, 60_000);
  it('runs an isolated forecast scenario without changing either populated ledger checksum', async () => {
    const {
      buyer,
      vendor,
      foreign,
      as,
      path,
      unrelated,
      concrete,
      other,
      forecast,
      approveBudget,
      recordCost,
    } = await forecastFixture();
    await approveBudget();
    const firstActual = await recordCost(4_000_000);
    const created = await forecast();
    expect(created.statusCode, created.body).toBe(201);
    const saved = created.json();
    await recordCost(100_000);

    async function ledgerChecksum() {
      const projectPostings = await ctx.owner.client`
        select id, bill_id, approval_event_id, total_minor, posting_on
        from enterprise_suite.actual_bill_postings where org_id = ${buyer.orgId} order by id
      `;
      const splits = await ctx.owner.client`
        select posting_id, cost_code_id, amount_minor
        from enterprise_suite.actual_bill_allocations where org_id = ${buyer.orgId}
        order by posting_id, cost_code_id
      `;
      const accounts = await ctx.owner.client`
        select id, transaction_id, account, direction, amount_minor
        from public.ledger_entries where org_id in (${vendor.orgId}, ${buyer.orgId}) order by id
      `;
      expect(projectPostings).toHaveLength(2);
      expect(splits).toHaveLength(2);
      expect(accounts).toHaveLength(2);
      return createHash('sha256')
        .update(JSON.stringify({ projectPostings, splits, accounts }))
        .digest('hex');
    }
    const settled = await call(ctx, 'POST', '/v1/bills/' + firstActual.billId + '/settle', {
      as,
      body: { method: 'check', reference: 'SCENARIO-LEDGER-FIXTURE' },
    });
    expect(settled.statusCode, settled.body).toBe(200);
    const beforeScenario = await ledgerChecksum();
    const scenarios = path + '/cost-scenarios';
    const scenario = {
      forecastId: saved.id,
      scenarioName: 'Higher concrete remaining allowance',
      overrides: [{ costCodeId: concrete.id, method: 'remaining_cost', remainingMinor: 5_000_000 }],
      clientRequestId: randomUUID(),
    };
    const run = (body = scenario, version = 4, actor = as, route = scenarios) =>
      call(ctx, 'POST', route, { as: actor, headers: match(version), body });
    expect((await run(scenario, 4, buyer.as('estimator'))).statusCode).toBe(403);
    expect((await run(scenario, 4, foreign.owner)).statusCode).toBe(404);
    expect((await run(scenario, 4, as, unrelated + '/cost-scenarios')).statusCode).toBe(404);
    const controller = buyer.as('finance');
    expect((await run(scenario, 4, controller)).statusCode).toBe(404);
    expect((await run(scenario, 3)).statusCode).toBe(412);
    expect((await run({ ...scenario, forecastId: randomUUID() })).statusCode).toBe(404);
    expect(
      (
        await run({
          ...scenario,
          overrides: [{ ...scenario.overrides[0]!, costCodeId: other.id }],
        })
      ).statusCode,
    ).toBe(400);
    const saveScenario = await Promise.all([run(), run()]);
    expect(saveScenario.map((result) => result.statusCode).sort()).toEqual([200, 201]);
    const succeeded = saveScenario[0]!.json();
    expect(saveScenario[1]!.json()).toEqual(succeeded);
    expect(succeeded).toMatchObject({
      forecastId: saved.id,
      sourceVersion: 4,
      status: 'complete',
      actualMinor: '4000000',
      knownRemainingMinor: '6500000',
      priorEacMinor: '10000000',
      eacMinor: '10500000',
      eacDifferenceMinor: '500000',
      priorMarginMinor: '5000000',
      marginMinor: '4500000',
    });
    const list = await call(ctx, 'GET', scenarios + '?forecastId=' + saved.id, { as });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items).toEqual([succeeded]);
    expect(
      (await call(ctx, 'POST', scenarios + '/' + succeeded.id + '/post', { as, body: {} }))
        .statusCode,
    ).toBe(404);
    expect(await ledgerChecksum()).toBe(beforeScenario);
    expect((await forecast()).json()).toEqual(saved);

    const grant = await call(ctx, 'PUT', path + '/budget/grants/' + controller.membershipId, {
      as,
      headers: match(0),
      body: { active: true, reason: 'Finance review is assigned.', clientRequestId: randomUUID() },
    });
    expect(grant.statusCode, grant.body).toBe(200);
    const unchanged = await run(
      {
        ...scenario,
        scenarioName: 'Review unchanged assumptions',
        overrides: [],
        clientRequestId: randomUUID(),
      },
      4,
      controller,
    );
    expect(unchanged.statusCode, unchanged.body).toBe(201);
    expect(unchanged.json()).toMatchObject({
      eacMinor: '10000000',
      eacDifferenceMinor: '0',
      createdByUserId: controller.userId,
    });
    const handlers = buildTaskList({
      platformDb: ctx.platformDb.db,
      mail: ctx.mail,
      mailer: createMailerClient(null),
      config: ctx.config,
    });
    await runOnce({
      connectionString: workerConnectionString(platformTestUrl()),
      taskList: { 'forecast.scenario_created': handlers['forecast.scenario_created'] },
      noHandleSignals: true,
      logger: new Logger(() => () => {}),
    });
    const events = await ctx.owner.client`
      select status from public.domain_events
      where org_id = ${buyer.orgId} and event_type = 'forecast.scenario_created'
    `;
    expect(events).toEqual([{ status: 'dispatched' }, { status: 'dispatched' }]);
    const notices = await ctx.owner.client`
      select recipient_membership_id from public.notifications
      where org_id = ${buyer.orgId} and dedupe_key like 'forecast.scenario_created:%:in_app'
    `;
    expect(notices.map(({ recipient_membership_id }) => recipient_membership_id).sort()).toEqual(
      [as.membershipId, controller.membershipId].sort(),
    );
    expect(await ledgerChecksum()).toBe(beforeScenario);
  }, 60_000);
  it('lists only granted finance projects with current versions and scoped source activity', async () => {
    const {
      buyer,
      foreign,
      as,
      path,
      unrelated,
      budgetId,
      asOf,
      approveBudget,
      recordCost,
      forecast,
    } = await forecastFixture();
    const projectId = path.split('/').at(-1)!;
    const unrelatedId = unrelated.split('/').at(-1)!;
    const finance = buyer.as('finance');
    const portfolio = '/v1/enterprise/finance/projects';
    const activityPath = portfolio + '/' + projectId + '/activity';
    const fetch = (url = portfolio, actor = as) => call(ctx, 'GET', url, { as: actor });
    const draft = await fetch(portfolio + '?projectId=' + projectId);
    expect(draft.statusCode, draft.body).toBe(200);
    expect(draft.json()).toMatchObject({
      items: [
        { id: projectId, budget: { id: budgetId, state: 'draft', version: 3 }, forecast: null },
      ],
    });
    expect((await fetch(portfolio, finance)).json()).toEqual({ items: [], nextCursor: null });
    expect((await fetch(activityPath, finance)).statusCode).toBe(404);
    expect((await fetch(activityPath, foreign.owner)).statusCode).toBe(404);
    expect(
      (await fetch(portfolio + '?projectId=' + projectId, foreign.owner)).json().items,
    ).toEqual([]);

    await approveBudget();
    await recordCost(4_000_000);
    const saved = await forecast();
    expect(saved.statusCode, saved.body).toBe(201);
    const [posting] = await ctx.owner.client`
      select id from enterprise_suite.actual_bill_postings
      where org_id = ${buyer.orgId} and project_id = ${projectId}
    `;
    const current = {
      id: projectId,
      name: 'Forecast contract progress',
      budget: { id: budgetId, currency: 'USD', state: 'approved', version: 4 },
      forecast: {
        id: saved.json().id,
        asOf,
        status: 'complete',
        eacMinor: '10000000',
        currency: 'USD',
      },
    };
    const page = await fetch(portfolio + '?limit=1');
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json().nextCursor).toEqual(expect.any(String));
    const next = await fetch(
      portfolio + '?limit=1&cursor=' + encodeURIComponent(page.json().nextCursor),
    );
    expect(next.statusCode, next.body).toBe(200);
    expect(next.json().nextCursor).toBeNull();
    expect([...page.json().items, ...next.json().items]).toEqual(
      expect.arrayContaining([
        current,
        { id: unrelatedId, name: 'Unrelated forecast scope', budget: null, forecast: null },
      ]),
    );

    const grant = (active: boolean, revision: number) =>
      call(ctx, 'PUT', path + '/budget/grants/' + finance.membershipId, {
        as,
        headers: match(revision),
        body: {
          active,
          reason: active ? 'Assigned finance review.' : 'Review reassigned.',
          clientRequestId: randomUUID(),
        },
      });
    expect((await grant(true, 0)).statusCode).toBe(200);
    expect((await fetch(portfolio, finance)).json()).toEqual({
      items: [current],
      nextCursor: null,
    });
    expect((await fetch(portfolio + '?projectId=' + unrelatedId, finance)).json().items).toEqual(
      [],
    );
    const activity = await fetch(activityPath, finance);
    expect(activity.statusCode, activity.body).toBe(200);
    expect(activity.headers['cache-control']).toBe('private, no-store');
    expect(activity.json()).toMatchObject({
      projectId,
      currentVariances: [],
      activity: [
        { kind: 'forecast_saved', recordId: saved.json().id },
        { kind: 'bill_posted', recordId: posting!.id },
        { kind: 'baseline_approved' },
      ],
    });
    expect((await fetch(portfolio + '/' + unrelatedId + '/activity')).json().activity).toEqual([]);
    expect((await grant(false, 1)).statusCode).toBe(200);
    expect((await fetch(activityPath, finance)).statusCode).toBe(404);
    expect((await fetch(portfolio, finance)).json().items).toEqual([]);
  }, 60_000);

  it('queues and downloads a stamped WIP report that reconciles posted amounts and flags the missing forecast', async () => {
    const {
      buyer,
      foreign,
      as,
      path,
      unrelated,
      concrete,
      other,
      asOf,
      forecast,
      approveBudget,
      recordCost,
    } = await forecastFixture();
    await approveBudget();
    const monthStart = asOf.slice(0, 7) + '-01';
    const oldDate = new Date(monthStart + 'T00:00:00Z');
    oldDate.setUTCMonth(oldDate.getUTCMonth() - 1);
    const earlierMonth = oldDate.toISOString().slice(0, 10);
    const prior = await call(ctx, 'PUT', path + '/actual-costs/periods/' + earlierMonth, {
      as,
      headers: match(0),
      body: {
        state: 'open',
        reason: 'Open prior month for reconciliation.',
        clientRequestId: randomUUID(),
      },
    });
    expect(prior.statusCode, prior.body).toBe(200);
    const earlier = await recordCost(300_000, {
      path,
      costCodeId: concrete.id,
      postingDate: earlierMonth.slice(0, 8) + '15',
    });
    const current = await recordCost(3_700_000);
    const unforecast = await recordCost(200_000, {
      path: unrelated,
      costCodeId: other.id,
      postingDate: asOf,
    });
    const savedForecast = await forecast();
    expect(savedForecast.statusCode, savedForecast.body).toBe(201);
    expect(savedForecast.json()).toMatchObject({ actualMinor: '4000000', eacMinor: '10000000' });
    const root = '/v1/enterprise/finance/wip';
    const controller = buyer.as('finance');
    const firstProjectId = path.split('/').at(-1)!;
    const secondProjectId = unrelated.split('/').at(-1)!;
    const period = await call(ctx, 'GET', path + '/actual-costs/periods/' + monthStart, { as });
    expect(period.statusCode, period.body).toBe(200);
    const openPeriodId = period.json().period.id as string;
    const closed = await call(ctx, 'PUT', path + '/actual-costs/periods/' + monthStart, {
      as,
      headers: match(1),
      body: {
        state: 'closed',
        reason: 'Close current WIP reporting period.',
        clientRequestId: randomUUID(),
      },
    });
    expect(closed.statusCode, closed.body).toBe(200);
    const periodId = closed.json().period.id as string;
    const data = {
      periodId,
      projectIds: [firstProjectId, secondProjectId],
      methodologyVersion: 'bill-cost-to-cost-v1',
      clientRequestId: randomUUID(),
    };
    const queue = (body = data, expected = 2, actor = controller) =>
      call(ctx, 'POST', root, { as: actor, headers: match(expected), body });
    expect((await queue()).statusCode).toBe(404);
    expect((await queue(data, 2, buyer.as('estimator'))).statusCode).toBe(403);
    async function grant(route: string, active: boolean, revision: number) {
      const response = await call(ctx, 'PUT', route + '/budget/grants/' + controller.membershipId, {
        as,
        headers: match(revision),
        body: {
          active,
          reason: 'Manage scoped WIP access for the controller.',
          clientRequestId: randomUUID(),
        },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    await grant(path, true, 0);
    await grant(unrelated, true, 0);
    const options = await call(ctx, 'GET', root + '/options', { as: controller });
    expect(options.statusCode, options.body).toBe(200);
    expect(
      options
        .json()
        .projects.map((item: { id: string }) => item.id)
        .sort(),
    ).toEqual([firstProjectId, secondProjectId].sort());
    expect(options.json().periods[0]).toMatchObject({
      monthStart,
      state: 'closed',
      revision: 2,
      id: periodId,
    });
    expect((await queue({ ...data, periodId: openPeriodId }, 1)).statusCode).toBe(412);
    expect((await queue({ ...data, methodologyVersion: 'unknown' })).statusCode).toBe(400);
    const [first, retry] = await Promise.all([queue(), queue()]);
    expect([first.statusCode, retry.statusCode].sort(), first.body + retry.body).toEqual([
      200, 202,
    ]);
    expect(first.json()).toEqual(retry.json());
    const receipt = first.json();
    expect(receipt.status).toBe('queued');
    expect(receipt.request.currencyTotals).toEqual([
      { currency: 'USD', periodMinor: '3900000', totalThroughPeriodMinor: '4200000' },
    ]);
    const completedProject = receipt.request.rows.find(
      (row: { projectId: string }) => row.projectId === firstProjectId,
    );
    expect(completedProject).toMatchObject({
      sourceForecastId: savedForecast.json().id,
      sourceBudgetVersion: 4,
      estimatedAtCompletionMinor: '10000000',
      percentCompleteBps: 4000,
      earnedToDateMinor: '6000000',
      issues: [],
      currencyTotals: [
        { currency: 'USD', periodMinor: '3700000', totalThroughPeriodMinor: '4000000' },
      ],
    });
    expect(
      completedProject.postingSources.map((row: { sourceId: string; inPeriod: boolean }) => [
        row.sourceId,
        row.inPeriod,
      ]),
    ).toEqual([
      [earlier.billId, false],
      [current.billId, true],
    ]);
    const incomplete = receipt.request.rows.find(
      (row: { projectId: string }) => row.projectId === secondProjectId,
    );
    expect(incomplete).toMatchObject({
      issues: ['missing_forecast'],
      earnedToDateMinor: null,
      postingSources: [
        { sourceId: unforecast.billId, recordedMinor: '200000', allocatedMinor: '200000' },
      ],
    });
    const report = root + '/' + receipt.id;
    const download = () => call(ctx, 'GET', report + '/file', { as: controller });
    expect((await download()).statusCode).toBe(409);
    expect((await call(ctx, 'GET', report, { as: foreign.owner })).statusCode).toBe(404);
    expect((await call(ctx, 'GET', report, { as })).statusCode).toBe(404);

    const handlers = buildTaskList({
      platformDb: ctx.platformDb.db,
      mail: ctx.mail,
      mailer: createMailerClient(null),
      config: ctx.config,
    });
    await runOnce({
      connectionString: workerConnectionString(platformTestUrl()),
      taskList: { 'finance.wip_export': handlers['finance.wip_export'] },
      noHandleSignals: true,
      logger: new Logger(() => () => {}),
    });
    const ready = await call(ctx, 'GET', report, { as: controller });
    expect(ready.statusCode, ready.body).toBe(200);
    expect(ready.json()).toMatchObject({
      status: 'ready',
      request: receipt.request,
      digest: expect.any(String),
    });
    const file = await download();
    expect(file.statusCode, file.body).toBe(200);
    expect(file.headers['content-type']).toContain('text/csv');
    expect(file.headers.etag).toBe(
      '"' + createHash('sha256').update(file.body).digest('hex') + '"',
    );
    expect(file.headers.etag).toBe('"' + ready.json().digest + '"');
    const [header, ...csv] = file.body.trimEnd().split('\r\n');
    const names = header!.split(',');
    const values = (line: string) =>
      Object.fromEntries(line.split(',').map((field, index) => [names[index], field]));
    const rows = csv.map(values);
    expect(rows.find((row) => row.record_type === 'report_currency_total')).toMatchObject({
      period_start: monthStart,
      period_actual_minor: '3900000',
      cumulative_actual_minor: '4200000',
      methodology: 'bill-cost-to-cost-v1',
      captured_at: receipt.request.capturedAt,
    });
    const postingRows = rows.filter((row) => row.record_type === 'bill_posting');
    expect(postingRows).toHaveLength(3);
    for (const row of receipt.request.rows.flatMap(
      (project: {
        postingSources: Array<{
          postingId: string;
          sourceId: string;
          sourceRevisionId: string;
          recordedMinor: string;
        }>;
      }) => project.postingSources,
    )) {
      expect(postingRows).toContainEqual(
        expect.objectContaining({
          posting_id: row.postingId,
          source_bill_id: row.sourceId,
          source_approval_id: row.sourceRevisionId,
          recorded_minor: row.recordedMinor,
        }),
      );
    }
    expect(
      rows.some((row) => row.project_id === secondProjectId && row.issues === 'missing_forecast'),
    ).toBe(true);
    const outbox = await ctx.owner.client`
      select status from public.domain_events where org_id = ${buyer.orgId} and event_type = 'finance.wip_export'
    `;
    expect(outbox).toEqual([{ status: 'dispatched' }]);
    expect((await queue()).json().id).toBe(receipt.id);
    await grant(path, false, 1);
    expect((await download()).statusCode).toBe(404);
    expect((await call(ctx, 'GET', root, { as: controller })).json().items).toEqual([]);
  }, 60_000);
});
