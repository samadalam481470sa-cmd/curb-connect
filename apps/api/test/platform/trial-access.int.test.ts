// Free trial and access control (migration 0020, services/billing-access.ts, modules/billing).
// Covers: a new company's 7-day trial, expiry blocking company routes while billing stays reachable,
// the tenant role being unable to extend its own trial, one trial per person, paid access, and a
// signed Stripe webhook that cannot be forged or replayed.
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { call, createCompany, createTestContext, createUser, signIn, type TestContext } from '../helpers';

let ctx: TestContext;
const WEBHOOK_SECRET = 'whsec_trial_test_secret';

beforeAll(async () => {
  ctx = await createTestContext({ env: { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_PLAN_CODE: 'standard' } });
  // Plan catalog row the webhook maps to. Inserted only if absent; the catalog is owned by the platform.
  await ctx.owner.client`
    insert into public.plans (code, name, interval, price_minor, currency, included_usage)
    values ('standard', 'Standard (test)', 'month', 9900, 'USD', '{}'::jsonb)
    on conflict (code) do nothing`;
});
afterEach(() => ctx.cleanup());
afterAll(() => ctx?.close());

async function setTrialEnd(orgId: string, when: string): Promise<void> {
  // The owner connection is not the tenant role, so the protection trigger allows this test to simulate time.
  await ctx.owner.client`update public.organizations set trial_ends_at = ${when}::timestamptz where id = ${orgId}`;
}

