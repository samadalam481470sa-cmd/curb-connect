// Stripe integration without the SDK: webhook signature verification, status mapping and Checkout
// session creation over Stripe's HTTP API. Only company identifiers are sent to Stripe as metadata;
// no personal data beyond what Checkout itself collects.
import { createHmac, timingSafeEqual } from 'node:crypto';
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
