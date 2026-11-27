// Commercial-pad math tests (audit-gaps round 2): pad area, coverage and
// parking from contractor-entered ratios only, fit check, and the shared
// underwriting run. Blank inputs stay null — nothing is invented.
import { describe, expect, it } from 'vitest';
import { commercialPad, type CommercialPadInputs } from './commercialPad';

const base: CommercialPadInputs = {
  landPrice: 500_000,
  padLengthFt: 400,
  padWidthFt: 300,
  buildingSqFt: 20_000,
  coveragePct: 25,
  parkingPer1000SqFt: 5,
  sqFtPerSpace: 320,
  openSpacePct: 15,
  siteworkPerPadAcre: 80_000,
  buildCostPerSqFt: 150,
  revenue: 5_000_000,
  sellingCostPct: 3,
  financing: 100_000,
  durationMonths: 18,
};

describe('commercialPad', () => {
  it('computes pad area, coverage cap and parking from the entered ratios', () => {
    const r = commercialPad(base);
    expect(r.padSqFt).toBe(120_000);
    expect(r.padAcres).toBeCloseTo(120_000 / 43_560, 6);
    // 25% coverage of 120,000 sq ft.
    expect(r.maxBuildingSqFt).toBe(30_000);
    expect(r.coverageOk).toBe(true);
    // 20,000 sq ft × 5 spaces / 1,000 = 100 spaces × 320 sq ft.
    expect(r.parkingSpaces).toBe(100);
    expect(r.parkingSqFt).toBe(32_000);
    expect(r.openSpaceSqFt).toBe(18_000);
    // 20,000 + 32,000 + 18,000 = 70,000 ≤ 120,000.
    expect(r.developedSqFt).toBe(70_000);
    expect(r.fitsOnPad).toBe(true);
    expect(r.overBySqFt).toBe(0);
    expect(r.complete).toBe(true);
  });

  it('rounds parking spaces up', () => {
    const r = commercialPad({ ...base, buildingSqFt: 10_500, parkingPer1000SqFt: 4.5 });
    // 10.5 × 4.5 = 47.25 → 48 spaces.
    expect(r.parkingSpaces).toBe(48);
  });

  it('flags a building over the entered coverage and a layout over the pad', () => {
    const r = commercialPad({ ...base, buildingSqFt: 40_000 });
    expect(r.coverageOk).toBe(false);
    // 40,000 + 200×320 + 18,000 = 122,000 > 120,000.
    expect(r.fitsOnPad).toBe(false);
    expect(r.overBySqFt).toBe(2_000);
    expect(r.notes.some((n) => n.includes('larger than the entered coverage allows'))).toBe(true);
    expect(r.notes.some((n) => n.includes('over the pad'))).toBe(true);
  });

  it('runs the shared underwriting on the entered costs', () => {
    const r = commercialPad(base);
    const padAcres = 120_000 / 43_560;
    expect(r.sitework).toBeCloseTo(80_000 * padAcres, 6);
    expect(r.verticalBuild).toBe(3_000_000);
    expect(r.selling).toBe(150_000);
    const totalCost = 500_000 + 80_000 * padAcres + 3_000_000 + 150_000 + 100_000;
    expect(r.underwriting.totalCost).toBeCloseTo(totalCost, 6);
    expect(r.underwriting.profit).toBeCloseTo(5_000_000 - totalCost, 6);
    expect(r.underwriting.breakEvenRevenue).toBeCloseTo(totalCost, 6);
    expect(r.underwriting.complete).toBe(true);
    // Peak equity = all-in cost in pad mode (no monthly cash flow).
    expect(r.underwriting.peakCash).toBeCloseTo(totalCost, 6);
  });

  it('keeps derived figures null when inputs are blank', () => {
    const r = commercialPad({
      ...base,
      padLengthFt: 0,
      padWidthFt: 0,
      buildingSqFt: 0,
      coveragePct: 0,
      parkingPer1000SqFt: 0,
      sqFtPerSpace: 0,
      openSpacePct: 0,
      revenue: 0,
    });
    expect(r.padSqFt).toBeNull();
    expect(r.padAcres).toBeNull();
    expect(r.maxBuildingSqFt).toBeNull();
    expect(r.coverageOk).toBeNull();
    expect(r.parkingSpaces).toBeNull();
    expect(r.parkingSqFt).toBeNull();
    expect(r.openSpaceSqFt).toBeNull();
    expect(r.developedSqFt).toBeNull();
    expect(r.fitsOnPad).toBeNull();
    expect(r.overBySqFt).toBeNull();
    expect(r.sitework).toBe(0);
    expect(r.verticalBuild).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.notes[0]).toContain('Enter the pad dimensions');
  });

  it('always labels the ratios as contractor-entered, with no zoning claim', () => {
    const r = commercialPad(base);
    expect(r.notes.some((n) => n.includes('Field Pro has no zoning or parking-code source'))).toBe(true);
  });
});
