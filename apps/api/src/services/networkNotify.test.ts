// Email-gating tests for cross-company sends: assignments and network orders must only
// claim email can go out when a real mail path is configured (SMTP pair or the mailer).
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config';
import { EMAIL_NOT_CONNECTED_NOTE, emailConfigured } from './networkNotify';

type MailSlice = Pick<AppConfig, 'mail' | 'mailer'>;

function config(partial: MailSlice): AppConfig {
  return partial as AppConfig;
}

describe('emailConfigured', () => {
  it('is false with no mail path at all', () => {
    expect(
      emailConfigured(config({ mail: { smtpUrl: undefined, from: undefined, outboxDir: '/tmp/outbox', postalAddress: undefined }, mailer: null })),
    ).toBe(false);
  });

  it('is false with only half the SMTP pair', () => {
    expect(
      emailConfigured(config({ mail: { smtpUrl: 'smtp://x', from: undefined, outboxDir: '/tmp/outbox', postalAddress: undefined }, mailer: null })),
    ).toBe(false);
    expect(
      emailConfigured(config({ mail: { smtpUrl: undefined, from: 'a@b.co', outboxDir: '/tmp/outbox', postalAddress: undefined }, mailer: null })),
    ).toBe(false);
  });

  it('is true with the full SMTP pair', () => {
    expect(
      emailConfigured(config({ mail: { smtpUrl: 'smtp://x', from: 'a@b.co', outboxDir: '/tmp/outbox', postalAddress: undefined }, mailer: null })),
    ).toBe(true);
  });

  it('is true when the connected-mailbox mailer is configured', () => {
    expect(
      emailConfigured(
        config({
          mail: { smtpUrl: undefined, from: undefined, outboxDir: '/tmp/outbox', postalAddress: undefined },
          mailer: { url: 'https://m', publicOrigin: 'https://m', sharedSecret: 's' },
        }),
      ),
    ).toBe(true);
  });

  it('the not-connected note never claims an email was sent', () => {
    expect(EMAIL_NOT_CONNECTED_NOTE).toContain('nothing was emailed');
    expect(EMAIL_NOT_CONNECTED_NOTE).toContain('in-app notification was delivered');
  });
});
