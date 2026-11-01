import { createHmac, timingSafeEqual } from 'node:crypto';

function secret() {
  const value = process.env.DOWNLOAD_TOKEN_SECRET || process.env.STRIPE_SECRET_KEY;
  if (!value) {
    const err = new Error('DOWNLOAD_TOKEN_SECRET is not configured');
    err.statusCode = 503;
    err.code = 'token_secret_missing';
    throw err;
  }
  return value;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/**
 * Issue a short-lived download token bound to a paid Stripe Checkout Session.
 * Default TTL: 24 hours.
 */
export function issueDownloadToken(sessionId, email, ttlSeconds = 60 * 60 * 24) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = b64url(
    JSON.stringify({
      sid: sessionId,
      email: email || null,
      exp,
      sku: 'field-pro-license',
    }),
  );
  const sig = b64url(createHmac('sha256', secret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyDownloadToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    const err = new Error('Missing or invalid download token');
    err.statusCode = 401;
    err.code = 'invalid_token';
    throw err;
  }
  const [payload, sig] = token.split('.', 2);
  const expected = b64url(createHmac('sha256', secret()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    const err = new Error('Download token signature mismatch');
    err.statusCode = 401;
    err.code = 'invalid_token';
    throw err;
  }
  const data = JSON.parse(fromB64url(payload).toString('utf8'));
  if (!data.sid || !data.exp || data.exp < Math.floor(Date.now() / 1000)) {
    const err = new Error('Download token expired');
    err.statusCode = 401;
    err.code = 'token_expired';
    throw err;
  }
  return data;
}
