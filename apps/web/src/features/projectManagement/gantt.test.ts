import { describe, expect, it } from 'vitest';
import { barStyle, clampPercent, progressLabel, statusLabel } from './gantt';

const bar = {
  id: '1', title: 'Framing', startsOn: '2026-11-23', endsOn: '2026-11-27',
  progressPercent: 40, leftPercent: 20, widthPercent: 50, dependencyConflict: false,
};

describe('gantt presentation', () => {
  it('clamps percents into range', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
  it('keeps bars inside the chart', () => {
    expect(barStyle(bar)).toEqual({ left: '20%', width: '50%' });
    expect(barStyle({ ...bar, leftPercent: 90, widthPercent: 50 }).width).toBe('10%');
  });
  it('labels progress and dependency conflicts', () => {
    expect(progressLabel(bar)).toContain('40% complete');
    expect(progressLabel({ ...bar, dependencyConflict: true })).toContain('predecessor');
    expect(statusLabel('revise_and_resubmit')).toBe('Revise and resubmit');
    expect(statusLabel('unknown_status')).toBe('unknown_status');
  });
});
