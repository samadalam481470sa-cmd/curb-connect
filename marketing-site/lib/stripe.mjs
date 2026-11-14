import Stripe from 'stripe';
import { checkoutConfig, LICENSE_AMOUNT_CENTS, LICENSE_CURRENCY, PACKAGE_SKU } from './config.mjs';

let client;

export function getStripe() {
  client ??= new Stripe(checkoutConfig().key, { timeout: 8000, maxNetworkRetries: 1 });
  return client;
}

export function isLicensePrice(price) {
  return (
    price.type === 'one_time' &&
    price.unit_amount === LICENSE_AMOUNT_CENTS &&
    price.currency === LICENSE_CURRENCY
  );
}

export async function requirePaidSession(sessionId) {
  if (typeof sessionId !== 'string' || !/^cs_(test|live)_[a-zA-Z0-9]+$/.test(sessionId)) {
    throw Object.assign(new Error('Invalid checkout session.'), { statusCode: 400 });
  }
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'payment_intent.latest_charge'],
  });
  const items = session.line_items?.data;
  if (
    session.mode !== 'payment' ||
    session.metadata?.sku !== PACKAGE_SKU ||
    session.currency !== LICENSE_CURRENCY ||
    session.amount_total !== LICENSE_AMOUNT_CENTS ||
    items?.length !== 1 ||
    items[0].quantity !== 1 ||
    !items[0].price ||
    !isLicensePrice(items[0].price)
  ) {
    throw Object.assign(new Error('This session is not a Field Pro purchase.'), {
      statusCode: 403,
    });
  }

  if (session.status !== 'complete' || session.payment_status !== 'paid') {
    throw Object.assign(new Error('Payment is still unconfirmed. Try again shortly.'), {
      statusCode: 402,
    });
  }

  const charge = session.payment_intent?.latest_charge;
  if (!charge || typeof charge === 'string' || charge.amount_refunded || charge.disputed) {
    throw Object.assign(new Error('This purchase is unavailable for download.'), {
      statusCode: 403,
    });
  }
  return session;
}
