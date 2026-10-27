// RR-025: canonical roof-geometry JSON. Planar facets with ordered 2D footprint vertices in a
// local east/north frame (meters), optional elevations, per-facet pitch and direction, shared
// edges stored once (left/right facet), surface classification, provenance, and unresolved
// discontinuities. Stored in roof_report_versions.geometry and edited via PATCH
// /v1/roof/reports/{id}/geometry. The structural validator here is pure and dependency-free;
// numerical topology (self-intersection, planarity) lives in @fieldline/geometry.
import { z } from 'zod';
import { RoofEdgeTypeSchema, RoofSurfaceTypeSchema, MeasurementSourceSchema } from './enums';
import { PitchSchema } from './measurement';

export const ROOF_GEOMETRY_SCHEMA_VERSION = 1 as const;

const KeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const RoofVertexSchema = z.object({
  id: KeySchema,
  /** Meters east of the local origin. */
  x: z.number().finite(),
  /** Meters north of the local origin. */
  y: z.number().finite(),
  /** Elevation in meters when known; null = unknown, never guessed. */
  z: z.number().finite().nullable().default(null),
  source: MeasurementSourceSchema,
});
export type RoofVertex = z.infer<typeof RoofVertexSchema>;

export const RoofEdgeSchema = z.object({
  id: KeySchema,
  from: KeySchema,
  to: KeySchema,
  type: RoofEdgeTypeSchema.default('unclassified'),
  classificationSource: MeasurementSourceSchema.optional(),
  /** Facet on the left/right when walking from -> to (null = outside/perimeter). */
  leftFacet: KeySchema.nullable().default(null),
  rightFacet: KeySchema.nullable().default(null),
});
export type RoofEdge = z.infer<typeof RoofEdgeSchema>;

export const RoofFacetSchema = z.object({
  id: KeySchema,
  label: z.string().max(80).optional(),
  surfaceType: RoofSurfaceTypeSchema.default('pitched'),
  /** Ordered outer ring (counter-clockwise in plan view), not closed (first != last). */
  vertexIds: z.array(KeySchema).min(3),
  /** Voids (skylights, chimneys) are facets of a void surface type with parentFacet set. */
  parentFacet: KeySchema.nullable().default(null),
  pitch: PitchSchema.nullable(),
  pitchSource: MeasurementSourceSchema.optional(),
  /** Downslope direction in degrees clockwise from north; null for flat. */
  azimuthDeg: z.number().min(0).lt(360).nullable().default(null),
  needsReview: z.boolean().default(false),
});
export type RoofFacet = z.infer<typeof RoofFacetSchema>;

export const RoofGeoreferenceSchema = z.object({
  /** WGS84 lon/lat of the local origin. */
  origin: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  /** Rotation of local +y from true north, degrees. */
  rotationDeg: z.number().default(0),
  imageryAssetId: z.uuid().optional(),
  /** Ground sample distance of the source imagery, meters per pixel. */
  gsdM: z.number().positive().optional(),
});

export const RoofDiscontinuitySchema = z.object({
  code: z.enum(['open_ring', 'nonplanar', 'ambiguous_edge', 'occluded', 'missing_elevation', 'other']),
  message: z.string().max(500),
  facetIds: z.array(KeySchema).default([]),
  edgeIds: z.array(KeySchema).default([]),
});

export const RoofGeometrySchema = z.object({
  schemaVersion: z.literal(ROOF_GEOMETRY_SCHEMA_VERSION),
  crs: z.literal('LOCAL_ENU_M'),
  /** Increments on every accepted edit; PATCH requires the current value. */
  geometryRevision: z.number().int().nonnegative(),
  georef: RoofGeoreferenceSchema.nullable().default(null),
  vertices: z.array(RoofVertexSchema),
  edges: z.array(RoofEdgeSchema),
  facets: z.array(RoofFacetSchema),
  unresolved: z.array(RoofDiscontinuitySchema).default([]),
});
export type RoofGeometry = z.infer<typeof RoofGeometrySchema>;
export type RoofGeometryInput = z.input<typeof RoofGeometrySchema>;

