// Roof topology: facets, vertex snapping, shared-edge graph, edge classification and linear
// totals without double counting (RF-024, RF-025, RF-028).
//
// Model: property -> structures -> facets. A facet is a planar surface given by an ordered ring
// of plan-view vertices (planar meters), a pitch (rise/run) and the plan-view DOWNSLOPE direction
// (the way water runs). Each physical edge is stored exactly once, keyed by its two snapped node
// ids, with the ids of every facet that uses it.
import { compareStrings, GeometryError, isFiniteNumber, neumaierSum, at, cyclic } from './numeric';
import { type Pitch, pitchRatio, slopeFactor, trueEdgeLength } from './pitch';
import {
  area as ringArea,
  DEFAULT_TOLERANCE,
  distance,
  normalizeWinding,
  pointInPolygon,
  pointSegmentDistance,
  polygonsOverlap,
  type Point,
  type PolygonIssue,
  signedArea,
  validatePolygon,
} from './polygon';

export const EDGE_TYPES = [
  'eave',
  'rake',
  'ridge',
  'hip',
  'valley',
  'flashing',
  'step_flashing',
  'perimeter',
  'unclassified',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export interface RoofVertex extends Point {
  /** Stable vertex id (editor-assigned). Edge labels reference vertex ids. */
  readonly id: string;
}

export interface FacetInput {
  readonly id: string;
  /** Structure the facet belongs to (main house, garage...). Default "main". */
  readonly structureId?: string;
  /** Ordered plan-view ring (open, either winding; normalized to CCW internally). */
  readonly vertices: readonly RoofVertex[];
  /** null = pitch unknown: sloped area and true lengths stay unresolved, never guessed. */
  readonly pitch: Pitch | null;
  /** Plan-view downslope direction (need not be unit length). Required when pitch > 0. */
  readonly downslope?: Point | null;
  /** Non-roof voids inside the facet (skylights, chimneys, HVAC units), subtracted from area. */
  readonly exclusions?: readonly (readonly Point[])[];
}

export interface RoofInput {
  readonly facets: readonly FacetInput[];
  /** Manual edge labels keyed by `edgeKey(vertexIdA, vertexIdB)` (order-insensitive). */
  readonly edgeLabels?: Readonly<Record<string, EdgeType>>;
  /** Structures left out of the property total (still analysed and subtotalled). */
  readonly excludedStructureIds?: readonly string[];
  readonly options?: TopologyOptions;
}

export interface TopologyOptions {
  /** Vertices within this distance (m) merge into one node. Default 0.01 m (1 cm). */
  readonly snapTolerance?: number;
  /** Edge counts as level/parallel to the fall line within this angle (degrees). Default 1. */
  readonly angleToleranceDeg?: number;
}

export const DEFAULT_SNAP_TOLERANCE_M = 0.01;
export const DEFAULT_ANGLE_TOLERANCE_DEG = 1;

export type TopologyIssueCode =
  | PolygonIssue['code']
  | 'duplicate_facet_id'
  | 'collapsed_vertex'
  | 'duplicate_facet'
  | 'overlapping_facets'
  | 't_junction'
  | 'non_manifold_edge'
  | 'missing_downslope'
  | 'unknown_pitch'
  | 'invalid_exclusion'
  | 'edge_length_mismatch'
  | 'label_conflict'
  | 'unknown_edge_label';

export interface TopologyIssue {
  readonly code: TopologyIssueCode;
  /** error = blocks quantities/pricing; warning = needs review but totals are computed. */
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly facetIds?: readonly string[];
  readonly edgeId?: string;
}

export interface RoofNode extends Point {
  readonly id: string;
  /** Vertex ids merged into this node by snapping (first one is the node id). */
  readonly vertexIds: readonly string[];
}

export interface EdgeResult {
  /** `edgeKey(a, b)` of its node ids. */
  readonly id: string;
  readonly nodeIds: readonly [string, string];
  readonly facetIds: readonly string[];
  readonly planLength: number;
  /** Length along the roof surface; null when a needed pitch/direction is unknown. */
  readonly trueLength: number | null;
  /** Classification derived from geometry alone. */
  readonly derivedType: EdgeType;
  readonly derivedReason: string;
  readonly label: EdgeType | null;
  /** label ?? derivedType. */
  readonly type: EdgeType;
  readonly conflict: string | null;
}

export interface FacetResult {
  readonly id: string;
  readonly structureId: string;
  readonly nodeIds: readonly string[];
  readonly planArea: number;
  readonly excludedArea: number;
  /** planArea - excludedArea. */
  readonly netPlanArea: number;
  readonly slopeFactor: number | null;
  readonly slopedArea: number | null;
  readonly valid: boolean;
}

export interface EdgeTypeTotal {
  readonly count: number;
  readonly planLength: number;
  readonly trueLength: number | null;
}

export interface AreaTotal {
  readonly facetCount: number;
  readonly netPlanArea: number;
  /** null when any included facet has unknown pitch. */
  readonly slopedArea: number | null;
}

export interface RoofAnalysis {
  readonly geometryVersion: string;
  readonly nodes: readonly RoofNode[];
  readonly facets: readonly FacetResult[];
  readonly edges: readonly EdgeResult[];
  readonly edgeTotals: Readonly<Record<EdgeType, EdgeTypeTotal>>;
  readonly structureTotals: Readonly<Record<string, AreaTotal>>;
  readonly propertyTotal: AreaTotal;
  readonly issues: readonly TopologyIssue[];
  /** No error-severity issues: quantities may be priced. */
  readonly valid: boolean;
}

export const TOPOLOGY_VERSION = '1.0.0';

/** Order-insensitive key of an edge between two ids. */
export function edgeKey(a: string, b: string): string {
  return compareStrings(a, b) <= 0 ? `${a}|${b}` : `${b}|${a}`;
}

export function isEdgeType(value: string): value is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(value);
}

