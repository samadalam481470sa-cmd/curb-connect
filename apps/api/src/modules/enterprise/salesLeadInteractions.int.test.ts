import { randomUUID } from 'node:crypto';
import { Logger, runOnce } from 'graphile-worker';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import {
  call,
  createCompany,
  createTestContext,
  platformTestUrl,
  type TestContext,
  type TestSession,
} from '../../../test/helpers';
import { workerConnectionString } from '../../jobs/install';
import { buildTaskList } from '../../jobs/tasks';
import { createMailerClient } from '../../services/mailer-client';

let ctx: TestContext;
const leads = '/v1/enterprise/sales/leads';
const policy = '/v1/enterprise/sales/assignment-settings/follow-up-reminders';
const revision = (value: number) => ({ 'if-match': '"' + value + '"' });

beforeAll(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from enterprise_suite.sales_lead_follow_ups where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_interactions where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_conversations where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_follow_up_policy_revisions where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_activities where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_assignments where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_territory_revisions where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_leads where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_sources where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});

afterAll(async () => ctx?.close());

it('orders private lead interactions and delivers only enabled internal follow-up reminders', async () => {
  const company = await createCompany(ctx, { roles: ['salesperson', 'estimator'] });
  const outsider = await createCompany(ctx);
  const rep = company.as('salesperson');
  const owner = company.owner;
  for (const tenant of [company, outsider]) {
    expect(
      (
        await call(ctx, 'PUT', '/v1/enterprise/status', {
          as: tenant.owner,
          body: { enabled: true },
        })
      ).statusCode,
    ).toBe(200);
  }
  const source = await call(ctx, 'POST', leads + '/sources', {
    as: owner,
    body: { name: 'Interaction fixture source' },
  });
  expect(source.statusCode, source.body).toBe(201);
  async function createLead(name: string, as: TestSession) {
    const input = { name, sourceId: source.json().id, contactMethod: 'none', consent: {} };
    const preview = await call(ctx, 'POST', leads + '/preview', { as, body: input });
    expect(preview.statusCode, preview.body).toBe(200);
    const saved = await call(ctx, 'POST', leads, {
      as,
      headers: revision(0),
      body: {
        ...input,
        clientRequestId: randomUUID(),
        previewFingerprint: preview.json().previewFingerprint,
      },
    });
    expect(saved.statusCode, saved.body).toBe(201);
    return saved.json().id as string;
  }
  const leadId = await createLead('Owned by the salesperson', rep);
  const outsideLead = await createLead('Owned by the manager', owner);
  const path = leads + '/' + leadId + '/interactions';
  expect(
    (await call(ctx, 'GET', leads + '/' + outsideLead + '/interactions', { as: rep })).statusCode,
  ).toBe(404);
  expect((await call(ctx, 'GET', path, { as: outsider.owner })).statusCode).toBe(404);
  expect((await call(ctx, 'GET', path, { as: company.as('estimator') })).statusCode).toBe(403);
  const defaults = await call(ctx, 'GET', policy, { as: owner });
  expect(defaults.json()).toEqual({ enabled: true, revision: 0, history: [] });

  const base = {
    channel: 'call',
    outcome: 'follow_up_requested',
    notes: 'Private buyer availability fixture',
    occurredAt: new Date(Date.now() - 7_200_000).toISOString(),
    nextAt: new Date(Date.now() - 60_000).toISOString(),
    newConversationTitle: 'Initial buyer discussion',
    clientRequestId: randomUUID(),
  };
  const log = (input: object, expected: number, as: TestSession = rep) =>
    call(ctx, 'POST', path, { as, headers: revision(expected), body: input });
  expect((await log({ ...base, nextAt: base.occurredAt }, 1)).statusCode).toBe(400);
  expect((await log(base, 0)).statusCode).toBe(412);
  const saved = await log(base, 1);
  expect(saved.statusCode, saved.body).toBe(201);
  expect((await log(base, 1)).json()).toEqual(saved.json());
  expect((await log({ ...base, notes: 'Changed retry payload' }, 1)).statusCode).toBe(409);
  const { interaction: first } = saved.json();
  expect(saved.json()).toMatchObject({
    revision: 2,
    interaction: {
      notes: base.notes,
      linkedConversation: { title: 'Initial buyer discussion' },
      followUp: { reminderScheduled: true },
    },
  });
  const conversationId = first.linkedConversation.id;
  const crossLink = await call(ctx, 'POST', leads + '/' + outsideLead + '/interactions', {
    as: owner,
    headers: revision(1),
    body: {
      ...base,
      newConversationTitle: undefined,
      conversationId,
      clientRequestId: randomUUID(),
    },
  });
  expect(crossLink.statusCode).toBe(404);

  const territory = await call(ctx, 'PUT', '/v1/enterprise/sales/assignment-settings/territories', {
    as: owner,
    headers: revision(0),
    body: {
      membershipId: rep.membershipId,
      communityId: null,
      capacity: 10,
      active: true,
      reason: 'Cover unclassified synthetic leads.',
      clientRequestId: randomUUID(),
    },
  });
  expect(territory.statusCode, territory.body).toBe(200);
  const assigned = await call(ctx, 'POST', leads + '/' + outsideLead + '/assignments', {
    as: owner,
    headers: revision(1),
    body: {
      mode: 'direct',
      ownerMembershipId: rep.membershipId,
      reason: 'Assign follow-up responsibility.',
      clientRequestId: randomUUID(),
    },
  });
  expect(assigned.statusCode, assigned.body).toBe(201);
  const assignedLog = await call(ctx, 'POST', leads + '/' + outsideLead + '/interactions', {
    as: rep,
    headers: revision(2),
    body: {
      occurredAt: base.occurredAt,
      channel: 'call',
      outcome: 'attempted',
      notes: 'An interaction after the assignment.',
      clientRequestId: randomUUID(),
    },
  });
  expect(assignedLog.statusCode, assignedLog.body).toBe(201);

  const taskList = buildTaskList({
    platformDb: ctx.platformDb.db,
    mail: ctx.mail,
    mailer: createMailerClient(null),
    config: ctx.config,
  });
  async function dispatch() {
    await runOnce({
      connectionString: workerConnectionString(platformTestUrl()),
      taskList: {
        'sales.follow_up_due': taskList['sales.follow_up_due']!,
        'sales.lead_assigned': taskList['sales.lead_assigned']!,
      },
      noHandleSignals: true,
      logger: new Logger(() => () => {}),
    });
  }
  const initialMailCount = ctx.mail.sent.length;
  await dispatch();
  async function notices() {
    return ctx.owner.client`select channel, recipient_membership_id, title from public.notifications
      where org_id = ${company.orgId} and dedupe_key like 'sales.follow_up_due:%'`;
  }
  expect(await notices()).toEqual([
    {
      channel: 'in_app',
      recipient_membership_id: rep.membershipId,
      title: 'A sales lead follow-up is due',
    },
  ]);
  const assignmentNotification = await ctx.owner.client`select recipient_membership_id, channel
    from public.notifications where org_id = ${company.orgId}
    and dedupe_key = ${'sales.lead_assigned:' + assigned.json().id + ':in_app'}`;
  expect(assignmentNotification).toEqual([
    { recipient_membership_id: rep.membershipId, channel: 'in_app' },
  ]);

  const queued = await log(
    {
      ...base,
      channel: 'meeting',
      notes: 'Second private interaction',
      newConversationTitle: undefined,
      conversationId,
      clientRequestId: randomUUID(),
    },
    2,
  );
  expect(queued.statusCode, queued.body).toBe(201);
  expect(queued.json().interaction.followUp.reminderScheduled).toBe(true);
  const input = {
    enabled: false,
    reason: 'Switch to manually reviewed follow-ups.',
    clientRequestId: randomUUID(),
  };
  const set = (as: TestSession, base: number) =>
    call(ctx, 'PUT', policy, { as, headers: revision(base), body: input });
  expect((await set(rep, 0)).statusCode).toBe(403);
  const off = await set(owner, 0);
  expect(off.statusCode, off.body).toBe(200);
  expect((await set(owner, 0)).json()).toEqual(off.json());
  expect((await call(ctx, 'GET', policy, { as: owner })).json()).toMatchObject({
    enabled: false,
    revision: 1,
  });
  await dispatch();
  expect(await notices()).toHaveLength(1);
  expect(ctx.mail.sent).toHaveLength(initialMailCount);

  const older = await log(
    {
      ...base,
      channel: 'email',
      notes: 'Older private email',
      occurredAt: new Date(Date.now() - 10_800_000).toISOString(),
      newConversationTitle: undefined,
      conversationId,
      clientRequestId: randomUUID(),
    },
    3,
  );
  expect(older.statusCode, older.body).toBe(201);
  expect(older.json().interaction.followUp.reminderScheduled).toBe(false);
  const equalTimeIds = [first.id, queued.json().interaction.id].sort().reverse();
  const view = await call(ctx, 'GET', path + '?limit=1', { as: rep });
  expect(view.statusCode, view.body).toBe(200);
  expect(view.json()).toMatchObject({
    revision: 4,
    items: [{ id: equalTimeIds[0] }],
    conversations: [{ id: conversationId }],
  });
  const rest = await call(
    ctx,
    'GET',
    path + '?cursor=' + encodeURIComponent(view.json().nextCursor),
    { as: rep },
  );
  expect(rest.json().items.map(({ id }: { id: string }) => id)).toEqual([
    equalTimeIds[1],
    older.json().interaction.id,
  ]);
  expect(
    (await call(ctx, 'GET', '/v1/portal/homeowner/sales/leads/' + leadId + '/interactions'))
      .statusCode,
  ).toBe(404);
  const actions = await ctx.owner.client`select "after" from public.audit_events
    where org_id = ${company.orgId} and action = 'sales.interaction_logged'
    and "after" ->> 'leadId' = ${leadId}`;
  expect(actions).toHaveLength(3);
  expect(JSON.stringify(actions)).not.toContain(base.notes);
}, 60_000);
