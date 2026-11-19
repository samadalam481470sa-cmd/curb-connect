/** Shared marketing-site configuration. Secrets come from environment only. */

export const PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1UWpfV2Lo2k11Iv0f2FgrKJm';
export const PRODUCT_ID = process.env.STRIPE_PRODUCT_ID || 'prod_VXvW41CmNLOfOP';
export const PAYMENT_LINK_URL =
  process.env.STRIPE_PAYMENT_LINK_URL ||
  'https://buy.stripe.com/test_6oUeV6cXN0P0gzU9ss3Ru00';
export const LICENSE_AMOUNT_CENTS = 15_000;
export const LICENSE_CURRENCY = 'usd';
export const PACKAGE_SKU = 'field-pro-license';
export const RELEASE_FILENAME = 'field-pro-app.zip';

export function siteOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) return `${proto}://${host}`;
  return process.env.SITE_ORIGIN || 'https://field-pro-marketing.vercel.app';
}

export function requireStripeSecret() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const err = new Error('STRIPE_SECRET_KEY is not configured');
    err.statusCode = 503;
    err.code = 'stripe_not_configured';
    throw err;
  }
  return key;
}
