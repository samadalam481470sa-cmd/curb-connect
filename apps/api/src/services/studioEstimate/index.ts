// Studio estimate service: turns a saved House Studio house (spec + settings) into the
// installed-cost estimate the web studio shows, server-side, using the faithful port of
// the web math in this folder (layout/roomEdits/detailedCatalog/prices/takeoff/studioCost).
// The estimate is the NAHB 2024 survey model — national-average $/sq ft escalated to
// today — so every snapshot is labeled budgetary, never binding, never a bid.
import {
  StudioHouseSettingsSchema,
  StudioHouseSpecSchema,
  type StudioEstimateLine,
  type StudioHouseSettings,
  type StudioHouseSpec,
} from '@fieldline/contracts';
import { eq, sql } from 'drizzle-orm';
import { estimates } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { DEFAULT_STUDIO_COSTS, studioEstimate, type StudioCostSettings } from './studioCost';
import { computeTakeoff, DEFAULT_SPEC, type BuildSpec } from './takeoff';

export const STUDIO_ESTIMATE_ENGINE = 'studio-cost-1';

export const STUDIO_ESTIMATE_BASIS =
  'NAHB Cost of Constructing a Home 2024 survey (national average $/sq ft), escalated and ' +
  'scaled to this plan. A planning estimate — not a bid, not a fixed price.';

/** StudioHouseSpec + defaults -> the BuildSpec the takeoff expects (same merge the web does). */
export function buildSpecFromStudioSpec(spec: StudioHouseSpec): BuildSpec {
  return {
    lengthFt: spec.lengthFt,
    widthFt: spec.widthFt,
    stories: spec.stories,
    bedrooms: spec.bedrooms,
    bathrooms: spec.bathrooms,
    garage: spec.garage,
    wallHeightFt: spec.wallHeightFt,
    roofPitch: spec.roofPitch,
    overhangFt: spec.overhangFt ?? DEFAULT_SPEC.overhangFt,
    wastePercent: spec.wastePercent ?? DEFAULT_SPEC.wastePercent,
    studSpacingIn: spec.studSpacingIn ?? DEFAULT_SPEC.studSpacingIn,
    ...(spec.roomEdits ? { roomEdits: spec.roomEdits } : {}),
  };
}

/** Cost settings from the studio house's saved settings, with the model defaults. */
export function costSettingsFromStudioSettings(settings: StudioHouseSettings): StudioCostSettings {
  return {
    escalationPercent: settings.escalationPercent ?? DEFAULT_STUDIO_COSTS.escalationPercent,
    regionalFactor: settings.regionalFactor ?? DEFAULT_STUDIO_COSTS.regionalFactor,
  };
}

export interface StudioEstimateComputation {
  spec: BuildSpec;
  settings: StudioCostSettings;
  lines: StudioEstimateLine[];
  totalMinor: number;
  areaSqFt: number;
  perSqFtMinor: number;
  takeoffSummary: {
    slabAreaSqFt: number;
    concreteYd3: number;
    roofSquares: number;
    windows: number;
    exteriorDoors: number;
    interiorDoors: number;
  };
}

/**
 * Compute the studio estimate for a stored studio house. Parses the stored spec/settings
 * with the contracts schemas first (a malformed stored spec is a validation error, never
 * a silently wrong number). Amounts are whole dollars in the model; minor units are cents.
 */
export function computeStudioEstimate(
  rawSpec: unknown,
  rawSettings: unknown,
): StudioEstimateComputation {
  const spec = buildSpecFromStudioSpec(StudioHouseSpecSchema.parse(rawSpec));
  const settings = costSettingsFromStudioSettings(StudioHouseSettingsSchema.parse(rawSettings ?? {}));
  const takeoff = computeTakeoff(spec);
  const estimate = studioEstimate(takeoff, settings);
  const lines: StudioEstimateLine[] = estimate.systems.map((s) => ({
    systemId: s.def.id,
    label: s.def.label,
    phase: s.def.phase,
    amountMinor: s.amount * 100,
    keyQty: s.keyQty,
    note: s.note,
  }));
  return {
    spec,
    settings,
    lines,
    totalMinor: estimate.total * 100,
    areaSqFt: estimate.areaSqFt,
    perSqFtMinor: estimate.perSqFt * 100,
    takeoffSummary: {
      slabAreaSqFt: takeoff.summary.slabAreaSqFt,
      concreteYd3: takeoff.summary.concreteYd3,
      roofSquares: takeoff.summary.roofSquares,
      windows: takeoff.summary.windows,
      exteriorDoors: takeoff.summary.exteriorDoors,
      interiorDoors: takeoff.summary.interiorDoors,
    },
  };
}

/** The estimate_revisions payload for one snapshot (insert-only, like every revision). */
export function studioRevisionData(c: StudioEstimateComputation) {
  return {
    status: 'review_required' as const,
    priceBookRevisionId: null,
    inputs: {
      spec: c.spec,
      settings: c.settings,
      takeoffSummary: c.takeoffSummary,
      areaSqFt: c.areaSqFt,
      perSqFtMinor: c.perSqFtMinor,
      basis: STUDIO_ESTIMATE_BASIS,
    },
    scenarios: { base: { totalMinor: c.totalMinor } },
    lines: c.lines,
    currency: 'USD',
    subtotalMinor: c.totalMinor,
    taxMinor: 0,
    totalMinor: c.totalMinor,
    lowTotalMinor: c.totalMinor,
    highTotalMinor: c.totalMinor,
    engineVersion: STUDIO_ESTIMATE_ENGINE,
    gatingResult: {
      blockers: [],
      warnings: [STUDIO_ESTIMATE_BASIS],
      quoteKind: 'budgetary_range',
    },
    quoteKind: 'budgetary_range' as const,
    isBinding: false,
    assumptions: [
      STUDIO_ESTIMATE_BASIS,
      `Escalation ${c.settings.escalationPercent}% over the 2024 survey; regional factor ${c.settings.regionalFactor}.`,
    ],
  };
}

/**
 * Budget lines for job-cost seeding from a studio estimate: one line per system, cost
 * code = system id. Zero-amount systems are skipped and counted (never given an amount).
 */
export function studioBudgetLines(c: StudioEstimateComputation): {
  lines: { costCode: string; label: string; budgetMinor: number }[];
  skipped: number;
} {
  const lines: { costCode: string; label: string; budgetMinor: number }[] = [];
  let skipped = 0;
  for (const line of c.lines) {
    if (line.amountMinor <= 0) {
      skipped += 1;
      continue;
    }
    lines.push({ costCode: line.systemId, label: line.label, budgetMinor: line.amountMinor });
  }
  return { lines, skipped };
}

/** Per-company, per-year estimate number (same advisory-lock pattern as the roof flow). */
export async function nextEstimateNumber(tx: Tx, orgId: string): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`estimates:${orgId}`}))`);
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(estimates)
    .where(eq(estimates.orgId, orgId));
  return `EST-${new Date().getFullYear()}-${String((row?.count ?? 0) + 1).padStart(4, '0')}`;
}
