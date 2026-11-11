// Traced roof measurement (MANUAL source). Turns contractor-traced lon/lat rings into canonical
// roof geometry in one shared local tangent plane (LOCAL_ENU_M), measures every facet on the
// server and summarises totals. Pitch is never invented: a facet without a pitch keeps an unknown
// sloped area and the measurement is incomplete until it is entered.
import {
  type RoofEdge,
  type RoofFacet,
  type RoofGeometry,
  ROOF_GEOMETRY_SCHEMA_VERSION,
  RoofGeometrySchema,
  type MeasuredFacet,
  type TracedFacetInput,
  type TracePoint,
} from '@fieldline/contracts';
import {
  area,
  normalizeWinding,
  perimeter,
  type Point,
  slopeFactor,
  tangentPlane,
  validatePolygon,
} from '@fieldline/geometry';
import { z } from 'zod';
import { problem } from '../http/problem';

export const ROOF_TRACE_ENGINE = 'roof-trace@1.0.0';
export const SQFT_PER_M2 = 10.763910416709722;
export const FT_PER_M = 3.280839895013123;
/** A traced plane smaller than this is a mis-click, not a roof facet. */
const MIN_FACET_M2 = 0.5;

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export interface MeasuredTraceFacet {
  key: string;
  label: string | null;
  pitchRise: number | null;
  planAreaM2: number;
  slopedAreaM2: number | null;
  perimeterM: number;
}

/** Stored in roof_report_versions.totals (SI units; display conversions happen on read). */
export const TraceTotalsSchema = z.object({
  engine: z.string(),
  planAreaM2: z.number(),
  slopedAreaM2: z.number().nullable(),
  roofingSquares: z.number().nullable(),
  unresolvedFacetKeys: z.array(z.string()),
  complete: z.boolean(),
  facets: z.array(
    z.object({
      key: z.string(),
      label: z.string().nullable(),
      pitchRise: z.number().nullable(),
      planAreaM2: z.number(),
      slopedAreaM2: z.number().nullable(),
      perimeterM: z.number(),
    }),
  ),
});
export type TraceTotals = z.infer<typeof TraceTotalsSchema>;

export interface TraceMeasurement {
  geometry: RoofGeometry;
  totals: TraceTotals;
  /** WGS84 centre of the traced roof (property location). */
  center: TracePoint;
}

function meanOf(points: readonly TracePoint[]): TracePoint {
  let lon = 0;
  let lat = 0;
  for (const p of points) {
    lon += p.lon;
    lat += p.lat;
  }
  return { lon: lon / points.length, lat: lat / points.length };
}

