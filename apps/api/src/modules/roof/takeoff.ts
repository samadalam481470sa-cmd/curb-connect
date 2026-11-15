// Roof quantity takeoff (RR-034, RR-035, RF-029, COS-207, COS-208, COS-209, ADD-030, ADD-033) on top
// of @fieldline/pricing: per-facet sloped area (plan x sqrt(1 + (rise/run)^2)), roofing squares at
// 100 ft2, waste applied ONCE to the base quantity, packs rounded up only on the order quantity, and
// unresolved lines (never default brand dimensions) when coverage, pitch or waste is unknown.
// Append-only measurement overrides (latest per field/target wins) replace computed inputs.
import type { RoofGeometryState } from '@fieldline/contracts';
import {
  EXAMPLE_WASTE_RULES,
  type MaterialClass,
  type MaterialSpec,
  materialTakeoff,
  recommendWaste,
  ROOF_EDGE_TYPES,
  ROOF_TAKEOFF_VERSION,
  ROOF_WASTE_VERSION,
  roofTakeoff,
  selectWaste,
  type WasteRuleSet,
  type WasteSelection,
} from '@fieldline/pricing';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { RoofTakeoffRequestSchema } from '@fieldline/contracts';
import type { Tx } from '../../db/runtime';
import { measurementOverrides, wastePolicies } from '../../db/schema';
import { problem } from '../../http/problem';

export const OVERRIDE_SUBJECT = 'roof_report_version';

export async function latestOverrides(tx: Tx, orgId: string, versionId: string) {
  const rows = await tx
    .select()
    .from(measurementOverrides)
    .where(and(eq(measurementOverrides.orgId, orgId), eq(measurementOverrides.subjectType, OVERRIDE_SUBJECT), eq(measurementOverrides.subjectId, versionId)))
    .orderBy(asc(measurementOverrides.createdAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(r.field, r);
  return latest;
}

function overrideValue(row: { newValue: unknown } | undefined): number | null | undefined {
  if (!row) return undefined;
  const v = row.newValue as { state: string; value?: number };
  return v.state === 'known' && typeof v.value === 'number' ? v.value : null;
}

export function requireValidGeometry(state: RoofGeometryState | null): RoofGeometryState {
  if (!state || state.facets.length === 0) throw problem('measurement_unknown', 'No roof facets have been drawn yet.');
  if (!state.valid) {
    const errs = state.issues.filter((i) => i.severity === 'error');
    throw problem('geometry_invalid', `Fix the geometry before quantities: ${errs.map((e) => e.code).join(', ')}.`, {
      errors: errs.map((e) => ({ path: e.facetIds?.join(',') ?? e.edgeId ?? 'geometry', message: e.message, code: e.code })),
    });
  }
  return state;
}

export async function computeTakeoff(tx: Tx, orgId: string, versionId: string, state: RoofGeometryState, req: z.infer<typeof RoofTakeoffRequestSchema>) {
  const overrides = await latestOverrides(tx, orgId, versionId);
  const applied: string[] = [];
  const excluded = state.structures.filter((s) => !s.included).map((s) => s.structureId);
  const facets = state.facets.map((f) => {
    const ov = overrideValue(overrides.get(`facet.planAreaM2:${f.id}`));
    if (ov !== undefined) applied.push(`facet.planAreaM2:${f.id}`);
    return {
      id: f.id,
      structureId: f.structureId,
      planAreaM2: String(ov ?? f.netPlanAreaM2),
      pitch: f.pitch ? { rise: String(f.pitch.rise), run: String(f.pitch.run) } : null,
    };
  });
  const edgeLengthsM: Record<string, string | null> = {};
  for (const t of ROOF_EDGE_TYPES) {
    const ov = overrides.get(`edges.lengthM:${t}`);
    if (ov) {
      applied.push(`edges.lengthM:${t}`);
      const v = overrideValue(ov);
      edgeLengthsM[t] = v === null || v === undefined ? null : String(v);
      continue;
    }
    const tot = state.edgeTotals[t];
    edgeLengthsM[t] = !tot || tot.count === 0 ? '0' : tot.trueLengthM === null ? null : String(tot.trueLengthM);
  }
  const takeoff = roofTakeoff({ facets, edgeLengthsM, excludedStructureIds: excluded });

  const [policy] = await tx.select().from(wastePolicies).where(and(eq(wastePolicies.orgId, orgId), eq(wastePolicies.active, true))).limit(1);
  const rules = (policy?.rules as WasteRuleSet | undefined)?.rules ? (policy!.rules as WasteRuleSet) : EXAMPLE_WASTE_RULES;
  const maxPitch = Math.max(0, ...state.facets.map((f) => (f.pitch ? f.pitch.rise / f.pitch.run : 0)));
  const recommendation = recommendWaste(
    { roofType: req.roofType, facetCount: state.property.facetCount, hipCount: state.edgeTotals.hip?.count ?? 0, valleyCount: state.edgeTotals.valley?.count ?? 0, maxPitchRatio: String(maxPitch) },
    rules,
  );
  const selection = selectWaste({ recommendation, override: req.wasteOverride ? { ...req.wasteOverride, by: 'user' } : null });
  if (selection.status !== 'selected') {
    throw problem('measurement_unknown', `No validated waste recommendation for this roof (${recommendation.status === 'none' ? recommendation.reason : 'n/a'}); enter a waste value with an explanation.`);
  }
  const waste: Partial<Record<MaterialClass, WasteSelection>> = {};
  for (const s of req.materials) waste[s.materialClass] = selection;
  const specs: MaterialSpec[] = req.materials.map((m) => ({
    code: m.code,
    description: m.description,
    materialClass: m.materialClass,
    basis: m.basis,
    coveragePerPack: m.coveragePerPack,
    packUnit: m.packUnit,
    sku: m.sku ?? null,
    unitPrice: null,
    priceSourceRevision: null,
    critical: true,
  }));
  const lines = materialTakeoff(takeoff, specs, waste);
  const edgeLf = Object.fromEntries(Object.entries(takeoff.edgeLf).map(([k, v]) => [k, v === null ? null : v.toString()]));
  return {
    takeoff,
    lines,
    edgeLf,
    selection,
    recommendation,
    wastePolicyId: policy?.id ?? null,
    applied,
    engineVersion: `${ROOF_TAKEOFF_VERSION}+${ROOF_WASTE_VERSION}`,
  };
}