describe('free trial and access control', () => {
  it('gives a new company a seven-day trial on the database clock', async () => {
    const company = await createCompany(ctx);
    ctx.track.org(company.orgId);
    const [row] = await ctx.owner.client<{ days: number; exempt: boolean }[]>`
      select round(extract(epoch from (trial_ends_at - now())) / 86400)::int as days, billing_exempt as exempt
      from public.organizations where id = ${company.orgId}`;
    expect(row?.days).toBe(7);
    expect(row?.exempt).toBe(false);

    const status = await call(ctx, 'GET', '/v1/billing/status', { as: company.owner });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ access: 'trial', trialDaysLeft: 7, subscription: null });
  });

  it('blocks company routes after the trial ends, but keeps billing status reachable', async () => {
    const company = await createCompany(ctx);
    ctx.track.org(company.orgId);
    await setTrialEnd(company.orgId, '2020-01-01T00:00:00Z');

    const blocked = await call(ctx, 'GET', '/v1/orgs/current/settings', { as: company.owner });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().code).toBe('trial_expired');

    const status = await call(ctx, 'GET', '/v1/billing/status', { as: company.owner });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ access: 'expired', trialDaysLeft: null });
  });

  it('does not let the tenant role extend its own trial or grant itself an exemption', async () => {
    const company = await createCompany(ctx);
    ctx.track.org(company.orgId);
    const attempt = (sql: 'trial' | 'exempt') =>
      ctx.owner.client.begin(async (tx) => {
        await tx`set local role fieldline_app`;
        await tx`select set_config('app.org_id', ${company.orgId}, true)`;
        if (sql === 'trial') {
          await tx`update public.organizations set trial_ends_at = now() + interval '365 days' where id = ${company.orgId}`;
        } else {
          await tx`update public.organizations set billing_exempt = true where id = ${company.orgId}`;
        }
      });
    await expect(attempt('trial')).rejects.toThrow(/billing fields can only be changed by the platform/);
    await expect(attempt('exempt')).rejects.toThrow(/billing fields can only be changed by the platform/);
    const [row] = await ctx.owner.client<{ exempt: boolean }[]>`select billing_exempt as exempt from public.organizations where id = ${company.orgId}`;
    expect(row?.exempt).toBe(false);
  });

  it('gives one trial per person: a second company they create starts expired', async () => {
    const user = await createUser(ctx);
    const session = await signIn(ctx, user.userId, null);
    const body = { legalName: 'First Co (fictional)', displayName: 'First Co', productLines: ['roof'], timezone: 'America/Chicago' };
    const first = await call(ctx, 'POST', '/v1/orgs', { as: session, body, headers: { 'idempotency-key': `trial-1-${crypto.randomUUID()}` } });
    expect(first.statusCode).toBe(201);
    ctx.track.org(first.json().id);

    const second = await call(ctx, 'POST', '/v1/orgs', {
      as: session,
      body: { ...body, legalName: 'Second Co (fictional)', displayName: 'Second Co' },
      headers: { 'idempotency-key': `trial-2-${crypto.randomUUID()}` },
    });
    expect(second.statusCode).toBe(201);
    ctx.track.org(second.json().id);
    const [row] = await ctx.owner.client<{ state: string }[]>`
      select case when trial_ends_at > now() then 'trial' else 'expired' end as state
      from public.organizations where id = ${second.json().id}`;
    expect(row?.state).toBe('expired');
  });

  it('restores access when a paid subscription is active, and removes it when it lapses', async () => {
    const company = await createCompany(ctx);
    ctx.track.org(company.orgId);
    await setTrialEnd(company.orgId, '2020-01-01T00:00:00Z');
    const [plan] = await ctx.owner.client<{ id: string }[]>`select id from public.plans where code = 'standard'`;
    await ctx.owner.client`
      insert into public.subscriptions (org_id, plan_id, status, provider_subscription_id, current_period_start, current_period_end)
      values (${company.orgId}, ${plan!.id}, 'active', 'sub_test_active', now(), now() + interval '30 days')`;

    const ok = await call(ctx, 'GET', '/v1/orgs/current/settings', { as: company.owner });
    expect(ok.statusCode).toBe(200);
    const status = await call(ctx, 'GET', '/v1/billing/status', { as: company.owner });
    expect(status.json().access).toBe('subscribed');

    await ctx.owner.client`update public.subscriptions set status = 'canceled' where org_id = ${company.orgId}`;
    const lapsed = await call(ctx, 'GET', '/v1/orgs/current/settings', { as: company.owner });
    expect(lapsed.statusCode).toBe(402);
  });

  it('accepts a correctly signed Stripe subscription event and rejects forged or stale ones', async () => {
    const company = await createCompany(ctx);
    ctx.track.org(company.orgId);
    const now = Math.floor(Date.now() / 1000);
    const event = {
      id: `evt_${crypto.randomUUID()}`,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: `sub_${crypto.randomUUID()}`,
          status: 'active',
          metadata: { orgId: company.orgId },
          current_period_start: now,
          current_period_end: now + 30 * 86400,
        },
      },
    };
    const raw = JSON.stringify(event);
    const sign = (ts: number, secret = WEBHOOK_SECRET) =>
      `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`;

    const forged = await call(ctx, 'POST', '/v1/billing/webhook', {
      headers: { 'content-type': 'application/json', 'stripe-signature': sign(now, 'whsec_attacker') },
      rawPayload: raw,
    });
    expect(forged.statusCode).toBe(400);
    expect(forged.json().code).toBe('webhook_signature_invalid');

    const stale = await call(ctx, 'POST', '/v1/billing/webhook', {
      headers: { 'content-type': 'application/json', 'stripe-signature': sign(now - 3600) },
      rawPayload: raw,
    });
    expect(stale.statusCode).toBe(400);
    expect(stale.json().code).toBe('webhook_signature_invalid');

    const ok = await call(ctx, 'POST', '/v1/billing/webhook', {
      headers: { 'content-type': 'application/json', 'stripe-signature': sign(now) },
      rawPayload: raw,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ received: true, handled: true });

    const [row] = await ctx.owner.client<{ status: string }[]>`
      select status from public.subscriptions where org_id = ${company.orgId} and provider_subscription_id = ${event.data.object.id}`;
    expect(row?.status).toBe('active');
  });
});