/** Measures traced facets about one shared origin and builds the canonical geometry document. */
export function measureTrace(facets: readonly TracedFacetInput[], revision = 0): TraceMeasurement {
  const center = meanOf(facets.flatMap((f) => f.ring));
  const plane = tangentPlane(center);

  const vertices: RoofGeometry['vertices'] = [];
  const edges: RoofEdge[] = [];
  const geomFacets: RoofFacet[] = [];
  const measured: MeasuredTraceFacet[] = [];

  for (const f of facets) {
    const projected = f.ring.map((p) => plane.project(p));
    const issues = validatePolygon(projected);
    if (issues.length > 0) {
      throw problem('validation_failed', `Facet ${f.label ?? f.key}: ${issues[0]!.message}.`);
    }
    // Canonical winding is counter-clockwise in plan view; keep lon/lat in the same order.
    const order = normalizeWinding(projected.map((p, i) => ({ ...p, i }))).map((p) => p.i);
    const points: Point[] = order.map((i) => projected[i]!);
    const planAreaM2 = area(points);
    if (planAreaM2 < MIN_FACET_M2) {
      throw problem(
        'validation_failed',
        `Facet ${f.label ?? f.key} encloses ${planAreaM2.toFixed(2)} m², which is too small to be a roof plane.`,
      );
    }
    const vertexIds = points.map((p, i) => {
      const id = `${f.key}-v${i}`;
      vertices.push({ id, x: p.x, y: p.y, z: null, source: 'user_entered' });
      return id;
    });
    vertexIds.forEach((from, i) => {
      edges.push({
        id: `${f.key}-e${i}`,
        from,
        to: vertexIds[(i + 1) % vertexIds.length]!,
        type: 'unclassified',
        leftFacet: f.key,
        rightFacet: null,
      });
    });
    const pitch =
      f.pitchRise === null
        ? null
        : {
            rise: f.pitchRise,
            run: 12,
            input: `${f.pitchRise}/12`,
            inputUnit: 'rise_per_12' as const,
            source: 'user_entered' as const,
          };
    geomFacets.push({
      id: f.key,
      ...(f.label ? { label: f.label } : {}),
      surfaceType: 'pitched',
      vertexIds,
      parentFacet: null,
      pitch,
      ...(pitch ? { pitchSource: 'user_entered' as const } : {}),
      azimuthDeg: null,
      needsReview: pitch === null,
    });
    const factor = f.pitchRise === null ? null : slopeFactor({ rise: f.pitchRise, run: 12 });
    measured.push({
      key: f.key,
      label: f.label ?? null,
      pitchRise: f.pitchRise,
      planAreaM2,
      slopedAreaM2: factor === null ? null : planAreaM2 * factor,
      perimeterM: perimeter(points),
    });
  }

  const unresolvedFacetKeys = measured.filter((m) => m.slopedAreaM2 === null).map((m) => m.key);
  const complete = unresolvedFacetKeys.length === 0;
  const planAreaM2 = measured.reduce((s, m) => s + m.planAreaM2, 0);
  const slopedAreaM2 = complete ? measured.reduce((s, m) => s + (m.slopedAreaM2 ?? 0), 0) : null;

  const geometry = RoofGeometrySchema.parse({
    schemaVersion: ROOF_GEOMETRY_SCHEMA_VERSION,
    crs: 'LOCAL_ENU_M',
    geometryRevision: revision,
    georef: { origin: [center.lon, center.lat], rotationDeg: 0 },
    vertices,
    edges,
    facets: geomFacets,
    unresolved: [],
  });

  return {
    geometry,
    center,
    totals: {
      engine: ROOF_TRACE_ENGINE,
      planAreaM2,
      slopedAreaM2,
      roofingSquares: slopedAreaM2 === null ? null : (slopedAreaM2 * SQFT_PER_M2) / 100,
      unresolvedFacetKeys,
      complete,
      facets: measured,
    },
  };
}

/** Rebuilds the client view (lon/lat rings, imperial figures) from stored geometry + totals. */
export function traceView(
  geometryJson: unknown,
  totalsJson: unknown,
): {
  facets: MeasuredFacet[];
  totals: {
    planSqFt: number;
    slopedSqFt: number | null;
    squares: number | null;
    facetsMissingPitch: string[];
    complete: boolean;
  };
} {
  const geometry = RoofGeometrySchema.parse(geometryJson);
  const totals = TraceTotalsSchema.parse(totalsJson);
  if (!geometry.georef) throw new Error('traced geometry is missing its georeference');
  const plane = tangentPlane({ lon: geometry.georef.origin[0], lat: geometry.georef.origin[1] });
  const byId = new Map(geometry.vertices.map((v) => [v.id, v]));
  const figures = new Map(totals.facets.map((f) => [f.key, f]));
  const facets = geometry.facets.map((f): MeasuredFacet => {
    const m = figures.get(f.id);
    if (!m) throw new Error(`traced totals are missing facet ${f.id}`);
    return {
      key: f.id,
      label: f.label ?? null,
      ring: f.vertexIds.map((id) => {
        const v = byId.get(id);
        if (!v) throw new Error(`traced geometry is missing vertex ${id}`);
        const p = plane.unproject({ x: v.x, y: v.y });
        return { lon: round(p.lon, 9), lat: round(p.lat, 9) };
      }),
      pitchRise: f.pitch ? f.pitch.rise : null,
      planSqFt: round(m.planAreaM2 * SQFT_PER_M2, 1),
      slopedSqFt: m.slopedAreaM2 === null ? null : round(m.slopedAreaM2 * SQFT_PER_M2, 1),
      perimeterFt: round(m.perimeterM * FT_PER_M, 1),
      needsReview: f.needsReview,
    };
  });
  return {
    facets,
    totals: {
      planSqFt: round(totals.planAreaM2 * SQFT_PER_M2, 1),
      slopedSqFt: totals.slopedAreaM2 === null ? null : round(totals.slopedAreaM2 * SQFT_PER_M2, 1),
      squares: totals.roofingSquares === null ? null : round(totals.roofingSquares, 2),
      facetsMissingPitch: totals.unresolvedFacetKeys,
      complete: totals.complete,
    },
  };
}

export const TRACE_WARNINGS = [
  'Traced by a contractor on imagery: plan areas depend on image alignment and are not survey-grade.',
  'Pitch is as entered; verify on site before ordering materials or issuing a binding price.',
] as const;
