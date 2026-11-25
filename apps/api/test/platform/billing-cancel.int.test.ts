// Cancel-at-period-end (POST /v1/billing/cancel): Stripe is told to end the subscription at the
// end of the paid period, the local row records cancel_at, repeating the call is a no-op, and the
// honest errors come back when there is nothing to cancel, the caller lacks billing permission,
// or Stripe is not configured. The Stripe SDK is faked through the buildApp seam; no network.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { auditRows, call, createCompany, createTestContext, type TestContext } from '../helpers';
import type { StripeSubscriptionClient } from '../../src/services/stripe';

const CANCEL_AT = 1_798_500_000; // 2026-12-28T23:20:00Z — the date the fake Stripe returns.

function fakeStripe(): { client: StripeSubscriptionClient; calls: string[] } {
  const calls: string[] = [];
  const client: StripeSubscriptionClient = {
    update: (async (id: string) => {
      calls.push(id);
      return { status: 'active', cancel_at: CANCEL_AT, current_period_end: CANCEL_AT };
    }) as StripeSubscriptionClient['update'],
  };
  return { client, calls };
}

let ctx: TestContext;
let ctxNoStripe: TestContext;
let fake: ReturnType<typeof fakeStripe>;

beforeAll(async () => {
  fake = fakeStripe();
  ctx = await createTestContext({
    env: { STRIPE_SECRET_KEY: 'sk_test_cancel', STRIPE_PLAN_CODE: 'standard' },
    stripeSubscriptions: fake.client,
  });
  ctxNoStripe = await createTestContext({
    env: { STRIPE_SECRET_KEY: '', STRIPE_PLAN_CODE: 'standard' },
  });
  await ctx.owner.client`
    insert into public.plans (code, name, interval, price_minor, currency, included_usage)
    values ('standard', 'Standard (test)', 'month', 9900, 'USD', '{}'::jsonb)
    on conflict (code) do nothing`;
});
afterEach(() => ctx.cleanup());
afterAll(async () => {
  await ctx?.close();
  await ctxNoStripe?.close();
});

async function seedSubscription(orgId: string, providerId = 'sub_test_cancel'): Promise<void> {
  const [plan] = await ctx.owner.client<{ id: string }[]>`select id from public.plans where code = 'standard'`;
  await ctx.owner.client`
    insert into public.subscriptions (org_id, plan_id, status, provider_subscription_id, current_period_start, current_period_end)
    values (${orgId}, ${plan!.id}, 'active', ${providerId}, now(), now() + interval '30 days')`;
}

describe('POST /v1/billing/cancel', () => {
  it('schedules cancel at period end, keeps access until then, and audits the change', async () => {
    const company = await createCompany(ctx);
    ctx.track.org(company.orgId);
    await seedSubscription(company.orgId);

    const res = await call(ctx, 'POST', '/v1/billing/cancel', { as: company.owner });
    expect(res.statusCode).toBe(200);
    expect(fake.calls).toEqual(['sub_test_cancel']);
    expect(res.json()).toMatchObject({
      access: 'subscribed',
      subscription: { status: 'active', cancelAt: new Date(CANCEL_AT * 1000).toISOString() },
    });

    const [row] = await ctx.owner.client<{ cancel_at: Date | string }[]>`
      select cancel_at from public.subscriptions where org_id = ${company.orgId}`;
    expect(row?.cancel_at ? new Date(row.cancel_at).toISOString() : null).toBe(
      new Date(CANCEL_AT * 1000).toISOString(),
    );
    const audits = await auditRows(ctx, company.orgId, 'billing.subscription_cancel_scheduled');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.resource_type).toBe('subscription');
  });

  it('is a no-op on repeat: no second Stripe call', async () => {
    const company = await createCompany(ctx);
    ctx.track.org(company.orgId);
    await seedSubscription(company.orgId);
    const before = fake.calls.length;

    const first = await call(ctx, 'POST', '/v1/billing/cancel', { as: company.owner });
    expect(first.statusCode).toBe(200);
    const second = await call(ctx, 'POST', '/v1/billing/cancel', { as: company.owner });
    expect(second.statusCode).toBe(200);
    expect(second.json().subscription.cancelAt).toBe(new Date(CANCEL_AT * 1000).toISOString());
    expect(fake.calls.length).toBe(before + 1);
  });

  it('refuses when there is no active subscription, without calling Stripe', async () => {
    const company = await createCompany(ctx);
    ctx.track.org(company.orgId);
    const before = fake.calls.length;

    const res = await call(ctx, 'POST', '/v1/billing/cancel', { as: company.owner });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'conflict' });
    expect(fake.calls.length).toBe(before);
  });

  it('refuses a member without billing permission', async () => {
    const company = await createCompany(ctx, { roles: ['read_only'] });
    ctx.track.org(company.orgId);
    await seedSubscription(company.orgId);

    const res = await call(ctx, 'POST', '/v1/billing/cancel', { as: company.as('read_only') });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'forbidden' });
  });

  it('reports Stripe as unavailable when no secret key is configured', async () => {
    const company = await createCompany(ctxNoStripe);
    ctxNoStripe.track.org(company.orgId);
    const [plan] = await ctxNoStripe.owner.client<{ id: string }[]>`select id from public.plans where code = 'standard'`;
    await ctxNoStripe.owner.client`
      insert into public.subscriptions (org_id, plan_id, status, provider_subscription_id, current_period_start, current_period_end)
      values (${company.orgId}, ${plan!.id}, 'active', 'sub_test_nokey', now(), now() + interval '30 days')`;

    const res = await call(ctxNoStripe, 'POST', '/v1/billing/cancel', { as: company.owner });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'dependency_unavailable' });
    await ctxNoStripe.cleanup();
  });
});
