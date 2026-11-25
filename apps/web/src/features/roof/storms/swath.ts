// Pure helpers for the hail-swath GeoJSON from /v1/roof-storms/swath. Kept
// map-free so the geometry handling is unit-testable without MapLibre.
import type { Swath } from './api';

/** [[minLon, minLat], [maxLon, maxLat]] — the bounds MapLibre fits to. */
export type SwathBounds = [[number, number], [number, number]];

export function swathBounds(
  collection: Swath['swath'] | null | undefined,
): SwathBounds | null {
  if (!collection) return null;
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      const lon = value[0];
      const lat = value[1];
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
      return;
    }
    for (const child of value) visit(child);
  };
  for (const feature of collection.features) visit(feature.geometry.coordinates);
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}
