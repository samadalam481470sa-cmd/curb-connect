// Pure roof workbench logic (no React): unit display, pitch conversions, vertex snapping, command
// builders and the local preview that replays pending commands through @fieldline/geometry.
// RF-023, RF-025, RF-027, RF-028, RR-032, COS-204..COS-207, ADD-027, ADD-028, ADD-030, ADD-031.
import type { RoofEdgeType, RoofGeometryCommand, RoofGeometryState, RoofOrderStatus } from '@fieldline/contracts';
import {
  analyzeEditorState,
  applyCommand,
  edgeKey,
  type EditorCommand,
  type EditorFacet,
  type EditorState,
  type Pitch,
  pitchDegrees,
  pitchFromDegrees,
  risePer12,
  slopeFactor,
  toSI,
} from '@fieldline/geometry';

export const FT_PER_M = 1 / toSI(1, 'ft');
export const FT2_PER_M2 = FT_PER_M * FT_PER_M;

export const fmtFt2 = (m2: number | null | undefined) => (m2 == null ? 'Unknown' : `${(m2 * FT2_PER_M2).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ft²`);
export const fmtFt = (m: number | null | undefined) => (m == null ? 'Unknown' : `${(m * FT_PER_M).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ft`);
export const fmtSquares = (sq: number | null | undefined) => (sq == null ? 'Unknown' : `${sq.toFixed(2)} squares`);

export const EDGE_LABELS: Record<RoofEdgeType, string> = {
  eave: 'Eave',
  rake: 'Rake',
  ridge: 'Ridge',
  hip: 'Hip',
  valley: 'Valley',
  flashing: 'Flashing',
  step_flashing: 'Step flashing',
  perimeter: 'Perimeter',
  unclassified: 'Unclassified',
};

/** Edge strokes: pattern + color so type is never conveyed by color alone (ADD-005 accessibility). */
export const EDGE_STYLE: Record<RoofEdgeType, { color: string; dash: string }> = {
  eave: { color: '#22d3ee', dash: '' },
  rake: { color: '#a78bfa', dash: '6 3' },
  ridge: { color: '#f472b6', dash: '' },
  hip: { color: '#fb923c', dash: '2 3' },
  valley: { color: '#34d399', dash: '8 3 2 3' },
  flashing: { color: '#facc15', dash: '1 3' },
  step_flashing: { color: '#facc15', dash: '4 2' },
  perimeter: { color: '#94a3b8', dash: '' },
  unclassified: { color: '#e2e8f0', dash: '3 3' },
};

export const ORDER_STATUS_LABEL: Record<RoofOrderStatus, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  imagery_pending: 'Waiting for imagery',
  measuring: 'Measuring',
  review_required: 'In review',
  clarification_needed: 'Clarification needed',
  approved: 'Approved',
  quoted: 'Quoted',
  won: 'Won',
  invoiced: 'Invoiced',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

// ------------------------------------------------------------------ pitch (RF-027)
export type PitchInputMode = 'rise12' | 'degrees' | 'factor';

/**
 * Parse a pitch entered as rise per 12 ("6"), degrees ("26.57") or slope factor ("1.118").
 * Returns null for blank (unknown pitch stays unknown; never defaulted) and throws for bad input.
 */
export function parsePitch(mode: PitchInputMode, raw: string): Pitch | null {
  const text = raw.trim();
  if (text === '') return null;
  const v = Number(text);
  if (!Number.isFinite(v)) throw new Error('Enter a number.');
  if (mode === 'rise12') {
    if (v < 0 || v > 48) throw new Error('Rise per 12 must be between 0 and 48.');
    return { rise: v, run: 12 };
  }
  if (mode === 'degrees') {
    if (v < 0 || v >= 80) throw new Error('Degrees must be from 0 to below 80.');
    const p = pitchFromDegrees(v);
    return { rise: round(risePer12(p), 6), run: 12 };
  }
  if (v < 1 || v > 5) throw new Error('Slope factor must be between 1 and 5.');
  // factor = sqrt(1 + (rise/run)^2)
  return { rise: round(Math.sqrt(v * v - 1) * 12, 6), run: 12 };
}

