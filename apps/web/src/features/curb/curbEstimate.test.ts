import { describe, expect, it } from 'vitest';
import { DEFAULT_CURB_INPUTS, estimateCurb, SAMPLE_CURB_RATES } from './curbEstimate';

describe('curb workspace estimate', () => {
  it('bounded depth gives an ordered low/base/high band', () => {
    const e = estimateCurb(DEFAULT_CURB_INPUTS, SAMPLE_CURB_RATES);
    expect(e.depthState).toBe('bounded');
    expect(e.inchFeet).toEqual({ low: 24 * 2 * 6, base: 24 * 2 * 8, high: 24 * 2 * 10 });
    expect(e.cost!.low).toBeLessThan(e.cost!.base);
    expect(e.cost!.base).toBeLessThan(e.cost!.high);
  });

  it('equal low/high depth is a known depth with a single value', () => {
    const e = estimateCurb(
      { ...DEFAULT_CURB_INPUTS, depthLowIn: 8, depthBaseIn: 8, depthHighIn: 8 },
      SAMPLE_CURB_RATES,
    );
    expect(e.depthState).toBe('known');
    expect(e.cost!.low).toBeCloseTo(e.cost!.high, 6);
  });

  it('removal volume = section × length ÷ 27', () => {
    const e = estimateCurb(DEFAULT_CURB_INPUTS, SAMPLE_CURB_RATES);
    expect(e.removalYd3!.base).toBeCloseTo((((18 * 6) / 144) * 24) / 27, 6);
  });

  it('missing depth leaves the price unknown instead of guessing', () => {
    const e = estimateCurb(
      { ...DEFAULT_CURB_INPUTS, depthLowIn: 0, depthHighIn: 0 },
      SAMPLE_CURB_RATES,
    );
    expect(e.depthState).toBe('unknown');
    expect(e.cost).toBeNull();
  });
});
