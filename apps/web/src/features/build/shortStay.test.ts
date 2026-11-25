import { describe, expect, it } from 'vitest';
import { shortStay } from './shortStay';

const base = {
  units: 10,
  nightlyRate: 150,
  occupancyPct: 60,
  expensePct: 40,
  totalInvested: 2_000_000,
  capRatePct: 6,
};

describe('shortStay', () => {
  it('computes gross, net, payback and value at the cap rate', () => {
    const s = shortStay(base);
    expect(s.nightsPerYear).toBeCloseTo(219, 6);
    expect(s.annualGross).toBeCloseTo(10 * 150 * 219, 6);
    expect(s.annualNet).toBeCloseTo(10 * 150 * 219 * 0.6, 6);
    expect(s.paybackYears).toBeCloseTo(2_000_000 / (10 * 150 * 219 * 0.6), 6);
    expect(s.cashOnCashPct).toBeCloseTo(((10 * 150 * 219 * 0.6) / 2_000_000) * 100, 6);
    expect(s.valueAtCapRate).toBeCloseTo((10 * 150 * 219 * 0.6) / 0.06, 6);
    expect(s.complete).toBe(true);
  });

  it('blank nightly rate yields nulls and a plain note', () => {
    const s = shortStay({ ...base, nightlyRate: 0 });
    expect(s.annualGross).toBe(0);
    expect(s.paybackYears).toBeNull();
    expect(s.complete).toBe(false);
    expect(s.note).toContain('Enter a nightly rate');
  });

  it('clamps occupancy and expenses to 100% and handles no cap rate', () => {
    const s = shortStay({ ...base, occupancyPct: 150, expensePct: 100, capRatePct: 0 });
    expect(s.nightsPerYear).toBe(365);
    expect(s.annualNet).toBe(0);
    expect(s.paybackYears).toBeNull();
    expect(s.valueAtCapRate).toBeNull();
  });

  it('sanitizes bad inputs without crashing', () => {
    const s = shortStay({
      units: -2,
      nightlyRate: Number.NaN,
      occupancyPct: Number.NaN,
      expensePct: -5,
      totalInvested: -1,
      capRatePct: Number.NaN,
    });
    expect(s.annualGross).toBe(0);
    expect(s.cashOnCashPct).toBeNull();
    expect(s.complete).toBe(false);
  });
});
