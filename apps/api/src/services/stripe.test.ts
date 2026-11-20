import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCheckoutSession, mapStripeStatus, StripeUnavailable, verifyStripeSignature } from './stripe';

const SECRET = 'whsec_test_123';
const BODY = '{"id":"evt_1","type":"customer.subscription.updated"}';
const NOW = 1_795_500_000;

function sign(body: string, timestamp: number, secret = SECRET): string {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

describe('verifyStripeSignature', () => {
  it('accepts a correctly signed, fresh payload', () => {
    expect(verifyStripeSignature(BODY, sign(BODY, NOW), SECRET, NOW)).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, and a missing header', () => {
    expect(verifyStripeSignature(BODY + ' ', sign(BODY, NOW), SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, sign(BODY, NOW, 'whsec_other'), SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, undefined, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, sign(BODY, NOW), '', NOW)).toBe(false);
  });

  it('rejects replays outside the five-minute window', () => {
    expect(verifyStripeSignature(BODY, sign(BODY, NOW - 301), SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, sign(BODY, NOW + 301), SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, sign(BODY, NOW - 299), SECRET, NOW)).toBe(true);
  });

  it('rejects malformed headers instead of guessing', () => {
    expect(verifyStripeSignature(BODY, 'v1=abc', SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, `t=${NOW},v1=zz`, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, `t=abc,v1=${'a'.repeat(64)}`, SECRET, NOW)).toBe(false);
  });

  it('accepts when any one of several v1 signatures matches (key rotation)', () => {
    const good = sign(BODY, NOW).split(',')[1]!;
    expect(verifyStripeSignature(BODY, `t=${NOW},v1=${'b'.repeat(64)},${good}`, SECRET, NOW)).toBe(true);
  });
});

describe('mapStripeStatus', () => {
  it('maps paid and lapsed states, and ignores incomplete ones', () => {
    expect(mapStripeStatus('active')).toBe('active');
    expect(mapStripeStatus('trialing')).toBe('trialing');
    expect(mapStripeStatus('past_due')).toBe('past_due');
    expect(mapStripeStatus('unpaid')).toBe('past_due');
    expect(mapStripeStatus('paused')).toBe('paused');
    expect(mapStripeStatus('canceled')).toBe('canceled');
    expect(mapStripeStatus('incomplete')).toBeNull();
    expect(mapStripeStatus('something_new')).toBeNull();
  });
});

describe('createCheckoutSession', () => {
  it('posts only company metadata and returns the hosted URL', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test' }), { status: 200 });
    }) as unknown as typeof fetch;
    const url = await createCheckoutSession({
      secretKey: 'sk_test_x',
      priceId: 'price_123',
      orgId: '11111111-1111-4111-8111-111111111111',
      successUrl: 'https://app.example/billing?ok=1',
      cancelUrl: 'https://app.example/billing',
      fetchImpl,
    });
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test');
    expect(captured!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const params = new URLSearchParams(String(captured!.init.body));
    expect(params.get('mode')).toBe('subscription');
    expect(params.get('line_items[0][price]')).toBe('price_123');
    expect(params.get('metadata[orgId]')).toBe('11111111-1111-4111-8111-111111111111');
    expect([...params.keys()].join(' ')).not.toMatch(/email|name|phone/);
  });

  it('reports Stripe failures and malformed responses as unavailable', async () => {
    const base = { secretKey: 'k', priceId: 'p', orgId: 'o', successUrl: 'https://a', cancelUrl: 'https://b' };
    const httpError = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(createCheckoutSession({ ...base, fetchImpl: httpError })).rejects.toBeInstanceOf(StripeUnavailable);
    const noUrl = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(createCheckoutSession({ ...base, fetchImpl: noUrl })).rejects.toThrow(/checkout URL/);
    const httpUrl = (async () => new Response(JSON.stringify({ url: 'http://insecure' }), { status: 200 })) as unknown as typeof fetch;
    await expect(createCheckoutSession({ ...base, fetchImpl: httpUrl })).rejects.toThrow(/checkout URL/);
  });
});
