// Pure map-data policy: which mapped buildings are never shown, and which are hidden on request.
// Kept free of I/O so it can be tested without a database or network.

export interface Removal {
  lat: number;
  lon: number;
  radiusM: number;
}

export interface Point2D {
  lat: number;
  lon: number;
}

/**
 * OpenStreetMap tags for buildings that are government, military or custodial sites. These are not
 * shown on the map at all. The list is deliberately conservative: a false positive only hides a
 * footprint, while a false negative would publish a sensitive site.
 */
export function isSensitiveSite(tags: Record<string, unknown>): boolean {
  const is = (key: string, values: string[]) => typeof tags[key] === 'string' && values.includes(tags[key] as string);
  if (is('building', ['government', 'military', 'prison', 'barracks', 'bunker'])) return true;
  if (is('landuse', ['military'])) return true;
  if (is('amenity', ['prison', 'courthouse'])) return true;
  if (is('office', ['government', 'military'])) return true;
  if (typeof tags.government === 'string' || typeof tags.military === 'string') return true;
  return false;
}

/** Great-circle distance in metres between two WGS84 points. */
export function distanceMeters(a: Point2D, b: Point2D): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Mean of the ring's vertices. Good enough to decide whether a footprint sits inside a removal zone. */
export function ringCentroid(ring: readonly { lon: number; lat: number }[]): Point2D {
  const n = ring.length || 1;
  const lon = ring.reduce((s, p) => s + p.lon, 0) / n;
  const lat = ring.reduce((s, p) => s + p.lat, 0) / n;
  return { lat, lon };
}

/** True when the footprint's centroid lies inside any approved removal zone. */
export function isRemoved(centroid: Point2D, removals: readonly Removal[]): boolean {
  return removals.some((r) => distanceMeters(centroid, r) <= r.radiusM);
}