interface FacetGeom {
  readonly input: FacetInput;
  readonly structureId: string;
  readonly ring: RoofNode[];
  readonly valid: boolean;
  readonly ratio: number | null;
  readonly down: Point | null;
}

interface EdgeUse {
  readonly facet: FacetGeom;
  readonly from: RoofNode;
  readonly to: RoofNode;
}

function unit(v: Point): Point | null {
  const len = Math.hypot(v.x, v.y);
  return len > 0 && isFiniteNumber(len) ? { x: v.x / len, y: v.y / len } : null;
}

/** Snap vertices to nodes: first-come order, a vertex joins the first node within tolerance. */
function snapVertices(
  facets: readonly FacetInput[],
  tol: number,
): { nodes: RoofNode[]; byVertex: Map<string, RoofNode> } {
  const nodes: { id: string; x: number; y: number; vertexIds: string[] }[] = [];
  const byVertex = new Map<string, RoofNode>();
  for (const facet of facets) {
    for (const v of facet.vertices) {
      const existing = byVertex.get(v.id);
      if (existing) continue;
      let node = nodes.find((n) => distance(n, v) <= tol);
      if (!node) {
        node = { id: v.id, x: v.x, y: v.y, vertexIds: [] };
        nodes.push(node);
      }
      node.vertexIds.push(v.id);
      byVertex.set(v.id, node);
    }
  }
  return { nodes, byVertex };
}

