// Password hashing, random tokens and token encryption. Built only on node:crypto.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

/** scrypt cost. N=2^15, r=8 uses 32 MiB per hash, which is within OWASP's guidance. */
export interface ScryptCost {
  N: number;
  r: number;
  p: number;
}
export const DEFAULT_COST: ScryptCost = { N: 32768, r: 8, p: 1 };
const KEY_LENGTH = 32;

function scryptAsync(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { ...cost, maxmem: 256 * cost.N * cost.r * cost.p },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** Returns `scrypt$N$r$p$salt$hash`. The password itself is never stored. */
export async function hashPassword(
  password: string,
  cost: ScryptCost = DEFAULT_COST,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, cost);
  return ['scrypt', cost.N, cost.r, cost.p, salt.toString('base64'), key.toString('base64')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, hashText] = parts as [string, string, string, string, string, string];
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (![cost.N, cost.r, cost.p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const expected = Buffer.from(hashText, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltText, 'base64'), cost);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** A fixed hash checked when the username does not exist, so both paths take the same time. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(cost: ScryptCost = DEFAULT_COST): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'), cost);
  return dummyHash;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** PKCE S256 challenge for a code verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** AES-256-GCM. Output: v1.iv.tag.ciphertext (base64url parts). */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

export function decryptSecret(sealed: string, key: Buffer): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || body === undefined) throw new Error('unreadable secret');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'letmein123',
  'welcome123',
  'admin123',
  'abc12345',
  '11111111',
  '00000000',
]);

/** Returns a problem to show the user, or null when the password is acceptable. */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters for the password.';
  if (password.length > 200) return 'Use at most 200 characters for the password.';
  if (COMMON_PASSWORDS.has(password.toLowerCase()))
    return 'That password is too common. Pick another.';
  if (username && password.toLowerCase() === username.toLowerCase()) {
    return 'The password cannot be the same as the username.';
  }
  return null;
}
