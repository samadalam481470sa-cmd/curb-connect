import { describe, expect, it } from 'vitest';
import { farmScenario } from './farmScenario';

const base = {
  landPrice: 500_000,
  acres: 100,
  incomePerAcreYear: 300,
  costPerAcreYear: 100,
  holdYears: 5,
  appreciationPctPerYear: 3,
  sellingCostPct: 5,
};

describe('farmScenario', () => {
  it('computes net income, payback and the valuation curve', () => {
    const f = farmScenario(base);
    expect(f.annualGrossIncome).toBe(30_000);
    expect(f.annualCosts).toBe(10_000);
    expect(f.annualNetIncome).toBe(20_000);
    expect(f.paybackYears).toBe(25);
    expect(f.valuation).toHaveLength(6); // years 0..5
    expect(f.valuation[0]!.value).toBe(500_000);
    expect(f.exitValue).toBeCloseTo(500_000 * Math.pow(1.03, 5), 6);
    expect(f.totalNetIncome).toBe(100_000);
    expect(f.profit).toBeCloseTo(f.exitValue * 0.95 + 100_000 - 500_000, 6);
    expect(f.complete).toBe(true);
  });

  it('blank farm income yields nulls and a plain note, never invented figures', () => {
    const f = farmScenario({ ...base, incomePerAcreYear: 0, costPerAcreYear: 0 });
    expect(f.annualNetIncome).toBe(0);
    expect(f.paybackYears).toBeNull();
    expect(f.complete).toBe(false);
    expect(f.note).toContain('Enter your farm income per acre');
  });

  it('costs above income give no payback', () => {
    const f = farmScenario({ ...base, incomePerAcreYear: 100, costPerAcreYear: 150 });
    expect(f.annualNetIncome).toBe(-5_000);
    expect(f.paybackYears).toBeNull();
    expect(f.note).toContain('no payback');
  });

  it('handles zero land price and negative appreciation without crashing', () => {
    const f = farmScenario({ ...base, landPrice: 0, appreciationPctPerYear: -2 });
    expect(f.valuation).toEqual([]);
    expect(f.returnOnCostPct).toBeNull();
    expect(f.paybackYears).toBeNull();
    const g = farmScenario({ ...base, appreciationPctPerYear: -2, holdYears: 2 });
    expect(g.exitValue).toBeCloseTo(500_000 * 0.98 * 0.98, 6);
  });

  it('clamps the hold period and sanitizes bad inputs', () => {
    const f = farmScenario({ ...base, holdYears: 500, acres: -3, incomePerAcreYear: Number.NaN });
    expect(f.valuation.length).toBeLessThanOrEqual(61);
    expect(f.annualGrossIncome).toBe(0);
    expect(f.complete).toBe(false);
  });
});
