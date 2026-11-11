// Roof Intelligence Engine: provider-independent imagery selection, explicit abstention, facet
// measurement and revision immutability (RF-021..RF-030, RR-031..RR-040, AIQ-081..AIQ-090).
//
// Pure by design: no network, no database, no clock. Callers pass `asOf` so ranking and licence
// checks are deterministic and testable. Nothing here invents geometry, pitch, prices or capture
// dates; when the evidence is insufficient the result is `abstained` or uncertified.
//
// Imagery rights are enforced before scoring: the licensing register treats standard web-map
// imagery (Google map tiles, Esri basemaps) as visualization-only, so those providers are never
// eligible for machine analysis until legal signs off (docs/product/licensing-register.md).
import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema } from './common';
import { MeasurementSourceSchema } from './enums';

export const ROOF_ANALYSIS_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------- imagery providers and rights

/**
 * Providers the engine can consider. `google_map_tiles` and `esri_world_imagery` are deliberately
 * absent: they are visualization-only in the licensing register, not analysis sources.
 */
export const ANALYSIS_IMAGERY_PROVIDERS = [
  'fixture',
  'contractor_upload',
  'analysis_licensed_aerial',
  'google_solar',
  'naip',
  'local_gis',
  'lidar',
] as const;
export const AnalysisImageryProviderSchema = z.enum(ANALYSIS_IMAGERY_PROVIDERS);
export type AnalysisImageryProvider = z.infer<typeof AnalysisImageryProviderSchema>;

/**
 * Rights recorded per asset. `analysisAllowed` and `derivativesAllowed` must both be true before a
 * pixel may enter the measurement pipeline; a licence that only permits viewing never qualifies.
 */
export const RoofImageryRightsSchema = z.object({
  commercialUse: z.boolean(),
  analysisAllowed: z.boolean(),
  storageAllowed: z.boolean(),
  derivativesAllowed: z.boolean(),
  exportAllowed: z.boolean(),
  /** null = no automatic expiry recorded on the asset. */
  retentionDays: z.number().int().positive().nullable(),
});
export type RoofImageryRights = z.infer<typeof RoofImageryRightsSchema>;

export const IMAGERY_QUALITIES = ['high', 'medium', 'base', 'unknown'] as const;
export const ImageryQualitySchema = z.enum(IMAGERY_QUALITIES);
export type ImageryQuality = z.infer<typeof ImageryQualitySchema>;

export const IMAGERY_PERSPECTIVES = ['nadir', 'oblique', 'unknown'] as const;
export const ImageryPerspectiveSchema = z.enum(IMAGERY_PERSPECTIVES);
export type ImageryPerspective = z.infer<typeof ImageryPerspectiveSchema>;

/** One candidate image, with the metadata the ranking needs. Missing values stay null, not zero. */
export const RoofImageryCandidateSchema = z.object({
  id: z.string().min(1).max(128),
  provider: AnalysisImageryProviderSchema,
  /** Provider asset id or object key; never a credential. */
  sourceReference: z.string().min(1).max(500),
  captureDate: IsoDateSchema.nullable(),
  processingDate: IsoDateSchema.nullable().default(null),
  /** Ground sample distance in metres per pixel; null when the provider does not report it. */
  gsdM: z.number().positive().max(100).nullable(),
  quality: ImageryQualitySchema.default('unknown'),
  perspective: ImageryPerspectiveSchema.default('unknown'),
  orthorectified: z.boolean(),
  /** 0–100 from the image-quality worker; null when it has not run. */
  sharpnessScore: z.number().min(0).max(100).nullable().default(null),
  roofVisibilityPct: z.number().min(0).max(100),
  shadowPct: z.number().min(0).max(100).default(0),
  /** Confidence that the image is geographically calibrated (0–100). */
  georefConfidence: z.number().min(0).max(100),
  /** Confidence that the image shows the selected building (0–100). */
  buildingMatchConfidence: z.number().min(0).max(100),
  rights: RoofImageryRightsSchema,
  attribution: z.string().min(1).max(500),
  retentionExpiresAt: IsoDateTimeSchema.nullable().default(null),
  warnings: z.array(z.string().max(300)).default([]),
});
export type RoofImageryCandidate = z.infer<typeof RoofImageryCandidateSchema>;

