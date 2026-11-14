import { checkoutConfig, PACKAGE_SKU, requireRelease, TERMS_VERSION } from '../lib/config.mjs';
import { getStripe, isLicensePrice } from '../lib/stripe.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
  if (body?.acceptedTerms !== true || body?.termsVersion !== TERMS_VERSION) {
    return res.status(400).json({
      error: 'Please confirm you are 18 or older and accept the current terms before checkout.',
    });
  }

  try {
    requireRelease();
    const { origin, priceId } = checkoutConfig();
    const stripe = getStripe();
    const price = await stripe.prices.retrieve(priceId);
    if (!price.active || !isLicensePrice(price)) {
      throw new Error('The Field Pro price must be an active one-time $150 USD price');
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#pricing`,
      metadata: {
        sku: PACKAGE_SKU,
        terms_version: TERMS_VERSION,
        terms_accepted_at: new Date().toISOString(),
        age_18_plus_confirmed: 'true',
      },
      payment_intent_data: {
        description: 'Field Pro offline calculator, one-time license (no subscription)',
      },
      custom_text: {
        submit: {
          message:
            'One-time $150 payment. No subscription and no automatic renewal. ' +
            'By paying you agree to the Field Pro Terms of Service and Refund Policy ' +
            `(${origin}/terms, ${origin}/refunds).`,
        },
      },
    });
    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Field Pro checkout unavailable', error.type || error.message);
    return res
      .status(503)
      .json({ error: 'Checkout is temporarily unavailable. Please try again later.' });
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
