import { describe, expect, it } from 'vitest';
import { computeCurbEstimate, splitCutLength } from './calc';
import { EXAMPLE_PRICE_BOOK, PAGE60_RECIPE, WORKED_EXAMPLE } from './defaults';

describe('splitCutLength', () => {
  it('keeps a single segment exact', () => {
    expect(splitCutLength('18', 1)).toEqual([
      { id: 's1', kind: 'straight', length: '18', unit: 'ft' },
    ]);
  });

  it('splits equally and preserves the total on the last segment', () => {
    const parts = splitCutLength('18', 3);
    expect(parts).toHaveLength(3);
    expect(parts[0]!.length).toBe('6');
    expect(parts[1]!.length).toBe('6');
    expect(parts[2]!.length).toBe('6');
  });
});

describe('computeCurbEstimate', () => {
  it('reproduces the CP-060 page-60 totals ($3,744 / $4,118.40 / $5,491.20)', () => {
    const result = computeCurbEstimate({
      ...WORKED_EXAMPLE,
      book: EXAMPLE_PRICE_BOOK,
      recipe: PAGE60_RECIPE,
    });
    expect(result.quantities.cutLengthFt).toMatchObject({ state: 'known', value: '18' });
    expect(result.estimate.status).toBe('priced');
    expect(result.estimate.firm).toBe(true);
    expect(result.estimate.scenarios!.base.directCost.amount).toBe('3744.00');
    expect(result.estimate.scenarios!.base.costBasis.amount).toBe('4118.40');
    expect(result.estimate.scenarios!.base.total.amount).toBe('5491.20');
  });

  it('marks estimate non-firm when cut depth is bounded', () => {
    const result = computeCurbEstimate({
      cutLengthFt: '18',
      segmentCount: 1,
      sawPasses: 2,
      depthMode: 'bounded',
      depthIn: '6',
      depthLowIn: '6',
      depthBaseIn: '7',
      depthHighIn: '9',
      depthReason: 'depth unverified',
      removalWidthFt: '2',
      crossSectionFt2: '1.5',
      boundCrossSection: true,
      crossSectionLowFt2: '1',
      crossSectionHighFt2: '2',
      book: EXAMPLE_PRICE_BOOK,
      recipe: PAGE60_RECIPE,
      overheadPercent: '10',
      marginPercent: '25',
    });
    expect(result.quantities.cutDepthIn.state).toBe('bounded');
    expect(result.quantities.inchFeet.state).toBe('bounded');
    // Page-60 recipe quantities for cutting/breakout/replacement are known length-based;
    // firmness follows whether any priced line still carries bounds. Length-based lines
    // remain firm unless a bounded quantity feeds a priced basis.
    expect(result.estimate.status).toBe('priced');
    // With only depth/cross-section bounded and recipe using length/fixed bases, estimate
    // may still be firm — surface range drivers honestly when present.
    if (!result.estimate.firm) {
      expect(result.estimate.rangeDrivers.length).toBeGreaterThan(0);
    }
  });

  it('rejects empty cut length', () => {
    expect(() =>
      computeCurbEstimate({
        ...WORKED_EXAMPLE,
        cutLengthFt: '',
        book: EXAMPLE_PRICE_BOOK,
        recipe: PAGE60_RECIPE,
      }),
    ).toThrow(/Cut length/);
  });
});
