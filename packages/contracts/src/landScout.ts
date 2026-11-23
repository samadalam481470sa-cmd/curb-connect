// Land Scout: the buy-box land engine. A plain-English or form buy box is matched against
// Texas county appraisal-district parcel data (Collin CAD live, Dallas CAD via City of Dallas
// GIS), scored 0-100 (appraisal use 30, size 25, infrastructure 25, price 20) and ranked.
// Every value carries its source; unknown data stays null and is excluded from scoring —
// never guessed, never silently zero.
import { z } from 'zod';

export const LandUseTypeSchema = z.enum([
  'industrial',
  'warehouse',
  'data_center',
  'multifamily',
  'self_storage',
  'single_family',
  'any',
]);
export type LandUseType = z.infer<typeof LandUseTypeSchema>;

export const LAND_USE_LABELS: Record<LandUseType, string> = {
  industrial: 'Industrial',
  warehouse: 'Warehouse / distribution',
  data_center: 'Data center',
  multifamily: 'Multifamily',
  self_storage: 'Self-storage',
  single_family: 'Single-family development',
  any: 'Any use',
};

export const LandCountySchema = z.enum(['collin', 'dallas']);
export type LandCounty = z.infer<typeof LandCountySchema>;

export const LAND_COUNTY_LABELS: Record<LandCounty, string> = {
  collin: 'Collin County',
  dallas: 'Dallas County',
};

/** The structured buy box. The Qwen parser produces exactly this shape for user review. */
export const BuyBoxSchema = z.object({
  useType: LandUseTypeSchema.default('any'),
  acresMin: z.number().min(0).max(100_000).nullable().default(null),
  acresMax: z.number().min(0).max(100_000).nullable().default(null),
  /** Free-text zoning wish, matched against the appraisal use/class text (not city zoning). */
  zoning: z.string().trim().max(120).nullable().default(null),
  maxHighwayMiles: z.number().min(0).max(100).nullable().default(null),
  needsPower: z.boolean().default(false),
  needsWater: z.boolean().default(false),
  needsSewer: z.boolean().default(false),
  counties: z.array(LandCountySchema).min(1).max(2).default(['collin', 'dallas']),
  maxPricePerAcre: z.number().min(0).max(100_000_000).nullable().default(null),
});
export type BuyBox = z.infer<typeof BuyBoxSchema>;

export const LandParcelSchema = z.object({
  county: LandCountySchema,
  /** County appraisal account / property id, exactly as published. */
  parcelId: z.string(),
  ownerName: z.string().nullable(),
  ownerMailing: z.string().nullable(),
  situsAddress: z.string().nullable(),
  city: z.string().nullable(),
  zip: z.string().nullable(),
  acres: z.number().nullable(),
  /** Appraisal use/class as published by the CAD (not municipal zoning). */
  appraisalUse: z.string().nullable(),
  /** CAD land value in dollars when published; null when the source carries no value. */
  landValue: z.number().nullable(),
  marketValue: z.number().nullable(),
  valueYear: z.number().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  highwayMiles: z.number().nullable(),
  highwayName: z.string().nullable(),
  substationMiles: z.number().nullable(),
  substationName: z.string().nullable(),
  substationKv: z.number().nullable(),
  /** Data vintage as published (e.g. appraisal year, data date); null when unpublished. */
  vintage: z.string().nullable(),
  source: z.string(),
  sourceUrl: z.string(),
  /** 'live' = queried from the CAD service; 'import' = company-imported CSV row. */
  origin: z.enum(['live', 'import']),
});
export type LandParcel = z.infer<typeof LandParcelSchema>;

export const ScoreFactorSchema = z.object({
  /** 0-100, or null when the underlying data is unknown (excluded, never zero-filled). */
  score: z.number().min(0).max(100).nullable(),
  weight: z.number().min(0).max(1),
  detail: z.string(),
});
export type ScoreFactor = z.infer<typeof ScoreFactorSchema>;

