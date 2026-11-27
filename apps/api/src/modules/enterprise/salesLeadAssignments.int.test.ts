import { randomUUID } from 'node:crypto';
import { Logger, runOnce } from 'graphile-worker';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import {
  addMember,
  call,
  createCompany,
  createTestContext,
  createUser,
  platformTestUrl,
  signIn,
  type TestContext,
  type TestSession,
} from '../../../test/helpers';
import { workerConnectionString } from '../../jobs/install';
import { buildTaskList } from '../../jobs/tasks';
import { createMailerClient } from '../../services/mailer-client';

let ctx: TestContext;
const leads = '/v1/enterprise/sales/leads';
const settings = '/v1/enterprise/sales/assignment-settings';
const revision = (value: number) => ({ 'if-match': '"' + value + '"' });

beforeAll(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from enterprise_suite.sales_lead_activities where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_assignments where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_assignment_policy_revisions where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_territory_revisions where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_leads where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_sources where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});

afterAll(async () => ctx?.close());

it('assigns one eligible salesperson, rejects a competing revision and routes a queue to available capacity', async () => {
  const company = await createCompany(ctx, { roles: ['salesperson', 'estimator'] });
  const outsider = await createCompany(ctx, { roles: ['salesperson'] });
  const rep = company.as('salesperson');
  const added = await createUser(ctx, { displayName: 'Other eligible salesperson' });
  const otherId = await addMember(ctx, {
    orgId: company.orgId,
    userId: added.userId,
    role: 'salesperson',
  });
  const other = await signIn(ctx, added.userId, company.orgId);
  for (const tenant of [company, outsider]) {
    const response = await call(ctx, 'PUT', '/v1/enterprise/status', {
      as: tenant.owner,
      body: { enabled: true },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  const source = await call(ctx, 'POST', leads + '/sources', {
    as: company.owner,
    body: { name: 'Assignment fixture website' },
  });
  expect(source.statusCode, source.body).toBe(201);
  const community = await call(ctx, 'POST', '/v1/land-management/communities', {
    as: company.owner,
    body: { name: 'Assignment fixture community' },
  });
  expect(community.statusCode, community.body).toBe(201);
  const communityId = community.json().id as string;
  async function newLead(name: string, actor: TestSession = company.owner) {
    const input = {
      name,
      sourceId: source.json().id,
      communityId,
      consent: {},
      contactMethod: 'none',
    };
    const preview = await call(ctx, 'POST', leads + '/preview', { as: actor, body: input });
    expect(preview.statusCode, preview.body).toBe(200);
    const body = {
      ...input,
      clientRequestId: randomUUID(),
      previewFingerprint: preview.json().previewFingerprint,
    };
    const saved = await call(ctx, 'POST', leads, { as: actor, body, headers: revision(0) });
    expect(saved.statusCode, saved.body).toBe(201);
    return { id: saved.json().id as string, body };
  }

  const first = await newLead('A lead whose creator is the other salesperson', other);
  const url = leads + '/' + first.id + '/assignments';
  const manager = company.owner;
  const init = await call(ctx, 'GET', url, { as: manager });
  expect(init.statusCode, init.body).toBe(200);
  expect(init.json()).toMatchObject({
    revision: 1,
    owner: null,
    roundRobinEnabled: false,
    candidates: [],
  });
  expect((await call(ctx, 'GET', url, { as: outsider.owner })).statusCode).toBe(404);
  expect((await call(ctx, 'GET', url, { as: other })).statusCode).toBe(403);
  expect((await call(ctx, 'GET', leads, { as: other })).json()).toMatchObject({
    items: [{ id: first.id }],
  });

  const policy = (enabled: boolean, expected: number, as: TestSession = manager) =>
    call(ctx, 'PUT', settings + '/round-robin', {
      as,
      headers: revision(expected),
      body: { enabled, reason: 'Approved test policy.', clientRequestId: randomUUID() },
    });
  expect((await policy(true, 0)).statusCode).toBe(409);
  expect((await policy(true, 0, rep)).statusCode).toBe(403);

  const territory = (
    membershipId: string,
    input: { capacity: number; active: boolean },
    expected = 0,
  ) =>
    call(ctx, 'PUT', settings + '/territories', {
      as: manager,
      headers: revision(expected),
      body: {
        ...input,
        membershipId,
        communityId,
        reason: 'Approved community coverage.',
        clientRequestId: randomUUID(),
      },
    });
  expect(
    (await territory(outsider.as('salesperson').membershipId, { capacity: 1, active: true }))
      .statusCode,
  ).toBe(404);
  expect(
    (await territory(company.as('estimator').membershipId, { capacity: 1, active: true }))
      .statusCode,
  ).toBe(404);
  const authorized = await territory(rep.membershipId, { capacity: 1, active: true });
  expect(authorized.statusCode, authorized.body).toBe(200);
  expect(authorized.json()).toMatchObject({ revision: 1, active: true, capacity: 1 });

  const assign = (target: string, body: object, expected: number, as: TestSession = manager) =>
    call(ctx, 'POST', target, { as, body, headers: revision(expected) });
  const direct = {
    mode: 'direct',
    ownerMembershipId: rep.membershipId,
    reason: 'Manager selected territory owner.',
    clientRequestId: randomUUID(),
  };
  expect((await assign(url, { ...direct, ownerMembershipId: otherId }, 1)).statusCode).toBe(409);
  expect((await assign(url, direct, 1, rep)).statusCode).toBe(403);
  const competing = await Promise.all([
    assign(url, direct, 1),
    assign(url, { ...direct, clientRequestId: randomUUID() }, 1),
  ]);
  expect(competing.map((result) => result.statusCode).sort()).toEqual([201, 412]);
  const winner = competing.find((result) => result.statusCode === 201)?.json();
  expect(winner).toMatchObject({
    revision: 2,
    mode: 'direct',
    owner: { id: rep.membershipId },
    previousOwnerMembershipId: null,
  });
  expect((await call(ctx, 'GET', leads, { as: rep })).json()).toMatchObject({
    items: [{ id: first.id, revision: 2 }],
  });
  expect((await call(ctx, 'GET', leads, { as: other })).json()).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(
    (await call(ctx, 'POST', leads, { as: other, headers: revision(0), body: first.body }))
      .statusCode,
  ).toBe(409);

  const second = await newLead('Queue allocation with an occupied first owner');
  const queueUrl = leads + '/' + second.id + '/assignments';
  const queued = {
    mode: 'round_robin',
    reason: 'Use the approved assignment queue.',
    clientRequestId: randomUUID(),
  };
  expect((await assign(queueUrl, queued, 1)).statusCode).toBe(409);
  const extra = await territory(otherId, { capacity: 2, active: true });
  expect(extra.statusCode, extra.body).toBe(200);
  const rule = await policy(true, 0);
  expect(rule.statusCode, rule.body).toBe(200);
  expect(rule.json()).toMatchObject({ enabled: true, revision: 1, activeTerritoryCount: 2 });
  const selected = await assign(queueUrl, queued, 1);
  expect(selected.statusCode, selected.body).toBe(201);
  expect(selected.json()).toMatchObject({ owner: { id: otherId }, mode: 'round_robin' });
  expect((await assign(queueUrl, queued, 1)).json()).toEqual(selected.json());
  const off = await policy(false, 1);
  expect(off.statusCode, off.body).toBe(200);
  expect(off.json()).toMatchObject({
    enabled: false,
    revision: 2,
    history: [{ revision: 2 }, { revision: 1 }],
  });

  const taskList = buildTaskList({
    platformDb: ctx.platformDb.db,
    mail: ctx.mail,
    mailer: createMailerClient(null),
    config: ctx.config,
  });
  await runOnce({
    connectionString: workerConnectionString(platformTestUrl()),
    taskList: { 'sales.lead_assigned': taskList['sales.lead_assigned']! },
    noHandleSignals: true,
    logger: new Logger(() => () => {}),
  });
  const receipts = await ctx.owner.client`
    select recipient_membership_id, channel, delivery_status from public.notifications
    where org_id = ${company.orgId} and dedupe_key like 'sales.lead_assigned:%'`;
  expect(receipts).toHaveLength(2);
  expect(receipts).toEqual(
    expect.arrayContaining([
      {
        recipient_membership_id: rep.membershipId,
        channel: 'in_app',
        delivery_status: 'delivered',
      },
      { recipient_membership_id: otherId, channel: 'in_app', delivery_status: 'delivered' },
    ]),
  );
}, 60_000);
