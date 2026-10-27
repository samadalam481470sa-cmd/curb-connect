// PLT-020-QA / BE-076-QA: notifications (dedupe, preferences, inbox), the transactional outbox
// processed by the real graphile-worker task list (retries, dead letters), delivery failures in the
// operational queue with manual retry, membership-removal work release (PLT-015 S), and
// server-evaluated feature flags per tenant and jurisdiction.
import { Logger, runOnce } from 'graphile-worker';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/db/runtime';
import { workerConnectionString } from '../../src/jobs/install';
import { buildTaskList } from '../../src/jobs/tasks';
import { notify } from '../../src/services/notifications';
import { call, type Company, createCompany, createTestContext, createUser, type TestContext } from '../helpers';

let ctx: TestContext;
const silent = new Logger(() => () => {});

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  ctx.mail.failWith = null;
  ctx.mail.sent.length = 0;
  await ctx.cleanup();
});
afterAll(() => ctx?.close());

/** Runs every job that is due right now, exactly as src/worker.ts would. */
async function drainQueue(): Promise<void> {
  await runOnce({
    connectionString: workerConnectionString(process.env.TEST_DATABASE_URL as string),
    taskList: buildTaskList({ platformDb: ctx.owner.db, mail: ctx.mail, config: ctx.config }),
    noHandleSignals: true,
    logger: silent,
  });
}

async function notifyMember(company: Company, membershipId: string, dedupeKey: string, channels?: ('in_app' | 'email' | 'sms')[]) {
  return withTenant(ctx.appDb.db, { orgId: company.orgId, userId: company.owner.userId }, (tx) =>
    notify(tx, {
      orgId: company.orgId,
      recipientMembershipId: membershipId,
      category: 'estimate_approved',
      title: 'Estimate approved',
      body: 'Estimate E-1 was approved.',
      link: '/estimates/e-1',
      dedupeKey,
      ...(channels && { channels }),
    }),
  );
}