// ---------------------------------------------------------------- eligibility and ranking

/** Coarser than this, an edge cannot be measured reliably (60 cm per pixel). */
export const MAX_ANALYSIS_GSD_M = 0.6;
export const MIN_BUILDING_MATCH_CONFIDENCE = 60;
export const MIN_SHARPNESS_SCORE = 40;

export const IMAGERY_ELIGIBILITY_REASONS = [
  'analysis_rights_missing',
  'derivative_rights_missing',
  'rights_expired',
  'resolution_unknown',
  'resolution_too_coarse',
  'image_too_soft',
  'building_match_unconfirmed',
] as const;
export const ImageryEligibilityReasonSchema = z.enum(IMAGERY_ELIGIBILITY_REASONS);
export type ImageryEligibilityReason = z.infer<typeof ImageryEligibilityReasonSchema>;

export interface ImageryEligibility {
  eligible: boolean;
  reasons: ImageryEligibilityReason[];
}

/** Hard gates. A candidate that fails any gate is never scored, selected or measured from. */
export function evaluateImageryEligibility(
  candidate: RoofImageryCandidate,
  asOf: Date,
): ImageryEligibility {
  const reasons: ImageryEligibilityReason[] = [];
  if (!candidate.rights.analysisAllowed) reasons.push('analysis_rights_missing');
  if (!candidate.rights.derivativesAllowed) reasons.push('derivative_rights_missing');
  if (
    candidate.retentionExpiresAt !== null &&
    Date.parse(candidate.retentionExpiresAt) <= asOf.getTime()
  ) {
    reasons.push('rights_expired');
  }
  if (candidate.gsdM === null) reasons.push('resolution_unknown');
  else if (candidate.gsdM > MAX_ANALYSIS_GSD_M) reasons.push('resolution_too_coarse');
  if (candidate.sharpnessScore !== null && candidate.sharpnessScore < MIN_SHARPNESS_SCORE) {
    reasons.push('image_too_soft');
  }
  if (candidate.buildingMatchConfidence < MIN_BUILDING_MATCH_CONFIDENCE) {
    reasons.push('building_match_unconfirmed');
  }
  return { eligible: reasons.length === 0, reasons };
}

/** Weights from the engine specification; normalised at scoring time so custom sets stay 0–100. */
export const IMAGERY_QUALITY_WEIGHTS = {
  resolution: 0.25,
  sharpness: 0.2,
  roofVisibility: 0.2,
  orthorectification: 0.15,
  recency: 0.1,
  metadataConfidence: 0.1,
} as const;
export type ImageryQualityWeights = Readonly<Record<keyof typeof IMAGERY_QUALITY_WEIGHTS, number>>;

