import { getStripe } from '../lib/stripe.mjs';
import { issueDownloadToken } from '../lib/download-token.mjs';
import { PACKAGE_SKU } from '../lib/config.mjs';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * POST /api/webhook
 * Stripe webhook. Fulfillment is gated on payment_status for both
 * checkout.session.completed and checkout.session.async_payment_succeeded.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!process.env.STRIPE_SECRET_KEY || !webhookSecret) {
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  try {
    const stripe = getStripe();
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object;
      if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
        const email = session.customer_details?.email || session.customer_email || null;
        // Issue token for observability / future email delivery. Download still verifies live.
        const token = issueDownloadToken(session.id, email);
        console.info(
          JSON.stringify({
            event: 'field_pro_purchase_fulfilled',
            type: event.type,
            sessionId: session.id,
            email,
            sku: PACKAGE_SKU,
            amountTotal: session.amount_total,
            currency: session.currency,
            tokenIssued: Boolean(token),
          }),
        );
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('webhook_error', error?.message || error);
    return res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }
}
