// Activation codes: owner-issued, single-use codes that give a company time without a card.
// Format XXXX-XXXX-XXXX-XXXX from Crockford base32 (no I, L, O, U), so codes read clearly on paper.
// 16 characters carry 80 bits of randomness. Only a SHA-256 hash is stored.
import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 16;

export function generateActivationCode(): string {
  // 32 symbols and 256 byte values: masking with 31 is exact, so there is no modulo bias.
  const bytes = randomBytes(CODE_LENGTH);
  let raw = '';
  for (const b of bytes) raw += ALPHABET[b & 31];
  return raw.match(/.{4}/g)!.join('-');
}

/** Canonical form for hashing: typed case, spaces and dashes are ignored, look-alike letters are mapped. */
export function normalizeActivationCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return cleaned;
}

export function hashActivationCode(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}
