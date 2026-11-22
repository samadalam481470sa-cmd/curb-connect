import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COSTS,
  DEFAULT_RULES,
  cornerTerrain,
  elevationAt,
  fillGrid,
  flatTerrain,
  layoutParcel,
  runFeasibility,
  slopeAt,
  type FeasibilityInputs,
} from './siteFeasibility';

function inputs(over: Partial<FeasibilityInputs> = {}): FeasibilityInputs {
  return {
    parcel: { widthFt: 400, depthFt: 320 }, // about 2.94 acres
    rules: { ...DEFAULT_RULES },
    terrain: flatTerrain(500),
    treeCoverPct: 50,
    flood: null,
    home: { widthFt: 40, depthFt: 50, buildCost: 300_000 },
    landPrice: 500_000,
    costs: DEFAULT_COSTS.map((c) => ({ ...c })),
    layout: 'auto',
    plan: 'sell_pads',
    revenue: {
      padPrice: 120_000,
      homePrice: 450_000,
      monthlyRent: 2800,
      rentExpensePct: 35,
      capRatePct: 6,
      sellingCostPct: 5,
    },
    timeline: {
      approvalMonths: 6,
      siteWorkMonths: 6,
      buildMonths: 8,
      absorptionPerMonth: 1,
      interestPct: 9,
    },
    ...over,
  };
}

describe('terrain', () => {
  it('interpolates between corner heights', () => {
    const t = cornerTerrain(100, 110, 120, 130, 'test');
    const p = { widthFt: 100, depthFt: 100 };
    expect(elevationAt(t, p, 0, 0)).toBe(100);
    expect(elevationAt(t, p, 100, 100)).toBe(130);
    expect(elevationAt(t, p, 50, 50)).toBe(115);
    // 10 ft over 100 ft across and 20 ft over 100 ft back -> about 22.4% slope
    expect(slopeAt(t, p, 50, 50)).toBeCloseTo(Math.hypot(10, 20), 0);
  });

  it('fills missing samples from neighbours', () => {
    expect(
      fillGrid([
        [1, null],
        [3, 4],
      ]),
    ).toEqual([
      [1, 2.5],
      [3, 4],
    ]);
    expect(fillGrid([[null, null]])).toBeNull();
  });
});

describe('lot layout and code check', () => {
  it('fills the street frontage with lots that meet the minimums', () => {
    const layout = layoutParcel(inputs(), 'street_front');
    // 8000 sq ft / 320 ft deep = 25 ft, but the 60 ft minimum width wins: 400 / 60 = 6 lots
    expect(layout.lots).toHaveLength(6);
    expect(layout.lots.every((l) => l.issues.length === 0)).toBe(true);
    expect(layout.lots[0]!.home).not.toBeNull();
  });

  it('adds a new street when that yields more good lots', () => {
    const result = runFeasibility(inputs());
    expect(result.layout.choice).toBe('new_road');
    expect(result.passingLots).toBeGreaterThan(6);
    expect(result.layout.roadLengthFt).toBe(320);
  });

  it('flags steep lots in red with the reason and a fix', () => {
    const steep = inputs({
      terrain: cornerTerrain(500, 500, 600, 600, 'test'),
      layout: 'street_front',
    });
    const result = runFeasibility(steep);
    const issue = result.layout.lots[0]!.issues.find((i) => i.rule === 'Building slope');
    expect(issue?.why).toMatch(/slopes 31\.[23]%/);
    expect(issue?.fix).toBeTruthy();
    expect(result.passingLots).toBe(0);
  });

  it('keeps flood-zone lots but warns about them', () => {
    const result = runFeasibility(
      inputs({ flood: { zone: 'AE', specialHazard: true }, layout: 'street_front' }),
    );
    expect(result.passingLots).toBe(6);
    expect(result.layout.lots[0]!.issues[0]!.rule).toBe('Flood zone');
  });

  it('says why a house does not fit', () => {
    const result = runFeasibility(
      inputs({ home: { widthFt: 80, depthFt: 60, buildCost: 1 }, layout: 'street_front' }),
    );
    expect(result.layout.lots[0]!.issues.some((i) => i.rule === 'House fits inside setbacks')).toBe(
      true,
    );
  });
});

describe('earthwork and money', () => {
  it('has no earthwork on flat ground and some on a slope', () => {
    expect(runFeasibility(inputs()).cutCy).toBe(0);
    const sloped = runFeasibility(inputs({ terrain: cornerTerrain(500, 500, 510, 510, 'test') }));
    expect(sloped.cutCy).toBeGreaterThan(0);
    expect(sloped.cutCy).toBeCloseTo(sloped.fillCy, 0);
  });

  it('prices every line with its source and adds up', () => {
    const r = runFeasibility(inputs({ layout: 'street_front' }));
    expect(r.costRows.every((row) => row.source.length > 0)).toBe(true);
    const clearing = r.costRows.find((row) => row.id === 'clearing')!;
    expect(clearing.total).toBeCloseTo(r.acres * 0.5 * 4500, 6);
    expect(r.revenue).toBe(6 * 120_000);
    expect(r.profit).toBeCloseTo(r.revenue - r.sellingCost - r.totalCost + r.sellingCost, 6);
    expect(r.profit).toBeCloseTo(r.revenue - r.totalCost, 6);
    expect(r.months[0]!.out).toBe(500_000);
    expect(r.peakEquity).toBeGreaterThan(500_000);
    expect(r.interest).toBeGreaterThan(0);
  });

  it('adds home construction for build-and-sell and values build-and-hold', () => {
    const sell = runFeasibility(inputs({ plan: 'build_sell', layout: 'street_front' }));
    expect(sell.costRows.find((r) => r.id === 'homes')!.total).toBe(6 * 300_000);
    expect(sell.revenue).toBe(6 * 450_000);
    const hold = runFeasibility(inputs({ plan: 'build_hold', layout: 'street_front' }));
    expect(hold.hold!.noi).toBeCloseTo(6 * 2800 * 0.65 * 12, 6);
    expect(hold.revenue).toBeCloseTo(hold.hold!.noi / 0.06, 6);
  });
});
