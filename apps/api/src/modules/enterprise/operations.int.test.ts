import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  createCompany,
  createTestContext,
  type Company,
  type TestContext,
} from '../../../test/helpers';

let ctx: TestContext;
const queue = '/v1/enterprise/change-orders';
const projectRoute = '/v1/enterprise/projects';

beforeAll(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (sql) => {
      await sql`set local session_replication_role = replica`;
      await sql`delete from enterprise_suite.audit_events where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.change_orders where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.punch_items where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.projects where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});

afterAll(async () => {
  await ctx?.close();
});

async function project(company: Company, name: string): Promise<string> {
  const enabled = await call(ctx, 'PUT', '/v1/enterprise/status', {
    as: company.owner,
    body: { enabled: true },
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  const created = await call(ctx, 'POST', projectRoute, {
    as: company.owner,
    body: { name, originalContractMinor: 100_000 },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().id;
}

async function createOrder(company: Company, projectId: string, title: string): Promise<string> {
  const reply = await call(ctx, 'POST', projectRoute + '/' + projectId + '/change-orders', {
    as: company.owner,
    body: { number: 'PCO-01', title, description: 'New fixture scope', amountDeltaMinor: 24_000 },
  });
  expect(reply.statusCode, reply.body).toBe(201);
  return reply.json().id;
}

describe('Enterprise change orders', () => {
  it('paginates and filters tenant records and refuses cross-company links', async () => {
    const a = await createCompany(ctx);
    const b = await createCompany(ctx);
    const projectA = await project(a, 'North project');
    const secondProjectA = await project(a, 'South project');
    const projectB = await project(b, 'Private project');
    const first = await createOrder(a, projectA, 'Fixture walls');
    const second = await createOrder(a, secondProjectA, 'Fixture trim');
    const privateOrder = await createOrder(b, projectB, 'Private change');

    const page1 = await call(ctx, 'GET', queue + '?limit=1', { as: a.owner });
    expect(page1.statusCode, page1.body).toBe(200);
    const { items, nextCursor } = page1.json();
    expect(items).toHaveLength(1);
    expect(typeof nextCursor).toBe('string');
    const page2 = await call(ctx, 'GET', queue + '?limit=1&cursor=' + nextCursor, { as: a.owner });
    expect(page2.statusCode, page2.body).toBe(200);
    expect(page2.json().nextCursor).toBeNull();
    expect(new Set([items[0].order.id, page2.json().items[0].order.id])).toEqual(
      new Set([first, second]),
    );

    const filtered = await call(
      ctx,
      'GET',
      queue + '?projectId=' + projectA + '&search=NORTH&status=pco_draft',
      { as: a.owner },
    );
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json().items).toMatchObject([
      { order: { id: first }, projectName: 'North project' },
    ]);
    expect((await call(ctx, 'GET', queue + '?search=%25', { as: a.owner })).json().items).toEqual(
      [],
    );
    expect((await call(ctx, 'GET', queue + '/' + privateOrder, { as: a.owner })).statusCode).toBe(
      404,
    );
    expect(
      (await call(ctx, 'GET', queue + '?projectId=' + projectB, { as: a.owner })).statusCode,
    ).toBe(404);
  });

  it('shows immutable decision history and counts the approved amount once', async () => {
    const company = await createCompany(ctx, { roles: ['estimator'] });
    const projectId = await project(company, 'Change history project');
    const id = await createOrder(company, projectId, 'Fixture update');
    const details = queue + '/' + id;
    const statusUrl = details + '/status';
    const stages = ['pricing_requested', 'priced', 'submitted_to_owner'];
    for (const [index, status] of stages.entries()) {
      const reply = await call(ctx, 'PATCH', statusUrl, {
        as: company.owner,
        headers: { 'if-match': '"' + (index + 1) + '"' },
        body: { status },
      });
      expect(reply.statusCode, reply.body).toBe(200);
    }
    const decision = { headers: { 'if-match': '"4"' }, body: { status: 'approved' } };
    expect(
      (await call(ctx, 'PATCH', statusUrl, { as: company.as('estimator'), ...decision }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(ctx, 'PATCH', statusUrl, { as: company.owner, ...decision })).statusCode,
    ).toBe(200);
    expect(
      (await call(ctx, 'PATCH', statusUrl, { as: company.owner, ...decision })).statusCode,
    ).toBe(412);

    const detail = await call(ctx, 'GET', details, { as: company.owner });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().order).toMatchObject({ status: 'approved', revision: 5 });
    expect(detail.json().history).toMatchObject([
      {
        previousStatus: 'submitted_to_owner',
        status: 'approved',
        revision: 5,
        actorUserId: company.owner.userId,
      },
      { previousStatus: 'priced', status: 'submitted_to_owner', revision: 4 },
      { previousStatus: 'pricing_requested', status: 'priced', revision: 3 },
      { previousStatus: 'pco_draft', status: 'pricing_requested', revision: 2 },
      { action: 'pco.created', previousStatus: null, status: 'pco_draft', revision: 1 },
    ]);
    const record = await call(ctx, 'GET', projectRoute + '/' + projectId + '/records', {
      as: company.owner,
    });
    expect(record.json().summary).toMatchObject({
      approvedChangeMinor: 24_000,
      revisedContractMinor: 124_000,
    });
  });
});

describe('Enterprise punch items', () => {
  it('keeps the punch list scoped to its project and deduplicates concurrent creates', async () => {
    const company = await createCompany(ctx);
    const outside = await createCompany(ctx);
    const projectId = await project(company, 'Room finish work');
    const outsideProject = await project(outside, 'Outside checklist');
    const url = projectRoute + '/' + projectId + '/punch-items';
    const payload = {
      title: 'Touch up finish',
      description: 'Repair wall finish beside the outlet',
      location: 'Kitchen',
      dueDate: '2026-12-15',
      clientRequestId: randomUUID(),
    };
    const [first, second] = await Promise.all([
      call(ctx, 'POST', url, { as: company.owner, body: payload }),
      call(ctx, 'POST', url, { as: company.owner, body: payload }),
    ]);
    expect([first.statusCode, second.statusCode].sort(), first.body + second.body).toEqual([
      200, 201,
    ]);
    expect(first.json().id).toBe(second.json().id);
    expect(first.json()).toMatchObject({ status: 'open', revision: 1, dueDate: '2026-12-15' });
    const list = await call(ctx, 'GET', url, { as: company.owner });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(
      (await call(ctx, 'GET', url + '?status=closed', { as: company.owner })).json().items,
    ).toEqual([]);
    expect(
      (
        await call(ctx, 'GET', projectRoute + '/' + outsideProject + '/punch-items', {
          as: company.owner,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(ctx, 'PATCH', '/v1/enterprise/punch-items/' + first.json().id + '/status', {
          as: outside.owner,
          headers: { 'if-match': '"1"' },
          body: { status: 'in_progress' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('requires a reviewer and a current revision to verify completed work', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const projectId = await project(company, 'Finish verification');
    const create = await call(ctx, 'POST', projectRoute + '/' + projectId + '/punch-items', {
      as: company.owner,
      body: {
        title: 'Replace trim',
        description: 'Replace the trim at the jamb',
        location: 'Hall',
        clientRequestId: randomUUID(),
      },
    });
    expect(create.statusCode, create.body).toBe(201);
    const url = '/v1/enterprise/punch-items/' + create.json().id + '/status';
    const start = await call(ctx, 'PATCH', url, {
      as: company.as('estimator'),
      headers: { 'if-match': '"1"' },
      body: { status: 'in_progress' },
    });
    expect(start.statusCode, start.body).toBe(200);
    const review = await call(ctx, 'PATCH', url, {
      as: company.as('estimator'),
      headers: { 'if-match': '"2"' },
      body: { status: 'ready_for_review' },
    });
    expect(review.statusCode, review.body).toBe(200);
    const close = { status: 'closed', reviewNote: 'Trim checked against the scope.' };
    expect(
      (
        await call(ctx, 'PATCH', url, {
          as: company.as('estimator'),
          headers: { 'if-match': '"3"' },
          body: close,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(ctx, 'PATCH', url, {
          as: company.as('reviewer'),
          headers: { 'if-match': '"2"' },
          body: close,
        })
      ).statusCode,
    ).toBe(412);
    expect(
      (
        await call(ctx, 'PATCH', url, {
          as: company.as('reviewer'),
          headers: { 'if-match': '"3"' },
          body: { status: 'closed' },
        })
      ).statusCode,
    ).toBe(400);
    const closed = await call(ctx, 'PATCH', url, {
      as: company.as('reviewer'),
      headers: { 'if-match': '"3"' },
      body: close,
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toMatchObject({
      status: 'closed',
      revision: 4,
      reviewNote: close.reviewNote,
    });
    const [audit] = await ctx.owner.client<{ total: number }[]>`
      select count(*)::int as total from enterprise_suite.audit_events
      where org_id = ${company.orgId}::uuid and object_id = ${create.json().id}::uuid
    `;
    expect(audit?.total).toBe(4);
  });
});
