import { describe, expect, it } from 'vitest';
import { planSubdivision } from './subdivision';

describe('planSubdivision', () => {
  it('lays out a spine-road grid on a 400x320 ft parcel', () => {
    // 128,000 sq ft = 2.94 acres. 15% roads = 19,200 sq ft; net 108,800 / 8,000 = 13 lots by area.
    // Single row: 60 ft min width -> 6 lots. Spine road: 60 ft wide (allowance), 170 ft deep
    // lots, 60 ft wide -> 5 per side = 10 lots. Spine wins; area cap 13 does not bind.
    const plan = planSubdivision(
      { widthFt: 400, depthFt: 320 },
      { targetLotSqft: 8000, minLotWidthFt: 60, roadsAllowancePct: 15, roadWidthFt: 50 },
    );
    expect(plan.shape).toBe('spine_road');
    expect(plan.lots).toHaveLength(10);
    expect(plan.lots.map((l) => l.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(plan.road).not.toBeNull();
    expect(plan.road!.x1 - plan.road!.x0).toBeCloseTo(60, 0);
    // Each lot is 170 ft deep x 64 ft of frontage = 10,880 sq ft.
    expect(plan.avgLotSqft).toBeCloseTo(10_880, 0);
    expect(plan.lots[0]!.areaSqft).toBeCloseTo(10_880, 0);
    expect(plan.grossAcres).toBeCloseTo(128_000 / 43_560, 2);
    expect(plan.roadAllowanceAcres).toBeCloseTo(19_200 / 43_560, 2);
    expect(plan.roadAcres).toBeCloseTo((60 * 320) / 43_560, 2);
    expect(plan.densityLotsPerAcre).toBeCloseTo(10 / (128_000 / 43_560), 2);
    expect(plan.note).toMatch(/not a survey/);
  });

  it('uses a single row when the parcel is too narrow for a spine road', () => {
    const plan = planSubdivision(
      { widthFt: 200, depthFt: 150 },
      { targetLotSqft: 6000, minLotWidthFt: 50, roadsAllowancePct: 10, roadWidthFt: 50 },
    );
    expect(plan.shape).toBe('single_row');
    expect(plan.road).toBeNull();
    // 6,000 / 150 ft deep = 40 ft, but the 50 ft minimum wins: 200 / 50 = 4 lots.
    expect(plan.lots).toHaveLength(4);
    expect(plan.lots[0]!.frontageFt).toBeCloseTo(50, 0);
  });

  it('caps the lot count at what the net area holds', () => {
    // 200x200 ft = 40,000 sq ft; 50% roads leaves 20,000 sq ft, so at most 2 lots of 10,000.
    const plan = planSubdivision(
      { widthFt: 200, depthFt: 200 },
      { targetLotSqft: 10_000, minLotWidthFt: 50, roadsAllowancePct: 50, roadWidthFt: 40 },
    );
    expect(plan.lots.length).toBeLessThanOrEqual(2);
    expect(plan.lots.length).toBeGreaterThan(0);
  });

  it('returns an empty plan, not a crash, for zero or blank inputs', () => {
    expect(
      planSubdivision(
        { widthFt: 0, depthFt: 0 },
        { targetLotSqft: 8000, minLotWidthFt: 60, roadsAllowancePct: 15, roadWidthFt: 50 },
      ).lots,
    ).toHaveLength(0);
    expect(
      planSubdivision(
        { widthFt: 400, depthFt: 320 },
        { targetLotSqft: 0, minLotWidthFt: 60, roadsAllowancePct: 15, roadWidthFt: 50 },
      ).lots,
    ).toHaveLength(0);
    expect(
      planSubdivision(
        { widthFt: 40, depthFt: 40 },
        { targetLotSqft: 8000, minLotWidthFt: 60, roadsAllowancePct: 15, roadWidthFt: 50 },
      ).lots,
    ).toHaveLength(0);
  });
});