describe('PLT-020-QA notifications', () => {
  it('dedupes per key and channel; in-app is delivered immediately, email goes through the outbox', async () => {
    const a = await createCompany(ctx);
    const first = await notifyMember(a, a.owner.membershipId, 'estimate-approved:e-1');
    expect(first.created.map((c) => [c.channel, c.status])).toEqual([
      ['in_app', 'delivered'],
      ['email', 'queued'],
    ]);
    const again = await notifyMember(a, a.owner.membershipId, 'estimate-approved:e-1');
    expect(again.created).toEqual([]);
    expect(again.deduplicated).toEqual(['in_app', 'email']);

    const inbox = await call(ctx, 'GET', '/v1/notifications', { as: a.owner });
    expect(inbox.json().items).toHaveLength(1);
    expect(inbox.json().items[0]).toMatchObject({ title: 'Estimate approved', readAt: null, link: '/estimates/e-1' });
    expect((await call(ctx, 'POST', `/v1/notifications/${inbox.json().items[0].id}/read`, { as: a.owner })).statusCode).toBe(204);
    expect((await call(ctx, 'GET', '/v1/notifications?unread=true', { as: a.owner })).json().items).toEqual([]);

    await drainQueue();
    expect(ctx.mail.sent).toHaveLength(1);
    expect(ctx.mail.sent[0]).toMatchObject({ to: a.owner.email, subject: expect.stringContaining('Estimate approved') });
    expect(ctx.mail.sent[0]!.text).toContain('http://localhost:3000/estimates/e-1');
    const [row] = await ctx.owner.client<{ delivery_status: string; provider_message_id: string | null }[]>`
      select delivery_status, provider_message_id from notifications where org_id = ${a.orgId} and channel = 'email'`;
    expect(row?.delivery_status).toBe('sent');
    expect(row?.provider_message_id).toMatch(/^test:notification-/);
    const [event] = await ctx.owner.client<{ status: string; dispatched_at: Date | null }[]>`
      select status, dispatched_at from domain_events where org_id = ${a.orgId} and event_type = 'notification.deliver'`;
    expect(event?.status).toBe('dispatched');
    expect(event?.dispatched_at).not.toBeNull();
    // Running the worker again does not send twice (idempotent handler).
    await drainQueue();
    expect(ctx.mail.sent).toHaveLength(1);
  });

  it('honours opt-out per category and channel; SMS is recorded as suppressed (no adapter yet)', async () => {
    const a = await createCompany(ctx);
    const put = await call(ctx, 'PUT', '/v1/notifications/preferences', {
      as: a.owner,
      body: { preferences: [{ category: 'estimate_approved', channel: 'email', enabled: false }] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().preferences).toContainEqual({ category: 'estimate_approved', channel: 'email', enabled: false });
    const result = await notifyMember(a, a.owner.membershipId, 'opt-out:e-2', ['in_app', 'email', 'sms']);
    expect(result.created.map((c) => [c.channel, c.status])).toEqual([
      ['in_app', 'delivered'],
      ['email', 'suppressed'],
      ['sms', 'suppressed'],
    ]);
    await drainQueue();
    expect(ctx.mail.sent).toEqual([]);
  });

  it('members only see their own notifications', async () => {
    const a = await createCompany(ctx, { roles: ['estimator'] });
    await notifyMember(a, a.owner.membershipId, 'owner-only', ['in_app']);
    expect((await call(ctx, 'GET', '/v1/notifications', { as: a.as('estimator') })).json().items).toEqual([]);
  });
});

describe('BE-076-QA outbox, retries and dead letters', () => {
  it('a failing delivery keeps the business change, surfaces in the ops queue, and can be retried', async () => {
    const a = await createCompany(ctx);
    const invitation = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body: { email: 'mail-fails@example.test', role: 'estimator' },
    });
    expect(invitation.statusCode).toBe(201);
    await notifyMember(a, a.owner.membershipId, 'will-fail', ['email']);
    // Exhaust retries quickly: one attempt each.
    await ctx.owner.client`update graphile_worker._private_jobs set max_attempts = 1 where payload ->> 'orgId' = ${a.orgId}`;
    ctx.mail.failWith = 'SMTP 421 try later';
    await drainQueue();

    // PLT-020 S: the invitation (the business transition) is intact.
    const [inv] = await ctx.owner.client<{ status: string }[]>`select status from invitations where id = ${invitation.json().id}`;
    expect(inv?.status).toBe('pending');
    const events = await ctx.owner.client<{ event_type: string; status: string; last_error: string | null; attempts: number }[]>`
      select event_type, status, last_error, attempts from domain_events where org_id = ${a.orgId} order by event_type`;
    expect(events).toEqual([
      { event_type: 'invitation.send', status: 'dead', last_error: 'SMTP 421 try later', attempts: 1 },
      { event_type: 'notification.deliver', status: 'dead', last_error: 'SMTP 421 try later', attempts: 1 },
    ]);
    const dead = await ctx.owner.client<{ task: string }[]>`
      select task from fieldline_job_dead_letters where org_id = ${a.orgId} order by task`;
    expect(dead.map((d) => d.task)).toEqual(['invitation.send', 'notification.deliver']);
    // The restricted role cannot read the platform dead-letter view.
    const denied = await ctx.appDb.client`select 1 from fieldline_job_dead_letters`.catch((e: { code?: string }) => e.code);
    expect(denied).toBe('42501');

    const queue = await call(ctx, 'GET', '/v1/notifications/delivery-failures', { as: a.owner });
    expect(queue.statusCode).toBe(200);
    const items = queue.json().items as { kind: string; id: string; status: string; lastError: string | null }[];
    const failedNotification = items.find((i) => i.kind === 'notification');
    expect(failedNotification).toMatchObject({ status: 'failed', lastError: 'SMTP 421 try later' });
    expect(items.filter((i) => i.kind === 'outbox_event')).toHaveLength(2);
    // Estimators do not see the operational queue.
    const est = await createCompany(ctx, { roles: ['estimator'] });
    expect((await call(ctx, 'GET', '/v1/notifications/delivery-failures', { as: est.as('estimator') })).statusCode).toBe(403);

    ctx.mail.failWith = null;
    const retry = await call(ctx, 'POST', `/v1/notifications/delivery-failures/${failedNotification!.id}/retry`, { as: a.owner });
    expect(retry.statusCode).toBe(202);
    await drainQueue();
    const [row] = await ctx.owner.client<{ delivery_status: string }[]>`
      select delivery_status from notifications where id = ${failedNotification!.id}`;
    expect(row?.delivery_status).toBe('sent');
    expect(ctx.mail.sent.map((m) => m.to)).toEqual([a.owner.email]);
    // Retrying a non-failed delivery is refused.
    expect(
      (await call(ctx, 'POST', `/v1/notifications/delivery-failures/${failedNotification!.id}/retry`, { as: a.owner })).statusCode,
    ).toBe(409);
  });

  it('a transient failure is retried with backoff instead of dying', async () => {
    const a = await createCompany(ctx);
    await notifyMember(a, a.owner.membershipId, 'transient', ['email']);
    ctx.mail.failWith = 'connection reset';
    await drainQueue();
    const [job] = await ctx.owner.client<{ attempts: number; max_attempts: number; run_at: string }[]>`
      select attempts, max_attempts, run_at from graphile_worker._private_jobs where payload ->> 'orgId' = ${a.orgId}`;
    expect(job?.attempts).toBe(1);
    expect(job?.max_attempts).toBe(6);
    // drizzle's postgres.js client returns timestamps as strings.
    expect(new Date(job!.run_at).getTime()).toBeGreaterThan(Date.now());
    const [event] = await ctx.owner.client<{ status: string }[]>`select status from domain_events where org_id = ${a.orgId}`;
    expect(event?.status).toBe('failed');
  });

  it('the invitation email is delivered by the worker with a working accept link', async () => {
    const a = await createCompany(ctx);
    await call(ctx, 'POST', '/v1/team/invitations', { as: a.owner, body: { email: 'mailed@example.test', role: 'reviewer' } });
    await drainQueue();
    expect(ctx.mail.sent).toHaveLength(1);
    const link = /Accept: (\S+)/.exec(ctx.mail.sent[0]!.text)?.[1];
    expect(link).toMatch(/^http:\/\/localhost:3000\/invitations\/accept#token=/);
    const invitee = await createUser(ctx, { email: 'mailed@example.test' });
    const { signIn } = await import('../helpers');
    const session = await signIn(ctx, invitee.userId, null);
    const token = new URL(link!).hash.replace('#token=', '');
    expect((await call(ctx, 'POST', '/v1/invitations/accept', { as: session, body: { token } })).statusCode).toBe(200);
  });

  it('PLT-015 S: removing a reviewer releases their claimed review tasks so no stale approval remains', async () => {
    const a = await createCompany(ctx, { roles: ['reviewer'] });
    const reviewer = a.as('reviewer');
    const [task] = await ctx.owner.client<{ id: string }[]>`
      insert into review_tasks (org_id, kind, status, subject_type, subject_id, claimed_by_membership_id, lease_expires_at)
      values (${a.orgId}, 'curb_estimate', 'claimed', 'estimate_revision', gen_random_uuid(), ${reviewer.membershipId},
              now() + interval '1 hour')
      returning id`;
    await call(ctx, 'POST', `/v1/team/members/${reviewer.membershipId}/deactivate`, { as: a.owner, body: { reason: 'left' } });
    await drainQueue();
    const [after] = await ctx.owner.client<{ status: string; claimed_by_membership_id: string | null }[]>`
      select status, claimed_by_membership_id from review_tasks where id = ${task!.id}`;
    expect(after).toEqual({ status: 'open', claimed_by_membership_id: null });
    const [audit] = await ctx.owner.client<{ actor_type: string }[]>`
      select actor_type from audit_events where org_id = ${a.orgId} and action = 'review_task.released'`;
    expect(audit?.actor_type).toBe('worker');
  });
});

describe('PLT-020 feature flags (server-evaluated, tenant + jurisdiction scoped)', () => {
  it('exposes evaluated flags in /v1/me and /v1/flags; tenant overrides apply only to that tenant', async () => {
    const a = await createCompany(ctx);
    const b = await createCompany(ctx);
    const me = await call(ctx, 'GET', '/v1/me', { as: a.owner });
    expect(me.json().flags).toMatchObject({ 'crm.leads': true, 'curb.ai_measurement': false });
    const off = await call(ctx, 'PUT', '/v1/flags/crm.leads', { as: a.owner, body: { enabled: false, rolloutNote: 'Not using CRM yet' } });
    expect(off.statusCode).toBe(200);
    expect(off.json().flags['crm.leads']).toBe(false);
    expect((await call(ctx, 'GET', '/v1/me', { as: a.owner })).json().flags['crm.leads']).toBe(false);
    expect((await call(ctx, 'GET', '/v1/me', { as: b.owner })).json().flags['crm.leads']).toBe(true);
    const audit = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from audit_events where org_id = ${a.orgId} and action = 'flags.override_set'`;
    expect(audit[0]?.n).toBe(1);
  });

  it('a tenant cannot switch on a capability that does not exist yet (no trained model)', async () => {
    const a = await createCompany(ctx);
    const res = await call(ctx, 'PUT', '/v1/flags/curb.ai_measurement', { as: a.owner, body: { enabled: true } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('feature_unavailable');
  });

  it('jurisdiction-scoped evaluation: a platform rule for one jurisdiction applies only there', async () => {
    const a = await createCompany(ctx);
    const [j] = await ctx.owner.client<{ id: string }[]>`
      insert into jurisdictions (code, name, kind, status, region, rules_version)
      values (${`SYN-${crypto.randomUUID().slice(0, 8)}`}, 'Synthetic Township (test)', 'city', 'draft', 'ZZ', 'synthetic-1')
      returning id`;
    try {
      await ctx.owner.client`insert into feature_flags (org_id, jurisdiction_id, key, enabled)
        values (null, ${j!.id}, 'curb.permit_rules', true)`;
      const there = await call(ctx, 'GET', `/v1/flags?jurisdictionId=${j!.id}`, { as: a.owner });
      expect(there.json().flags['curb.permit_rules']).toBe(true);
      const elsewhere = await call(ctx, 'GET', '/v1/flags', { as: a.owner });
      expect(elsewhere.json().flags['curb.permit_rules']).toBe(false);
      // Tenants may opt out locally, even where the platform enabled it.
      const optOut = await call(ctx, 'PUT', '/v1/flags/curb.permit_rules', {
        as: a.owner,
        body: { enabled: false, jurisdictionId: j!.id },
      });
      expect(optOut.statusCode).toBe(200);
      const after = await call(ctx, 'GET', `/v1/flags?jurisdictionId=${j!.id}`, { as: a.owner });
      expect(after.json().flags['curb.permit_rules']).toBe(false);
    } finally {
      await ctx.owner.client`delete from feature_flags where jurisdiction_id = ${j!.id}`;
      await ctx.owner.client`delete from jurisdictions where id = ${j!.id}`;
    }
  });
});
