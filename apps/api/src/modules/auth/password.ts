// Password hashing for username sign-in. Only `scrypt$N$r$p$salt$hash` is ever stored; the
// password itself never reaches the database or a log. Built on node:crypto only.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface ScryptCost {
  N: number;
  r: number;
  p: number;
}

/** N=2^15, r=8, p=1 uses 32 MiB per hash (OWASP's scrypt guidance). Tests pass a cheaper cost. */
export const DEFAULT_SCRYPT_COST: ScryptCost = { N: 32768, r: 8, p: 1 };
const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
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

export async function hashPassword(
  password: string,
  cost: ScryptCost = DEFAULT_SCRYPT_COST,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost);
  return ['scrypt', cost.N, cost.r, cost.p, salt.toString('base64'), key.toString('base64')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  const valid =
    [cost.N, cost.r, cost.p].every((v) => Number.isInteger(v) && v > 0) &&
    cost.N <= 1 << 20 &&
    cost.r <= 32 &&
    cost.p <= 4;
  if (!valid) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), cost);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * A hash checked when no account matches, so an unknown username takes as long as a wrong
 * password and the response time does not reveal which usernames exist.
 */
const dummies = new Map<string, Promise<string>>();
export function dummyHash(cost: ScryptCost = DEFAULT_SCRYPT_COST): Promise<string> {
  const key = `${cost.N}:${cost.r}:${cost.p}`;
  let hash = dummies.get(key);
  if (!hash) {
    hash = hashPassword(randomBytes(16).toString('hex'), cost);
    dummies.set(key, hash);
  }
  return hash;
}

/** Five wrong passwords in a row lock the account for 15 minutes. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
