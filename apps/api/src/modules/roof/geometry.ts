// Server side of the roof geometry editor (RF-023, RF-025, RF-027, RF-028, RR-032, COS-204..COS-207,
// ADD-027, ADD-028, ADD-030, ADD-031, ADD-034). The draft version's geometry IS its append-only
// command log (roof_geometry_ops) replayed through @fieldline/geometry: deterministic, reversible
// (undo/redo are log entries), and the same log reproduces the same totals after a reload.
// Derived facets/vertices/edges rows and the version snapshot are rewritten after every accepted
// edit; topology errors (self-intersection, zero area, duplicates, overlaps) are flagged in the
// snapshot and block quantities and submission, never silently priced.
import type { RoofGeometryCommand, RoofGeometryState } from '@fieldline/contracts';
import {
  analyzeRoof,
  appliedCommands,
  canRedo,
  canUndo,
  createHistory,
  type EditorCommand,
  type EditorHistory,
  execute,
  GEOMETRY_VERSION,
  GeometryError,
  pitchDegrees,
  type RoofAnalysis,
  redo,
  risePer12,
  TOPOLOGY_VERSION,
  toRoofInput,
  toSI,
  undo,
} from '@fieldline/geometry';
import { and, asc, eq } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { roofEdges, roofFacets, roofGeometryOps, roofReportVersions, roofVertices } from '../../db/schema';
import { problem } from '../../http/problem';

export interface PitchMeta {
  method: string;
  source: string;
  confidence: number | null;
}

export interface ReplayResult {
  history: EditorHistory;
  analysis: RoofAnalysis;
  pitchMeta: Map<string, PitchMeta>;
}

export const FT2_PER_M2 = 1 / (toSI(1, 'ft') * toSI(1, 'ft'));

type Op = typeof roofGeometryOps.$inferSelect;

export async function loadOps(tx: Tx, orgId: string, versionId: string): Promise<Op[]> {
  return tx
    .select()
    .from(roofGeometryOps)
    .where(and(eq(roofGeometryOps.orgId, orgId), eq(roofGeometryOps.reportVersionId, versionId)))
    .orderBy(asc(roofGeometryOps.sequence));
}

/** Applies one command (or undo/redo). Invalid commands throw 422 geometry_invalid. */
export function step(history: EditorHistory, cmd: RoofGeometryCommand): EditorHistory {
  if (cmd.type === 'undo') return undo(history);
  if (cmd.type === 'redo') return redo(history);
  if (cmd.type === 'set_pitch' && cmd.method === 'single_overhead_photo') {
    // RF-027 S: one overhead photograph cannot establish pitch without scale/3D constraints.
    throw problem('measurement_unknown', `Pitch for ${cmd.facetId} cannot come from a single overhead photo; enter a measured, provider 3D or plan pitch, or leave it unknown.`);
  }
  try {
    // Extra provenance fields (method/source/confidence) ride along; the editor ignores them.
    return execute(history, cmd as unknown as EditorCommand);
  } catch (error) {
    if (error instanceof GeometryError) throw problem('geometry_invalid', error.message);
    throw error;
  }
}

export function replayCommands(commands: readonly RoofGeometryCommand[], excludedStructureIds: readonly string[]): ReplayResult {
  let history = createHistory();
  for (const c of commands) history = step(history, c);
  return analyse(history, excludedStructureIds);
}

export function analyse(history: EditorHistory, excludedStructureIds: readonly string[]): ReplayResult {
  const pitchMeta = new Map<string, PitchMeta>();
  for (const c of appliedCommands(history) as unknown as RoofGeometryCommand[]) {
    if (c.type === 'set_pitch') pitchMeta.set(c.facetId, { method: c.method, source: c.source, confidence: c.confidence ?? null });
    if (c.type === 'add_facet' && c.pitch) pitchMeta.set(c.id, { method: 'manual_entry', source: 'user_entered', confidence: null });
  }
  const analysis = analyzeRoof({ ...toRoofInput(history.state), excludedStructureIds });
  return { history, analysis, pitchMeta };
}

export function opsToCommands(ops: Op[]): RoofGeometryCommand[] {
  return ops.flatMap((o) => (o.payload as { commands: RoofGeometryCommand[] }).commands);
}

