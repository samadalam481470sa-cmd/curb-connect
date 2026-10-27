// HMAC-signed, short-lived capability tokens for the local storage adapter's upload/download
// routes. The token binds operation, object key, expiry and (for uploads) the declared type/limit.
// It is not sufficient on its own: the routes also require a session in the key's org.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface StorageTokenClaims {
  op: 'upload' | 'download';
  key: string;
  /** Unix seconds. */
  exp: number;
  contentType: string;
  maxBytes?: number;
  fileName?: string;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`fieldline-storage-v1.${payload}`).digest('base64url');
}

export function createStorageToken(secret: string, claims: StorageTokenClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export type TokenCheck =
  | { ok: true; claims: StorageTokenClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_operation' };

export function verifyStorageToken(
  secret: string,
  token: string,
  op: StorageTokenClaims['op'],
  nowSeconds = Math.floor(Date.now() / 1000),
): TokenCheck {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return { ok: false, reason: 'malformed' };
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let claims: StorageTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StorageTokenClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (claims.op !== op) return { ok: false, reason: 'wrong_operation' };
  if (typeof claims.exp !== 'number' || claims.exp < nowSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}
