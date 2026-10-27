// WGS84 local tangent-plane (East-North-Up) projection for lon/lat polygons (RF-023, RF-025).
//
// Each polygon is projected about one origin (default: the mean of its vertices) via geodetic ->
// ECEF -> ENU. The planar result keeps East/North and drops Up. For roof- and curb-sized extents
// (< 1 km) the planar distortion is below 1e-7 relative, far under imagery error. Uses
// trigonometric functions, so results may differ by ~1 ulp between JS engines (see numeric.ts).
import { GeometryError, isFiniteNumber } from './numeric';
import type { Point } from './polygon';

export interface LonLat {
  /** Longitude in decimal degrees, -180..180. */
  readonly lon: number;
  /** Latitude in decimal degrees, -90..90. */
  readonly lat: number;
}

export const WGS84 = Object.freeze({ a: 6378137, f: 1 / 298.257223563 });
const E2 = WGS84.f * (2 - WGS84.f);
const DEG = Math.PI / 180;

function checkLonLat(p: LonLat): void {
  if (
    !isFiniteNumber(p.lon) ||
    !isFiniteNumber(p.lat) ||
    Math.abs(p.lat) > 90 ||
    Math.abs(p.lon) > 180
  ) {
    throw new GeometryError('invalid_coordinate', `invalid lon/lat (${p.lon}, ${p.lat})`);
  }
}

function toEcef(p: LonLat, h = 0): [number, number, number] {
  const lat = p.lat * DEG;
  const lon = p.lon * DEG;
  const sinLat = Math.sin(lat);
  const n = WGS84.a / Math.sqrt(1 - E2 * sinLat * sinLat);
  const cosLat = Math.cos(lat);
  return [
    (n + h) * cosLat * Math.cos(lon),
    (n + h) * cosLat * Math.sin(lon),
    (n * (1 - E2) + h) * sinLat,
  ];
}

export interface TangentPlane {
  readonly origin: LonLat;
  /** Project lon/lat to planar meters (x = east, y = north) about the origin. */
  project(p: LonLat): Point;
}

export function tangentPlane(origin: LonLat): TangentPlane {
  checkLonLat(origin);
  const [ox, oy, oz] = toEcef(origin);
  const lat = origin.lat * DEG;
  const lon = origin.lon * DEG;
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  return {
    origin,
    project(p: LonLat): Point {
      checkLonLat(p);
      const [x, y, z] = toEcef(p);
      const dx = x - ox;
      const dy = y - oy;
      const dz = z - oz;
      return { x: -sLon * dx + cLon * dy, y: -sLat * cLon * dx - sLat * sLon * dy + cLat * dz };
    },
  };
}

/** Mean lon/lat of a ring (used as the default tangent origin). */
export function meanLonLat(ring: readonly LonLat[]): LonLat {
  if (ring.length === 0) throw new GeometryError('invalid_argument', 'empty ring');
  let lon = 0;
  let lat = 0;
  for (const p of ring) {
    checkLonLat(p);
    lon += p.lon;
    lat += p.lat;
  }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

/** Project a lon/lat ring to planar meters; returns the plane so other rings can share it. */
export function projectRing(
  ring: readonly LonLat[],
  origin?: LonLat,
): { plane: TangentPlane; points: Point[] } {
  const plane = tangentPlane(origin ?? meanLonLat(ring));
  return { plane, points: ring.map((p) => plane.project(p)) };
}
