// Ellipsoid (geodesic) area and perimeter on WGS84 — the QGIS QgsDistanceArea approach.
//
// QGIS measures area and length on the ellipsoid with GeographicLib (Karney's algorithms);
// this module is the same library, via the `geographiclib` npm package (MIT). Use it for
// parcel and land measurement, where extent makes the ellipsoid matter, and as a cross-check
// on plan area. Roof facets keep the local tangent plane (projection.ts): at house scale the
// geodesic and planar areas differ by far under 0.01%, below imagery error, and the tangent
// plane is what the facet topology and pitch math are built on.
import geographiclib from 'geographiclib';
import { GeometryError, isFiniteNumber } from './numeric';
import type { LonLat } from './projection';

/** Square metres in one acre (43,560 ft² × 0.09290304 m²/ft², exact). */
export const M2_PER_ACRE = 4046.8564224;

/** The small typed surface of GeographicLib's polygon accumulator we rely on. */
interface PolygonAccumulator {
  AddPoint(lat: number, lon: number): void;
  Compute(
    reverse: boolean,
    sign: boolean,
  ): { number: number; perimeter: number; area: number };
}

const WGS84 = geographiclib.Geodesic.WGS84 as unknown as {
  Polygon(polyline: boolean): PolygonAccumulator;
};

function checkRing(ring: readonly LonLat[]): void {
  if (ring.length < 3) {
    throw new GeometryError(
      'invalid_argument',
      `geodesic measurement needs at least 3 vertices, got ${ring.length}`,
    );
  }
  for (const p of ring) {
    if (
      !isFiniteNumber(p.lon) ||
      !isFiniteNumber(p.lat) ||
      Math.abs(p.lat) > 90 ||
      Math.abs(p.lon) > 180
    ) {
      throw new GeometryError('invalid_coordinate', `invalid lon/lat (${p.lon}, ${p.lat})`);
    }
  }
}

function accumulate(ring: readonly LonLat[]): { perimeter: number; area: number } {
  checkRing(ring);
  const poly = WGS84.Polygon(false);
  for (const p of ring) poly.AddPoint(p.lat, p.lon);
  const { perimeter, area } = poly.Compute(false, true);
  return { perimeter, area };
}

/**
 * Geodesic area of a lon/lat ring on the WGS84 ellipsoid, in square metres (always
 * positive). Winding does not matter: the absolute value is returned.
 */
export function geodesicArea(ring: readonly LonLat[]): number {
  return Math.abs(accumulate(ring).area);
}

/** Geodesic area of a lon/lat ring in acres. */
export function geodesicAreaAcres(ring: readonly LonLat[]): number {
  return geodesicArea(ring) / M2_PER_ACRE;
}

/** Geodesic perimeter of a lon/lat ring on the WGS84 ellipsoid, in metres. */
export function geodesicPerimeter(ring: readonly LonLat[]): number {
  return accumulate(ring).perimeter;
}
