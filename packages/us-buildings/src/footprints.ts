// Building footprints from public GeoJSON (Polygon / MultiPolygon, WGS84 lon/lat). Area uses a local
// equirectangular projection around each footprint's centroid, which is accurate to well under 1%
// for building-sized polygons. Inputs are validated: non-finite or out-of-range coordinates, empty
// rings and oversized files are rejected rather than silently counted.
import { z } from 'zod';

const SQM_TO_SQFT = 10.763910416709722;
const EARTH_RADIUS_M = 6_371_008.8;
export const MAX_RINGS = 50_000;
export const MAX_VERTICES_PER_RING = 10_000;

/** Coarse box covering the 50 states, including Alaska's Aleutians and Hawaii. */
export const US_BOUNDS = { minLat: 17, maxLat: 72, minLon: -180, maxLon: -64 } as const;

export type Position = [number, number];
export type Ring = Position[];

const Position = z.tuple([z.number().finite(), z.number().finite()]);

const Geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(Position).min(4)).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(z.array(Position).min(4)).min(1)).min(1) }),
]);

export const Feature = z.object({
  type: z.literal('Feature'),
  geometry: Geometry,
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const FeatureCollection = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(Feature).max(MAX_RINGS),
});

export interface Footprint {
  areaSqFt: number;
  centroid: { lat: number; lon: number };
  properties: Record<string, unknown>;
}

function assertInUs(lon: number, lat: number): void {
  if (lat < US_BOUNDS.minLat || lat > US_BOUNDS.maxLat || lon < US_BOUNDS.minLon || lon > US_BOUNDS.maxLon) {
    throw new RangeError(`Coordinate ${lat},${lon} is outside the United States bounds.`);
  }
}

/** Planar area of one ring in square metres, after projecting to a local metric plane. */
export function ringAreaSqM(ring: Ring): number {
  if (ring.length > MAX_VERTICES_PER_RING) throw new RangeError('Ring has too many vertices.');
  const lat0 = ring.reduce((s, [, lat]) => s + lat, 0) / ring.length;
  const lon0 = ring.reduce((s, [lon]) => s + lon, 0) / ring.length;
  const kx = (Math.PI / 180) * EARTH_RADIUS_M * Math.cos((lat0 * Math.PI) / 180);
  const ky = (Math.PI / 180) * EARTH_RADIUS_M;
  const pts = ring.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky] as const);
  let twice = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

/** Area of a polygon with holes: outer ring minus holes. */
export function polygonAreaSqM(rings: Ring[]): number {
  const [outer, ...holes] = rings;
  if (!outer) return 0;
  return Math.max(0, ringAreaSqM(outer) - holes.reduce((s, h) => s + ringAreaSqM(h), 0));
}

/** Parse a GeoJSON FeatureCollection into footprints. Invalid input throws; nothing is skipped silently. */
export function parseFootprints(json: unknown): Footprint[] {
  const collection = FeatureCollection.parse(json);
  return collection.features.map((feature) => {
    const polygons: Ring[][] =
      feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    let areaSqM = 0;
    let sumLon = 0;
    let sumLat = 0;
    let count = 0;
    for (const rings of polygons) {
      for (const ring of rings) {
        for (const [lon, lat] of ring) {
          assertInUs(lon, lat);
          sumLon += lon;
          sumLat += lat;
          count += 1;
        }
      }
      areaSqM += polygonAreaSqM(rings);
    }
    return {
      areaSqFt: Math.round(areaSqM * SQM_TO_SQFT * 10) / 10,
      centroid: { lat: sumLat / count, lon: sumLon / count },
      properties: feature.properties ?? {},
    };
  });
}
