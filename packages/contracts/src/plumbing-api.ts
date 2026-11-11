// Plumbing Pro server contracts (ConstructionOS module 10). These schemas define the records the API
// persists: projects, calibrated plan versions, immutable design revisions, priced estimates and the
// approval that freezes one. Every record is tenant-owned; the API scopes reads and writes by org.
import { z } from 'zod';
import { UuidSchema } from './common';
import {
  FIXTURE_TYPES,
  FixtureLineSchema,
  PipeRunSchema,
  PIPE_MATERIALS,
  PLUMBING_SYSTEMS,
  NOMINAL_SIZES_MM,
} from './plumbing';

export const PlumbingProjectStatusSchema = z.enum(['draft', 'active', 'archived']);
export type PlumbingProjectStatus = z.infer<typeof PlumbingProjectStatusSchema>;

const Name = z.string().trim().min(1).max(200);
const OptionalNote = z.string().trim().max(2000).optional();

export const PlumbingProjectSchema = z.object({
  id: UuidSchema,
  name: Name,
  jurisdiction: z.string(),
  status: PlumbingProjectStatusSchema,
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlumbingProject = z.infer<typeof PlumbingProjectSchema>;

export const PlumbingProjectListSchema = z.object({
  items: z.array(PlumbingProjectSchema),
});

export const CreatePlumbingProjectRequestSchema = z
  .object({
    name: Name,
    jurisdiction: z.string().trim().max(120).default(''),
  })
  .strict();
export type CreatePlumbingProjectRequest = z.infer<typeof CreatePlumbingProjectRequestSchema>;

/**
 * PL-002 scale calibration. The user measures a known real-world distance in pixels on the plan;
 * the scale is that distance divided by the pixels. The API stores the inputs and the derived
 * scale so a later reviewer can re-check the arithmetic.
 */
export const CalibratePlanRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    pageNumber: z.number().int().min(1).max(500).default(1),
    /** Known real-world distance of the reference line. */
    referenceFeet: z.number().positive().max(10_000),
    /** Pixels measured for the same line, at the plan's native resolution. */
    measuredPixels: z.number().positive().max(1_000_000),
    note: OptionalNote,
  })
  .strict();
export type CalibratePlanRequest = z.infer<typeof CalibratePlanRequestSchema>;

export interface PlanScale {
  feetPerPixel: number;
  pixelsPerFoot: number;
}

/** Pure calibration arithmetic; throws (rather than dividing by zero) for non-positive pixels. */
export function planScale(input: { referenceFeet: number; measuredPixels: number }): PlanScale {
  if (!(input.measuredPixels > 0)) throw new Error('Calibration needs a positive pixel distance.');
  if (!(input.referenceFeet > 0)) throw new Error('Calibration needs a positive reference distance.');
  const feetPerPixel = input.referenceFeet / input.measuredPixels;
  return { feetPerPixel, pixelsPerFoot: 1 / feetPerPixel };
}

export const PlanVersionSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  filename: z.string(),
  pageNumber: z.number().int(),
  referenceFeet: z.number(),
  measuredPixels: z.number(),
  feetPerPixel: z.number(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type PlanVersion = z.infer<typeof PlanVersionSchema>;

/** The design payload of a revision. Immutable once written. */
export const PlumbingDesignSchema = z
  .object({
    fixtures: z.array(FixtureLineSchema).max(500),
    runs: z.array(PipeRunSchema).max(500),
  })
  .strict();
export type PlumbingDesign = z.infer<typeof PlumbingDesignSchema>;

export const CreateRevisionRequestSchema = z
  .object({
    note: OptionalNote,
    design: PlumbingDesignSchema,
  })
  .strict();
export type CreateRevisionRequest = z.infer<typeof CreateRevisionRequestSchema>;

export const PlumbingRevisionSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  revisionNumber: z.number().int(),
  fixtures: z.array(FixtureLineSchema),
  runs: z.array(PipeRunSchema),
  note: z.string().nullable(),
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PlumbingRevision = z.infer<typeof PlumbingRevisionSchema>;

export const EstimateTotalsSchema = z.object({
  materialMinor: z.number().int(),
  laborMinor: z.number().int(),
  equipmentMinor: z.number().int(),
  contingencyMinor: z.number().int(),
  overheadMinor: z.number().int(),
  markupMinor: z.number().int(),
  subtotalMinor: z.number().int(),
  preTaxMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
});

export const ComputeEstimateRequestSchema = z
  .object({
    revisionId: UuidSchema,
    prices: z.record(z.string().max(200), z.number().int().min(0)).default({}),
    laborRateMinorPerHour: z.number().int().min(0),
    equipmentMinor: z.number().int().min(0).default(0),
    contingencyPercent: z.number().min(0).max(50).default(5),
    overheadPercent: z.number().min(0).max(50).default(10),
    markupPercent: z.number().min(0).max(100).default(15),
    taxPercent: z.number().min(0).max(30).default(0),
  })
  .strict();
export type ComputeEstimateRequest = z.infer<typeof ComputeEstimateRequestSchema>;

export const PlumbingEstimateStatusSchema = z.enum(['draft', 'approved', 'superseded']);

export const PlumbingEstimateRecordSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  revisionId: UuidSchema,
  revisionNumber: z.number().int(),
  status: PlumbingEstimateStatusSchema,
  totals: EstimateTotalsSchema,
  laborHours: z.number(),
  materialMinor: z.number().int(),
  unpricedLineKeys: z.array(z.string()),
  prices: z.record(z.string(), z.number().int()),
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PlumbingEstimateRecord = z.infer<typeof PlumbingEstimateRecordSchema>;

export const PlumbingEstimateRecordListSchema = z.object({
  items: z.array(PlumbingEstimateRecordSchema),
});

export const PlumbingProjectDetailSchema = z.object({
  project: PlumbingProjectSchema,
  plans: z.array(PlanVersionSchema),
  revisions: z.array(PlumbingRevisionSchema),
  estimates: z.array(PlumbingEstimateRecordSchema),
});
export type PlumbingProjectDetail = z.infer<typeof PlumbingProjectDetailSchema>;

/** Exported for documentation and client-side catalogs; the API validates with the same lists. */
export const PLUMBING_CATALOG_INPUTS = {
  systems: PLUMBING_SYSTEMS,
  materials: PIPE_MATERIALS,
  fixtureTypes: FIXTURE_TYPES,
  nominalSizesMm: NOMINAL_SIZES_MM,
} as const;
