import { describe, expect, it } from 'vitest';
import { SHINGLE_OPTIONS, computeShingleQuote } from './shinglePricing';

describe('product-specific roof shingle estimate', () => {
  it('uses manufacturer packages per square and rounds only at purchase stage', () => {
    expect(SHINGLE_OPTIONS.find(x => x.id === 'gaf_hdz')?.bundlesPerSquare).toBe(3);
    expect(SHINGLE_OPTIONS.find(x => x.id === 'oc_duration')?.bundlesPerSquare).toBe(3);
    expect(computeShingleQuote(1000, 10, 3, 40, 150)).toEqual({
      bundles: 33, shingleCost: 1320, laborCost: 1500, total: 2820,
    });
  });
  it('never treats missing supplier prices as a real zero-dollar quote', () => {
    expect(computeShingleQuote(1000, 10, 3, null, 120).total).toBeNull();
    expect(computeShingleQuote(1000, 10, 3, null, null).shingleCost).toBeNull();
  });
  it('supports custom packaging and does not round prematurely', () => {
    expect(computeShingleQuote(500, 10, 4, 90, 130).bundles).toBe(22);
    expect(computeShingleQuote(0, 10, 3, 0, 0).bundles).toBe(0);
  });
  it('rejects nonsensical roof sizes, costs or package coverage', () => {
    expect(() => computeShingleQuote(-1, 10, 3, 40, 150)).toThrow();
    expect(() => computeShingleQuote(100, 10, 0, 40, 150)).toThrow();
    expect(() => computeShingleQuote(100, 10, 3, -1, 150)).toThrow();
    expect(() => computeShingleQuote(100, 50, 3, 40, 150)).toThrow();
  });
});
