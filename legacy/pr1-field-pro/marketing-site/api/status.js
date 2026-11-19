import { PAYMENT_LINK_URL, PRICE_ID, PRODUCT_ID } from '../lib/config.mjs';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const release = join(__dirname, '..', 'public', 'releases', 'field-pro-app.zip');
  return res.status(200).json({
    product: 'Field Pro',
    priceId: PRICE_ID,
    productId: PRODUCT_ID,
    paymentLinkConfigured: Boolean(PAYMENT_LINK_URL),
    stripeSecretConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    releasePublished: existsSync(release),
    checkoutReady: Boolean(PAYMENT_LINK_URL || process.env.STRIPE_SECRET_KEY),
    downloadReady: Boolean(process.env.STRIPE_SECRET_KEY) && existsSync(release),
  });
}
