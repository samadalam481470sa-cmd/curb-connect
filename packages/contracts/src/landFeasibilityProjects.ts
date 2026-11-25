// Saved land-feasibility projects: a named snapshot of one feasibility run (the inputs the
// builder entered plus the computed summary) so the builder can flip between saved projects
// instead of re-entering a parcel. The summary is CLIENT-COMPUTED: runFeasibility lives in
// the web app (apps/web/src/features/build/siteFeasibility.ts) and the API cannot import it,
// so the server stores the summary exactly as the client sends it and labels it
// 'client-computed' — it never recomputes or invents profit, acres or lot counts. The inputs
// snapshot is the same shape the web app feeds runFeasibility, so loading a project restores
// the run exactly (re-running it locally recomputes the numbers from those inputs).
import { z } from 'zod';

export const LandFeasibilityCostLineSchema = z.object({
  id: z.enum([
    'clearing',
    'earthwork',
    'road',
    'mainLine',
    'services',
    'retaining',
    'permits',
    'engineering',
    'contingency',
  ]),
  label: z.string().min(1).max(120),
  unit: z.enum(['acre', 'cy', 'lf', 'lot', 'pct']),
  unitCost: z.number().min(0).max(1_000_000_000),
  source: z.string().max(500),
});
export type LandFeasibilityCostLine = z.infer<typeof LandFeasibilityCostLineSchema>;

/** Snapshot of the inputs to one feasibility run, as entered by the builder. */
export const LandFeasibilityInputsSchema = z.object({
  parcel: z.object({
    widthFt: z.number().min(1).max(10_000),
    depthFt: z.number().min(1).max(10_000),
  }),
  rules: z.object({
    minLotSqft: z.number().min(1).max(1_000_000),
    minLotWidthFt: z.number().min(1).max(10_000),
    frontSetbackFt: z.number().min(0).max(1_000),
    sideSetbackFt: z.number().min(0).max(1_000),
    rearSetbackFt: z.number().min(0).max(1_000),
    maxBuildSlopePct: z.number().min(0).max(100),
    maxCoveragePct: z.number().min(0).max(100),
    roadWidthFt: z.number().min(0).max(1_000),
    source: z.string().max(500),
  }),
  terrain: z.object({
    grid: z.array(z.array(z.number().nullable()).max(7)).max(7),
    source: z.string().max(500),
  }),
  treeCoverPct: z.number().min(0).max(100),
  flood: z
    .object({ zone: z.string().max(20), specialHazard: z.boolean() })
    .nullable(),
  home: z.object({
    widthFt: z.number().min(1).max(1_000),
    depthFt: z.number().min(1).max(1_000),
    buildCost: z.number().min(0).max(1_000_000_000),
  }),
  landPrice: z.number().min(0).max(1_000_000_000),
  costs: z.array(LandFeasibilityCostLineSchema).min(1).max(50),
  /** Contractor-entered sewer depth; absent (or blank/0) means no depth effect. */
  sewerDepth: z
    .object({
      depthFt: z.number().min(0).max(1_000),
      extraCostPerFtPerLf: z.number().min(0).max(1_000_000),
    })
    .optional(),
  layout: z.enum(['auto', 'street_front', 'new_road']),
  plan: z.enum(['sell_pads', 'build_sell', 'build_hold']),
  revenue: z.object({
    padPrice: z.number().min(0).max(1_000_000_000),
    homePrice: z.number().min(0).max(1_000_000_000),
    monthlyRent: z.number().min(0).max(1_000_000),
    rentExpensePct: z.number().min(0).max(100),
    capRatePct: z.number().min(0).max(100),
    sellingCostPct: z.number().min(0).max(100),
  }),
  timeline: z.object({
    approvalMonths: z.number().min(0).max(120),
    siteWorkMonths: z.number().min(0).max(120),
    buildMonths: z.number().min(0).max(120),
    absorptionPerMonth: z.number().min(0).max(1_000),
    interestPct: z.number().min(0).max(100),
  }),
});
export type LandFeasibilityInputs = z.infer<typeof LandFeasibilityInputsSchema>;

/**
 * Computed summary of the run, as calculated by the client at save time. Stored verbatim;
 * the server does not recompute it (see the note at the top of this file).
 */
export const LandFeasibilitySummarySchema = z.object({
  acres: z.number().min(0).max(1_000_000),
  lotCount: z.number().int().min(0).max(100_000),
  profit: z.number().min(-1_000_000_000_000).max(1_000_000_000_000),
});
export type LandFeasibilitySummary = z.infer<typeof LandFeasibilitySummarySchema>;

export const SaveLandFeasibilityProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  inputs: LandFeasibilityInputsSchema,
  summary: LandFeasibilitySummarySchema,
});
export type SaveLandFeasibilityProjectRequest = z.infer<
  typeof SaveLandFeasibilityProjectRequestSchema
>;

export const SavedLandFeasibilityProjectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  inputs: LandFeasibilityInputsSchema,
  summary: LandFeasibilitySummarySchema,
  /** The summary was computed by the client at save time; the server stores it verbatim. */
  summarySource: z.literal('client-computed'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedLandFeasibilityProject = z.infer<typeof SavedLandFeasibilityProjectSchema>;

export const LandFeasibilityProjectListSchema = z.object({
  items: z.array(SavedLandFeasibilityProjectSchema),
});
export type LandFeasibilityProjectList = z.infer<typeof LandFeasibilityProjectListSchema>;
