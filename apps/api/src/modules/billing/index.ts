// `billing` module: trial status, subscription checkout, cancel-at-period-end and the Stripe webhook.
//
// Access rule and the trial clock live in services/billing-access.ts and the organizations table
// (migration 0020). These routes stay reachable after a trial ends (allowExpiredOrg) so an expired
// company can see its status and subscribe. Nothing here charges automatically: Checkout is the only
// place a card is taken, after the customer accepts the renewal terms shown next to the button.
//
// LEGAL GATE (California Automatic Renewal Law, FTC Negative Option Rule): before subscribing the
// screen must show the price, the billing period, that it renews until cancelled, and how to cancel,
// with a separate consent checkbox. The API requires `acceptedTerms: true` on every checkout request.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { users } from '../../db/schema/auth';
import { organizations } from '../../db/schema/orgs';
import { activationCodes, plans, subscriptions, trialClaims } from '../../db/schema/billing';
import { requireOrg, requireUser, platformTx, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { hashActivationCode, normalizeActivationCode } from '../../services/activation-codes';
import { trialEmailKey } from '../../services/trial-email';
import { decideAccess } from '../../services/billing-access';
import { createCheckoutSession, cancelSubscriptionAtPeriodEnd, mapStripeStatus, StripeUnavailable, verifyStripeSignature } from '../../services/stripe';

const StatusResponse = z.object({
  access: z.enum(['subscribed', 'activated', 'grandfathered', 'trial', 'expired']),
  trialDaysLeft: z.number().int().nullable(),
  trialEndsAt: z.string().nullable(),
  /** End of the time bought with an activation code, or null. */
  activatedUntil: z.string().nullable(),
  /** True when this person's email address has already had its one free trial. */
  emailTrialUsed: z.boolean(),
  /** Whether the person has opened the link we emailed. */
  emailVerified: z.boolean(),
  /** The trial is held until the owner verifies their email. */
  trialPending: z.boolean(),
  subscription: z
    .object({ status: z.string(), currentPeriodEnd: z.string(), cancelAt: z.string().nullable() })
    .nullable(),
  plan: z
    .object({ name: z.string(), priceMinor: z.number().int(), currency: z.string(), interval: z.string() })
    .nullable(),
  checkoutAvailable: z.boolean(),
});

const ActivateBody = z.object({
  code: z.string().min(4).max(40),
});

const CheckoutBody = z.object({
  acceptedTerms: z.literal(true),
});

interface StripeEventObject {
  id?: unknown;
  status?: unknown;
  metadata?: { orgId?: unknown } | null;
  current_period_start?: unknown;
  current_period_end?: unknown;
  cancel_at?: unknown;
  items?: { data?: Array<{ current_period_start?: unknown; current_period_end?: unknown }> };
}

const toSeconds = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const billingModule: FastifyPluginAsyncZod = async (app) => {
  app.get('/billing/status', {
    config: { auth: 'org', allowExpiredOrg: true, rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: {
      tags: ['billing'],
      summary: 'Trial, subscription and access state for the active company',
      response: { 200: StatusResponse },
    },
  }, async (request) => readStatus(request));

  app.post('/billing/activate', {
    config: {
      permission: 'billing_settings:update',
      allowExpiredOrg: true,
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['billing'],
      summary: 'Redeem an activation code for the active company',
      body: ActivateBody,
      response: { 200: StatusResponse },
    },
  }, async (request) => {
    const org = requireOrg(request);
    const normalized = normalizeActivationCode(request.body.code);
    if (!normalized) throw problem('activation_code_invalid');
    const hash = hashActivationCode(normalized);
    const redeemed = await platformTx(request, 'billing.activate', async (tx) => {
      const [code] = await tx
        .select()
        .from(activationCodes)
        .where(eq(activationCodes.codeHash, hash))
        .for('update')
        .limit(1);
      if (!code || code.revokedAt || code.redeemedAt) return null;
      await tx
        .update(activationCodes)
        .set({ redeemedAt: sql`now()`, redeemedOrgId: org.orgId, redeemedByUserId: org.userId })
        .where(eq(activationCodes.id, code.id));
      // Extends from the current end of access, so two codes stack instead of overlapping.
      await tx
        .update(organizations)
        .set({
          activatedUntil: sql`greatest(coalesce(${organizations.activatedUntil}, now()), now()) + make_interval(days => ${code.grantDays})`,
        })
        .where(eq(organizations.id, org.orgId));
      await auditRequest(request, tx, {
        orgId: org.orgId,
        action: 'billing.activation_redeemed',
        resourceType: 'organization',
        resourceId: org.orgId,
        after: { codeId: code.id, grantDays: code.grantDays },
      });
      return true;
    }, { orgId: org.orgId, userId: org.userId });
    if (!redeemed) throw problem('activation_code_invalid');
    return readStatus(request);
  });

  async function readStatus(request: FastifyRequest) {
    const org = requireOrg(request);
    const user = requireUser(request);
    // Recomputed from the rows, not taken from the request-start snapshot, so a code redeemed in this
    // request is reflected in the response.
    const { org: row, sub, plan, activatedUntil, access, trialDaysLeft } = await tenantTx(request, async (tx) => {
      const [o] = await tx
        .select({
          trialEndsAt: organizations.trialEndsAt,
          billingExempt: organizations.billingExempt,
          trialPending: organizations.trialPending,
          activatedUntil: organizations.activatedUntil,
        })
        .from(organizations)
        .where(eq(organizations.id, org.orgId))
        .limit(1);
      const [s] = await tx
        .select({ status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd, cancelAt: subscriptions.cancelAt, planId: subscriptions.planId })
        .from(subscriptions)
        .where(eq(subscriptions.orgId, org.orgId))
        .orderBy(desc(subscriptions.currentPeriodEnd))
        .limit(1);
      const [p] = s
        ? await tx.select({ name: plans.name, priceMinor: plans.priceMinor, currency: plans.currency, interval: plans.interval })
            .from(plans)
            .where(eq(plans.id, s.planId))
            .limit(1)
        : [];
      // A company that has not subscribed yet still needs the price and renewal terms before
      // checkout (item 12): fall back to the active catalog plan checkout would sell.
      const [catalog] = p
        ? []
        : await tx.select({ name: plans.name, priceMinor: plans.priceMinor, currency: plans.currency, interval: plans.interval })
            .from(plans)
            .where(and(eq(plans.code, app.config.payments.planCode), eq(plans.active, true)))
            .limit(1);
      const decision = decideAccess({
        now: new Date(),
        billingExempt: o?.billingExempt ?? false,
        trialEndsAt: o?.trialEndsAt ?? null,
        activatedUntil: o?.activatedUntil ?? null,
        subscription: s ? { status: s.status, currentPeriodEnd: s.currentPeriodEnd } : null,
      });
      return {
        org: o,
        sub: s,
        plan: p ?? catalog ?? null,
        activatedUntil: o?.activatedUntil ?? null,
        access: decision.state,
        trialDaysLeft: decision.trialDaysLeft,
      };
    });
    const { emailTrialUsed, emailVerified } = await platformTx(request, 'billing.status', async (tx) => {
      const [u] = await tx
        .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.id, user.userId))
        .limit(1);
      const key = u?.email ? trialEmailKey(u.email) : null;
      const [claim] = key
        ? await tx.select({ key: trialClaims.emailKey }).from(trialClaims).where(eq(trialClaims.emailKey, key)).limit(1)
        : [];
      return { emailTrialUsed: Boolean(claim), emailVerified: Boolean(u?.emailVerifiedAt) };
    }, { orgId: org.orgId, userId: user.userId });
    return {
      access,
      trialDaysLeft,
      trialEndsAt: row?.trialEndsAt ? row.trialEndsAt.toISOString() : null,
      activatedUntil: activatedUntil ? activatedUntil.toISOString() : null,
      emailTrialUsed,
      emailVerified,
      trialPending: Boolean(row?.trialPending),
      subscription: sub ? { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString(), cancelAt: sub.cancelAt ? sub.cancelAt.toISOString() : null } : null,
      plan: plan,
      checkoutAvailable: Boolean(app.config.payments.stripePriceId && app.config.payments.stripeSecretKey),
    };
  }

  app.post('/billing/checkout', {
    config: {
      permission: 'billing_settings:update',
      allowExpiredOrg: true,
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['billing'],
      summary: 'Start a subscription Checkout for the active company (requires acceptance of the renewal terms)',
      body: CheckoutBody,
      response: { 200: z.object({ url: z.string().url() }) },
    },
  }, async (request) => {
    const org = requireOrg(request);
    const { payments } = app.config;
    const appOrigin = app.config.appOrigin;
    if (!payments.stripeSecretKey || !payments.stripePriceId) {
      throw problem('dependency_unavailable', 'Online payments are not configured on this server.', { retryable: false });
    }
    if (org.access === 'subscribed') {
      throw problem('conflict', 'This company already has an active subscription.');
    }
    try {
      const url = await createCheckoutSession({
        secretKey: payments.stripeSecretKey,
        priceId: payments.stripePriceId,
        orgId: org.orgId,
        successUrl: `${appOrigin}/subscription?checkout=success`,
        cancelUrl: `${appOrigin}/subscription?checkout=cancelled`,
      });
      return { url };
    } catch (err) {
      if (err instanceof StripeUnavailable) {
        throw problem('payment_provider_error', 'The payment provider could not start checkout. Try again shortly.', { retryable: true });
      }
      throw err;
    }
  });

  // Cancel at the end of the paid period: the subscription stays active until
  // currentPeriodEnd and is never ended immediately, matching the refund policy (full refund
  // within 30 days of first payment; after that, cancel anytime and keep access to the end of
  // the period already paid for). Repeating the call is a no-op once Stripe has been told:
  // the stored cancelAt is returned without a second Stripe call, and the Stripe call itself
  // carries a deterministic idempotency key. No migration was needed: subscriptions already
  // stores providerSubscriptionId, status and cancelAt, and the webhook already records
  // cancel_at from customer.subscription.updated.
  app.post('/billing/cancel', {
    config: {
      permission: 'billing_settings:update',
      allowExpiredOrg: true,
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['billing'],
      summary: 'Schedule the active subscription to cancel at the end of its paid period',
      response: { 200: StatusResponse },
    },
  }, async (request) => {
    const org = requireOrg(request);
    const { payments } = app.config;
    if (!payments.stripeSecretKey) {
      throw problem('dependency_unavailable', 'Online payments are not configured on this server.', { retryable: false });
    }
    const found = await tenantTx(request, async (tx) => {
      const [s] = await tx
        .select({
          id: subscriptions.id,
          status: subscriptions.status,
          providerSubscriptionId: subscriptions.providerSubscriptionId,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          cancelAt: subscriptions.cancelAt,
        })
        .from(subscriptions)
        .where(eq(subscriptions.orgId, org.orgId))
        .orderBy(desc(subscriptions.currentPeriodEnd))
        .limit(1);
      return s ?? null;
    });
    if (!found || !found.providerSubscriptionId || !['active', 'trialing', 'past_due'].includes(found.status)) {
      throw problem('conflict', 'This company has no active subscription to cancel.');
    }
    if (found.cancelAt) return readStatus(request);
    let result: { status: string; cancelAt: Date | null; currentPeriodEnd: Date | null };
    try {
      result = await cancelSubscriptionAtPeriodEnd({
        secretKey: payments.stripeSecretKey,
        subscriptionId: found.providerSubscriptionId,
        ...(app.stripeSubscriptions ? { client: app.stripeSubscriptions } : {}),
      });
    } catch (err) {
      if (err instanceof StripeUnavailable) {
        throw problem('payment_provider_error', 'The payment provider could not cancel the subscription. Try again shortly.', { retryable: true });
      }
      throw err;
    }
    // Record Stripe's answer locally so the status screen is honest even before the webhook
    // arrives; the webhook later reconciles the same row.
    const cancelAt = result.cancelAt ?? result.currentPeriodEnd ?? found.currentPeriodEnd;
    await tenantTx(request, async (tx) => {
      await tx
        .update(subscriptions)
        .set({ cancelAt, revision: sql`${subscriptions.revision} + 1` })
        .where(eq(subscriptions.id, found.id));
      await auditRequest(request, tx, {
        orgId: org.orgId,
        action: 'billing.subscription_cancel_scheduled',
        resourceType: 'subscription',
        resourceId: found.id,
        before: { status: found.status },
        after: { status: result.status, cancelAt: cancelAt.toISOString() },
      });
    });
    return readStatus(request);
  });

  // The webhook must verify the signature over the exact bytes Stripe sent, so JSON is kept raw here.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    (request as unknown as { rawBody: string }).rawBody = String(body);
    try {
      done(null, body === '' ? {} : JSON.parse(String(body)));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.post('/billing/webhook', {
    config: { auth: 'none', rateLimit: { max: 300, timeWindow: '1 minute' } },
    schema: { tags: ['billing'], summary: 'Stripe webhook: subscription lifecycle events (signature required)' },
  }, async (request, reply) => {
    const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? '';
    const secret = app.config.payments.stripeWebhookSecret;
    if (!secret) throw problem('dependency_unavailable', 'Webhook secret is not configured.', { retryable: true });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = request.headers['stripe-signature'];
    if (!verifyStripeSignature(rawBody, typeof header === 'string' ? header : undefined, secret, nowSeconds)) {
      throw problem('webhook_signature_invalid');
    }

    const event = (request.body ?? {}) as { type?: unknown; data?: { object?: StripeEventObject } };
    const type = typeof event.type === 'string' ? event.type : '';
    if (!type.startsWith('customer.subscription.')) {
      return { received: true, handled: false };
    }
    const obj = event.data?.object ?? {};
    const orgId = typeof obj.metadata?.orgId === 'string' ? obj.metadata.orgId : null;
    const providerId = typeof obj.id === 'string' ? obj.id : null;
    const status = type === 'customer.subscription.deleted' ? 'canceled' : mapStripeStatus(String(obj.status ?? ''));
    const periodStart = toSeconds(obj.current_period_start) ?? toSeconds(obj.items?.data?.[0]?.current_period_start);
    const periodEnd = toSeconds(obj.current_period_end) ?? toSeconds(obj.items?.data?.[0]?.current_period_end);
    if (!orgId || !providerId || !status || periodStart === null || periodEnd === null || !z.uuid().safeParse(orgId).success) {
      // Not something we can attach to a company (or not yet paid): acknowledge so Stripe does not retry.
      reply.code(200);
      return { received: true, handled: false };
    }

    const result = await platformTx(request, 'billing.webhook', async (tx) => {
      const [plan] = await tx
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.code, app.config.payments.planCode), eq(plans.active, true)))
        .limit(1);
      if (!plan) return 'no_plan';
      const [existing] = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.providerSubscriptionId, providerId)))
        .limit(1);
      const values = {
        planId: plan.id,
        status,
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        cancelAt: toSeconds(obj.cancel_at) === null ? null : new Date((obj.cancel_at as number) * 1000),
      };
      if (existing) {
        await tx.update(subscriptions).set({ ...values, revision: sql`${subscriptions.revision} + 1` }).where(eq(subscriptions.id, existing.id));
      } else {
        await tx.insert(subscriptions).values({
          id: randomUUID(),
          orgId,
          providerSubscriptionId: providerId,
          ...values,
        });
      }
      return 'ok';
    }, { orgId, userId: null });

    if (result === 'no_plan') {
      // The plan row is missing: fail so Stripe retries once the catalog is configured.
      throw problem('dependency_unavailable', 'Subscription plan is not configured yet.', { retryable: true });
    }
    return { received: true, handled: true };
  });
};

export default billingModule;
