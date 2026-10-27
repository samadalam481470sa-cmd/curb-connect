import { describe, expect, it } from 'vitest';
import { fractionToPercent, percentToFraction } from './decimal-text';
import { formatAreaDisplay, formatLengthDisplay, formatMoney, formatRelative } from './format';

describe('locale and unit display (PLT-019)', () => {
  it('PLT-019-FE: money is formatted from exact minor units per locale', () => {
    expect(formatMoney({ amountMinor: 549120, currency: 'USD' }, 'en-US')).toBe('$5,491.20');
    expect(formatMoney({ amountMinor: 549120, currency: 'EUR' }, 'de-DE')).toMatch(
      /^5\.491,20\s€$/,
    );
    expect(formatMoney({ amountMinor: 1500, currency: 'JPY' }, 'en-US')).toBe('¥1,500');
  });

  it('PLT-019-FE: lengths and areas display in the chosen system without changing the SI value', () => {
    const metres = 5.4864; // 18 ft
    expect(formatLengthDisplay(metres, 'imperial', 'en-US')).toBe('18.0 ft');
    expect(formatLengthDisplay(metres, 'metric', 'en-US')).toBe('5.49 m');
    expect(formatLengthDisplay(metres, 'metric', 'fr-CA')).toBe('5,49 m');
    expect(formatAreaDisplay(9.290304, 'imperial', 'en-US')).toBe('100 sq ft');
    expect(formatAreaDisplay(9.290304, 'metric', 'en-US')).toBe('9.3 m²');
    expect(metres).toBe(5.4864);
  });

  it('formats relative last-updated times', () => {
    const now = new Date('2026-10-26T10:00:00Z');
    expect(formatRelative('2026-10-26T09:55:00Z', 'en-US', now)).toBe('5 minutes ago');
    expect(formatRelative('2026-10-26T10:00:00Z', 'en-US', now)).toBe('now');
  });
});

describe('percent text to fraction strings (no floats)', () => {
  it('converts typed percents to stored fractions', () => {
    expect(percentToFraction('8.25')).toBe('0.0825');
    expect(percentToFraction('10')).toBe('0.1');
    expect(percentToFraction('0')).toBe('0');
    expect(percentToFraction('7,5')).toBe('0.075');
    expect(percentToFraction('99.9999')).toBe('0.999999');
  });

  it('rejects out-of-range or malformed input instead of rounding', () => {
    expect(percentToFraction('100')).toBeNull();
    expect(percentToFraction('-1')).toBeNull();
    expect(percentToFraction('8.123456')).toBeNull();
    expect(percentToFraction('abc')).toBeNull();
  });

  it('round-trips for display', () => {
    expect(fractionToPercent('0.0825')).toBe('8.25');
    expect(fractionToPercent('0.1')).toBe('10');
    expect(fractionToPercent('0')).toBe('0');
  });
});