function clamp100(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** 5 cm/px scores 100; 60 cm/px scores 0; linear in between. */
export function resolutionScore(gsdM: number | null): number {
  if (gsdM === null) return 0;
  if (gsdM <= 0.05) return 100;
  if (gsdM >= MAX_ANALYSIS_GSD_M) return 0;
  return clamp100((100 * (MAX_ANALYSIS_GSD_M - gsdM)) / (MAX_ANALYSIS_GSD_M - 0.05));
}

/** Exponential freshness with a two-year half-life; a missing date is neutral-low, never newest. */
export function recencyScore(captureDate: string | null, asOf: Date): number {
  if (captureDate === null) return 40;
  const captured = Date.parse(`${captureDate}T00:00:00Z`);
  if (!Number.isFinite(captured)) return 40;
  const ageDays = (asOf.getTime() - captured) / 86_400_000;
  if (ageDays <= 0) return 100;
  return clamp100(100 * 0.5 ** (ageDays / 730));
}

/**
 * Weighted quality score (0–100). Newer is not automatically better: resolution, sharpness, roof
 * visibility and orthorectification dominate, so an older clear image can outrank a new obstructed
 * one. Eligibility is a separate, authoritative gate.
 */
export function scoreImageryCandidate(
  candidate: RoofImageryCandidate,
  options: { asOf: Date; weights?: ImageryQualityWeights },
): number {
  const weights = options.weights ?? IMAGERY_QUALITY_WEIGHTS;
  const sharpness = candidate.sharpnessScore ?? 50;
  const orthorectification = candidate.orthorectified ? 100 : 30;
  const metadataConfidence = clamp100(
    (candidate.georefConfidence + candidate.buildingMatchConfidence) / 2,
  );
  const total =
    weights.resolution * resolutionScore(candidate.gsdM) +
    weights.sharpness * clamp100(sharpness) +
    weights.roofVisibility * clamp100(candidate.roofVisibilityPct) +
    weights.orthorectification * orthorectification +
    weights.recency * recencyScore(candidate.captureDate, options.asOf) +
    weights.metadataConfidence * metadataConfidence;
  const weightSum =
    weights.resolution +
    weights.sharpness +
    weights.roofVisibility +
    weights.orthorectification +
    weights.recency +
    weights.metadataConfidence;
  return weightSum <= 0 ? 0 : clamp100(total / weightSum);
}

export interface RankedImageryCandidate {
  candidate: RoofImageryCandidate;
  score: number;
  eligibility: ImageryEligibility;
}

export interface ImageryRanking {
  /** Eligible candidates only, best first. */
  ranked: RankedImageryCandidate[];
  selected: RankedImageryCandidate | null;
  excluded: { candidateId: string; reasons: ImageryEligibilityReason[] }[];
}

/**
 * Ranks every candidate instead of discarding alternatives, returns the best eligible one, and
 * lists why each excluded asset may not be analysed. Ties break by newer capture date, then id.
 */
export function rankImageryCandidates(
  candidates: readonly RoofImageryCandidate[],
  options: { asOf: Date; weights?: ImageryQualityWeights; limit?: number },
): ImageryRanking {
  const evaluated: RankedImageryCandidate[] = candidates.map((candidate) => ({
    candidate,
    score: scoreImageryCandidate(candidate, options),
    eligibility: evaluateImageryEligibility(candidate, options.asOf),
  }));
  const ranked = evaluated
    .filter((entry) => entry.eligibility.eligible)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDate = a.candidate.captureDate ?? '';
      const bDate = b.candidate.captureDate ?? '';
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return a.candidate.id.localeCompare(b.candidate.id);
    });
  const limited = options.limit === undefined ? ranked : ranked.slice(0, options.limit);
  const excluded = evaluated
    .filter((entry) => !entry.eligibility.eligible)
    .map((entry) => ({ candidateId: entry.candidate.id, reasons: entry.eligibility.reasons }));
  return { ranked: limited, selected: ranked[0] ?? null, excluded };
}

// ---------------------------------------------------------------- roof measurement

/** One measured facet; unknown pitch is null, never a guessed angle. */
export const RoofFacetMeasurementSchema = z.object({
  facetId: z.string().min(1).max(64),
  label: z.string().max(80).optional(),
  planAreaM2: z.number().finite().nonnegative(),
  /** Degrees from horizontal in [0, 90); null when pitch is not established by evidence. */
  pitchDeg: z.number().finite().min(0).lt(90).nullable(),
  pitchSource: MeasurementSourceSchema.nullable().default(null),
  confidence: z.number().min(0).max(100),
  needsReview: z.boolean().default(false),
});
export type RoofFacetMeasurement = z.infer<typeof RoofFacetMeasurementSchema>;

/** One roofing square = 100 sq ft = 9.290304 m² (exact). */
export const ROOFING_SQUARE_M2 = 9.290304;

/** True sloped area; null when the facet pitch is unknown (no pitch correction invented). */
export function slopedAreaM2(facet: RoofFacetMeasurement): number | null {
  if (facet.pitchDeg === null) return null;
  return facet.planAreaM2 / Math.cos((facet.pitchDeg * Math.PI) / 180);
}

