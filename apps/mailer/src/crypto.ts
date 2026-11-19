// AES-256-GCM sealing for stored refresh tokens and the short-lived OAuth state cookie. Each use
// gets its own key derived from MAILER_TOKEN_ENCRYPTION_KEY (HKDF-SHA256), and the associated data
// binds a sealed value to its owner, so a token copied onto another member's row will not open.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export function deriveKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', master, Buffer.alloc(0), `fieldline-mailer:${purpose}`, 32),
  );
}

export function seal(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, body]).toString('base64url')}`;
}

/** Throws when the value was tampered with, sealed for another owner, or sealed with another key. */
export function unseal(key: Buffer, sealed: string, aad: string): string {
  const [version, payload] = sealed.split('.');
  if (version !== VERSION || !payload) throw new Error('unsupported sealed value');
  const raw = Buffer.from(payload, 'base64url');
  if (raw.length < 29) throw new Error('sealed value too short');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** RFC 7636 S256 code challenge. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
