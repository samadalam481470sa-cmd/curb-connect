import { describe, expect, it } from 'vitest';
import {
  loadAutoSend,
  recipientEmailFor,
  rememberRecipientEmail,
  saveAutoSend,
} from './invoicePrefs';

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('invoice sending preferences', () => {
  it('remembers the auto-send choice per company and falls back to the default', () => {
    const store = memory();
    expect(loadAutoSend('org-a', true, store)).toBe(true);
    saveAutoSend('org-a', false, store);
    expect(loadAutoSend('org-a', true, store)).toBe(false);
    expect(loadAutoSend('org-b', true, store)).toBe(true);
  });

  it('fills in the last email used for each customer company', () => {
    const store = memory();
    expect(recipientEmailFor('org-a', 'partner-1', store)).toBe('');
    rememberRecipientEmail('org-a', 'partner-1', 'ap@builder.test', store);
    expect(recipientEmailFor('org-a', 'partner-1', store)).toBe('ap@builder.test');
    expect(recipientEmailFor('org-b', 'partner-1', store)).toBe('');
  });

  it('survives broken or missing storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadAutoSend('o', true, broken)).toBe(true);
    expect(() => saveAutoSend('o', false, broken)).not.toThrow();
    expect(recipientEmailFor('o', 'p', null)).toBe('');
  });
});