export interface RoofMeasurementTotals {
  planAreaM2: number;
  /** null when any facet lacks a pitch: an uncertified sloped area is not presented as a total. */
  slopedAreaM2: number | null;
  roofingSquares: number | null;
  unresolvedFacetIds: string[];
  complete: boolean;
}

/** Sums facets; refuses to present a sloped total while any facet pitch is unknown. */
export function roofMeasurementTotals(
  facets: readonly RoofFacetMeasurement[],
): RoofMeasurementTotals {
  let planAreaM2 = 0;
  let sloped = 0;
  const unresolvedFacetIds: string[] = [];
  for (const facet of facets) {
    planAreaM2 += facet.planAreaM2;
    const area = slopedAreaM2(facet);
    if (area === null) unresolvedFacetIds.push(facet.facetId);
    else sloped += area;
  }
  const complete = unresolvedFacetIds.length === 0;
  return {
    planAreaM2,
    slopedAreaM2: complete ? sloped : null,
    roofingSquares: complete ? sloped / ROOFING_SQUARE_M2 : null,
    unresolvedFacetIds,
    complete,
  };
}

/** Conservative overall confidence: the weakest link, not an average that hides a bad input. */
export function overallConfidence(parts: {
  imagery: number;
  geometry: number;
  calibration: number;
  pitch: number;
  buildingMatch: number;
}): number {
  return Math.round(
    clamp100(
      Math.min(parts.imagery, parts.geometry, parts.calibration, parts.pitch, parts.buildingMatch),
    ),
  );
}

// ---------------------------------------------------------------- analysis outcome

export const ROOF_ANALYSIS_ABSTENTION_REASONS = [
  'model_not_registered',
  'building_not_confirmed',
  'no_eligible_imagery',
  'geometry_missing',
] as const;
export const RoofAnalysisAbstentionReasonSchema = z.enum(ROOF_ANALYSIS_ABSTENTION_REASONS);
export type RoofAnalysisAbstentionReason = z.infer<typeof RoofAnalysisAbstentionReasonSchema>;

export const RoofMeasurementTotalsSchema = z.object({
  planAreaM2: z.number().nonnegative(),
  slopedAreaM2: z.number().nonnegative().nullable(),
  roofingSquares: z.number().nonnegative().nullable(),
  unresolvedFacetIds: z.array(z.string()),
  complete: z.boolean(),
});

export const RoofAnalysisOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('measured'),
    selectedCandidateId: z.string(),
    facets: z.array(RoofFacetMeasurementSchema).min(1),
    totals: RoofMeasurementTotalsSchema,
    confidence: z.number().min(0).max(100),
    /** True only when geometry is complete and confidence clears the review threshold. */
    certified: z.boolean(),
    warnings: z.array(z.string()),
  }),
  z.object({
    outcome: z.literal('abstained'),
    reasons: z.array(RoofAnalysisAbstentionReasonSchema).min(1),
    warnings: z.array(z.string()),
  }),
]);
export type RoofAnalysisOutcome = z.infer<typeof RoofAnalysisOutcomeSchema>;

export interface AssessRoofAnalysisInput {
  candidates: readonly RoofImageryCandidate[];
  facets: readonly RoofFacetMeasurement[];
  asOf: Date;
  /** A validated, registered segmentation model must exist before any geometry is claimed. */
  modelRegistered: boolean;
  /** The contractor or reviewer must confirm the target building (never the nearest guess). */
  buildingConfirmed: boolean;
}

/**
 * Produces a measured result only when a model exists, the building is confirmed, an eligible
 * licensed image exists and geometry is present. Otherwise it abstains with explicit reasons; it
 * never substitutes a default roof shape, pitch or area.
 */
