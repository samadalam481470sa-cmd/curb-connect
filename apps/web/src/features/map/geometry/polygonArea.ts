// Client-side plan-area helpers: WGS84 polygon rings → m² / ft² using Turf geodesic area.
// Satellite outlines are horizontal footprints; pitch is applied separately by the roof calculator.
import area from '@turf/area';
import { lineString, polygon } from '@turf/helpers';
import length from '@turf/length';
import {
  area as planarAreaM2,
  convert,
  projectRing,
  type LonLat as GeomLonLat,
} from '@fieldline/geometry';

export type LngLat = readonly [lng: number, lat: number];

const M2_PER_FT2 = 0.09290304;
const M_PER_FT = 0.3048;

/** Ensure a ring is closed (first === last) for GeoJSON Polygon. */
export function closeRing(ring: readonly LngLat[]): LngLat[] {
  if (ring.length === 0) return [];
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return [...ring];
  return [...ring, first];
}

/** Open ring (no duplicate closing vertex). */
export function openRing(ring: readonly LngLat[]): LngLat[] {
  if (ring.length < 2) return [...ring];
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return [...ring];
}

export interface PlanAreaResult {
  /** Geodesic area via Turf (preferred for map footprints). */
  readonly areaM2: number;
  readonly areaFt2: number;
  /** Local ENU planar area via @fieldline/geometry (cross-check). */
  readonly planarAreaM2: number;
  readonly planarAreaFt2: number;
}

/**
 * Convert a lon/lat polygon ring to plan area.
 * Accepts open or closed rings; needs ≥ 3 distinct vertices.
 */
export function planAreaFromLngLat(ring: readonly LngLat[]): PlanAreaResult {
  const open = openRing(ring);
  if (open.length < 3) {
    return { areaM2: 0, areaFt2: 0, planarAreaM2: 0, planarAreaFt2: 0 };
  }
  const closed = closeRing(open);
  const turfM2 = area(polygon([closed.map(([lng, lat]) => [lng, lat])]));
  const geomRing: GeomLonLat[] = open.map(([lng, lat]) => ({ lon: lng, lat }));
  const { points } = projectRing(geomRing);
  const planarM2 = planarAreaM2(points);
  return {
    areaM2: turfM2,
    areaFt2: turfM2 / M2_PER_FT2,
    planarAreaM2: planarM2,
    planarAreaFt2: planarM2 / M2_PER_FT2,
  };
}

/** Perimeter of a lon/lat ring in meters (geodesic) and feet. */
export function perimeterFromLngLat(ring: readonly LngLat[]): { lengthM: number; lengthFt: number } {
  const open = openRing(ring);
  if (open.length < 2) return { lengthM: 0, lengthFt: 0 };
  const closed = closeRing(open);
  const lengthM = length(lineString(closed.map(([lng, lat]) => [lng, lat])), { units: 'meters' });
  return { lengthM, lengthFt: lengthM / M_PER_FT };
}

/** Per-edge lengths (open ring → n edges, last closes to first). */
export function edgeLengthsFt(ring: readonly LngLat[]): number[] {
  const open = openRing(ring);
  if (open.length < 2) return [];
  const out: number[] = [];
  for (let i = 0; i < open.length; i++) {
    const a = open[i]!;
    const b = open[(i + 1) % open.length]!;
    const lengthM = length(lineString([
      [a[0], a[1]],
      [b[0], b[1]],
    ]), { units: 'meters' });
    out.push(lengthM / M_PER_FT);
  }
  return out;
}

/** Format area for display inputs consumed by computeRoofEstimate (decimal string). */
export function areaFt2AsInput(areaFt2: number, digits = 2): string {
  if (!Number.isFinite(areaFt2) || areaFt2 <= 0) return '';
  return areaFt2.toFixed(digits);
}

export function areaM2AsInput(areaM2: number, digits = 2): string {
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return '';
  return areaM2.toFixed(digits);
}

/** Haversine distance in meters between two lng/lat points (snap threshold helper). */
export function distanceMeters(a: LngLat, b: LngLat): number {
  return length(
    lineString([
      [a[0], a[1]],
      [b[0], b[1]],
    ]),
    { units: 'meters' },
  );
}

/** Convert SI meters (geometry package) when callers already have planar meters. */
export function metersToFeet(m: number): number {
  return convert(m, 'm', 'ft');
}
