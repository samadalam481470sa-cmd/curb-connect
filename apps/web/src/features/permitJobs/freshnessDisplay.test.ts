import { describe, expect, it } from 'vitest';
import { ageLabel, newestPermitLabel, permitAgeDays } from './freshnessDisplay';

describe('permit freshness display', () => {
  it('ages San Antonio honestly: newest Nov 20 checked Nov 25 is 5 days old', () => {
    expect(permitAgeDays('2026-11-20T00:00:00.000Z', '2026-11-25T12:00:00.000Z')).toBe(5);
    expect(ageLabel('2026-11-20T00:00:00.000Z', '2026-11-25T12:00:00.000Z')).toBe(
      ' (5 days old at last check)',
    );
  });

  it('shows no age label for a permit published on the check day', () => {
    expect(permitAgeDays('2026-11-25T00:00:00.000Z', '2026-11-25T12:00:00.000Z')).toBe(0);
    expect(ageLabel('2026-11-25T00:00:00.000Z', '2026-11-25T12:00:00.000Z')).toBe('');
  });

  it('uses the singular for one day', () => {
    expect(ageLabel('2026-11-24T00:00:00.000Z', '2026-11-25T12:00:00.000Z')).toBe(
      ' (1 day old at last check)',
    );
  });

  it('never invents an age from a missing or unreadable date', () => {
    expect(permitAgeDays(null, '2026-11-25T12:00:00.000Z')).toBeNull();
    expect(ageLabel(null, '2026-11-25T12:00:00.000Z')).toBe('');
    expect(permitAgeDays('not-a-date', '2026-11-25T12:00:00.000Z')).toBeNull();
    expect(permitAgeDays('2026-11-20T00:00:00.000Z', 'not-a-date')).toBeNull();
  });

  it('clamps a future-dated newest permit to zero instead of a negative age', () => {
    expect(permitAgeDays('2026-11-26T00:00:00.000Z', '2026-11-25T12:00:00.000Z')).toBe(0);
  });

  it('labels Houston by coverage and daily feeds by newest permit', () => {
    expect(newestPermitLabel('houston')).toBe('coverage through ');
    expect(newestPermitLabel('sanantonio')).toBe('newest permit ');
    expect(newestPermitLabel('dallas')).toBe('newest permit ');
  });
});
