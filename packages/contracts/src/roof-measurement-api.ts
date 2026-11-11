// Roof measurement API contracts (blueprint "Roof analysis API", MANUAL source path; RF-023/025/027,
// RR-034/035/037). A contractor traces roof planes on imagery as lon/lat rings; the API projects
// them to the local tangent plane, measures every area itself, stores versioned geometry and turns
// an approved measurement into a priced estimate. The client sends rings, pitches and prices,
// never areas or totals: anything derived is recomputed on the server.
import { z } from 'zod';
import { UuidSchema } from './common';
import {
  EstimateStatusSchema,
  QuoteKindSchema,
  RoofOrderStatusSchema,
  RoofReportVersionStatusSchema,
} from './enums';

const Key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const TracePointSchema = z.object({
  lon: z.number().finite().min(-180).max(180),
  lat: z.number().finite().min(-90).max(90),
});
export type TracePoint = z.infer<typeof TracePointSchema>;

/** Rise per 12 of run; null = not yet established (sloped area stays unknown). */
export const PitchRiseSchema = z.number().finite().min(0).max(24).nullable();

export const TracedFacetInputSchema = z
  .object({
    key: Key,
    label: z.string().trim().max(80).optional(),
    /** Outer ring, not closed (first != last), in either winding; 3..200 corners. */
    ring: z.array(TracePointSchema).min(3).max(200),
    pitchRise: PitchRiseSchema,
  })
  .strict();
export type TracedFacetInput = z.infer<typeof TracedFacetInputSchema>;

const Facets = z
  .array(TracedFacetInputSchema)
  .min(1)
  .max(60)
  .refine((list) => new Set(list.map((f) => f.key)).size === list.length, {
    message: 'facet keys must be unique',
  });

export const CreateRoofMeasurementRequestSchema = z
  .object({
    /** Job address exactly as entered. */
    address: z.string().trim().min(3).max(300),
    facets: Facets,
    note: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CreateRoofMeasurementRequest = z.infer<typeof CreateRoofMeasurementRequestSchema>;

export const ReviseRoofMeasurementRequestSchema = z
  .object({
    /** Optimistic concurrency: the version number the edit was made against. */
    baseVersionNumber: z.number().int().min(1),
    facets: Facets,
    note: z.string().trim().max(2000).optional(),
  })
  .strict();
export type ReviseRoofMeasurementRequest = z.infer<typeof ReviseRoofMeasurementRequestSchema>;

export const MeasuredFacetSchema = z.object({
  key: Key,
  label: z.string().nullable(),
  ring: z.array(TracePointSchema),
  pitchRise: PitchRiseSchema,
  planSqFt: z.number(),
  /** null while pitch is unknown. */
  slopedSqFt: z.number().nullable(),
  perimeterFt: z.number(),
  needsReview: z.boolean(),
});
export type MeasuredFacet = z.infer<typeof MeasuredFacetSchema>;

export const RoofMeasurementTotalsViewSchema = z.object({
  planSqFt: z.number(),
  /** null until every facet has a pitch: no partial sloped total is presented as complete. */
  slopedSqFt: z.number().nullable(),
  squares: z.number().nullable(),
  facetsMissingPitch: z.array(z.string()),
  complete: z.boolean(),
});

export const RoofMeasurementVersionSchema = z.object({
  id: UuidSchema,
  versionNumber: z.number().int(),
  status: RoofReportVersionStatusSchema,
  facets: z.array(MeasuredFacetSchema),
  totals: RoofMeasurementTotalsViewSchema,
  /** Always 'user_entered' here: traced by the contractor on imagery, not a survey. */
  source: z.literal('user_entered'),
  warnings: z.array(z.string()),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
});
export type RoofMeasurementVersion = z.infer<typeof RoofMeasurementVersionSchema>;

export const RoofMeasurementSummarySchema = z.object({
  id: UuidSchema,
  number: z.string(),
  status: RoofOrderStatusSchema,
  address: z.string(),
  versionNumber: z.number().int(),
  versionStatus: RoofReportVersionStatusSchema,
  planSqFt: z.number(),
  squares: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RoofMeasurementSummary = z.infer<typeof RoofMeasurementSummarySchema>;

export const RoofMeasurementListSchema = z.object({ items: z.array(RoofMeasurementSummarySchema) });

export const RoofMeasurementDetailSchema = RoofMeasurementSummarySchema.extend({
  propertyId: UuidSchema,
  version: RoofMeasurementVersionSchema,
});
export type RoofMeasurementDetail = z.infer<typeof RoofMeasurementDetailSchema>;

const MinorPrice = z.number().int().min(0).max(100_000_000);
const Percent = (max: number) => z.number().finite().min(0).max(max);

/**
 * Prices are the contractor's own, per purchase unit, in integer cents. They are recorded as an
 * approved price book revision so the estimate can always be reproduced from what it priced.
 */
export const CreateRoofEstimateRequestSchema = z
  .object({
    wastePercent: Percent(40),
    wasteReason: z.string().trim().min(1).max(200),
    redeck: z.boolean().default(false),
    prices: z
      .object({
        shingleBundleMinor: MinorPrice,
        underlaymentRollMinor: MinorPrice,
        deckSheetMinor: MinorPrice.nullable().default(null),
      })
      .strict(),
    /** Optional install labor per roofing square (sloped, no waste). null = materials only. */
    laborPerSquareMinor: MinorPrice.nullable().default(null),
    overheadPercent: Percent(100).default(0),
    marginPercent: Percent(90).default(0),
    taxPercent: Percent(25).default(0),
    /** Where the prices came from, e.g. "Home Depot listing 2026-11-10". */
    priceSource: z.string().trim().min(1).max(200),
  })
  .strict();
export type CreateRoofEstimateRequest = z.input<typeof CreateRoofEstimateRequestSchema>;

export const RoofEstimateLineSchema = z.object({
  code: z.string(),
  description: z.string(),
  category: z.string(),
  status: z.enum(['priced', 'unresolved']),
  quantity: z.string().nullable(),
  unit: z.string(),
  unitRate: z.string().nullable(),
  extendedMinor: z.number().int().nullable(),
  formula: z.string(),
});

export const RoofEstimateRecordSchema = z.object({
  id: UuidSchema,
  number: z.string(),
  measurementId: UuidSchema,
  status: EstimateStatusSchema,
  revisionNumber: z.number().int(),
  quoteKind: QuoteKindSchema,
  isBinding: z.boolean(),
  currency: z.string(),
  subtotalMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  lines: z.array(RoofEstimateLineSchema),
  /** Measurement version the estimate priced (frozen; a later edit needs a new estimate). */
  measurementVersionNumber: z.number().int(),
  warnings: z.array(z.string()),
  engineVersion: z.string(),
  createdAt: z.string(),
});
export type RoofEstimateRecord = z.infer<typeof RoofEstimateRecordSchema>;

export const RoofEstimateListSchema = z.object({ items: z.array(RoofEstimateRecordSchema) });
