import {
  LICENSE_AMOUNT_CENTS,
  LICENSE_CURRENCY,
  PACKAGE_SKU,
  PAYMENT_LINK_URL,
  PRICE_ID,
  siteOrigin,
} from '../lib/config.mjs';
import { getStripe } from '../lib/stripe.mjs';

/**
 * POST /api/checkout
 * Creates a Stripe Checkout Session for the $150 Field Pro license.
 * Falls back to the Payment Link URL when STRIPE_SECRET_KEY is missing.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', siteOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = siteOrigin(req);
  const email =
    req.body && typeof req.body.email === 'string' ? req.body.email.trim().slice(0, 320) : undefined;

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(200).json({
      mode: 'payment_link',
      url: PAYMENT_LINK_URL,
      notice: 'Using hosted Stripe Payment Link. Set STRIPE_SECRET_KEY for dynamic Checkout Sessions.',
    });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#pricing`,
      customer_email: email || undefined,
      customer_creation: 'if_required',
      billing_address_collection: 'auto',
      invoice_creation: { enabled: true },
      submit_type: 'pay',
      metadata: {
        sku: PACKAGE_SKU,
        package: 'field-pro-app',
        amount_cents: String(LICENSE_AMOUNT_CENTS),
        currency: LICENSE_CURRENCY,
      },
      payment_intent_data: {
        metadata: { sku: PACKAGE_SKU, package: 'field-pro-app' },
      },
    });

    return res.status(200).json({
      mode: 'checkout_session',
      id: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('checkout_error', error?.message || error);
    return res.status(502).json({
      error: 'Unable to start checkout',
      code: 'checkout_failed',
      fallbackUrl: PAYMENT_LINK_URL,
    });
  }
}
