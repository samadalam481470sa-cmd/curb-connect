import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_COSTS, NAHB_SOURCE, PHASES, SYSTEMS, nahbTableTotal, studioEstimate } from './studioCost';
import { DEFAULT_SPEC, computeTakeoff } from './takeoff';

describe('House Studio cost model', () => {
  it('matches the published NAHB 2024 total', () => {
    expect(Math.abs(nahbTableTotal() - NAHB_SOURCE.totalCost)).toBeLessThanOrEqual(5);
  });

  it('prices the NAHB average house at the NAHB total when not escalated', () => {
    // A house close to 2,647 sq ft conditioned area.
    const takeoff = computeTakeoff({ ...DEFAULT_SPEC, lengthFt: 52, widthFt: 26, stories: 2 });
    const est = studioEstimate(takeoff, { escalationPercent: 0, regionalFactor: 1 });
    const expected = (NAHB_SOURCE.totalCost / NAHB_SOURCE.averageSqFt) * est.areaSqFt;
    expect(Math.abs(est.total - expected)).toBeLessThan(30);
    expect(est.perSqFt).toBe(Math.round(NAHB_SOURCE.totalCost / NAHB_SOURCE.averageSqFt));
  });

  it('escalates, applies the regional factor, and fills every phase in order', () => {
    const takeoff = computeTakeoff(DEFAULT_SPEC);
    const base = studioEstimate(takeoff, { escalationPercent: 0, regionalFactor: 1 });
    const est = studioEstimate(takeoff, { ...DEFAULT_STUDIO_COSTS, regionalFactor: 0.9 });
    expect(est.total / base.total).toBeCloseTo(1.138 * 0.9, 2);
    expect(est.inPlaceByPhase).toHaveLength(PHASES.length);
    expect(est.inPlaceByPhase.at(-1)).toBe(est.total);
    for (let i = 1; i < est.inPlaceByPhase.length; i += 1)
      expect(est.inPlaceByPhase[i]!).toBeGreaterThanOrEqual(est.inPlaceByPhase[i - 1]!);
    expect(est.systems).toHaveLength(SYSTEMS.length);
    expect(est.systems.every((s) => s.amount > 0)).toBe(true);
  });
});