export function describePitch(p: Pitch | null | undefined): { rise12: string; degrees: string; factor: string } {
  if (!p) return { rise12: 'Unknown', degrees: 'Unknown', factor: 'Unknown' };
  return { rise12: `${round(risePer12(p), 2)}/12`, degrees: `${round(pitchDegrees(p), 2)}°`, factor: round(slopeFactor(p), 4).toFixed(4) };
}

export function round(v: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

// ------------------------------------------------------------------ snapping (RF-023 vertex snapping)
export interface Pt {
  x: number;
  y: number;
}

/** Snap to the nearest existing vertex within `tolM`, else to the grid (if any). */
export function snapPoint(p: Pt, vertices: readonly { id: string; x: number; y: number }[], tolM: number, gridM: number | null = null): { point: Pt; vertexId: string | null } {
  let best: { id: string; d: number; x: number; y: number } | null = null;
  for (const v of vertices) {
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d <= tolM && (!best || d < best.d)) best = { id: v.id, d, x: v.x, y: v.y };
  }
  if (best) return { point: { x: best.x, y: best.y }, vertexId: best.id };
  if (gridM && gridM > 0) return { point: { x: round(Math.round(p.x / gridM) * gridM, 6), y: round(Math.round(p.y / gridM) * gridM, 6) }, vertexId: null };
  return { point: { x: round(p.x, 6), y: round(p.y, 6) }, vertexId: null };
}

