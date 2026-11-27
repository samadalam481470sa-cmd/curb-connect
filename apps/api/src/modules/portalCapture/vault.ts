// Credential vault for portal capture: supplier portal secrets are sealed
// with AES-256-GCM using the deployment's STORAGE_ENCRYPTION_KEY (the same
// 32-byte base64 key that protects local object storage — see
// src/storage/local.ts) before they touch the database. Sealed form is
// base64url(iv + authTag + body) with a fixed AAD so a sealed value cannot
// be transplanted into another context.
//
// Rules enforced here and in the API layer:
//   * Secrets are write-only. No API returns a secret (sealed or plain).
//   * Secrets are never logged, never put in job payloads, never in errors.
//   * If STORAGE_ENCRYPTION_KEY is not configured, the vault is unavailable
//     and the API refuses to store secrets (honest gated state) instead of
//     falling back to plaintext or a weaker key.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const AAD = Buffer.from('portal-capture-secret-v1', 'utf8');
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function vaultKeyFromConfig(encryptionKey: string | undefined): Buffer | null {
  if (!encryptionKey) return null;
  const key = Buffer.from(encryptionKey, 'base64');
  return key.length === 32 ? key : null;
}

export function sealPortalSecret(key: Buffer, plain: string): string {
  if (key.length !== 32) throw new Error('portal vault needs a 32-byte key');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unsealPortalSecret(key: Buffer, sealed: string): string {
  if (key.length !== 32) throw new Error('portal vault needs a 32-byte key');
  const raw = Buffer.from(sealed, 'base64url');
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('sealed portal secret is malformed');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(AAD);
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString(
    'utf8',
  );
}
