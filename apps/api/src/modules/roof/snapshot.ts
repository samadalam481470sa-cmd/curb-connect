// Report snapshot for PDF/CSV/JSON exports (RF-036, RR-036, RR-038, COS-202, ADD-035). Built from
// a frozen version snapshot, never from live editor state. Imagery is embedded ONLY when the rights
// engine allows embed_in_exports; otherwise the PDF shows the vector diagram and a disclosure.
import { BRAND, ROOF_EXPORT_SCHEMA_VERSION, type RoofGeometryState } from '@fieldline/contracts';
import type { EdgeCategory, RoofReportSnapshot } from '@fieldline/pdf';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Tx } from '../../db/runtime';
import { organizations, properties, structures } from '../../db/schema';
import { decide, parseLicense } from '../imagery/rights';
import { loadImagery } from '../imagery/service';
import { requireOrder, requireReport, type RoofVersionRow } from './service';
import { latestOverrides } from './takeoff';

const EDGE_CATEGORY: Record<string, EdgeCategory> = {
  eave: 'eave',
  rake: 'rake',
  ridge: 'ridge',
  hip: 'hip',
  valley: 'valley',
  flashing: 'wall_flashing',
  step_flashing: 'step_flashing',
  perimeter: 'unclassified',
  unclassified: 'unclassified',
};

/** Deterministic synthetic tile for fixture imagery (clearly not a real capture). */
async function syntheticImage(seed: string): Promise<string> {
  const shade = 96 + (seed.charCodeAt(0) % 64);
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: shade, g: shade, b: shade } } }).png({ compressionLevel: 9 }).toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

export interface ReportExportBundle {
  snapshot: RoofReportSnapshot;
  geometry: RoofGeometryState;
  version: RoofVersionRow;
  orderNumber: string;
  imageryDecision: { allowed: boolean; reason: string } | null;
  overrides: { field: string; reason: string; newValue: unknown; actorUserId: string | null }[];
}

export async function buildReportSnapshot(tx: Tx, orgId: string, version: RoofVersionRow): Promise<ReportExportBundle> {
  const geometry = version.geometry as RoofGeometryState | null;
  if (!geometry) throw new Error('version has no geometry snapshot');
  const report = await requireReport(tx, orgId, version.roofReportId);
  const order = await requireOrder(tx, orgId, report.roofOrderId);
  const [org] = await tx.select({ name: organizations.displayName }).from(organizations).where(eq(organizations.id, orgId));
  const [prop] = await tx.select().from(properties).where(and(eq(properties.orgId, orgId), eq(properties.id, order.propertyId)));
  const names = new Map(
    (await tx.select({ id: structures.id, label: structures.label }).from(structures).where(and(eq(structures.orgId, orgId), eq(structures.propertyId, order.propertyId)))).map((s) => [s.id, s.label]),
  );
  const imagery = version.imageryAssetId ? await loadImagery(tx, orgId, version.imageryAssetId) : null;
  const license = imagery ? parseLicense(imagery.rights) : null;
  const embed = imagery ? decide(license, 'embed_in_exports') : null;
  const verts = new Map(geometry.vertices.map((v) => [v.id, v]));
  const overrides = [...(await latestOverrides(tx, orgId, version.id)).values()];

  const structuresSnap = geometry.structures
    .filter((s) => s.included && s.measured)
    .map((s) => {
      const facets = geometry.facets.filter((f) => f.structureId === s.structureId);
      const facetIds = new Set(facets.map((f) => f.id));
      return {
        id: s.structureId,
        name: names.get(s.structureId) ?? s.structureId,
        wasteFactor: 0,
        facets: facets.map((f) => ({
          id: f.id,
          label: f.id,
          polygon: f.vertexIds.map((id) => [verts.get(id)!.x, verts.get(id)!.y] as [number, number]),
          planAreaSqM: f.netPlanAreaM2,
          slopedAreaSqM: f.slopedAreaM2 ?? f.netPlanAreaM2,
          pitchRisePer12: f.pitch?.risePer12 ?? 0,
          provenance: (f.pitch?.source ?? 'user_entered') as 'user_entered',
        })),
        edges: geometry.edges
          .filter((e) => e.facetIds.some((id) => facetIds.has(id)))
          .map((e) => {
            const a = verts.get(e.nodeIds[0]);
            const b = verts.get(e.nodeIds[1]);
            return {
              id: e.id,
              category: EDGE_CATEGORY[e.type] ?? 'unclassified',
              lengthM: e.trueLengthM ?? e.planLengthM,
              from: [a?.x ?? 0, a?.y ?? 0] as [number, number],
              to: [b?.x ?? 0, b?.y ?? 0] as [number, number],
              provenance: (e.label ? 'user_entered' : 'machine_estimated') as 'user_entered',
            };
          }),
      };
    });
  const unmeasured = geometry.structures.filter((s) => s.included && !s.measured).map((s) => `${names.get(s.structureId) ?? s.structureId}: not measured (no dimensions invented)`);
  const excluded = geometry.structures.filter((s) => !s.included).map((s) => `${names.get(s.structureId) ?? s.structureId}: excluded from scope`);

  const snapshot: RoofReportSnapshot = {
    kind: 'roof_report',
    meta: {
      documentId: `${order.number}-R${version.versionNumber}`,
      revision: version.versionNumber,
      issuedAt: (version.approvedAt ?? version.submittedAt ?? version.updatedAt).toISOString(),
      organization: { name: org?.name ?? 'Contractor' },
      productName: BRAND.name,
    },
    property: { addressLines: [prop?.normalizedAddress ?? prop?.originalQuery ?? 'Property'].filter(Boolean) as string[], ...(prop?.parcelId ? { parcelId: prop.parcelId } : {}) },
    measurementSystem: 'imperial',
    imagery: imagery
      ? {
          provider: imagery.provider,
          ...(imagery.captureDate ? { captureDate: imagery.captureDate } : {}),
          ...(imagery.gsdM ? { gsdMeters: Number(imagery.gsdM) } : {}),
          ...(license?.licenseRef ? { licenseId: license.licenseRef } : {}),
          exportAllowed: Boolean(embed?.allowed),
          attribution: imagery.attribution,
          ...(embed?.allowed && license?.isSynthetic ? { imageSrc: await syntheticImage(imagery.id) } : {}),
        }
      : { provider: 'none (manual tracing / plan)', exportAllowed: false },
    structures: structuresSnap,
    exclusions: [...excluded, ...unmeasured],
    reviewNotes: overrides.map((o) => ({ author: o.actorUserId ?? 'system', at: o.createdAt.toISOString(), text: `Override ${o.field}: ${o.reason}` })),
    methodology:
      'Each facet is drawn separately on licensed imagery or a plan. Sloped area = plan area x sqrt(1 + (rise/run)^2) per facet; shared edges are counted once and classified from adjoining facets. Waste and pack rounding are applied only in the material takeoff.',
    disclaimers: [
      'Measurements are estimates unless marked field verified.',
      'Not a survey.',
      ...(license?.isSynthetic ? ['Imagery is SYNTHETIC test data, not a real capture.'] : []),
    ],
    approval:
      version.status === 'approved' || version.status === 'issued'
        ? { status: 'approved', ...(version.approvedAt ? { approvedAt: version.approvedAt.toISOString() } : {}), approverRole: 'Reviewer' }
        : { status: version.status === 'submitted' ? 'review_required' : 'draft' },
  };
  return {
    snapshot,
    geometry,
    version,
    orderNumber: order.number,
    imageryDecision: embed ? { allowed: embed.allowed, reason: embed.reason } : null,
    overrides: overrides.map((o) => ({ field: o.field, reason: o.reason, newValue: o.newValue, actorUserId: o.actorUserId })),
  };
}

