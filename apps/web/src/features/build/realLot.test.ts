import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COSTS, DEFAULT_RULES, fillGrid, runFeasibility,
  type ExitPlan, type FeasibilityInputs,
} from './siteFeasibility';
import { computeTakeoff, DEFAULT_SPEC, priceTakeoff } from './takeoff';

/** Phase D item 19 — full house-builder + land-feasibility run on one real Texas lot.
 *
 * Lot: public coordinates in Fort Worth, TX (center 32.7767, -97.3670; no customer data).
 * Parcel modeled as 400 ft (street frontage) × 320 ft deep, matching the sample layout.
 *
 * Terrain: 3×3 elevations fetched live on 2026-11-23 from the USGS 3DEP Elevation Point
 * Query Service (same public endpoint as apps/api site-terrain.ts), feet:
 *   row 0 (south): 598.997, (fetch timed out → null), 615.759
 *   row 1:         614.179, 645.320, 630.682
 *   row 2 (north): 635.980, 650.074, 636.774
 * The missing sample exercises fillGrid exactly as the live API path does.
 *
 * Flood: FEMA NFHL was unreachable from the build environment on 2026-11-23 (HTTP 000),
 * so flood is null here. Live flood lookup remains UNVERIFIED in this run — see
 * docs/phase-d-real-lot-test.md.
 *
 * Zoning/costs/revenue use the in-repo starting values, which are labeled starting values
 * (not published prices or ordinance rules); this test verifies the math pipeline end to
 * end, not a real investment decision.
 */
const RECORDED_GRID: (number | null)[][] = [
  [598.9973004605639, null, 615.7589906721349],
  [614.1785445224792, 645.3197415426196, 630.6824673209459],
  [635.9803911420543, 650.0736955234862, 636.7735177914501],
];

function inputs(plan: ExitPlan): FeasibilityInputs {
  const grid = fillGrid(RECORDED_GRID);
  if (!grid) throw new Error('recorded grid must fill');
  return {
    parcel: { widthFt: 400, depthFt: 320 },
    rules: { ...DEFAULT_RULES },
    terrain: { grid, source: 'USGS 3DEP EPQS recorded 2026-11-23 (Fort Worth, TX)' },
    treeCoverPct: 25,
    flood: null,
    home: { widthFt: 40, depthFt: 50, buildCost: 300_000 },
    landPrice: 500_000,
    costs: DEFAULT_COSTS.map((c) => ({ ...c })),
    layout: 'auto',
    plan,
    revenue: {
      padPrice: 120_000, homePrice: 450_000, monthlyRent: 2800,
      rentExpensePct: 35, capRatePct: 6, sellingCostPct: 5,
    },
    timeline: {
      approvalMonths: 6, siteWorkMonths: 6, buildMonths: 8,
      absorptionPerMonth: 1, interestPct: 9,
    },
  };
}

const finite = (n: number) => Number.isFinite(n);

describe('real Fort Worth lot — land feasibility (item 19)', () => {
  it('fills the missing USGS sample from neighbours', () => {
    const grid = fillGrid(RECORDED_GRID)!;
    expect(grid[0]![1]).toBeCloseTo((598.9973004605639 + 615.7589906721349 + 645.3197415426196) / 3, 3);
    expect(grid.flat().every(finite)).toBe(true);
  });

  it.each(['sell_pads', 'build_sell', 'build_hold'] as ExitPlan[])(
    'runs the %s plan end to end with finite money and cash flow',
    (plan) => {
      const r = runFeasibility(inputs(plan));
      expect(r.acres).toBeCloseTo((400 * 320) / 43_560, 2);
      expect(r.lotCount).toBeGreaterThanOrEqual(0);
      expect(r.passingLots).toBeLessThanOrEqual(r.lotCount);
      expect([r.cutCy, r.fillCy, r.siteCost, r.totalCost, r.revenue, r.profit, r.peakEquity].every(finite)).toBe(true);
      expect(r.costRows.length).toBeGreaterThan(0);
      expect(r.costRows.every((c) => finite(c.total) && c.source.length > 0)).toBe(true);
      expect(r.months.length).toBeGreaterThan(0);
      expect(r.months.every((m) => finite(m.out) && finite(m.in) && finite(m.interest) && finite(m.net) && finite(m.cumulative))).toBe(true);
      if (plan === 'build_hold') expect(r.hold).not.toBeNull();
      else expect(r.hold).toBeNull();
    },
  );

  it('reports terrain-driven lot issues instead of crashing on steep recorded ground', () => {
    const r = runFeasibility(inputs('sell_pads'));
    // Recorded elevations span ~51 ft across the parcel, so slope/earthwork must show up
    // as quantities or lot issues — never as NaN or a thrown error.
    expect(r.cutCy + r.fillCy).toBeGreaterThan(0);
    const issueCount = r.layout.lots.reduce((s, l) => s + l.issues.length, 0);
    expect(issueCount + r.passingLots).toBeGreaterThan(0);
  });
});

describe('real Fort Worth lot — house builder takeoff (item 19)', () => {
  it('produces a priced takeoff for the default house on the lot', () => {
    const takeoff = computeTakeoff({ ...DEFAULT_SPEC });
    expect(takeoff.lines.length).toBeGreaterThan(10);
    expect(takeoff.summary.slabAreaSqFt).toBeGreaterThan(0);
    expect(takeoff.summary.concreteYd3).toBeGreaterThan(0);
    expect(takeoff.summary.roofSquares).toBeGreaterThan(0);
    expect(takeoff.lines.every((l) => finite(l.quantity) && l.quantity > 0 && l.formula.length > 0)).toBe(true);

    const priced = priceTakeoff(takeoff.lines);
    expect(finite(priced.total)).toBe(true);
    expect(priced.total).toBeGreaterThan(0);
    expect(priced.unpriced).toBeGreaterThanOrEqual(0);
    // Unpriced lines stay unpriced (no invented numbers).
    expect(priced.lines.filter((l) => l.unitPrice === null).every((l) => l.total === null)).toBe(true);
  });
});
