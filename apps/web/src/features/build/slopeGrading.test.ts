import { describe, expect, it } from 'vitest';
import { cornerTerrain, flatTerrain, layoutParcel, type FeasibilityInputs, DEFAULT_COSTS, DEFAULT_RULES } from './siteFeasibility';
import { gradingNote, mainLinePoints, slopeBands, trenchDepthCheck } from './slopeGrading';

describe('slopeBands', () => {
  it('puts flat ground entirely in the gentle band', () => {
    const g = slopeBands(flatTerrain(500), { widthFt: 400, depthFt: 320 }, 25);
    expect(g.sampled).toBeGreaterThan(0);
    expect(g.bands.find((b) => b.id === 'gentle')!.sharePct).toBeCloseTo(100, 0);
    expect(g.bands.find((b) => b.id === 'over_limit')!.sharePct).toBe(0);
    expect(g.reliefFt).toBe(0);
    expect(g.bands.reduce((s, b) => s + b.sharePct, 0)).toBeCloseTo(100, 6);
  });

  it('puts a steep uniform slope entirely over the building limit', () => {
    // 100 ft of fall over a 100 ft parcel, both directions: slope ~100% everywhere.
    const g = slopeBands(
      cornerTerrain(0, 100, 100, 200, 'test'),
      { widthFt: 100, depthFt: 100 },
      25,
    );
    expect(g.bands.find((b) => b.id === 'over_limit')!.sharePct).toBeCloseTo(100, 0);
    expect(g.reliefFt).toBeCloseTo(200, 0);
    expect(g.note).toMatch(/over the 25% building limit/);
  });

  it('splits a moderate slope between gentle and moderate bands', () => {
    // 10 ft of fall over 100 ft back: ~10% slope -> moderate band.
    const g = slopeBands(
      cornerTerrain(100, 100, 110, 110, 'test'),
      { widthFt: 100, depthFt: 100 },
      25,
    );
    expect(g.bands.find((b) => b.id === 'moderate')!.sharePct).toBeGreaterThan(90);
    expect(g.bands.find((b) => b.id === 'over_limit')!.sharePct).toBe(0);
  });

  it('always labels the grading note an estimate, not engineering', () => {
    expect(gradingNote([], 25)).toMatch(/estimate/);
    expect(gradingNote([], 25)).toMatch(/civil engineer must confirm/);
    const g = slopeBands(flatTerrain(500), { widthFt: 400, depthFt: 320 }, 25);
    expect(g.note).toMatch(/Mostly gentle ground/);
    expect(g.note).toMatch(/USGS 3DEP LiDAR/);
  });
});

describe('trenchDepthCheck', () => {
  const parcel = { widthFt: 100, depthFt: 100 };
  // Ground rises 10 ft from the street edge (z=0) to the back (z=100).
  const rising = cornerTerrain(100, 100, 110, 110, 'test');

  it('deepest cut is the entered depth plus the ground rise along the main', () => {
    const check = trenchDepthCheck(rising, parcel, [{ x: 50, z: 0 }, { x: 50, z: 100 }], 6);
    expect(check).not.toBeNull();
    expect(check!.fallFt).toBeCloseTo(10, 6);
    expect(check!.deepestCutFt).toBeCloseTo(16, 6);
    expect(check!.shallowestCutFt).toBe(6);
    expect(check!.mainLengthFt).toBeCloseTo(100, 6);
    expect(check!.note).toMatch(/Estimate/);
    expect(check!.note).toMatch(/engineer's design/);
  });

  it('flat ground keeps the cut at the entered depth', () => {
    const check = trenchDepthCheck(flatTerrain(500), parcel, [{ x: 0, z: 0 }, { x: 100, z: 0 }], 8);
    expect(check!.deepestCutFt).toBe(8);
    expect(check!.fallFt).toBe(0);
  });

  it('returns null when no depth was entered or there is no main', () => {
    expect(trenchDepthCheck(rising, parcel, [{ x: 50, z: 0 }, { x: 50, z: 100 }], 0)).toBeNull();
    expect(trenchDepthCheck(rising, parcel, [{ x: 50, z: 0 }], 6)).toBeNull();
    expect(trenchDepthCheck(rising, parcel, [], Number.NaN)).toBeNull();
  });

  it('mainLinePoints follows the new street when the layout has one', () => {
    const inputs: FeasibilityInputs = {
      parcel: { widthFt: 400, depthFt: 320 },
      rules: { ...DEFAULT_RULES },
      terrain: flatTerrain(500),
      treeCoverPct: 0,
      flood: null,
      home: { widthFt: 40, depthFt: 50, buildCost: 300_000 },
      landPrice: 500_000,
      costs: DEFAULT_COSTS.map((c) => ({ ...c })),
      layout: 'new_road',
      plan: 'sell_pads',
      revenue: { padPrice: 120_000, homePrice: 450_000, monthlyRent: 2800, rentExpensePct: 35, capRatePct: 6, sellingCostPct: 5 },
      timeline: { approvalMonths: 6, siteWorkMonths: 6, buildMonths: 8, absorptionPerMonth: 1, interestPct: 9 },
    };
    const layout = layoutParcel(inputs, 'new_road');
    expect(layout.road).not.toBeNull();
    const pts = mainLinePoints(layout, inputs.parcel);
    expect(pts).toEqual([{ x: 200, z: 0 }, { x: 200, z: 320 }]);
    const front = mainLinePoints(layoutParcel(inputs, 'street_front'), inputs.parcel);
    expect(front).toEqual([{ x: 0, z: 0 }, { x: 400, z: 0 }]);
  });
});