export function assessRoofAnalysis(input: AssessRoofAnalysisInput): RoofAnalysisOutcome {
  if (!input.modelRegistered) {
    return {
      outcome: 'abstained',
      reasons: ['model_not_registered'],
      warnings: [
        'No validated roof-segmentation model is registered, so no geometry was produced.',
      ],
    };
  }
  if (!input.buildingConfirmed) {
    return {
      outcome: 'abstained',
      reasons: ['building_not_confirmed'],
      warnings: ['Confirm the target building before running the analysis.'],
    };
  }
  const ranking = rankImageryCandidates(input.candidates, { asOf: input.asOf });
  if (ranking.selected === null) {
    const reasons = [...new Set(ranking.excluded.flatMap((entry) => entry.reasons))];
    return {
      outcome: 'abstained',
      reasons: ['no_eligible_imagery'],
      warnings:
        reasons.length === 0
          ? ['No imagery was supplied.']
          : reasons.map((reason) => `Imagery excluded: ${reason.replaceAll('_', ' ')}.`),
    };
  }
  if (input.facets.length === 0) {
    return {
      outcome: 'abstained',
      reasons: ['geometry_missing'],
      warnings: ['No roof geometry was produced for the confirmed building.'],
    };
  }

  const totals = roofMeasurementTotals(input.facets);
  const geometryConfidence =
    input.facets.reduce((sum, facet) => sum + facet.confidence, 0) / input.facets.length;
  const confidence = overallConfidence({
    imagery: ranking.selected.score,
    geometry: geometryConfidence,
    calibration: ranking.selected.candidate.georefConfidence,
    pitch: totals.complete ? geometryConfidence : 0,
    buildingMatch: ranking.selected.candidate.buildingMatchConfidence,
  });
  const warnings = [...ranking.selected.candidate.warnings];
  if (!totals.complete) {
    warnings.push(
      'One or more facets have unknown pitch; sloped area, roofing squares and material quantities are not certified.',
    );
  }

  return {
    outcome: 'measured',
    selectedCandidateId: ranking.selected.candidate.id,
    facets: [...input.facets],
    totals,
    confidence,
    certified: totals.complete && confidence >= 70,
    warnings,
  };
}

// ---------------------------------------------------------------- revision immutability

export const ROOF_MEASUREMENT_REVISION_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'superseded',
  'rejected',
] as const;
export const RoofMeasurementRevisionStatusSchema = z.enum(ROOF_MEASUREMENT_REVISION_STATUSES);
export type RoofMeasurementRevisionStatus = z.infer<typeof RoofMeasurementRevisionStatusSchema>;

/** A saved measurement revision. Approved and later states are immutable (RR-037). */
export const RoofMeasurementRevisionSchema = z.object({
  id: z.string().min(1).max(128),
  analysisJobId: z.string().min(1).max(128),
  revisionNumber: z.number().int().positive(),
  status: RoofMeasurementRevisionStatusSchema,
  geometryRevision: z.number().int().nonnegative(),
  totalSlopedAreaM2: z.number().nonnegative().nullable(),
  approvedAt: IsoDateTimeSchema.nullable(),
  approvedByUserId: z.string().min(1).max(128).nullable(),
});
export type RoofMeasurementRevision = z.infer<typeof RoofMeasurementRevisionSchema>;

export function isRoofRevisionEditable(revision: RoofMeasurementRevision): boolean {
  return revision.status === 'draft';
}

/** Throws for any non-draft revision: an edit must create a new revision, never mutate history. */
export function assertRoofRevisionEditable(revision: RoofMeasurementRevision): void {
  if (!isRoofRevisionEditable(revision)) {
    throw new Error(
      `Revision ${revision.id} is ${revision.status}; create a new revision instead of editing it.`,
    );
  }
}

/** Freezes a draft revision as approved; a new correction must be a new revision. */
export function markRoofRevisionApproved(
  revision: RoofMeasurementRevision,
  approval: { approvedByUserId: string; approvedAt: string },
): RoofMeasurementRevision {
  assertRoofRevisionEditable(revision);
  return {
    ...revision,
    status: 'approved',
    approvedAt: approval.approvedAt,
    approvedByUserId: approval.approvedByUserId,
  };
}
