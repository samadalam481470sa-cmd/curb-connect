// GEOS-style geometry operations — the QGIS/GEOS toolset (buffer, intersection, union,
// difference), via the permissively licensed `@turf/*` packages (MIT), which implement the
// same overlay algorithms. No GEOS or QGIS source is used. Operations run on lon/lat rings:
// turf works in lon/lat space, so results stay lon/lat and areas are measured afterwards with
// the tangent-plane or geodesic math, never from degree-space numbers.
import buffer from '@turf/buffer';
import difference from '@turf/difference';
import intersect from '@turf/intersect';
import union from '@turf/union';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { GeometryError, isFiniteNumber } from './numeric';
import type { LonLat } from './projection';

type Ring = readonly LonLat[];

function checkRing(ring: Ring, label: string): void {
  if (ring.length < 3) {
    throw new GeometryError(
      'invalid_argument',
      `${label} needs at least 3 vertices, got ${ring.length}`,
    );
  }
  for (const p of ring) {
    if (
      !isFiniteNumber(p.lon) ||
      !isFiniteNumber(p.lat) ||
      Math.abs(p.lat) > 90 ||
      Math.abs(p.lon) > 180
    ) {
      throw new GeometryError('invalid_coordinate', `${label} has an invalid lon/lat`);
    }
  }
}

function toFeature(ring: Ring): Feature<Polygon> {
  const coords = ring.map((p) => [p.lon, p.lat]);
  coords.push([ring[0]!.lon, ring[0]!.lat]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

function toCollection(rings: readonly Ring[]): FeatureCollection<Polygon | MultiPolygon> {
  return { type: 'FeatureCollection', features: rings.map(toFeature) };
}

/** Outer rings of a Polygon/MultiPolygon result, as open lon/lat rings (empty when no area). */
function resultRings(
  feature: Feature<Polygon | MultiPolygon> | null,
): LonLat[][] {
  if (!feature) return [];
  const geometry = feature.geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const out: LonLat[][] = [];
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer || outer.length < 4) continue;
    // Drop the closing vertex (GeoJSON closes rings; this repo's rings are open).
    out.push(outer.slice(0, -1).map((pos) => ({ lon: pos[0]!, lat: pos[1]! })));
  }
  return out;
}

/**
 * Union of several lon/lat rings: the combined outline with overlaps counted once. Returns
 * [] when the input is empty. Use it to measure combined footprint area without
 * double-counting overlapping facets or parcels.
 */
export function unionLonLatRings(rings: readonly Ring[]): LonLat[][] {
  if (rings.length === 0) return [];
  for (const [i, ring] of rings.entries()) checkRing(ring, `ring ${i}`);
  if (rings.length === 1) return [[...rings[0]!]];
  return resultRings(union(toCollection(rings)) ?? null);
}

/** Overlap of two lon/lat rings; [] when they do not overlap. */
export function intersectLonLatRings(a: Ring, b: Ring): LonLat[][] {
  checkRing(a, 'first ring');
  checkRing(b, 'second ring');
  return resultRings(intersect(toCollection([a, b])));
}

/** The part of `a` outside `b`; [] when `a` is entirely inside `b`. */
export function differenceLonLatRings(a: Ring, b: Ring): LonLat[][] {
  checkRing(a, 'first ring');
  checkRing(b, 'second ring');
  return resultRings(difference(toCollection([a, b])));
}

/**
 * Buffer a lon/lat ring outward (positive metres) or inward (negative metres, e.g. a
 * setback). Returns [] when an inward buffer eats the whole ring.
 */
export function bufferLonLatRing(ring: Ring, metres: number): LonLat[][] {
  checkRing(ring, 'ring');
  if (!isFiniteNumber(metres)) {
    throw new GeometryError('invalid_argument', 'buffer distance must be a finite number');
  }
  return resultRings(buffer(toFeature(ring), metres, { units: 'meters' }) ?? null);
}