export interface TopologyIssue {
  code:
    | 'duplicate_id'
    | 'unknown_vertex'
    | 'unknown_facet'
    | 'degenerate_edge'
    | 'duplicate_edge'
    | 'missing_edge'
    | 'edge_overused'
    | 'clockwise_ring'
    | 'zero_area'
    | 'repeated_vertex';
  message: string;
  ref?: string;
}

/** Signed plan area (shoelace), m2. Positive for counter-clockwise rings. */
export function signedRingArea(points: readonly { x: number; y: number }[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/** Sloped area from plan area and rise/run: plan * sqrt(1 + (rise/run)^2). */
export function slopedArea(planAreaM2: number, rise: number, run: number): number {
  const r = rise / run;
  return planAreaM2 * Math.sqrt(1 + r * r);
}

const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Structural topology check: closed rings over known vertices, CCW winding, every ring side
 * backed by exactly one stored edge, each edge shared by at most two facets, no duplicates.
 */
export function validateRoofTopology(geometry: RoofGeometry): TopologyIssue[] {
  const issues: TopologyIssue[] = [];
  const vertices = new Map<string, RoofVertex>();
  for (const v of geometry.vertices) {
    if (vertices.has(v.id)) issues.push({ code: 'duplicate_id', message: `vertex ${v.id} repeated`, ref: v.id });
    vertices.set(v.id, v);
  }
  const facetIds = new Set<string>();
  for (const f of geometry.facets) {
    if (facetIds.has(f.id)) issues.push({ code: 'duplicate_id', message: `facet ${f.id} repeated`, ref: f.id });
    facetIds.add(f.id);
  }
  const edgesByPair = new Map<string, RoofEdge>();
  const edgeIds = new Set<string>();
  for (const e of geometry.edges) {
    if (edgeIds.has(e.id)) issues.push({ code: 'duplicate_id', message: `edge ${e.id} repeated`, ref: e.id });
    edgeIds.add(e.id);
    if (!vertices.has(e.from) || !vertices.has(e.to)) {
      issues.push({ code: 'unknown_vertex', message: `edge ${e.id} references a missing vertex`, ref: e.id });
    }
    if (e.from === e.to) issues.push({ code: 'degenerate_edge', message: `edge ${e.id} is a loop`, ref: e.id });
    const k = edgeKey(e.from, e.to);
    if (edgesByPair.has(k)) issues.push({ code: 'duplicate_edge', message: `edge ${e.id} duplicates ${edgesByPair.get(k)!.id}`, ref: e.id });
    edgesByPair.set(k, e);
    for (const side of [e.leftFacet, e.rightFacet]) {
      if (side && !facetIds.has(side)) issues.push({ code: 'unknown_facet', message: `edge ${e.id} references facet ${side}`, ref: e.id });
    }
  }
  const usage = new Map<string, number>();
  for (const f of geometry.facets) {
    if (new Set(f.vertexIds).size !== f.vertexIds.length) {
      issues.push({ code: 'repeated_vertex', message: `facet ${f.id} repeats a vertex`, ref: f.id });
    }
    const pts = f.vertexIds.map((id) => vertices.get(id));
    if (pts.some((p) => !p)) {
      issues.push({ code: 'unknown_vertex', message: `facet ${f.id} references a missing vertex`, ref: f.id });
      continue;
    }
    const area = signedRingArea(pts as RoofVertex[]);
    if (Math.abs(area) < 1e-9) issues.push({ code: 'zero_area', message: `facet ${f.id} has no area`, ref: f.id });
    else if (area < 0) issues.push({ code: 'clockwise_ring', message: `facet ${f.id} is clockwise`, ref: f.id });
    for (let i = 0; i < f.vertexIds.length; i += 1) {
      const k = edgeKey(f.vertexIds[i]!, f.vertexIds[(i + 1) % f.vertexIds.length]!);
      if (!edgesByPair.has(k)) {
        issues.push({ code: 'missing_edge', message: `facet ${f.id} side ${k} has no edge`, ref: f.id });
      } else {
        usage.set(k, (usage.get(k) ?? 0) + 1);
      }
    }
  }
  for (const [k, n] of usage) {
    if (n > 2) issues.push({ code: 'edge_overused', message: `edge ${edgesByPair.get(k)!.id} is shared by ${n} facets`, ref: edgesByPair.get(k)!.id });
  }
  return issues;
}
