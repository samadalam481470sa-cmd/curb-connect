// Pure helpers for manual customers and contacts.
import { describe, expect, it } from 'vitest';
import { contactDisplayLabel, customerDisplayLabel } from './customers';

describe('customerDisplayLabel', () => {
  it('shows company with contact name for businesses', () => {
    expect(
      customerDisplayLabel({ displayName: 'Sam Acme', companyName: 'Acme Builders LLC', kind: 'business' }),
    ).toBe('Acme Builders LLC (Sam Acme)');
  });

  it('shows just the name for people and same-name businesses', () => {
    expect(customerDisplayLabel({ displayName: 'Jane Homeowner', companyName: null, kind: 'person' })).toBe(
      'Jane Homeowner',
    );
    expect(
      customerDisplayLabel({
        displayName: 'Acme Builders LLC',
        companyName: 'Acme Builders LLC',
        kind: 'business',
      }),
    ).toBe('Acme Builders LLC');
  });
});

describe('contactDisplayLabel', () => {
  it('shows role and reach details when present', () => {
    expect(
      contactDisplayLabel({
        displayName: 'Jane Homeowner',
        role: 'Owner',
        email: 'jane@example.com',
        phone: null,
      }),
    ).toBe('Jane Homeowner — Owner · jane@example.com');
  });

  it('shows just the name when nothing else is known', () => {
    expect(
      contactDisplayLabel({ displayName: 'Sam Acme', role: null, email: null, phone: null }),
    ).toBe('Sam Acme');
  });
});
