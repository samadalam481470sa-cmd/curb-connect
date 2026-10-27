import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, PricingDecimal } from './index';

describe('@fieldline/pricing smoke', () => {
  it('exports a semantic engine version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('does exact decimal arithmetic (no binary float drift)', () => {
    expect(new PricingDecimal('0.1').plus('0.2').toString()).toBe('0.3');
  });

  it('rounds half-up at an explicit stage', () => {
    expect(new PricingDecimal('2.345').toDecimalPlaces(2).toFixed(2)).toBe('2.35');
    expect(new PricingDecimal('-2.345').toDecimalPlaces(2).toFixed(2)).toBe('-2.35');
    expect(new PricingDecimal('2.344').toDecimalPlaces(2).toFixed(2)).toBe('2.34');
  });
});
