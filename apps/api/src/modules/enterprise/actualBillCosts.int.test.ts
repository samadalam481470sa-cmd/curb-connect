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
const match = (revision: number) => ({ 'if-match': String(revision) });

beforeAll(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  const ids = [...ctx.tracked.orgIds];
  if (ids.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
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

async function project(company: Company, name: string) {
  if (!(await call(ctx, 'GET', '/v1/enterprise/status', { as: company.owner })).json().enabled) {
    const enabled = await call(ctx, 'PUT', '/v1/enterprise/status', {
      as: company.owner,
      body: { enabled: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
  }
  const result = await call(ctx, 'POST', projects, { as: company.owner, body: { name } });
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
});
