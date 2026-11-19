/** PostGIS / GeoJSON helpers for the properties module. */
import type { GeoPoint } from '@fieldline/contracts';

/** EWKT for a WGS84 point (lon, lat). PostGIS geography accepts this on write. */
export function pointEwkt(lon: number, lat: number): string {
  return `SRID=4326;POINT(${lon} ${lat})`;
}

export function geoPoint(lon: number, lat: number): GeoPoint {
  return { type: 'Point', coordinates: [lon, lat] };
}

/** Parse ST_AsGeoJSON text into a GeoPoint, or null. */
export function parseGeoJsonPoint(raw: string | null | undefined): GeoPoint | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { type?: string; coordinates?: unknown };
    if (parsed.type !== 'Point' || !Array.isArray(parsed.coordinates)) return null;
    const [lon, lat] = parsed.coordinates as [unknown, unknown];
    if (typeof lon !== 'number' || typeof lat !== 'number') return null;
    return geoPoint(lon, lat);
  } catch {
    return null;
  }
}
