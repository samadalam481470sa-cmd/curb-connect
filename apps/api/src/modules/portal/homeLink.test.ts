// Connectivity build 7: portal contract resolution precedence + plan spec reading.
import { describe, expect, it } from 'vitest';
import { pickPortalContractId, planSpecSummary } from './homeLink';

describe('pickPortalContractId', () => {
  it('prefers the land house contract', () => {
    expect(pickPortalContractId('house-contract', 'direct-contract')).toBe('house-contract');
  });

  it('falls back to the direct contract', () => {
    expect(pickPortalContractId(null, 'direct-contract')).toBe('direct-contract');
    expect(pickPortalContractId(undefined, 'direct-contract')).toBe('direct-contract');
  });

  it('returns null when neither exists', () => {
    expect(pickPortalContractId(null, null)).toBeNull();
    expect(pickPortalContractId(undefined, undefined)).toBeNull();
  });
});

describe('planSpecSummary', () => {
  it('reads the known fields', () => {
    expect(
      planSpecSummary({
        bedrooms: 3,
        bathrooms: 2,
        stories: 1,
        garage: 'two_car',
        lengthFt: 50,
        widthFt: 32,
        roofPitch: 6,
      }),
    ).toEqual({
      bedrooms: 3,
      bathrooms: 2,
      stories: 1,
      garage: 'two_car',
      lengthFt: 50,
      widthFt: 32,
      roofPitch: 6,
    });
  });

  it('never invents missing or malformed values', () => {
    expect(planSpecSummary(null)).toEqual({
      bedrooms: null,
      bathrooms: null,
      stories: null,
      garage: null,
      lengthFt: null,
      widthFt: null,
      roofPitch: null,
    });
    expect(planSpecSummary({ bedrooms: 'three', garage: 2 })).toEqual({
      bedrooms: null,
      bathrooms: null,
      stories: null,
      garage: null,
      lengthFt: null,
      widthFt: null,
      roofPitch: null,
    });
  });
});
