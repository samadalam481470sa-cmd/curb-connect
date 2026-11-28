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
  /** The community this project was converted into, once converted (null until then). */
  communityId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedLandFeasibilityProject = z.infer<typeof SavedLandFeasibilityProjectSchema>;

export const LandFeasibilityProjectListSchema = z.object({
  items: z.array(SavedLandFeasibilityProjectSchema),
});
export type LandFeasibilityProjectList = z.infer<typeof LandFeasibilityProjectListSchema>;

// ---------------------------------------------------------------- create community from project

/**
 * Optional client-computed lot layout for conversion: the subdivision plan + phase split
 * the web app computed for this run (planSubdivision / assignPhases). Like the summary it
 * is stored/used verbatim and labeled client-computed — the server never recomputes a lot
 * layout. When omitted, conversion creates the community and lots 1..lotCount from the
 * stored summary (no dimensions, no phases — the builder adds those in Land Management).
 */
export const FeasibilityLayoutSchema = z.object({
  lots: z
    .array(
      z.object({
        number: z.number().int().min(1).max(100_000),
        widthFt: z.number().min(0).max(100_000).nullable().optional(),
        depthFt: z.number().min(0).max(100_000).nullable().optional(),
      }),
    )
    .min(1)
    .max(2_000),
  phases: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        lotNumbers: z.array(z.number().int().min(1).max(100_000)).max(2_000),
      }),
    )
    .max(50)
    .optional(),
});
export type FeasibilityLayout = z.infer<typeof FeasibilityLayoutSchema>;

export const CreateCommunityFromFeasibilityRequestSchema = z.object({
  layout: FeasibilityLayoutSchema.nullable().optional(),
  /** Community name override; defaults to the project name. */
  name: z.string().trim().min(1).max(200).nullable().optional(),
});
export type CreateCommunityFromFeasibilityRequest = z.infer<
  typeof CreateCommunityFromFeasibilityRequestSchema
>;

export const CreateCommunityFromFeasibilityResponseSchema = z.object({
  projectId: z.uuid(),
  communityId: z.uuid(),
  communityName: z.string(),
  /** False when the project was already converted (idempotent return). */
  created: z.boolean(),
  phasesCreated: z.number().int(),
  lotsCreated: z.number().int(),
  /** Where the lots came from: the supplied layout, the stored lot count, or none. */
  lotSource: z.enum(['layout', 'summary_lot_count', 'none']),
  note: z.string(),
});
export type CreateCommunityFromFeasibilityResponse = z.infer<
  typeof CreateCommunityFromFeasibilityResponseSchema
>;

// ---------------------------------------------------------------- concept site plan PDF

/** A rectangle in parcel feet: x along the street frontage, z back from the street edge. */
export const ConceptPlanRectSchema = z.object({
  x0: z.number().min(-100_000).max(100_000),
  x1: z.number().min(-100_000).max(100_000),
  z0: z.number().min(-100_000).max(100_000),
  z1: z.number().min(-100_000).max(100_000),
});
export type ConceptPlanRect = z.infer<typeof ConceptPlanRectSchema>;

/**
 * Request to render a "Concept for Discussion" site-plan sheet from the current feasibility
 * run. Like the saved-project summary, every figure is CLIENT-COMPUTED: the lot plan and
 * underwriting run in the web app, and the server renders them verbatim into the PDF — it
 * never recomputes or invents a lot count, price or profit.
 */
export const ConceptPlanRequestSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(1).max(120),
  parcelWidthFt: z.number().min(1).max(10_000),
  parcelDepthFt: z.number().min(1).max(10_000),
  acres: z.number().min(0).max(1_000_000),
  road: ConceptPlanRectSchema.nullable(),
  lots: z
    .array(
      z.object({
        number: z.number().int().min(1).max(100_000),
        rect: ConceptPlanRectSchema,
        areaSqft: z.number().min(0).max(1_000_000_000),
        home: ConceptPlanRectSchema.nullable(),
        passes: z.boolean(),
        hasIssues: z.boolean(),
      }),
    )
    .max(2_000),
  homeFootprint: z
    .object({ widthFt: z.number().min(1).max(1_000), depthFt: z.number().min(1).max(1_000) })
    .nullable(),
  exitPlanLabel: z.string().trim().min(1).max(120),
  /** Underwriting summary lines, pre-formatted by the client. */
  summaryLines: z
    .array(z.object({ label: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(80) }))
    .max(40),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(20),
});
export type ConceptPlanRequest = z.infer<typeof ConceptPlanRequestSchema>;

export const ConceptPlanResponseSchema = z.object({
  filename: z.string(),
  contentBase64: z.string(),
  sha256Hex: z.string(),
  pages: z.number().int().positive(),
});
export type ConceptPlanResponse = z.infer<typeof ConceptPlanResponseSchema>;
