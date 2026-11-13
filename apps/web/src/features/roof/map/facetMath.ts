// Map-drawn roof facets (RF-023, RF-025, RF-027): lon/lat rings -> plan area via the shared WGS84
// tangent-plane projection -> sloped area from pitch. Source is always MANUAL (contractor-drawn on
// imagery); results carry that provenance and are never presented as survey-grade.
import {
  area,
  centroid,
  perimeter,
  projectRing,
  slopeFactor,
  type LonLat,
} from '@fieldline/geometry';

export const SQFT_PER_M2 = 10.763910416709722;
export const FT_PER_M = 3.280839895013123;

export interface MapFacet {
  id: string;
  name: string;
  ring: LonLat[];
  /** Rise per 12; null = pitch not yet confirmed (sloped area unresolved). */
  pitch: number | null;
  /** GIS building footprint, not verified roof facets (needs contractor confirmation). */
  source?: 'osm_footprint';
}

export interface MapFacetResult {
  id: string;
  name: string;
  planSqFt: number;
  perimeterFt: number;
  pitch: number | null;
  pitchDegrees: number | null;
  slopedSqFt: number | null;
  label: LonLat;
}

export interface MapRoofResult {
  facets: MapFacetResult[];
  planSqFt: number;
  /** Sum of sloped areas for facets with a confirmed pitch. */
  slopedSqFt: number;
  facetsMissingPitch: number;
  squares: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function measureFacet(f: MapFacet): MapFacetResult | null {
  if (f.ring.length < 3) return null;
  const { plane, points } = projectRing(f.ring);
  const planM2 = area(points);
  const perimM = perimeter([...points, points[0]!]);
  const c = centroid(points);
  // Invert the tiny tangent offset back to lon/lat for the label (meters -> degrees, local).
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((plane.origin.lat * Math.PI) / 180);
  const label = {
    lon: plane.origin.lon + c.x / metersPerDegLon,
    lat: plane.origin.lat + c.y / metersPerDegLat,
  };
  const planSqFt = planM2 * SQFT_PER_M2;
  const factor = f.pitch === null ? null : slopeFactor({ rise: Math.max(0, f.pitch), run: 12 });
  return {
    id: f.id,
    name: f.name,
    planSqFt: r1(planSqFt),
    perimeterFt: r1(perimM * FT_PER_M),
    pitch: f.pitch,
    pitchDegrees:
      f.pitch === null ? null : r1((Math.atan(Math.max(0, f.pitch) / 12) * 180) / Math.PI),
    slopedSqFt: factor === null ? null : r1(planSqFt * factor),
    label,
  };
}

export function measureRoof(facets: readonly MapFacet[]): MapRoofResult {
  const results = facets.map(measureFacet).filter((r): r is MapFacetResult => r !== null);
  const planSqFt = results.reduce((s, r) => s + r.planSqFt, 0);
  const slopedSqFt = results.reduce((s, r) => s + (r.slopedSqFt ?? 0), 0);
  return {
    facets: results,
    planSqFt: r1(planSqFt),
    slopedSqFt: r1(slopedSqFt),
    facetsMissingPitch: results.filter((r) => r.slopedSqFt === null).length,
    squares: Math.round(slopedSqFt) / 100,
  };
}

/** GeoJSON for the map: closed facet polygons with their measured labels. */
export function facetsGeoJson(facets: readonly MapFacet[], results: readonly MapFacetResult[]) {
  const byId = new Map(results.map((r) => [r.id, r]));
  return {
    type: 'FeatureCollection' as const,
    features: facets
      .filter((f) => f.ring.length >= 3)
      .map((f) => {
        const r = byId.get(f.id);
        const ring = f.ring.map((p) => [p.lon, p.lat]);
        return {
          type: 'Feature' as const,
          id: f.id,
          properties: {
            id: f.id,
            label: r
              ? `${f.name}\n${Math.round(r.slopedSqFt ?? r.planSqFt).toLocaleString('en-US')} ft²${r.slopedSqFt === null ? ' plan' : ''}`
              : f.name,
          },
          geometry: { type: 'Polygon' as const, coordinates: [[...ring, ring[0]!]] },
        };
      }),
  };
}
