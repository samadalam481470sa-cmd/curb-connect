// Roof report -> quote (RR-040, COS-210, COS-211, ADD-033). Quantities are prefilled from an APPROVED
// report version (and its latest takeoff for waste-adjusted order area), then priced by the shared
// estimates engine. Preview prices good/better/best without writing; convert creates one shared
// estimate for the selected tier (immutable revision with input + price-book snapshots, gating).
// Provenance flows through: a contractor-traced report is user_entered, so the shared gating keeps
// it a labeled range until measurements are field verified.
import type { Measurement, RoofGeometryState } from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { materialTakeoffs } from '../../db/schema';
import { signoffResolver } from '../estimates';
import { computeRevision } from '../estimates/service';
import type { RoofVersionRow } from './service';

export const ROOF_QUOTE_INPUT_KEYS = ['roof_sloped_area', 'roof_order_area', 'roof_plan_area', 'roof_facet_count'] as const;

export async function quoteInputs(tx: Tx, orgId: string, version: RoofVersionRow): Promise<{ inputs: Record<string, Measurement>; takeoffId: string | null; wasteFraction: string | null }> {
  const g = version.geometry as RoofGeometryState;
  const at = (version.approvedAt ?? new Date()).toISOString();
  const verified = g.facets.every((f) => f.pitch && (f.pitch.source === 'field_verified' || f.pitch.source === 'survey_supplied'));
  const source = verified ? 'field_verified' : 'user_entered';
  const known = (value: number, unit: 'm' | 'm2' | 'count'): Measurement => ({ state: 'known', value, unit, source, measuredAt: at, precision: unit === 'count' ? 0 : Math.abs(value) * 0.01 });
  const [takeoff] = await tx
    .select()
    .from(materialTakeoffs)
    .where(and(eq(materialTakeoffs.orgId, orgId), eq(materialTakeoffs.reportVersionId, version.id)))
    .orderBy(desc(materialTakeoffs.createdAt))
    .limit(1);
  const sloped = g.property.slopedAreaM2;
  const inputs: Record<string, Measurement> = {
    roof_plan_area: known(g.property.netPlanAreaM2, 'm2'),
    roof_sloped_area: sloped === null ? { state: 'unknown', reason: 'not_measured_yet' } : known(sloped, 'm2'),
    roof_order_area:
      sloped !== null && takeoff ? known(sloped * (1 + Number(takeoff.wasteFraction)), 'm2') : { state: 'unknown', reason: 'not_provided', note: 'run a takeoff to select waste' },
    roof_facet_count: known(g.property.facetCount, 'count'),
  };
  for (const [type, t] of Object.entries(g.edgeTotals)) {
    if (t.count === 0) continue;
    inputs[`roof_${type}_length`] = t.trueLengthM === null ? { state: 'unknown', reason: 'not_measured_yet' } : known(t.trueLengthM, 'm');
  }
  return { inputs, takeoffId: takeoff?.id ?? null, wasteFraction: takeoff?.wasteFraction ?? null };
}

export async function priceTier(
  tx: Tx,
  orgId: string,
  propertyId: string,
  inputs: Record<string, Measurement>,
  lines: { code: string; quantityKey?: string | undefined; quantity?: string | undefined; critical: boolean }[],
  assumptions: string[],
  priceBookRevisionId: string | null,
) {
  return computeRevision(
    tx,
    orgId,
    { productLine: 'roof', curbProjectId: null, propertyId },
    { inputs, lineSpecs: lines as never, siteConditions: {}, assumptions, priceBookRevisionId },
    signoffResolver(tx, orgId, 'roof'),
  );
}