export function reportJson(b: ReportExportBundle) {
  const g = b.geometry;
  return {
    schemaVersion: ROOF_EXPORT_SCHEMA_VERSION,
    units: { length: 'm', area: 'm2', squares: '100 ft2' },
    report: { order: b.orderNumber, versionId: b.version.id, versionNumber: b.version.versionNumber, status: b.version.status, geometryRevision: g.geometryRevision, engineVersions: b.version.engineVersions },
    imagery: { provider: b.snapshot.imagery.provider, captureDate: b.snapshot.imagery.captureDate ?? null, attribution: b.snapshot.imagery.attribution ?? null },
    totals: g.property,
    structures: g.structures,
    facets: g.facets.map((f) => ({ ...f, polygon: f.vertexIds.map((id) => g.vertices.find((v) => v.id === id)) })),
    edgeTotals: g.edgeTotals,
    edges: g.edges,
    overrides: b.overrides,
  };
}

export function reportCsv(b: ReportExportBundle): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const rows: unknown[][] = [
    ['schema_version', ROOF_EXPORT_SCHEMA_VERSION],
    ['report_version', b.version.versionNumber, 'status', b.version.status],
    [],
    ['record', 'id', 'structure_id', 'type', 'plan_area_m2', 'sloped_area_m2', 'pitch_rise_per_12', 'pitch_source', 'length_m'],
  ];
  for (const f of b.geometry.facets) rows.push(['facet', f.id, f.structureId, 'facet', f.netPlanAreaM2, f.slopedAreaM2, f.pitch?.risePer12 ?? '', f.pitch?.source ?? 'unknown', '']);
  for (const e of b.geometry.edges) rows.push(['edge', e.id, '', e.type, '', '', '', '', e.trueLengthM ?? '']);
  rows.push(['total', 'property', '', '', b.geometry.property.netPlanAreaM2, b.geometry.property.slopedAreaM2, '', '', '']);
  return `${rows.map((r) => r.map(esc).join(',')).join('\n')}\n`;
}
