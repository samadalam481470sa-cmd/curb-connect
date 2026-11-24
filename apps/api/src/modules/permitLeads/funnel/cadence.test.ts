import { describe, expect, it } from 'vitest';
import {
  funnelCadenceSources,
  nextRefreshAt,
  refreshIntervalMinutes,
  sourceDue,
  texasHour,
} from './cadence';

describe('caffeinate cadence', () => {
  it('reads Texas time correctly, including daylight time', () => {
    // 18:00 UTC = 12:00 CST in November, 13:00 CDT in June.
    expect(texasHour(new Date('2026-11-24T18:00:00.000Z'))).toBe(12);
    expect(texasHour(new Date('2026-06-24T18:00:00.000Z'))).toBe(13);
    expect(texasHour(new Date('2026-11-24T04:00:00.000Z'))).toBe(22);
  });

  it('re-checks daily feeds every 30 minutes in the workday, hourly overnight', () => {
    const day = new Date('2026-11-24T18:00:00.000Z'); // 12:00 CST
    const night = new Date('2026-11-24T04:00:00.000Z'); // 22:00 CST
    expect(refreshIntervalMinutes('austin', day)).toBe(30);
    expect(refreshIntervalMinutes('austin', night)).toBe(60);
  });

  it('checks Houston at most once a day — its file is weekly', () => {
    const day = new Date('2026-11-24T18:00:00.000Z');
    expect(refreshIntervalMinutes('houston', day)).toBe(24 * 60);
  });

  it('marks a source due only after its interval has passed', () => {
    const now = new Date('2026-11-24T18:00:00.000Z');
    expect(sourceDue('austin', null, now)).toBe(true);
    expect(sourceDue('austin', '2026-11-24T17:45:00.000Z', now)).toBe(false);
    expect(sourceDue('austin', '2026-11-24T17:29:00.000Z', now)).toBe(true);
    expect(sourceDue('houston', '2026-11-24T10:00:00.000Z', now)).toBe(false);
    expect(sourceDue('houston', '2026-11-23T10:00:00.000Z', now)).toBe(true);
  });

  it('reports the next refresh time, or null when already due', () => {
    const now = new Date('2026-11-24T18:00:00.000Z');
    expect(nextRefreshAt('austin', '2026-11-24T17:45:00.000Z', now)).toBe(
      '2026-11-24T18:15:00.000Z',
    );
    expect(nextRefreshAt('austin', null, now)).toBeNull();
  });

  it('covers all 8 live sources with an honest cadence note each', () => {
    const sources = funnelCadenceSources(new Date('2026-11-24T18:00:00.000Z'));
    expect(sources.map((s) => s.id).sort()).toEqual([
      'arlington',
      'austin',
      'collin',
      'dallas',
      'denton',
      'fortworth',
      'houston',
      'sanantonio',
    ]);
    const houston = sources.find((s) => s.id === 'houston')!;
    expect(houston.note).toContain('Weekly Excel file');
    const denton = sources.find((s) => s.id === 'denton')!;
    expect(denton.note).toContain('2026-01-06');
  });
});
