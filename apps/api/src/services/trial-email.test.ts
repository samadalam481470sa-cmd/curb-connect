import { describe, expect, it } from 'vitest';
import { trialEmailKey } from './trial-email';
import { generateActivationCode, hashActivationCode, normalizeActivationCode } from './activation-codes';

describe('trialEmailKey', () => {
  it('treats case, surrounding spaces and +tags as the same mailbox', () => {
    expect(trialEmailKey('  Owner@Example.com ')).toBe('owner@example.com');
    expect(trialEmailKey('owner+roofs@example.com')).toBe('owner@example.com');
  });

  it('collapses Gmail dots and googlemail.com', () => {
    expect(trialEmailKey('Sam.Alam@googlemail.com')).toBe('samalam@gmail.com');
    expect(trialEmailKey('s.a.m+x@gmail.com')).toBe('sam@gmail.com');
  });

  it('keeps dots for other providers and rejects malformed addresses', () => {
    expect(trialEmailKey('sam.alam@outlook.com')).toBe('sam.alam@outlook.com');
    expect(trialEmailKey('no-at-sign')).toBeNull();
    expect(trialEmailKey('@example.com')).toBeNull();
    expect(trialEmailKey('name@')).toBeNull();
  });
});

describe('activation codes', () => {
  it('generates grouped codes that survive a round trip through normalisation', () => {
    const code = generateActivationCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(normalizeActivationCode(code.toLowerCase())).toBe(code.replace(/-/g, ''));
    expect(new Set(Array.from({ length: 50 }, generateActivationCode)).size).toBe(50);
  });

  it('accepts spacing, dashes and look-alike letters, and rejects wrong lengths', () => {
    expect(normalizeActivationCode('abcd 12Il 0O1o 0000')).toBe('ABCD121100100000');
    expect(normalizeActivationCode('ABCD-1234')).toBeNull();
    expect(normalizeActivationCode('ABCD-1234-5678-9AB')).toBeNull();
    expect(normalizeActivationCode('ABCD-1234-5678-9ABU')).toBeNull();
  });

  it('hashes the normalised form, never the plain code', () => {
    const hash = hashActivationCode('ABCD1234EFGH5678');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashActivationCode('ABCD1234EFGH5678'));
  });
});
