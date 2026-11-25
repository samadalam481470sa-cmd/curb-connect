// Map-drawn roof facets (RF-023, RF-025, RF-027): lon/lat rings -> plan area via the shared WGS84
// tangent-plane projection -> sloped area from pitch. Source is always MANUAL (contractor-drawn on
// imagery); results carry that provenance and are never presented as survey-grade.
//
// Shape validation (QGIS-style): every facet ring is validated with validatePolygon before it
// counts toward any total. A facet with a blocking shape problem (self-intersection, zero
// area) is flagged with the issue codes and excluded from the totals until the contractor
// repairs or redraws it; a facet with a non-blocking problem (duplicate vertex) is flagged
// but still counted. The label point comes from plane.unproject(), the Newton-accurate
// inverse of the projection — not a flat-earth metres-per-degree constant.
import {
  area,
  centroid,
  intersectLonLatRings,
  perimeter,
  projectRing,
  samePoint,
  slopeFactor,
  unionLonLatRings,
  validatePolygon,
  type LonLat,
  type Point,
  type PolygonIssue,
} from '@fieldline/geometry';

export const SQFT_PER_M2 = 10.763910416709722;
export const FT_PER_M = 3.280839895013123;

export interface MapFacet {
  id: string;
  name: string;
  ring: LonLat[];
  /** Rise per 12; null = pitch not yet confirmed (sloped area unresolved). */
  pitch: number | null;
  /**
   * Provenance that needs contractor confirmation: a GIS building footprint, or an
   * AI auto-detected candidate the contractor confirmed (verify eaves, ridges, pitch).
   */
  source?: 'osm_footprint' | 'auto_detect';
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
  /** Shape problems found by validatePolygon (empty = the ring is usable as drawn). */
  issues: PolygonIssue[];
  /** True when a blocking issue keeps this facet out of the roof totals. */
  blocked: boolean;
}

export interface MapRoofResult {
  facets: MapFacetResult[];
  planSqFt: number;
  /** Sum of sloped areas for facets with a confirmed pitch. */
  slopedSqFt: number;
  facetsMissingPitch: number;
  squares: number;
  /** Facets excluded from the totals by a blocking shape problem. */
  invalidFacets: number;
  /** Facets counted in the totals but carrying a non-blocking shape warning. */
  flaggedFacets: number;
  /**
   * Combined footprint of all valid facets with overlaps counted once (union), in ft².
   * Null when there are no valid facets.
   */
  unionPlanSqFt: number | null;
  /** Number of valid-facet pairs whose outlines overlap. */
  overlappingFacetPairs: number;
}

/** Issue codes that keep a facet out of the totals: its measured area cannot be trusted. */
export const BLOCKING_ISSUE_CODES: readonly PolygonIssue['code'][] = [
  'self_intersection',
  'zero_area',
  'non_finite_coordinate',
  'too_few_vertices',
];

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Shape problems of one facet ring, in its local tangent plane. */
export function validateMapFacet(f: MapFacet): PolygonIssue[] {
  if (f.ring.length < 3) {
    return [
      {
        code: 'too_few_vertices',
        message: `a polygon needs at least 3 vertices, got ${f.ring.length}`,
        indices: [],
      },
    ];
  }
  try {
    const { points } = projectRing(f.ring);
    const issues = validatePolygon(points);
    const duplicates = issues.filter((issue) => issue.code === 'duplicate_vertex');
    if (duplicates.length === 0) return issues;
    // A duplicated vertex shifts the edge indices, so the validator also reports the
    // edges around it as intersecting. The measurement itself is unaffected, so re-check
    // the deduped ring and keep only the duplicate report when it is otherwise clean.
    const deduped: Point[] = [];
    for (const p of points) {
      if (deduped.length === 0 || !samePoint(deduped[deduped.length - 1]!, p)) deduped.push(p);
    }
    if (deduped.length > 1 && samePoint(deduped[0]!, deduped[deduped.length - 1]!)) deduped.pop();
    return [...duplicates, ...validatePolygon(deduped)];
  } catch {
    return [
      { code: 'non_finite_coordinate', message: 'coordinates must be finite numbers', indices: [] },
    ];
  }
}

export function measureFacet(f: MapFacet): MapFacetResult | null {
  if (f.ring.length < 3) return null;
  const issues = validateMapFacet(f);
  const blocked = issues.some((issue) => BLOCKING_ISSUE_CODES.includes(issue.code));
  if (issues.some((issue) => issue.code === 'non_finite_coordinate')) {
    // Unmeasurable: report the shape problem instead of throwing in the workspace.
    const firstFinite = f.ring.find((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
    return {
      id: f.id,
      name: f.name,
      planSqFt: 0,
      perimeterFt: 0,
      pitch: f.pitch,
      pitchDegrees:
        f.pitch === null ? null : r1((Math.atan(Math.max(0, f.pitch) / 12) * 180) / Math.PI),
      slopedSqFt: null,
      label: firstFinite ?? { lon: 0, lat: 0 },
      issues,
      blocked: true,
    };
  }
  const { plane, points } = projectRing(f.ring);
  const planM2 = area(points);
  const perimM = perimeter([...points, points[0]!]);
  // A zero-area ring (e.g. a bow-tie) has no centroid; label it at its mean point instead.
  let label: LonLat;
  try {
    label = plane.unproject(centroid(points));
  } catch {
    const mean = points.reduce(
      (s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length }),
      { x: 0, y: 0 },
    );
    label = plane.unproject(mean);
  }
  // The label comes from plane.unproject(), the Newton-accurate inverse of the projection —
  // not a flat-earth metres-per-degree constant.
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
    issues,
    blocked,
  };
}

export function measureRoof(facets: readonly MapFacet[]): MapRoofResult {
  const results = facets.map(measureFacet).filter((r): r is MapFacetResult => r !== null);
  const counted = results.filter((r) => !r.blocked);
  const planSqFt = counted.reduce((s, r) => s + r.planSqFt, 0);
  const slopedSqFt = counted.reduce((s, r) => s + (r.slopedSqFt ?? 0), 0);
  const invalidFacets = results.filter((r) => r.blocked).length;
  const flaggedFacets = results.filter((r) => !r.blocked && r.issues.length > 0).length;
  // Combined footprint with overlaps counted once, and the overlap count itself.
  let unionPlanSqFt: number | null = null;
  let overlappingFacetPairs = 0;
  if (counted.length > 0) {
    const rings = facets
      .filter((f) => counted.some((r) => r.id === f.id))
      .map((f) => f.ring);
    try {
      const unionRings = unionLonLatRings(rings);
      let unionM2 = 0;
      for (const ring of unionRings) {
        unionM2 += area(projectRing(ring).points);
      }
      unionPlanSqFt = r1(unionM2 * SQFT_PER_M2);
    } catch {
      unionPlanSqFt = null;
    }
    try {
      for (let i = 0; i < rings.length; i++) {
        for (let j = i + 1; j < rings.length; j++) {
          if (intersectLonLatRings(rings[i]!, rings[j]!).length > 0) overlappingFacetPairs++;
        }
      }
    } catch {
      overlappingFacetPairs = 0;
    }
  }
  return {
    facets: results,
    planSqFt: r1(planSqFt),
    slopedSqFt: r1(slopedSqFt),
    facetsMissingPitch: counted.filter((r) => r.slopedSqFt === null).length,
    squares: Math.round(slopedSqFt) / 100,
    invalidFacets,
    flaggedFacets,
    unionPlanSqFt,
    overlappingFacetPairs,
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