// ------------------------------------------------------------------ ids
let seq = 0;
export function localId(prefix: string): string {
  seq += 1;
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}${rand}${seq.toString(36)}`;
}

/**
 * Commands for a traced polygon: new vertices for points not snapped to an existing vertex, then
 * add_facet with the structure id. Points are given in drawing order.
 */
export function facetCommands(points: readonly { point: Pt; vertexId: string | null }[], structureId: string, facetId = localId('f')): RoofGeometryCommand[] {
  const cmds: RoofGeometryCommand[] = [];
  const ids: string[] = [];
  for (const p of points) {
    if (p.vertexId) {
      ids.push(p.vertexId);
    } else {
      const id = localId('v');
      cmds.push({ type: 'add_vertex', id, x: p.point.x, y: p.point.y });
      ids.push(id);
    }
  }
  if (new Set(ids).size < 3) throw new Error('A facet needs at least three distinct corners.');
  cmds.push({ type: 'add_facet', id: facetId, vertexIds: ids, structureId });
  return cmds;
}

// ------------------------------------------------------------------ local preview
/** Rebuild an editor state from the server snapshot so pending local commands can be previewed. */
export function editorStateFrom(s: RoofGeometryState): EditorState {
  const vertices = new Map(s.vertices.map((v) => [v.id, { x: v.x, y: v.y }]));
  const facets = new Map<string, EditorFacet>(
    s.facets.map((f) => [f.id, { id: f.id, structureId: f.structureId, vertexIds: f.vertexIds, pitch: f.pitch ? { rise: f.pitch.rise, run: f.pitch.run } : null, downslope: null, exclusions: [] }]),
  );
  const edgeLabels = new Map<string, RoofEdgeType>();
  for (const e of s.edges) if (e.label) edgeLabels.set(edgeKey(e.nodeIds[0], e.nodeIds[1]), e.label);
  return { vertices, facets, edgeLabels } as EditorState;
}

export interface Preview {
  vertices: { id: string; x: number; y: number }[];
  facets: { id: string; structureId: string; vertexIds: string[]; pitch: Pitch | null; netPlanAreaM2: number; slopedAreaM2: number | null }[];
  edges: { id: string; a: string; b: string; type: RoofEdgeType; planLengthM: number; trueLengthM: number | null; conflict: string | null }[];
  totals: { facetCount: number; netPlanAreaM2: number; slopedAreaM2: number | null };
  issues: { code: string; severity: string; message: string }[];
  error: string | null;
}

/**
 * Server snapshot + pending (unsynced) commands -> what the canvas shows. Undo/redo are never
 * pending (they run on the server log), so every pending command can be applied locally. The
 * preview is labelled as local until the server confirms; server totals are authoritative.
 */
export function buildPreview(server: RoofGeometryState, pending: readonly RoofGeometryCommand[]): Preview {
  let state = editorStateFrom(server);
  let error: string | null = null;
  for (const c of pending) {
    if (c.type === 'undo' || c.type === 'redo') continue;
    try {
      state = applyCommand(state, c as unknown as EditorCommand);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  if (pending.length === 0) {
    return {
      vertices: server.vertices,
      facets: server.facets.map((f) => ({ id: f.id, structureId: f.structureId, vertexIds: f.vertexIds, pitch: f.pitch ? { rise: f.pitch.rise, run: f.pitch.run } : null, netPlanAreaM2: f.netPlanAreaM2, slopedAreaM2: f.slopedAreaM2 })),
      edges: server.edges.map((e) => ({ id: e.id, a: e.nodeIds[0], b: e.nodeIds[1], type: e.type, planLengthM: e.planLengthM, trueLengthM: e.trueLengthM, conflict: e.conflict })),
      totals: { facetCount: server.property.facetCount, netPlanAreaM2: server.property.netPlanAreaM2, slopedAreaM2: server.property.slopedAreaM2 },
      issues: server.issues,
      error: null,
    };
  }
  const a = analyzeEditorState(state);
  const byId = new Map(a.facets.map((f) => [f.id, f]));
  return {
    vertices: [...state.vertices.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y })),
    facets: [...state.facets.values()].map((f) => ({ id: f.id, structureId: f.structureId, vertexIds: [...f.vertexIds], pitch: f.pitch, netPlanAreaM2: byId.get(f.id)?.netPlanArea ?? 0, slopedAreaM2: byId.get(f.id)?.slopedArea ?? null })),
    edges: a.edges.map((e) => ({ id: e.id, a: e.nodeIds[0], b: e.nodeIds[1], type: e.type, planLengthM: e.planLength, trueLengthM: e.trueLength, conflict: e.conflict })),
    totals: { facetCount: a.propertyTotal.facetCount, netPlanAreaM2: a.propertyTotal.netPlanArea, slopedAreaM2: a.propertyTotal.slopedArea },
    issues: a.issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message })),
    error,
  };
}

/** Uncertainty legend (ADD-031): the lowest pitch confidence and the imagery scale define it. */
export function uncertaintySummary(state: RoofGeometryState, gsdM: number | null): { lowestConfidence: number | null; unknownPitches: number; scale: string } {
  const confs = state.facets.map((f) => f.pitch?.confidence).filter((c): c is number => typeof c === 'number');
  return {
    lowestConfidence: confs.length ? Math.min(...confs) : null,
    unknownPitches: state.facets.filter((f) => !f.pitch).length,
    scale: gsdM ? `1 px ≈ ${fmtFt(gsdM)} (ground sample distance)` : 'No calibrated scale: lengths come from traced coordinates only',
  };
}

// ------------------------------------------------------------------ blueprint scale (ADD-029)
/** Metres per pixel from two image points a known real distance (ft) apart. */
export function calibrate(a: Pt, b: Pt, knownFt: number): number {
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || px < 5) throw new Error('Pick two points at least 5 pixels apart.');
  if (!Number.isFinite(knownFt) || knownFt <= 0) throw new Error('Enter the real distance in feet.');
  return toSI(knownFt, 'ft') / px;
}

// ------------------------------------------------------------------ takeoff (RR-034, RR-035)
export interface MaterialRow {
  code: string;
  description: string;
  materialClass: 'shingles' | 'underlayment' | 'starter' | 'ridge_cap' | 'drip_edge' | 'valley' | 'flashing' | 'vents' | 'accessory';
  basis: { kind: 'sloped_area' } | { kind: 'edges'; edgeTypes: RoofEdgeType[] };
  packUnit: string;
  /** Coverage per pack as typed (ft² or lf). Blank = unknown -> unresolved line; never defaulted. */
  coverage: string;
}

/** Material rows offered on the takeoff form. Coverage is blank on purpose (no brand defaults). */
export const MATERIAL_PRESETS: MaterialRow[] = [
  { code: 'SHINGLES', description: 'Shingles', materialClass: 'shingles', basis: { kind: 'sloped_area' }, packUnit: 'square', coverage: '' },
  { code: 'UNDERLAYMENT', description: 'Underlayment', materialClass: 'underlayment', basis: { kind: 'sloped_area' }, packUnit: 'roll', coverage: '' },
  { code: 'STARTER', description: 'Starter strip', materialClass: 'starter', basis: { kind: 'edges', edgeTypes: ['eave', 'rake'] }, packUnit: 'bundle', coverage: '' },
  { code: 'RIDGE_CAP', description: 'Hip and ridge cap', materialClass: 'ridge_cap', basis: { kind: 'edges', edgeTypes: ['hip', 'ridge'] }, packUnit: 'bundle', coverage: '' },
  { code: 'DRIP_EDGE', description: 'Drip edge', materialClass: 'drip_edge', basis: { kind: 'edges', edgeTypes: ['eave', 'rake'] }, packUnit: 'piece', coverage: '' },
  { code: 'VALLEY', description: 'Valley liner', materialClass: 'valley', basis: { kind: 'edges', edgeTypes: ['valley'] }, packUnit: 'roll', coverage: '' },
];

export function takeoffRequest(rows: readonly MaterialRow[], waste?: { rate: string; reason: string }) {
  const bad = rows.find((r) => r.coverage.trim() !== '' && !/^\d+(\.\d+)?$/.test(r.coverage.trim()));
  if (bad) throw new Error(`Coverage for ${bad.description} must be a plain number.`);
  if (waste && waste.rate.trim() !== '' && !/^0(\.\d+)?$|^1(\.0+)?$/.test(waste.rate.trim())) throw new Error('Waste is a fraction from 0 to 1, for example 0.12.');
  return {
    roofType: 'combination',
    materials: rows.map((r) => ({ code: r.code, description: r.description, materialClass: r.materialClass, basis: r.basis, coveragePerPack: r.coverage.trim() === '' ? null : r.coverage.trim(), packUnit: r.packUnit })),
    ...(waste && waste.rate.trim() !== '' && { wasteOverride: { wasteRate: waste.rate.trim(), reason: waste.reason.trim() } }),
  };
}

// ------------------------------------------------------------------ quote (RR-040)
export const QUOTE_QUANTITY_KEYS = [
  { value: 'roof_order_area', label: 'Order area (sloped, with waste)' },
  { value: 'roof_sloped_area', label: 'Sloped area' },
  { value: 'roof_plan_area', label: 'Plan area' },
  { value: 'roof_ridge_length', label: 'Ridge length' },
  { value: 'roof_hip_length', label: 'Hip length' },
  { value: 'roof_valley_length', label: 'Valley length' },
  { value: 'roof_eave_length', label: 'Eave length' },
  { value: 'roof_rake_length', label: 'Rake length' },
] as const;

export interface TierLineInput {
  code: string;
  quantityKey: string;
}
export interface TierInput {
  tier: 'good' | 'better' | 'best';
  label: string;
  enabled: boolean;
  lines: TierLineInput[];
}

export function quoteRequest(tiers: readonly TierInput[], confirmations: { pricingDate: boolean; waste: boolean }, versionId?: string, selectedTier?: TierInput['tier']) {
  const used = tiers.filter((t) => t.enabled).map((t) => ({ tier: t.tier, label: t.label, lines: t.lines.filter((l) => l.code.trim() !== '').map((l) => ({ code: l.code.trim().toUpperCase(), quantityKey: l.quantityKey, critical: true })) }));
  if (used.length === 0) throw new Error('Enable at least one tier.');
  const empty = used.find((t) => t.lines.length === 0);
  if (empty) throw new Error(`Add a price book item code to the ${empty.tier} tier.`);
  const badCode = used.flatMap((t) => t.lines).find((l) => !/^[A-Z0-9_]{2,40}$/.test(l.code));
  if (badCode) throw new Error(`"${badCode.code}" is not a valid item code (letters, digits, underscore).`);
  return { ...(versionId && { versionId }), confirmations, tiers: used, ...(selectedTier && { selectedTier }) };
}

/** Minor units (string or number from JSON) -> display money, or null. */
export function money(minor: unknown, currency: unknown): string | null {
  if (minor === null || minor === undefined || typeof currency !== 'string') return null;
  try {
    const n = BigInt(String(minor));
    const neg = n < 0n;
    const abs = neg ? -n : n;
    const s = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(neg ? `-${s}` : s));
  } catch {
    return null;
  }
}
