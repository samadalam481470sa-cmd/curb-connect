import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sealPortalSecret, unsealPortalSecret, vaultKeyFromConfig } from './vault';

const key = randomBytes(32);

describe('portal credential vault', () => {
  it('round-trips a secret', () => {
    const sealed = sealPortalSecret(key, 'builder-portal-password');
    expect(sealed).not.toContain('builder-portal-password');
    expect(unsealPortalSecret(key, sealed)).toBe('builder-portal-password');
  });

  it('seals the same secret differently each time (random IV)', () => {
    expect(sealPortalSecret(key, 'same')).not.toBe(sealPortalSecret(key, 'same'));
  });

  it('fails with the wrong key', () => {
    const sealed = sealPortalSecret(key, 'secret');
    expect(() => unsealPortalSecret(randomBytes(32), sealed)).toThrow();
  });

  it('fails when the sealed value is tampered with', () => {
    const sealed = sealPortalSecret(key, 'secret');
    const raw = Buffer.from(sealed, 'base64url');
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    expect(() => unsealPortalSecret(key, raw.toString('base64url'))).toThrow();
  });

  it('rejects malformed sealed values', () => {
    expect(() => unsealPortalSecret(key, 'not-a-sealed-value')).toThrow();
  });

  it('vaultKeyFromConfig accepts only a base64 32-byte key', () => {
    expect(vaultKeyFromConfig(undefined)).toBeNull();
    expect(vaultKeyFromConfig(Buffer.from('short').toString('base64'))).toBeNull();
    expect(vaultKeyFromConfig(key.toString('base64'))).toEqual(key);
  });
});
