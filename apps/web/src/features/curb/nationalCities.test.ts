import { describe, expect, it } from 'vitest';
import nationalPlaces from '../../../public/permit-cities.json';
import {
  citySuggestionsFor,
  isNationalCityDirectory,
  matchingCountiesFor,
  type NationalCityDirectory,
} from './nationalCities';

const directory = nationalPlaces as NationalCityDirectory;

describe('nationwide city and county lookup', () => {
  it('ships a bundled directory for all 50 states and DC', () => {
    expect(isNationalCityDirectory(directory)).toBe(true);
    expect(Object.keys(directory)).toHaveLength(51);
    const count = Object.values(directory)
      .flatMap((counties) => Object.values(counties))
      .reduce((total, places) => total + places.length, 0);
    expect(count).toBeGreaterThan(30_000);
  });

  it('suggests cities in the chosen state only', () => {
    expect(citySuggestionsFor(directory, 'TX', 'dal')).toContain('Dallas');
    expect(citySuggestionsFor(directory, 'OR', 'port')).toContain('Portland');
    expect(citySuggestionsFor(directory, 'ME', 'port')).toContain('Portland');
    expect(citySuggestionsFor(directory, 'TX', 'miam')).not.toContain('Miami Beach');
  });

  it('returns county choices for multi-county cities without guessing jurisdiction', () => {
    const choices = matchingCountiesFor(directory, 'TX', 'Carrollton');
    expect(choices).toContain('Dallas County');
    expect(choices).toContain('Denton County');
    expect(matchingCountiesFor(directory, 'TX', 'No such city')).toHaveLength(0);
  });

  it('normalizes capitalization and limits the number of suggestions rendered', () => {
    expect(citySuggestionsFor(directory, 'TX', '  CAR  ', 3).length).toBeLessThanOrEqual(3);
    expect(citySuggestionsFor(directory, 'TX', 'a', 20)).toEqual([]);
    expect(citySuggestionsFor(null, 'TX', 'Dallas')).toEqual([]);
    expect(citySuggestionsFor(directory, 'TX', 'Dallas', 0)).toEqual([]);
  });

  it('rejects malformed directory responses', () => {
    expect(isNationalCityDirectory(null)).toBe(false);
    expect(isNationalCityDirectory([])).toBe(false);
    expect(isNationalCityDirectory({ TX: { Dallas: ['Dallas'] } })).toBe(false);
  });
});
