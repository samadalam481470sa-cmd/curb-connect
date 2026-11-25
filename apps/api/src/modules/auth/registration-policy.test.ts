import { describe, expect, it } from 'vitest';
import { passwordRegistrationPolicy } from './registration-policy';

describe('password registration email-verification policy', () => {
  it('fails closed in production if only the development outbox is available', () => {
    expect(passwordRegistrationPolicy('production', 'dev-outbox')).toEqual({
      allowed: false,
      autoVerify: false,
    });
  });

  it('requires real email verification for production SMTP registrations', () => {
    expect(passwordRegistrationPolicy('production', 'smtp')).toEqual({
      allowed: true,
      autoVerify: false,
    });
  });

  it('keeps the isolated test and development sign-up journeys working', () => {
    for (const env of ['development', 'test'] as const) {
      expect(passwordRegistrationPolicy(env, 'dev-outbox')).toEqual({
        allowed: true,
        autoVerify: true,
      });
      expect(passwordRegistrationPolicy(env, 'smtp')).toEqual({
        allowed: true,
        autoVerify: false,
      });
    }
  });
});
