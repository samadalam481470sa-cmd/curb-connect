import { describe, expect, it } from 'vitest';
import { paybackYearsFromCumulative, underwrite } from './underwriting';

const base = {
  land: 500_000,
  sitework: 200_000,
  verticalBuild: 600_000,
  selling: 65_000,
  hoaMonthlyPerLot: 0,
  lotCount: 10,
  carryMonths: 20,
  financing: 50_000,
  revenue: 1_800_000,
  peakEquity: 900_000,
  durationMonths: 20,
};

describe('underwrite', () => {
  it('itemizes costs and computes profit, return on cost and equity multiple', () => {
    const u = underwrite(base);
    expect(u.items.map((i) => i.id)).toEqual([
      'land',
      'sitework',
      'verticalBuild',
      'selling',
      'hoa',
      'financing',
    ]);
    expect(u.totalCost).toBe(1_415_000);
    expect(u.profit).toBe(385_000);
    expect(u.returnOnCostPct).toBeCloseTo((385_000 / 1_415_000) * 100, 6);
    expect(u.equityMultiple).toBeCloseTo((900_000 + 385_000) / 900_000, 6);
    expect(u.annualizedReturnPct).toBeCloseTo(
      (Math.pow((900_000 + 385_000) / 900_000, 12 / 20) - 1) * 100,
      6,
    );
    expect(u.peakCash).toBe(900_000);
    expect(u.complete).toBe(true);
  });

  it('carries HOA dues per lot over the deal length', () => {
    const u = underwrite({ ...base, hoaMonthlyPerLot: 50 });
    expect(u.hoaTotal).toBe(50 * 10 * 20);
    expect(u.totalCost).toBe(1_415_000 + 10_000);
    expect(u.profit).toBe(375_000);
  });

  it('returns null ratios, not Infinity, for zero and blank inputs', () => {
    const u = underwrite({
      land: 0,
      sitework: 0,
      verticalBuild: 0,
      selling: 0,
      hoaMonthlyPerLot: 0,
      lotCount: 0,
      carryMonths: 0,
      financing: 0,
      revenue: 0,
      peakEquity: 0,
      durationMonths: 0,
    });
    expect(u.totalCost).toBe(0);
    expect(u.profit).toBe(0);
    expect(u.returnOnCostPct).toBeNull();
    expect(u.equityMultiple).toBeNull();
    expect(u.annualizedReturnPct).toBeNull();
    expect(u.complete).toBe(false);
  });

  it('handles a loss: negative profit and an equity multiple under 1', () => {
    const u = underwrite({ ...base, revenue: 1_000_000 });
    expect(u.profit).toBe(-415_000);
    expect(u.returnOnCostPct).toBeCloseTo((-415_000 / 1_415_000) * 100, 6);
    expect(u.equityMultiple).toBeCloseTo((900_000 - 415_000) / 900_000, 6);
    expect(u.annualizedReturnPct).not.toBeNull();
  });

  it('reports break-even revenue and break-even price per lot', () => {
    const u = underwrite(base);
    expect(u.breakEvenRevenue).toBe(1_415_000);
    expect(u.breakEvenPerLot).toBe(141_500);
    const noLots = underwrite({ ...base, lotCount: 0 });
    expect(noLots.breakEvenPerLot).toBeNull();
  });

  it('computes payback years from the cumulative cash flow', () => {
    // Cash out for 18 months, back to zero at month 24 -> 2 years.
    const cumulative: number[] = Array.from({ length: 25 }, (_, m) => (m < 24 ? -100_000 : 5_000));
    cumulative[0] = 0;
    const u = underwrite({ ...base, cumulativeByMonth: cumulative });
    expect(u.paybackYears).toBe(2);
  });

  it('payback is null when no series is given or the balance never recovers', () => {
    expect(underwrite(base).paybackYears).toBeNull();
    expect(paybackYearsFromCumulative(undefined)).toBeNull();
    expect(paybackYearsFromCumulative([0, -10, -20, -30])).toBeNull();
    expect(paybackYearsFromCumulative([0, 10, 20])).toBeNull(); // never negative: nothing to pay back
    expect(paybackYearsFromCumulative([0, -10, 5])).toBeCloseTo(2 / 12, 6);
  });
});
