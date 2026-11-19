import { describe, expect, it } from 'vitest';
import { assertSourceAllowed, LicenceRefused, SOURCE_LICENCES } from './index';

describe('source licence registry', () => {
  it('allows permissive sources to be stored and redistributed', () => {
    expect(assertSourceAllowed('usgs-3dep', 'store').id).toBe('usgs-3dep');
    expect(assertSourceAllowed('census-tiger', 'redistribute').permissive).toBe(true);
  });

  it('refuses share-alike sources for storage and redistribution, but allows display', () => {
    expect(() => assertSourceAllowed('openstreetmap-odbl', 'store')).toThrow(LicenceRefused);
    expect(() => assertSourceAllowed('ms-us-buildings-odbl', 'redistribute')).toThrow(/cannot be used/);
    expect(assertSourceAllowed('openstreetmap-odbl', 'display').id).toBe('openstreetmap-odbl');
  });

  it('refuses unknown sources', () => {
    expect(() => assertSourceAllowed('scraped-site', 'store')).toThrow(/Unknown data source/);
  });

  it('keeps ids unique and marks every entry as not yet verified', () => {
    expect(new Set(SOURCE_LICENCES.map((s) => s.id)).size).toBe(SOURCE_LICENCES.length);
    expect(SOURCE_LICENCES.every((s) => s.verifiedOn === null)).toBe(true);
  });
});
