import Stripe from 'stripe';
import { requireStripeSecret } from './config.mjs';

let client;

export function getStripe() {
  if (!client) {
    client = new Stripe(requireStripeSecret(), {
      apiVersion: '2026-09-30.endive',
      appInfo: { name: 'Field Pro Marketing', version: '1.0.0' },
    });
  }
  return client;
}

/** Returns a paid Checkout Session or throws. */
export async function requirePaidSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    const err = new Error('Invalid checkout session id');
    err.statusCode = 400;
    err.code = 'invalid_session';
    throw err;
  }
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'payment_intent'],
  });
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    const err = new Error('Payment is not complete');
    err.statusCode = 402;
    err.code = 'payment_incomplete';
    throw err;
  }
  if (session.status === 'expired') {
    const err = new Error('Checkout session expired');
    err.statusCode = 410;
    err.code = 'session_expired';
    throw err;
  }
  return session;
}