const round = (v: number, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

export function geometryState(
  r: ReplayResult,
  meta: { reportId: string; versionId: string; versionNumber: number; versionStatus: RoofGeometryState['versionStatus']; geometryRevision: number; scopeStructureIds: readonly string[]; excludedStructureIds: readonly string[] },
): RoofGeometryState {
  const { analysis, history } = r;
  const facets = [...history.state.facets.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const byId = new Map(analysis.facets.map((f) => [f.id, f]));
  const sids = [...new Set([...meta.scopeStructureIds, ...analysis.facets.map((f) => f.structureId)])].sort();
  const edgeTotals = Object.fromEntries(
    Object.entries(analysis.edgeTotals).map(([k, t]) => [k, { count: t.count, planLengthM: round(t.planLength), trueLengthM: t.trueLength === null ? null : round(t.trueLength) }]),
  );
  return {
    reportId: meta.reportId,
    versionId: meta.versionId,
    versionNumber: meta.versionNumber,
    versionStatus: meta.versionStatus,
    geometryRevision: meta.geometryRevision,
    geometryVersion: GEOMETRY_VERSION,
    valid: analysis.valid,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    vertices: [...history.state.vertices.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, p]) => ({ id, x: p.x, y: p.y })),
    facets: facets.map((f) => {
      const a = byId.get(f.id);
      const pm = r.pitchMeta.get(f.id);
      return {
        id: f.id,
        structureId: f.structureId,
        vertexIds: [...f.vertexIds],
        planAreaM2: round(a?.planArea ?? 0),
        netPlanAreaM2: round(a?.netPlanArea ?? 0),
        slopedAreaM2: a?.slopedArea == null ? null : round(a.slopedArea),
        slopeFactor: a?.slopeFactor == null ? null : round(a.slopeFactor, 9),
        pitch: f.pitch
          ? {
              rise: f.pitch.rise,
              run: f.pitch.run,
              risePer12: round(risePer12(f.pitch), 4),
              degrees: round(pitchDegrees(f.pitch), 4),
              method: pm?.method ?? 'manual_entry',
              source: pm?.source ?? 'user_entered',
              confidence: pm?.confidence ?? null,
            }
          : null,
        valid: a?.valid ?? false,
      };
    }),
    edges: analysis.edges.map((e) => ({
      id: e.id,
      nodeIds: [e.nodeIds[0], e.nodeIds[1]] as [string, string],
      facetIds: [...e.facetIds],
      type: e.type,
      derivedType: e.derivedType,
      label: e.label,
      planLengthM: round(e.planLength),
      trueLengthM: e.trueLength === null ? null : round(e.trueLength),
      conflict: e.conflict,
    })),
    edgeTotals,
    structures: sids.map((sid) => {
      const t = analysis.structureTotals[sid];
      return {
        structureId: sid,
        included: !meta.excludedStructureIds.includes(sid),
        measured: Boolean(t && t.facetCount > 0),
        facetCount: t?.facetCount ?? 0,
        netPlanAreaM2: round(t?.netPlanArea ?? 0),
        slopedAreaM2: t?.slopedArea == null ? null : round(t.slopedArea),
      };
    }),
    property: {
      facetCount: analysis.propertyTotal.facetCount,
      netPlanAreaM2: round(analysis.propertyTotal.netPlanArea),
      slopedAreaM2: analysis.propertyTotal.slopedArea === null ? null : round(analysis.propertyTotal.slopedArea),
      squares: analysis.propertyTotal.slopedArea === null ? null : round((analysis.propertyTotal.slopedArea * FT2_PER_M2) / 100, 6),
    },
    issues: analysis.issues.map((i) => ({
      code: i.code,
      severity: i.severity,
      message: i.message,
      ...(i.facetIds ? { facetIds: [...i.facetIds] } : {}),
      ...(i.edgeId ? { edgeId: i.edgeId } : {}),
    })),
  };
}

/** Rewrites the derived rows + snapshot of a DRAFT version (locked versions are frozen by triggers). */
export async function persistDerived(tx: Tx, orgId: string, versionId: string, state: RoofGeometryState, r: ReplayResult): Promise<void> {
  await tx.delete(roofFacets).where(and(eq(roofFacets.orgId, orgId), eq(roofFacets.reportVersionId, versionId)));
  await tx.delete(roofVertices).where(and(eq(roofVertices.orgId, orgId), eq(roofVertices.reportVersionId, versionId)));
  await tx.delete(roofEdges).where(and(eq(roofEdges.orgId, orgId), eq(roofEdges.reportVersionId, versionId)));
  if (state.vertices.length) {
    await tx.insert(roofVertices).values(state.vertices.map((v) => ({ orgId, reportVersionId: versionId, key: v.id, x: v.x, y: v.y, source: 'user_entered' as const })));
  }
  if (state.facets.length) {
    await tx.insert(roofFacets).values(
      state.facets.map((f) => ({
        orgId,
        reportVersionId: versionId,
        key: f.id,
        label: f.structureId,
        vertexKeys: f.vertexIds,
        pitchRise: f.pitch ? String(f.pitch.rise) : null,
        pitchRun: f.pitch ? String(f.pitch.run) : null,
        pitchRatio: f.pitch ? String(round(f.pitch.rise / f.pitch.run)) : null,
        pitchSource: f.pitch ? (f.pitch.source as 'user_entered') : null,
        planAreaM2: String(f.netPlanAreaM2),
        slopedAreaM2: f.slopedAreaM2 === null ? null : String(f.slopedAreaM2),
        areaSource: 'user_entered' as const,
        needsReview: !f.valid || f.pitch === null,
      })),
    );
  }
  const nodeKey = new Map<string, string>();
  for (const n of r.analysis.nodes) nodeKey.set(n.id, n.id);
  if (state.edges.length) {
    await tx.insert(roofEdges).values(
      state.edges.map((e) => ({
        orgId,
        reportVersionId: versionId,
        key: e.id,
        fromVertexKey: e.nodeIds[0],
        toVertexKey: e.nodeIds[1],
        leftFacetKey: e.facetIds[0] ?? null,
        rightFacetKey: e.facetIds[1] ?? null,
        edgeType: e.type,
        classificationSource: e.label ? ('user_entered' as const) : ('machine_estimated' as const),
        lengthM: e.trueLengthM === null ? null : String(e.trueLengthM),
      })),
    );
  }
  await tx
    .update(roofReportVersions)
    .set({
      geometry: state,
      totals: { property: state.property, structures: state.structures, edgeTotals: state.edgeTotals },
      validation: { valid: state.valid, issues: state.issues },
      unresolvedIssues: state.issues.map((i) => ({ code: i.code, message: i.message })),
      engineVersions: { geometry: GEOMETRY_VERSION, topology: TOPOLOGY_VERSION },
      geometryRevision: state.geometryRevision,
    })
    .where(and(eq(roofReportVersions.orgId, orgId), eq(roofReportVersions.id, versionId)));
}
