import { checkoutConfig, PACKAGE_SKU, requireRelease } from '../lib/config.mjs';
import { getStripe, isLicensePrice } from '../lib/stripe.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
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
      metadata: { sku: PACKAGE_SKU },
    });
    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Field Pro checkout unavailable', error.type || error.message);
    return res
      .status(503)
      .json({ error: 'Checkout is temporarily unavailable. Please try again later.' });
  }
}
