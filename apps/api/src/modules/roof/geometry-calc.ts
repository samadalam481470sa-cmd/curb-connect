/**
 * Server-side roof polygon calculation: WGS84 GeoJSON → local ENU meters → plan/sloped area.
 * Uses @fieldline/geometry (projectRing, area, perimeter, slopeFactor).
 */
import {
  area,
  GEOMETRY_VERSION,
  meanLonLat,
  perimeter,
  projectRing,
  distance,
  slopeFactor,
  type LonLat,
  type Point,
  validatePolygon,
} from '@fieldline/geometry';
import { z } from 'zod';

const LonLatTuple = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const GeoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(LonLatTuple).min(4)).min(1),
});

export const GeoJsonMultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(LonLatTuple).min(4)).min(1)).min(1),
});

export const RoofGeometryInputSchema = z.union([GeoJsonPolygonSchema, GeoJsonMultiPolygonSchema]);

export const FacetPitchSchema = z.object({
  facetIndex: z.number().int().nonnegative().default(0),
  pitchRise: z.number().min(0).default(0),
  pitchRun: z.number().positive().default(12),
});

export const RoofCalculateBodySchema = z.object({
  geometry: RoofGeometryInputSchema.optional(),
  pitches: z.array(FacetPitchSchema).default([{ facetIndex: 0, pitchRise: 0, pitchRun: 12 }]),
});

export interface FacetResult {
  facetIndex: number;
  planAreaM2: number;
  slopedAreaM2: number;
  perimeterM: number;
  edgeLengthsM: number[];
  pitchRise: number;
  pitchRun: number;
  slopeFactor: number;
}

export interface RoofCalcResult {
  planAreaM2: number;
  slopedAreaM2: number;
  perimeterM: number;
  squares: number;
  edgeLengthsM: number[];
  facets: FacetResult[];
  georef: {
    origin: { lon: number; lat: number };
    crs: 'LOCAL_ENU_M';
    geometryVersion: string;
  };
  planarRingsM: Point[][];
  issues: Array<{ code: string; message: string }>;
}

const FT2_PER_M2 = 1 / 0.09290304;
const SQ_FT_PER_SQUARE = 100;

function toLonLatRing(ring: Array<[number, number]>): LonLat[] {
  return ring.map(([lon, lat]) => ({ lon, lat }));
}

function openLonLatRing(ring: LonLat[]): LonLat[] {
  if (
    ring.length >= 2 &&
    ring[0]!.lon === ring[ring.length - 1]!.lon &&
    ring[0]!.lat === ring[ring.length - 1]!.lat
  ) {
    return ring.slice(0, -1);
  }
  return ring;
}

function extractRings(
  geometry: z.infer<typeof RoofGeometryInputSchema>,
): Array<Array<[number, number]>> {
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]!];
  return geometry.coordinates.map((poly) => poly[0]!);
}

/** Pure calculation used by POST /v1/roof/orders/:id/calculate and unit tests. */
export function calculateRoofFromGeoJson(
  geometry: z.infer<typeof RoofGeometryInputSchema>,
  pitches: z.infer<typeof FacetPitchSchema>[] = [],
): RoofCalcResult {
  const ringsLonLat = extractRings(geometry);
  if (ringsLonLat.length === 0) {
    throw new Error('Geometry has no outer rings');
  }
  const openLonLatRings: LonLat[][] = ringsLonLat.map((ring) => openLonLatRing(toLonLatRing(ring)));

  const origin = meanLonLat(openLonLatRings.flat());
  const plane = projectRing(openLonLatRings[0]!, origin).plane;
  const planarRingsM = openLonLatRings.map((ring) => ring.map((p) => plane.project(p)));

  const issues: Array<{ code: string; message: string }> = [];
  const facets: FacetResult[] = [];
  let planAreaM2 = 0;
  let slopedAreaM2 = 0;
  let perimeterM = 0;
  const edgeLengthsM: number[] = [];

  for (let i = 0; i < planarRingsM.length; i += 1) {
    const ring = planarRingsM[i]!;
    const polyIssues = validatePolygon(ring);
    for (const issue of polyIssues) {
      issues.push({ code: issue.code, message: `facet ${i}: ${issue.message}` });
    }
    const plan = area(ring);
    const peri = perimeter(ring);
    const edges: number[] = [];
    for (let e = 0; e < ring.length; e += 1) {
      const a = ring[e]!;
      const b = ring[(e + 1) % ring.length]!;
      const len = distance(a, b);
      edges.push(len);
      edgeLengthsM.push(len);
    }
    const pitch =
      pitches.find((p) => p.facetIndex === i) ??
      pitches[0] ?? { facetIndex: i, pitchRise: 0, pitchRun: 12 };
    const factor = slopeFactor({ rise: pitch.pitchRise, run: pitch.pitchRun });
    const sloped = plan * factor;
    facets.push({
      facetIndex: i,
      planAreaM2: plan,
      slopedAreaM2: sloped,
      perimeterM: peri,
      edgeLengthsM: edges,
      pitchRise: pitch.pitchRise,
      pitchRun: pitch.pitchRun,
      slopeFactor: factor,
    });
    planAreaM2 += plan;
    slopedAreaM2 += sloped;
    perimeterM += peri;
  }

  const squares = (planAreaM2 * FT2_PER_M2) / SQ_FT_PER_SQUARE;

  return {
    planAreaM2,
    slopedAreaM2,
    perimeterM,
    squares,
    edgeLengthsM,
    facets,
    georef: {
      origin: { lon: origin.lon, lat: origin.lat },
      crs: 'LOCAL_ENU_M',
      geometryVersion: GEOMETRY_VERSION,
    },
    planarRingsM,
    issues,
  };
}

/** Round display numbers without mutating SI persistence precision elsewhere. */
export function roundRoofTotals(result: RoofCalcResult) {
  const r = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
  return {
    planAreaM2: r(result.planAreaM2),
    planAreaFt2: r(result.planAreaM2 * FT2_PER_M2, 2),
    slopedAreaM2: r(result.slopedAreaM2),
    slopedAreaFt2: r(result.slopedAreaM2 * FT2_PER_M2, 2),
    perimeterM: r(result.perimeterM),
    perimeterFt: r(result.perimeterM / 0.3048, 2),
    squares: r(result.squares, 3),
    edgeLengthsM: result.edgeLengthsM.map((e) => r(e)),
    facets: result.facets.map((f) => ({
      ...f,
      planAreaM2: r(f.planAreaM2),
      slopedAreaM2: r(f.slopedAreaM2),
      perimeterM: r(f.perimeterM),
      edgeLengthsM: f.edgeLengthsM.map((e) => r(e)),
      slopeFactor: r(f.slopeFactor, 6),
    })),
    georef: result.georef,
    issues: result.issues,
  };
}
