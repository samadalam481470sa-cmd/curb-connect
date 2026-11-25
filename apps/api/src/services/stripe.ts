// Stripe integration: webhook signature verification, status mapping and Checkout session creation
// over Stripe's HTTP API, plus subscription cancellation through the Stripe SDK (the `stripe`
// dependency, previously unused in code). Only company identifiers are sent to Stripe as metadata;
// no personal data beyond what Checkout itself collects.
import { createHmac, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';
import type { SubscriptionStatus } from './billing-access';

export const STRIPE_TOLERANCE_SECONDS = 300;

/**
 * Verify a Stripe-Signature header ("t=<unix>,v1=<hex>[,v1=...]") against the raw request body.
 * Rejects signatures outside the replay window and any mismatch, using a constant-time comparison.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = STRIPE_TOLERANCE_SECONDS,
): boolean {
  if (!header || !secret) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === 't' && value && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && value && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return signatures.some((sig) => {
    const candidate = Buffer.from(sig, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

/** Map a Stripe subscription status onto ours. Incomplete states are not yet paid, so they return null. */
export function mapStripeStatus(status: string): SubscriptionStatus | null {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'paused':
      return 'paused';
    case 'canceled':
      return 'canceled';
    default:
      return null;
  }
}

export interface CheckoutInput {
  secretKey: string;
  priceId: string;
  orgId: string;
  successUrl: string;
  cancelUrl: string;
  fetchImpl?: typeof fetch;
}

/** Create a subscription Checkout session and return its hosted URL. */
export async function createCheckoutSession(input: CheckoutInput): Promise<string> {
  const body = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': '1',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgId,
    'metadata[orgId]': input.orgId,
    'subscription_data[metadata][orgId]': input.orgId,
    allow_promotion_codes: 'false',
  });
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': `checkout-${input.orgId}-${input.priceId}-${Math.floor(Date.now() / 60_000)}`,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new StripeUnavailable(`Stripe returned HTTP ${res.status}`);
  const json = (await res.json()) as { url?: unknown };
  if (typeof json.url !== 'string' || !json.url.startsWith('https://')) {
    throw new StripeUnavailable('Stripe did not return a checkout URL');
  }
  return json.url;
}

export class StripeUnavailable extends Error {}

/**
 * Minimal surface of the Stripe SDK the cancel flow needs. The real SDK client satisfies it;
 * tests pass a fake instead of hitting api.stripe.com.
 */
export interface StripeSubscriptionClient {
  update(
    subscriptionId: string,
    params: { cancel_at_period_end: true },
    options: { idempotencyKey: string },
  ): Promise<{ status: string; cancel_at: number | null; current_period_end: number | null }>;
}

/** Adapt the real SDK client to the shape above. Stripe reports the period end per subscription
 * item (the Subscription itself has no top-level current_period_end in this SDK version), so the
 * first item's period end is used, falling back to cancel_at when there are no items. */
function sdkSubscriptionClient(secretKey: string): StripeSubscriptionClient {
  const subscriptions = new Stripe(secretKey).subscriptions;
  return {
    update: async (subscriptionId, params, options) => {
      const sub = await subscriptions.update(subscriptionId, params, options);
      return {
        status: sub.status,
        cancel_at: sub.cancel_at,
        current_period_end: sub.items.data[0]?.current_period_end ?? sub.cancel_at,
      };
    },
  };
}

export interface CancelSubscriptionInput {
  secretKey: string;
  subscriptionId: string;
  /** Injectable SDK client; defaults to a real `new Stripe(secretKey)` client. */
  client?: StripeSubscriptionClient;
  /** Idempotency key for the Stripe call; defaults to `cancel-<subscriptionId>`. */
  idempotencyKey?: string;
}

export interface CancelSubscriptionResult {
  status: string;
  /** When Stripe will end the subscription (the end of the paid period), or null. */
  cancelAt: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * Schedule a subscription to cancel at the end of its paid period: Stripe keeps it active until
 * `current_period_end` and reports that date in `cancel_at`. It never cancels immediately, so
 * access runs to the end of the period already paid for (the refund policy). The Stripe call is
 * idempotent on `cancel-<subscriptionId>` unless the caller passes its own key.
 */
export async function cancelSubscriptionAtPeriodEnd(
  input: CancelSubscriptionInput,
): Promise<CancelSubscriptionResult> {
  const client: StripeSubscriptionClient = input.client ?? sdkSubscriptionClient(input.secretKey);
  let sub: { status: string; cancel_at: number | null; current_period_end: number | null };
  try {
    sub = await client.update(
      input.subscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: input.idempotencyKey ?? `cancel-${input.subscriptionId}` },
    );
  } catch {
    throw new StripeUnavailable('Stripe could not cancel the subscription');
  }
  if (typeof sub.status !== 'string') {
    throw new StripeUnavailable('Stripe returned an unexpected subscription');
  }
  return {
    status: sub.status,
    cancelAt: typeof sub.cancel_at === 'number' ? new Date(sub.cancel_at * 1000) : null,
    currentPeriodEnd:
      typeof sub.current_period_end === 'number' ? new Date(sub.current_period_end * 1000) : null,
  };
}
