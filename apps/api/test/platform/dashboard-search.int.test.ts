// Regression tests for the home dashboard queues and universal search. They run against the real
// database through the restricted app role, so a pass means the company sees only its own live
// records, with the same RLS and permission rules as the deployed API.
import type { DashboardResponseSchema, SearchResponseSchema } from '@fieldline/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { type Company, type TestContext, call, createCompany, createTestContext } from '../helpers';

type Dashboard = z.infer<typeof DashboardResponseSchema>;
type SearchBody = z.infer<typeof SearchResponseSchema>;

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.cleanup();
});
afterAll(async () => {
  await ctx?.close();
});

/**
 * Records are inserted with the owner connection (fixtures only); the code under test reads them
 * through the app role. Only some modules expose create routes today, so the queues that depend on
 * them are seeded directly.
 */
async function seedRecords(company: Company) {
  const orgId = company.orgId;
  const [lead] = await ctx.owner.client<{ id: string }[]>`
    insert into leads (org_id, source, status, summary)
    values (${orgId}::uuid, 'web_form', 'new', 'Leaking flat roof at 12 Elm Street')
    returning id`;
  const [customer] = await ctx.owner.client<{ id: string }[]>`
    insert into customers (org_id, kind, display_name, company_name)
    values (${orgId}::uuid, 'business', 'Northgate Property Group', 'Northgate Property Group')
    returning id`;
  const [invoice] = await ctx.owner.client<{ id: string }[]>`
    insert into invoices (org_id, number, kind, status, due_on, total_minor)
    values (${orgId}::uuid, 'INV-TEST-0001', 'progress', 'issued', current_date - 10, 250000)
    returning id`;
  const [proposal] = await ctx.owner.client<{ id: string }[]>`
    insert into proposals (org_id, number, customer_id, title, status)
    values (${orgId}::uuid, 'PROP-TEST-0001', ${customer!.id}::uuid, 'Roof replacement', 'sent')
    returning id`;
  const [property] = await ctx.owner.client<{ id: string }[]>`
    insert into properties (org_id, original_query, locality, region)
    values (${orgId}::uuid, '12 Elm Street, Fort Worth, TX', 'Fort Worth', 'TX')
    returning id`;
  const [roofOrder] = await ctx.owner.client<{ id: string }[]>`
    insert into roof_orders (org_id, number, property_id, mode, status)
    values (${orgId}::uuid, 'ROOF-TEST-0001', ${property!.id}::uuid, 'diy', 'review_required')
    returning id`;
  const [task] = await ctx.owner.client<{ id: string }[]>`
    insert into tasks (org_id, title, status, assignee_membership_id)
    values (${orgId}::uuid, 'Call the homeowner back', 'open', ${company.owner.membershipId}::uuid)
    returning id`;
  return {
    lead: lead!.id,
    customer: customer!.id,
    invoice: invoice!.id,
    proposal: proposal!.id,
    property: property!.id,
    roofOrder: roofOrder!.id,
    task: task!.id,
  };
}

function queueOf(body: Dashboard, key: string) {
  return body.queues.find((queue) => queue.key === key);
}

