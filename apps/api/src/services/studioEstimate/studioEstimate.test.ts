// Connectivity build 3: the server-side studio estimate port. The math is the faithful
// port of the web studio (NAHB 2024 survey model); these tests pin the shape and the
// honesty labels, not invented exact prices.
import { describe, expect, it } from 'vitest';
import {
  STUDIO_ESTIMATE_BASIS,
  buildSpecFromStudioSpec,
  computeStudioEstimate,
  studioBudgetLines,
  studioRevisionData,
} from './index';
import { DEFAULT_SPEC, computeTakeoff } from './takeoff';

const VALID_SPEC = {
  lengthFt: 50,
  widthFt: 32,
  stories: 1,
  bedrooms: 3,
  bathrooms: 2,
  garage: 'two_car',
  wallHeightFt: 9,
  roofPitch: 6,
} as const;

describe('computeStudioEstimate', () => {
  it('produces priced lines that sum to the total', () => {
    const c = computeStudioEstimate(VALID_SPEC, {});
    expect(c.totalMinor).toBeGreaterThan(0);
    expect(c.lines.length).toBeGreaterThan(0);
    expect(c.lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(c.totalMinor);
    expect(c.areaSqFt).toBe(1600);
    expect(c.perSqFtMinor).toBeGreaterThan(0);
    expect(c.takeoffSummary.slabAreaSqFt).toBeGreaterThan(0);
  });

  it('is deterministic for the same inputs', () => {
    const a = computeStudioEstimate(VALID_SPEC, {});
    const b = computeStudioEstimate(VALID_SPEC, {});
    expect(a.totalMinor).toBe(b.totalMinor);
    expect(a.lines).toEqual(b.lines);
  });

  it('rejects a malformed stored spec instead of guessing', () => {
    expect(() => computeStudioEstimate({ lengthFt: 'wide' }, {})).toThrow();
    expect(() => computeStudioEstimate(null, {})).toThrow();
  });

  it('merges the web defaults for the optional fields', () => {
    const spec = buildSpecFromStudioSpec({ ...VALID_SPEC });
    expect(spec.overhangFt).toBe(DEFAULT_SPEC.overhangFt);
    expect(spec.wastePercent).toBe(DEFAULT_SPEC.wastePercent);
    expect(spec.studSpacingIn).toBe(DEFAULT_SPEC.studSpacingIn);
    const custom = buildSpecFromStudioSpec({ ...VALID_SPEC, overhangFt: 2 });
    expect(custom.overhangFt).toBe(2);
  });

  it('takeoff of the default spec is sane', () => {
    const t = computeTakeoff(DEFAULT_SPEC);
    expect(t.summary.slabAreaSqFt).toBeGreaterThan(0);
    expect(t.summary.concreteYd3).toBeGreaterThan(0);
    expect(t.summary.windows).toBeGreaterThan(0);
  });
});

describe('studioRevisionData', () => {
  it('is a non-binding budgetary snapshot with the basis labeled', () => {
    const c = computeStudioEstimate(VALID_SPEC, {});
    const r = studioRevisionData(c);
    expect(r.isBinding).toBe(false);
    expect(r.quoteKind).toBe('budgetary_range');
    expect(r.priceBookRevisionId).toBeNull();
    expect(r.lowTotalMinor).toBe(r.totalMinor);
    expect(r.highTotalMinor).toBe(r.totalMinor);
    expect(r.assumptions.join(' ')).toContain('NAHB');
    expect(STUDIO_ESTIMATE_BASIS).toContain('not a bid');
  });
});

describe('studioBudgetLines', () => {
  it('maps systems to cost codes and skips zero-amount lines', () => {
    const c = computeStudioEstimate(VALID_SPEC, {});
    const { lines, skipped } = studioBudgetLines(c);
    expect(lines.length + skipped).toBe(c.lines.length);
    expect(lines.every((l) => l.budgetMinor > 0)).toBe(true);
    expect(lines.reduce((s, l) => s + l.budgetMinor, 0)).toBeLessThanOrEqual(c.totalMinor);
  });
});
