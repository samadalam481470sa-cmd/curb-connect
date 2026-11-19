import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseTokenKey } from './config';
import { buildRfc822, encodeSubject, isEmail } from './mail';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from './security';

const FAST = { N: 1024, r: 8, p: 1 };

describe('passwords', () => {
  it('stores a salted scrypt hash and verifies only the right password', async () => {
    const hash = await hashPassword('correct horse battery', FAST);
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$/);
    expect(hash).not.toContain('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterY', hash)).toBe(false);
    expect(await hashPassword('correct horse battery', FAST)).not.toBe(hash);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$0$8$1$a$b')).toBe(false);
  });

  it('checks password rules', () => {
    expect(passwordProblem('short', 'sam')).toMatch(/at least 8/);
    expect(passwordProblem('password123', 'sam')).toMatch(/too common/);
    expect(passwordProblem('samalam99', 'SamAlam99')).toMatch(/same as the username/);
    expect(passwordProblem('roofs-and-curbs-2026', 'sam')).toBeNull();
  });
});

describe('token encryption', () => {
  const key = randomBytes(32);

  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret('ya29.secret-token', key);
    const b = encryptSecret('ya29.secret-token', key);
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret-token');
    expect(decryptSecret(a, key)).toBe('ya29.secret-token');
  });

  it('refuses tampered data and the wrong key', () => {
    const sealed = encryptSecret('value', key);
    const parts = sealed.split('.');
    parts[3] = Buffer.from('other').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() => decryptSecret(sealed, randomBytes(32))).toThrow();
  });
});

describe('config', () => {
  it('requires a 32-byte token key', () => {
    expect(() => parseTokenKey('')).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => parseTokenKey('abcd')).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(parseTokenKey('11'.repeat(32))).toHaveLength(32);
  });

  it('defaults to 127.0.0.1:4500 and needs both halves of a provider', () => {
    const config = loadConfig({ TOKEN_ENCRYPTION_KEY: '22'.repeat(32) });
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 4500,
      publicUrl: 'http://localhost:4500',
    });
    expect(config.google).toBeNull();
    expect(() =>
      loadConfig({ TOKEN_ENCRYPTION_KEY: '22'.repeat(32), GOOGLE_CLIENT_ID: 'only-id' }),
    ).toThrow(/together/);
  });
});

describe('mail building', () => {
  it('validates addresses and blocks header injection', () => {
    expect(isEmail('owner@curbconnect.test')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('x@y.com\r\nBcc: z@y.com')).toBe(false);
    const raw = buildRfc822(
      { to: 'client@example.com', subject: 'Invoice\r\nBcc: evil@example.com', text: 'Hi' },
      'owner@example.com',
    );
    expect(raw).toContain('Subject: Invoice Bcc: evil@example.com\r\n');
    expect(raw).not.toMatch(/^Bcc:/m);
  });

  it('encodes non-ASCII subjects', () => {
    expect(encodeSubject('Factura número 7')).toMatch(/^=\?UTF-8\?B\?/);
  });
});