export function analyzeRoof(input: RoofInput): RoofAnalysis {
  const snapTol = input.options?.snapTolerance ?? DEFAULT_SNAP_TOLERANCE_M;
  const angleTol = input.options?.angleToleranceDeg ?? DEFAULT_ANGLE_TOLERANCE_DEG;
  if (!(snapTol >= 0) || !(angleTol > 0 && angleTol < 45)) {
    throw new GeometryError(
      'invalid_argument',
      'snapTolerance must be >= 0 and angleToleranceDeg in (0, 45)',
    );
  }
  const levelSin = Math.sin((angleTol * Math.PI) / 180);
  const issues: TopologyIssue[] = [];

  const seenIds = new Set<string>();
  for (const f of input.facets) {
    if (seenIds.has(f.id)) {
      issues.push({
        code: 'duplicate_facet_id',
        severity: 'error',
        message: `facet id ${f.id} is used twice`,
        facetIds: [f.id],
      });
    }
    seenIds.add(f.id);
  }

  const { nodes, byVertex } = snapVertices(input.facets, snapTol);

  // --- Facets: snapped ring, validation, pitch -------------------------------------------
  const geoms: FacetGeom[] = input.facets.map((f) => {
    const ring: RoofNode[] = [];
    for (const v of f.vertices) {
      const node = byVertex.get(v.id);
      if (!node) throw new GeometryError('internal', 'unsnapped vertex');
      if (ring.length > 0 && ring[ring.length - 1] === node) {
        issues.push({
          code: 'collapsed_vertex',
          severity: 'warning',
          message: `facet ${f.id}: vertex ${v.id} snapped onto its neighbour`,
          facetIds: [f.id],
        });
        continue;
      }
      ring.push(node);
    }
    if (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
    const polyIssues = validatePolygon(ring, {
      tolerance: { length: snapTol / 10, area: DEFAULT_TOLERANCE.area },
    });
    for (const p of polyIssues) {
      issues.push({
        code: p.code,
        severity: 'error',
        message: `facet ${f.id}: ${p.message}`,
        facetIds: [f.id],
      });
    }
    const ccw = polyIssues.length === 0 ? normalizeWinding(ring) : ring;
    let ratio: number | null = null;
    let down: Point | null = null;
    if (f.pitch === null) {
      issues.push({
        code: 'unknown_pitch',
        severity: 'warning',
        message: `facet ${f.id}: pitch unknown, sloped area unresolved`,
        facetIds: [f.id],
      });
    } else {
      ratio = pitchRatio(f.pitch);
      down = f.downslope ? unit(f.downslope) : null;
      if (ratio > 0 && !down) {
        issues.push({
          code: 'missing_downslope',
          severity: 'warning',
          message: `facet ${f.id}: pitched facet has no downslope direction; edges cannot be classified`,
          facetIds: [f.id],
        });
      }
    }
    return {
      input: f,
      structureId: f.structureId ?? 'main',
      ring: ccw,
      valid: polyIssues.length === 0,
      ratio,
      down,
    };
  });

  // --- Duplicate / overlapping facets ----------------------------------------------------
  for (let i = 0; i < geoms.length; i++) {
    for (let j = i + 1; j < geoms.length; j++) {
      const a = at(geoms, i);
      const b = at(geoms, j);
      if (!a.valid || !b.valid) continue;
      const ids = [a.input.id, b.input.id];
      const setA = new Set(a.ring.map((n) => n.id));
      if (a.ring.length === b.ring.length && b.ring.every((n) => setA.has(n.id))) {
        issues.push({
          code: 'duplicate_facet',
          severity: 'error',
          message: `facets ${ids.join(' and ')} are duplicates`,
          facetIds: ids,
        });
      } else if (polygonsOverlap(a.ring, b.ring, snapTol / 10)) {
        issues.push({
          code: 'overlapping_facets',
          severity: 'error',
          message: `facets ${ids.join(' and ')} overlap`,
          facetIds: ids,
        });
      }
    }
  }

  // --- Shared-edge graph -------------------------------------------------------------------
  const uses = new Map<string, EdgeUse[]>();
  for (const g of geoms) {
    if (!g.valid) continue;
    for (let i = 0; i < g.ring.length; i++) {
      const from = at(g.ring, i);
      const to = cyclic(g.ring, i + 1);
      const key = edgeKey(from.id, to.id);
      const list = uses.get(key) ?? [];
      list.push({ facet: g, from, to });
      uses.set(key, list);
    }
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const labels = new Map<string, EdgeType>();
  for (const [rawKey, type] of Object.entries(input.edgeLabels ?? {})) {
    const [va, vb] = rawKey.split('|');
    const na = va === undefined ? undefined : byVertex.get(va);
    const nb = vb === undefined ? undefined : byVertex.get(vb);
    const key = na && nb ? edgeKey(na.id, nb.id) : null;
    if (!key || !uses.has(key) || !isEdgeType(type)) {
      issues.push({
        code: 'unknown_edge_label',
        severity: 'warning',
        message: `edge label ${rawKey} does not match an edge`,
      });
      continue;
    }
    labels.set(key, type);
  }

  const edges: EdgeResult[] = [];
  for (const key of [...uses.keys()].sort(compareStrings)) {
    const list = uses.get(key) ?? [];
    const first = at(list, 0);
    const [aId, bId] = key.split('|') as [string, string];
    const a = nodeById.get(aId) as RoofNode;
    const b = nodeById.get(bId) as RoofNode;
    const planLength = distance(a, b);
    const d = unit({ x: first.to.x - first.from.x, y: first.to.y - first.from.y }) ?? {
      x: 1,
      y: 0,
    };

    // T-junction: another node lying on this edge's interior.
    for (const n of nodes) {
      if (n === a || n === b) continue;
      if (
        pointSegmentDistance(n, a, b) <= snapTol &&
        distance(n, a) > snapTol &&
        distance(n, b) > snapTol
      ) {
        issues.push({
          code: 't_junction',
          severity: 'error',
          message: `node ${n.id} lies on edge ${key}; split the edge`,
          edgeId: key,
        });
      }
    }

    // True length from each adjacent facet plane; they must agree.
    let trueLength: number | null = planLength;
    const candidates: number[] = [];
    for (const u of list) {
      if (u.facet.ratio === null) trueLength = null;
      else if (u.facet.ratio === 0) candidates.push(planLength);
      else if (!u.facet.down) trueLength = null;
      else
        candidates.push(
          trueEdgeLength(planLength, u.facet.ratio, d.x * u.facet.down.x + d.y * u.facet.down.y),
        );
    }
    if (trueLength !== null) {
      trueLength = at(candidates, 0);
      if (
        candidates.some(
          (c) => Math.abs(c - (trueLength as number)) > 1e-6 * Math.max(1, planLength),
        )
      ) {
        issues.push({
          code: 'edge_length_mismatch',
          severity: 'warning',
          message: `edge ${key}: adjacent facet planes disagree on its true length`,
          edgeId: key,
        });
      }
    }

    const derived = classify(list, d, levelSin);
    if (list.length > 2) {
      issues.push({
        code: 'non_manifold_edge',
        severity: 'error',
        message: `edge ${key} is shared by ${list.length} facets`,
        edgeId: key,
      });
    }
    const label = labels.get(key) ?? null;
    const conflict = label ? labelConflict(label, derived.type, list) : null;
    if (conflict) {
      issues.push({
        code: 'label_conflict',
        severity: 'error',
        message: `edge ${key}: ${conflict}`,
        edgeId: key,
      });
    }
    edges.push({
      id: key,
      nodeIds: [aId, bId],
      facetIds: list.map((u) => u.facet.input.id),
      planLength,
      trueLength,
      derivedType: derived.type,
      derivedReason: derived.reason,
      label,
      type: label ?? derived.type,
      conflict,
    });
  }

  // --- Facet areas -------------------------------------------------------------------------
  const facets: FacetResult[] = geoms.map((g) => {
    const planArea = g.valid ? ringArea(g.ring) : 0;
    const excluded: number[] = [];
    (g.input.exclusions ?? []).forEach((ex, idx) => {
      const exIssues = validatePolygon(ex);
      const inside = g.valid && ex.every((p) => pointInPolygon(p, g.ring) >= 0);
      if (exIssues.length > 0 || !inside) {
        issues.push({
          code: 'invalid_exclusion',
          severity: 'error',
          message: `facet ${g.input.id}: exclusion ${idx} is invalid or outside the facet`,
          facetIds: [g.input.id],
        });
      } else {
        excluded.push(Math.abs(signedArea(ex)));
      }
    });
    const excludedArea = neumaierSum(excluded);
    const net = Math.max(0, planArea - excludedArea);
    const factor = g.input.pitch === null ? null : slopeFactor(g.input.pitch);
    return {
      id: g.input.id,
      structureId: g.structureId,
      nodeIds: g.ring.map((n) => n.id),
      planArea,
      excludedArea,
      netPlanArea: net,
      slopeFactor: factor,
      slopedArea: factor === null ? null : net * factor,
      valid: g.valid,
    };
  });

  // --- Totals (each edge counted once) -----------------------------------------------------
  const edgeTotals = {} as Record<EdgeType, EdgeTypeTotal>;
  for (const t of EDGE_TYPES) {
    const of = edges.filter((e) => e.type === t);
    edgeTotals[t] = {
      count: of.length,
      planLength: neumaierSum(of.map((e) => e.planLength)),
      trueLength: of.some((e) => e.trueLength === null)
        ? null
        : neumaierSum(of.map((e) => e.trueLength as number)),
    };
  }
  const total = (list: readonly FacetResult[]): AreaTotal => ({
    facetCount: list.length,
    netPlanArea: neumaierSum(list.map((f) => f.netPlanArea)),
    slopedArea: list.some((f) => f.slopedArea === null)
      ? null
      : neumaierSum(list.map((f) => f.slopedArea as number)),
  });
  const structureIds = [...new Set(facets.map((f) => f.structureId))].sort(compareStrings);
  const structureTotals: Record<string, AreaTotal> = {};
  for (const s of structureIds)
    structureTotals[s] = total(facets.filter((f) => f.structureId === s));
  const excludedStructures = new Set(input.excludedStructureIds ?? []);
  const propertyTotal = total(facets.filter((f) => !excludedStructures.has(f.structureId)));

  return {
    geometryVersion: TOPOLOGY_VERSION,
    nodes,
    facets,
    edges,
    edgeTotals,
    structureTotals,
    propertyTotal,
    issues,
    valid: !issues.some((i) => i.severity === 'error'),
  };
}

/**
 * Derive an edge type from adjacent facet planes. For each facet, `rise` is the elevation change
 * when stepping from the edge into the facet: negative = the facet falls away from the edge.
 */
function classify(
  list: readonly EdgeUse[],
  d: Point,
  levelSin: number,
): { type: EdgeType; reason: string } {
  if (list.length > 2) return { type: 'unclassified', reason: 'non_manifold' };
  const info: { flat: boolean; rise: number; level: boolean; alongFall: boolean }[] = [];
  for (const u of list) {
    if (u.facet.ratio === null) return { type: 'unclassified', reason: 'unknown_pitch' };
    if (u.facet.ratio === 0) {
      info.push({ flat: true, rise: 0, level: true, alongFall: false });
      continue;
    }
    if (!u.facet.down) return { type: 'unclassified', reason: 'missing_downslope' };
    const dir = unit({ x: u.to.x - u.from.x, y: u.to.y - u.from.y }) ?? d;
    const inward = { x: -dir.y, y: dir.x }; // CCW ring: interior is to the left
    const down = u.facet.down;
    const cosEdge = Math.abs(dir.x * down.x + dir.y * down.y);
    info.push({
      flat: false,
      rise: -u.facet.ratio * (inward.x * down.x + inward.y * down.y),
      level: cosEdge <= levelSin,
      alongFall: cosEdge >= Math.cos(Math.asin(levelSin)),
    });
  }
  const [p, q] = info as [(typeof info)[0], (typeof info)[0] | undefined];
  if (!q) {
    if (p.flat) return { type: 'perimeter', reason: 'boundary_of_flat_facet' };
    if (p.level)
      return p.rise > 0
        ? { type: 'eave', reason: 'level_low_boundary' }
        : { type: 'flashing', reason: 'level_high_boundary_wall' };
    if (p.alongFall) return { type: 'rake', reason: 'boundary_along_fall_line' };
    return { type: 'unclassified', reason: 'oblique_boundary' };
  }
  if (p.flat && q.flat) return { type: 'unclassified', reason: 'seam_between_flat_facets' };
  if (p.flat || q.flat) return { type: 'unclassified', reason: 'flat_to_sloped_transition' };
  if (p.rise < 0 && q.rise < 0) {
    return p.level && q.level
      ? { type: 'ridge', reason: 'level_convex' }
      : { type: 'hip', reason: 'inclined_convex' };
  }
  if (p.rise > 0 && q.rise > 0) return { type: 'valley', reason: 'concave' };
  return p.level && q.level
    ? { type: 'flashing', reason: 'level_step_between_planes' }
    : { type: 'step_flashing', reason: 'inclined_step_between_planes' };
}

const INTERIOR_TYPES: readonly EdgeType[] = ['ridge', 'hip', 'valley'];
const BOUNDARY_TYPES: readonly EdgeType[] = ['eave', 'rake', 'perimeter'];
const STRONG_DERIVED: readonly EdgeType[] = ['ridge', 'hip', 'valley', 'eave', 'rake'];

function labelConflict(
  label: EdgeType,
  derived: EdgeType,
  list: readonly EdgeUse[],
): string | null {
  if (INTERIOR_TYPES.includes(label)) {
    if (list.length < 2) return `${label} must join two facets`;
    if (list.some((u) => u.facet.ratio === 0)) return `${label} between non-sloping facets`;
  }
  if (BOUNDARY_TYPES.includes(label) && list.length > 1)
    return `${label} cannot be an interior edge`;
  if (STRONG_DERIVED.includes(derived) && STRONG_DERIVED.includes(label) && label !== derived) {
    return `labelled ${label} but facet geometry says ${derived}`;
  }
  return null;
}