export const LandScoreSchema = z.object({
  /** Weighted total over the known factors, renormalized; null when nothing could be scored. */
  total: z.number().min(0).max(100).nullable(),
  /** How many of the four factors had data. */
  factorsKnown: z.number().int().min(0).max(4),
  use: ScoreFactorSchema,
  size: ScoreFactorSchema,
  infrastructure: ScoreFactorSchema,
  price: ScoreFactorSchema,
});
export type LandScore = z.infer<typeof LandScoreSchema>;

export const RankedParcelSchema = z.object({
  parcel: LandParcelSchema,
  score: LandScoreSchema,
});
export type RankedParcel = z.infer<typeof RankedParcelSchema>;

export const LandSearchRequestSchema = z.object({
  buyBox: BuyBoxSchema,
  /** Ranked results to return (top N). */
  limit: z.number().int().min(1).max(50).default(20),
});
export type LandSearchRequest = z.infer<typeof LandSearchRequestSchema>;

export const LandSourceStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['ok', 'unavailable', 'stale']),
  detail: z.string(),
  url: z.string(),
});
export type LandSourceStatus = z.infer<typeof LandSourceStatusSchema>;

export const LandSearchResponseSchema = z.object({
  results: z.array(RankedParcelSchema),
  candidatesConsidered: z.number().int().min(0),
  sources: z.array(LandSourceStatusSchema),
  searchedAt: z.string(),
});
export type LandSearchResponse = z.infer<typeof LandSearchResponseSchema>;

export const LandScoutStatusSchema = z.object({
  aiParsing: z.boolean(),
  aiDetail: z.string(),
  sources: z.array(LandSourceStatusSchema),
});
export type LandScoutStatus = z.infer<typeof LandScoutStatusSchema>;

export const LandParseRequestSchema = z.object({
  text: z.string().trim().min(3).max(1000),
});
export type LandParseRequest = z.infer<typeof LandParseRequestSchema>;

export const LandParseResponseSchema = z.object({
  buyBox: BuyBoxSchema,
  model: z.string(),
  source: z.enum(['home', 'open']),
  /** Fields the model could not determine — left at defaults for the user to fill in. */
  notes: z.string(),
});
export type LandParseResponse = z.infer<typeof LandParseResponseSchema>;

export const SavedBuyBoxSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  buyBox: BuyBoxSchema,
  createdAt: z.string(),
});
export type SavedBuyBox = z.infer<typeof SavedBuyBoxSchema>;

export const SaveBuyBoxRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  buyBox: BuyBoxSchema,
});
export type SaveBuyBoxRequest = z.infer<typeof SaveBuyBoxRequestSchema>;

export const LandImportRequestSchema = z.object({
  county: LandCountySchema,
  /** CSV text with a header row; columns matched by name (see the import help in the UI). */
  csv: z.string().min(1).max(2_000_000),
});
export type LandImportRequest = z.infer<typeof LandImportRequestSchema>;

export const LandImportResponseSchema = z.object({
  imported: z.number().int().min(0),
  skipped: z.number().int().min(0),
  errors: z.array(z.string()).max(20),
});
export type LandImportResponse = z.infer<typeof LandImportResponseSchema>;

export const LandReportSchema = z.object({
  parcel: LandParcelSchema,
  score: LandScoreSchema,
  floodZone: z.string().nullable(),
  floodSpecialHazard: z.boolean().nullable(),
  floodSource: z.string().nullable(),
  terrainSummary: z.string().nullable(),
  terrainSource: z.string().nullable(),
  redFlags: z.array(z.string()),
  ownerIsEntity: z.boolean(),
  /** Texas Secretary of State business search guidance for entity owners. */
  sosLookupUrl: z.string(),
  generatedAt: z.string(),
});
export type LandReport = z.infer<typeof LandReportSchema>;
