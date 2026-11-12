/**
 * Nationwide place suggestions used by the curb-cutting permit lookup.
 *
 * Data is shipped as /permit-cities.json in public/ (MIT-licensed snapshot from
 * gfrancomontero/List-of-US-States-Counties-and-Cities-in-JSON-format).
 *
 * This is a geography autocomplete, NOT a source of permitting jurisdictions.
 * A listed place may be unincorporated or span multiple counties.
 */
import { normalizedCity } from './permitDirectory';

export type NationalCityDirectory = Record<string, Record<string, string[]>>;

export function citySuggestionsFor(
  directory: NationalCityDirectory | null,
  state: string,
  input: string,
  limit = 20,
): string[] {
  const search = normalizedCity(input);
  if (!directory || search.length < 2 || limit <= 0) return [];
  const matched = new Set<string>();
  for (const cities of Object.values(directory[state] ?? {})) {
    for (const place of cities) {
      if (normalizedCity(place).startsWith(search)) matched.add(place);
    }
  }
  return [...matched].sort((a, b) => a.localeCompare(b)).slice(0, limit);
}

export function matchingCountiesFor(
  directory: NationalCityDirectory | null,
  state: string,
  city: string,
): string[] {
  const search = normalizedCity(city);
  if (!directory || !search) return [];
  return Object.entries(directory[state] ?? {})
    .filter(([, cities]) => cities.some((candidate) => normalizedCity(candidate) === search))
    .map(([county]) => county)
    .sort((a, b) => a.localeCompare(b));
}

export function isNationalCityDirectory(value: unknown): value is NationalCityDirectory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const states = Object.keys(r);
  return states.length >= 50 && states.every((state) => {
    const counties = r[state];
    return (
      /^[A-Z]{2}$/.test(state) &&
      counties !== null &&
      typeof counties === 'object' &&
      !Array.isArray(counties) &&
      Object.values(counties).every(
        (places) => Array.isArray(places) && places.every((p) => typeof p === 'string'),
      )
    );
  });
}
