import { describe, expect, it } from 'vitest';
import {
  generateResetToken,
  hashResetToken,
  isResetEmailConfigured,
  RESET_TTL_MS,
  sendPasswordResetEmail,
} from './password-reset';
import type { MailAdapter, MailMessage } from './mail';

describe('password reset tokens', () => {
  it('generates unique URL-safe tokens and stores only their hash', () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashResetToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken(a)).not.toBe(a);
    expect(hashResetToken(a)).toBe(hashResetToken(a));
  });

  it('keeps reset links short-lived', () => {
    expect(RESET_TTL_MS).toBe(60 * 60 * 1000);
  });
});

describe('isResetEmailConfigured', () => {
  it('is false when mail is the dev outbox with no SMTP URL (nothing would be sent)', () => {
    expect(isResetEmailConfigured('dev-outbox', undefined)).toBe(false);
    expect(isResetEmailConfigured(undefined, 'smtp://example.test')).toBe(false);
  });

  it('is true once real sending is configured', () => {
    expect(isResetEmailConfigured('smtp', 'smtp://example.test')).toBe(true);
  });
});

describe('sendPasswordResetEmail', () => {
  it('sends one message with the reset link and a stable idempotency key', async () => {
    const sent: MailMessage[] = [];
    const mail: MailAdapter = {
      name: 'smtp',
      send: async (message) => {
        sent.push(message);
        return { providerMessageId: 'test-1' };
      },
    };
    await sendPasswordResetEmail(mail, {
      to: 'person@example.test',
      token: 'tok_abc',
      tokenId: 'reset-1',
      appOrigin: 'https://app.example.test/',
      postalAddress: undefined,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('person@example.test');
    expect(sent[0]?.text).toContain('https://app.example.test/reset-password?token=tok_abc');
    expect(sent[0]?.idempotencyKey).toBe('password-reset-reset-1');
  });
});
