// Connectivity build 3 (second half): proposal-accept budget seeding from estimate lines.
import { describe, expect, it } from 'vitest';
import { budgetLineFromEstimateLine, budgetLinesFromEstimateLines } from './budgetSeed';

describe('budgetLineFromEstimateLine', () => {
  it('maps a studio line', () => {
    expect(
      budgetLineFromEstimateLine({ systemId: 'framing', label: 'Framing', amountMinor: 123456 }),
    ).toEqual({ costCode: 'framing', label: 'Framing', budgetMinor: 123456 });
  });

  it('maps a priced engine line (decimal dollars to cents)', () => {
    expect(
      budgetLineFromEstimateLine({
        code: 'SHINGLE',
        description: 'Shingles',
        status: 'priced',
        extended: { base: '1234.56' },
      }),
    ).toEqual({ costCode: 'SHINGLE', label: 'Shingles', budgetMinor: 123456 });
  });

  it('skips unpriced, unresolved, zero and malformed lines', () => {
    expect(budgetLineFromEstimateLine({ systemId: 'x', amountMinor: 0 })).toBeNull();
    expect(budgetLineFromEstimateLine({ code: 'X', status: 'unresolved', extended: null })).toBeNull();
    expect(budgetLineFromEstimateLine({ code: 'X', status: 'priced', extended: { base: '0.00' } })).toBeNull();
    expect(budgetLineFromEstimateLine(null)).toBeNull();
    expect(budgetLineFromEstimateLine('nope')).toBeNull();
    expect(budgetLineFromEstimateLine({})).toBeNull();
  });
});

describe('budgetLinesFromEstimateLines', () => {
  it('merges duplicate cost codes and counts the skipped', () => {
    const { lines, skipped } = budgetLinesFromEstimateLines([
      { systemId: 'framing', label: 'Framing', amountMinor: 1000 },
      { systemId: 'framing', label: 'Framing', amountMinor: 500 },
      { systemId: 'roofing', label: 'Roofing', amountMinor: 2000 },
      { code: 'X', status: 'unresolved', extended: null },
      null,
    ]);
    expect(lines).toEqual([
      { costCode: 'framing', label: 'Framing', budgetMinor: 1500 },
      { costCode: 'roofing', label: 'Roofing', budgetMinor: 2000 },
    ]);
    expect(skipped).toBe(2);
  });

  it('handles non-array input', () => {
    expect(budgetLinesFromEstimateLines(null)).toEqual({ lines: [], skipped: 0 });
    expect(budgetLinesFromEstimateLines(undefined)).toEqual({ lines: [], skipped: 0 });
  });
});
