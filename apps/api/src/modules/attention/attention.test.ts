// Pure date-math tests for the attention feed: the rules (slipping schedules, stale
// orders, overdue AP) all reduce to whole-day differences against "today".
import { describe, expect, it } from 'vitest';
import { ageDays, daysBetween, isoDay } from './index';

describe('isoDay', () => {
  it('renders the UTC calendar day', () => {
    expect(isoDay(new Date('2026-11-26T15:30:00Z'))).toBe('2026-11-26');
    expect(isoDay(new Date('2026-11-26T23:59:59Z'))).toBe('2026-11-26');
  });
});

describe('daysBetween', () => {
  it('counts whole days between two ISO dates', () => {
    expect(daysBetween('2026-11-20', '2026-11-26')).toBe(6);
    expect(daysBetween('2026-11-26', '2026-11-26')).toBe(0);
  });

  it('is negative when the first date is later (not yet due)', () => {
    expect(daysBetween('2026-12-01', '2026-11-26')).toBe(-5);
  });

  it('handles month and year boundaries', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
  });
});

describe('ageDays', () => {
  it('counts whole days elapsed, flooring partial days', () => {
    const created = new Date('2026-11-20T12:00:00Z');
    expect(ageDays(created, new Date('2026-11-26T11:00:00Z'))).toBe(5);
    expect(ageDays(created, new Date('2026-11-26T12:00:00Z'))).toBe(6);
  });

  it('an order sent 3+ days ago crosses the awaiting-response threshold', () => {
    const sent = new Date('2026-11-23T09:00:00Z');
    const now = new Date('2026-11-26T09:00:00Z');
    expect(ageDays(sent, now)).toBeGreaterThanOrEqual(3);
  });
});
