import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LICENSE_AMOUNT_CENTS = 15_000;
export const LICENSE_CURRENCY = 'usd';
export const PACKAGE_SKU = 'field-pro-license';
/** Must match TERMS_VERSION in public/storefront.js and the version on public/terms.html. */
export const TERMS_VERSION = '2026-11-14';
export const releasePath = fileURLToPath(new URL('../release/field-pro-app.zip', import.meta.url));

export function checkoutConfig() {
  const { SITE_ORIGIN, STRIPE_SECRET_KEY, STRIPE_PRICE_ID, DOWNLOAD_TOKEN_SECRET, VERCEL_ENV } =
    process.env;
  if (
    !SITE_ORIGIN ||
    !STRIPE_SECRET_KEY ||
    !STRIPE_PRICE_ID?.startsWith('price_') ||
    !DOWNLOAD_TOKEN_SECRET ||
    DOWNLOAD_TOKEN_SECRET.length < 32 ||
    (VERCEL_ENV === 'production' && !/^(sk|rk)_live_/.test(STRIPE_SECRET_KEY))
  ) {
    throw new Error('Checkout configuration is incomplete');
  }
  const origin = new URL(SITE_ORIGIN);
  if (origin.protocol !== 'https:' || SITE_ORIGIN !== origin.origin) {
    throw new Error('Invalid storefront origin');
  }
  return { origin: origin.origin, key: STRIPE_SECRET_KEY, priceId: STRIPE_PRICE_ID };
}

export function requireRelease() {
  if (!existsSync(releasePath)) {
    throw new Error('Release package is unavailable');
  }
}
