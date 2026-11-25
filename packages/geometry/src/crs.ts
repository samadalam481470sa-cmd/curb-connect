// Minimal coordinate reference system support — QGIS on-the-fly reprojection, scoped to the
// CRSs this repo actually holds. Nothing here invents a CRS: EPSG:4326 is lon/lat on WGS84,
// EPSG:3857 is Web Mercator metres, LOCAL_ENU_M is the local tangent plane from projection.ts
// (East/North metres about a stated origin). Anything else is refused, never guessed.
import proj4 from 'proj4';
import { GeometryError } from './numeric';
import { tangentPlane, type LonLat } from './projection';

export type CrsId = 'EPSG:4326' | 'EPSG:3857' | 'LOCAL_ENU_M';

/** A point in EPSG:3857 or LOCAL_ENU_M (both are x = east, y = north, in metres). */
export interface Xy {
  readonly x: number;
  readonly y: number;
}

export type CrsPoint =
  | { readonly crs: 'EPSG:4326'; readonly lon: number; readonly lat: number }
  | { readonly crs: 'EPSG:3857'; readonly x: number; readonly y: number }
  | { readonly crs: 'LOCAL_ENU_M'; readonly x: number; readonly y: number };

function toLonLat(point: CrsPoint, origin?: LonLat): LonLat {
  switch (point.crs) {
    case 'EPSG:4326':
      return { lon: point.lon, lat: point.lat };
    case 'EPSG:3857': {
      const [lon, lat] = proj4('EPSG:3857', 'EPSG:4326', [point.x, point.y]);
      return { lon, lat };
    }
    case 'LOCAL_ENU_M': {
      if (!origin) {
        throw new GeometryError(
          'invalid_argument',
          'LOCAL_ENU_M needs an origin lon/lat to reproject from',
        );
      }
      return tangentPlane(origin).unproject({ x: point.x, y: point.y });
    }
    default:
      throw new GeometryError(
        'invalid_argument',
        `unsupported CRS "${(point as { crs: string }).crs}"`,
      );
  }
}

function fromLonLat(lonLat: LonLat, to: CrsId, origin?: LonLat): CrsPoint {
  switch (to) {
    case 'EPSG:4326':
      return { crs: 'EPSG:4326', lon: lonLat.lon, lat: lonLat.lat };
    case 'EPSG:3857': {
      const [x, y] = proj4('EPSG:4326', 'EPSG:3857', [lonLat.lon, lonLat.lat]);
      return { crs: 'EPSG:3857', x, y };
    }
    case 'LOCAL_ENU_M': {
      if (!origin) {
        throw new GeometryError(
          'invalid_argument',
          'LOCAL_ENU_M needs an origin lon/lat to reproject to',
        );
      }
      const p = tangentPlane(origin).project(lonLat);
      return { crs: 'LOCAL_ENU_M', x: p.x, y: p.y };
    }
    default:
      throw new GeometryError('invalid_argument', `unsupported CRS "${to}"`);
  }
}

/**
 * Reproject one point between the supported CRSs. LOCAL_ENU_M conversions need the tangent
 * origin; conversions between EPSG:4326 and EPSG:3857 do not. A point already in the target
 * CRS is returned unchanged.
 */
export function reprojectPoint(point: CrsPoint, to: CrsId, origin?: LonLat): CrsPoint {
  if (point.crs === to) return point;
  return fromLonLat(toLonLat(point, origin), to, origin);
}

/** Reproject a whole ring; the input ring's CRS is taken from its first point. */
export function reprojectRing(
  ring: readonly CrsPoint[],
  to: CrsId,
  origin?: LonLat,
): CrsPoint[] {
  return ring.map((p) => reprojectPoint(p, to, origin));
}

/** Convenience: a closed EPSG:3857 ring (e.g. a class-6 footprint) as lon/lat vertices. */
export function mercatorRingToLonLat(ring: readonly (readonly [number, number])[]): LonLat[] {
  return ring.map(([x, y]) => {
    const p = reprojectPoint({ crs: 'EPSG:3857', x, y }, 'EPSG:4326');
    if (p.crs !== 'EPSG:4326') throw new GeometryError('internal', 'reprojection lost its CRS');
    return { lon: p.lon, lat: p.lat };
  });
}

/** Convenience: lon/lat vertices as an EPSG:3857 ring. */
export function lonLatRingToMercator(ring: readonly LonLat[]): Xy[] {
  return ring.map((p) => {
    const q = reprojectPoint({ crs: 'EPSG:4326', lon: p.lon, lat: p.lat }, 'EPSG:3857');
    if (q.crs !== 'EPSG:3857') throw new GeometryError('internal', 'reprojection lost its CRS');
    return { x: q.x, y: q.y };
  });
}
