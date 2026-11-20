import { describe, expect, it } from 'vitest';
import { isEmailVerified, MICROSOFT_CONSUMER_TENANT } from './oidc';

describe('isEmailVerified', () => {
  it('trusts email_verified from Google', () => {
    expect(isEmailVerified({ email_verified: true })).toBe(true);
  });
  it('trusts personal Microsoft accounts', () => {
    expect(isEmailVerified({ tid: MICROSOFT_CONSUMER_TENANT })).toBe(true);
  });
  it('trusts work accounts with a verified domain', () => {
    expect(isEmailVerified({ tid: 'other', xms_edov: true })).toBe(true);
  });
  it('rejects an unverified work account', () => {
    expect(isEmailVerified({ tid: 'other' })).toBe(false);
    expect(isEmailVerified({ email_verified: false })).toBe(false);
  });
});