describe('Home dashboard queues', () => {
  it('returns every contract queue with live counts for the company records', async () => {
    const company = await createCompany(ctx);
    const seeded = await seedRecords(company);

    const res = await call(ctx, 'GET', '/v1/dashboard', { as: company.owner });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Dashboard;
    expect(body.queues).toHaveLength(9);
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);

    expect(queueOf(body, 'leads_new')).toMatchObject({ count: 1 });
    expect(queueOf(body, 'leads_new')?.items[0]).toMatchObject({
      subjectType: 'lead',
      subjectId: seeded.lead,
      status: 'new',
      href: '/leads',
    });
    expect(queueOf(body, 'roof_reviews')).toMatchObject({ count: 1 });
    expect(queueOf(body, 'roof_reviews')?.items[0]?.subjectId).toBe(seeded.roofOrder);
    expect(queueOf(body, 'invoices_overdue')).toMatchObject({ count: 1 });
    expect(queueOf(body, 'invoices_overdue')?.items[0]?.subjectId).toBe(seeded.invoice);
    expect(queueOf(body, 'proposals_awaiting_response')).toMatchObject({ count: 1 });
    expect(queueOf(body, 'proposals_awaiting_response')?.items[0]?.subjectId).toBe(seeded.proposal);
    expect(queueOf(body, 'my_tasks')).toMatchObject({ count: 1 });
    expect(queueOf(body, 'my_tasks')?.items[0]?.subjectId).toBe(seeded.task);
    // No invented work: queues with no matching rows report zero.
    expect(queueOf(body, 'permits_expiring')).toMatchObject({ count: 0, items: [] });
    expect(queueOf(body, 'dispatch_blocked')).toMatchObject({ count: 0, items: [] });
  });

  it("never counts another company's records", async () => {
    const owner = await createCompany(ctx);
    await seedRecords(owner);
    const other = await createCompany(ctx);

    const res = await call(ctx, 'GET', '/v1/dashboard', { as: other.owner });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Dashboard;
    for (const key of ['leads_new', 'roof_reviews', 'invoices_overdue', 'my_tasks']) {
      expect(queueOf(body, key)?.count, key).toBe(0);
    }
  });

  it('hides invoice queues from roles without invoice access instead of faking zero', async () => {
    const company = await createCompany(ctx, { roles: ['estimator'] });
    await seedRecords(company);

    const res = await call(ctx, 'GET', '/v1/dashboard', { as: company.as('estimator') });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Dashboard;
    const invoiceQueue = queueOf(body, 'invoices_overdue');
    expect(invoiceQueue?.count).toBe(0);
    expect(invoiceQueue?.label).toContain('not available for your role');
    // Non-financial queues still work for the same role.
    expect(queueOf(body, 'leads_new')?.count).toBe(1);
  });
});

describe('Tenant-scoped search', () => {
  it('finds records from every area and links to the screen that owns them', async () => {
    const company = await createCompany(ctx);
    await seedRecords(company);
    const job = await call(ctx, 'POST', '/v1/jobs', {
      as: company.owner,
      body: { title: 'Elm Street roof replacement', productLine: 'roof' },
    });
    expect(job.statusCode).toBe(201);

    const res = await call(ctx, 'GET', '/v1/search?q=Elm', { as: company.owner });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SearchBody;
    const byType = new Map(body.results.map((result) => [result.type, result]));
    expect([...byType.keys()].sort()).toEqual(['job', 'lead', 'property']);
    expect(byType.get('job')?.href).toBe('/jobs');
    expect(byType.get('lead')?.href).toBe('/leads');
    expect(byType.get('property')?.href).toBe('/roof');
    expect(byType.get('property')?.title).toBe('12 Elm Street, Fort Worth, TX');

    const invoice = await call(ctx, 'GET', '/v1/search?q=INV-TEST', { as: company.owner });
    expect((invoice.json() as SearchBody).results).toMatchObject([
      { type: 'invoice', title: 'Invoice INV-TEST-0001', href: '/invoice-dashboard' },
    ]);
  });

  it('applies the requested type filter', async () => {
    const company = await createCompany(ctx);
    await seedRecords(company);
    const res = await call(ctx, 'GET', '/v1/search?q=Elm&types=property', { as: company.owner });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SearchBody;
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.type).toBe('property');
  });

  it("never returns another company's records", async () => {
    const owner = await createCompany(ctx);
    await seedRecords(owner);
    const other = await createCompany(ctx);

    const res = await call(ctx, 'GET', '/v1/search?q=Northgate', { as: other.owner });
    expect(res.statusCode).toBe(200);
    expect((res.json() as SearchBody).results).toEqual([]);
  });

  it('omits invoice matches for roles without invoice access', async () => {
    const company = await createCompany(ctx, { roles: ['estimator'] });
    await seedRecords(company);

    const owner = await call(ctx, 'GET', '/v1/search?q=INV-TEST', { as: company.owner });
    expect((owner.json() as SearchBody).results).not.toHaveLength(0);
    const estimator = await call(ctx, 'GET', '/v1/search?q=INV-TEST', {
      as: company.as('estimator'),
    });
    expect(estimator.statusCode).toBe(200);
    expect((estimator.json() as SearchBody).results).toEqual([]);
  });

  it('rejects a query shorter than two characters', async () => {
    const company = await createCompany(ctx);
    const res = await call(ctx, 'GET', '/v1/search?q=a', { as: company.owner });
    expect(res.statusCode).toBe(400);
  });
});
