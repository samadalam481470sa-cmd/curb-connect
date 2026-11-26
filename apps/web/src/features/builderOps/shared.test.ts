// Pure-helper tests for the builder-operations views: money formatting (null is never
// invented into a number), dollar parsing, honest email-state labels, and EN/ES label
// parity for the field views.
import { describe, expect, it } from 'vitest';
import {
  FIELD_LABELS,
  emailStateLabel,
  minorToDollarsInput,
  money,
  parseDollarsToMinor,
  prettyStatus,
} from './shared';

describe('money', () => {
  it('formats minor units as dollars', () => {
    expect(money(549120)).toBe('$5,491.20');
    expect(money(0)).toBe('$0.00');
  });

  it('shows "Not entered" for null/undefined instead of inventing a number', () => {
    expect(money(null)).toBe('Not entered');
    expect(money(undefined)).toBe('Not entered');
  });
});

describe('parseDollarsToMinor', () => {
  it('parses plain, comma, and dollar-sign input', () => {
    expect(parseDollarsToMinor('1234.56')).toBe(123456);
    expect(parseDollarsToMinor('$1,234.56')).toBe(123456);
    expect(parseDollarsToMinor(' 42 ')).toBe(4200);
  });

  it('returns null for blank or non-numeric input (blank stays blank)', () => {
    expect(parseDollarsToMinor('')).toBeNull();
    expect(parseDollarsToMinor('   ')).toBeNull();
    expect(parseDollarsToMinor('abc')).toBeNull();
  });

  it('round-trips with minorToDollarsInput', () => {
    expect(minorToDollarsInput(parseDollarsToMinor('99.99'))).toBe('99.99');
    expect(minorToDollarsInput(null)).toBe('');
  });
});

describe('emailStateLabel', () => {
  it('never claims sent for the not-connected state', () => {
    expect(emailStateLabel('not_connected')).toBe('Email not connected yet');
    expect(emailStateLabel('sent')).toBe('Email sent');
    expect(emailStateLabel('queued')).toBe('Email queued');
    expect(emailStateLabel('failed')).toBe('Email failed');
    expect(emailStateLabel('anything-else')).toBe('Email not connected yet');
  });
});

describe('prettyStatus', () => {
  it('humanizes snake_case statuses', () => {
    expect(prettyStatus('pending_approval')).toBe('pending approval');
    expect(prettyStatus('in_production')).toBe('in production');
  });
});

describe('FIELD_LABELS parity', () => {
  it('Spanish has every English key and vice versa', () => {
    expect(Object.keys(FIELD_LABELS.es).sort()).toEqual(Object.keys(FIELD_LABELS.en).sort());
  });

  it('no label is blank in either language', () => {
    for (const value of Object.values(FIELD_LABELS.en)) expect(value.trim().length).toBeGreaterThan(0);
    for (const value of Object.values(FIELD_LABELS.es)) expect(value.trim().length).toBeGreaterThan(0);
  });
});
