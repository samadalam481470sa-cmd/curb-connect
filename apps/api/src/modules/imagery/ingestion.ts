// Provider-independent imagery ingestion. Adapters and contractor registration hand this module a
// normalized RoofImageryCandidate; it writes every field the ranking engine needs into
// imagery_assets (including the provider id and candidate metadata), and reads the same shape back.
// Missing metadata is preserved honestly: incomplete rows are not converted into a rankable
// candidate rather than being filled with invented scores.
import {
  ANALYSIS_IMAGERY_PROVIDERS,
  type AnalysisImageryProvider,
  evaluateImageryEligibility,
  type ImageryCandidate,
  type ImageryKind,
  RoofImageryRightsSchema,
  type RoofImageryCandidate,
} from '@fieldline/contracts';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { imageryAssets } from '../../db/schema';
import type { Tx } from '../../db/runtime';

export type ImageryAssetRow = typeof imageryAssets.$inferSelect;

const ANALYSIS_PROVIDERS = new Set<string>(ANALYSIS_IMAGERY_PROVIDERS);
const RANKABLE_STATUSES = ['candidate', 'selected', 'ingested'] as const;

function isAnalysisProvider(value: string): value is AnalysisImageryProvider {
  return ANALYSIS_PROVIDERS.has(value);
}

export interface IngestImageryCandidateInput {
  orgId: string;
  propertyId: string;
  candidate: RoofImageryCandidate;
  kind?: ImageryKind | undefined;
  mediaAssetId?: string | null | undefined;
  consentId?: string | null | undefined;
  objectKey?: string | null | undefined;
  widthPx?: number | null | undefined;
  heightPx?: number | null | undefined;
}

/** Writes a normalized candidate into the tenant's imagery table. The composite keys enforce org. */
export async function ingestImageryCandidate(
  tx: Tx,
  input: IngestImageryCandidateInput,
): Promise<ImageryAssetRow> {
  const candidate = input.candidate;
  const [asset] = await tx
    .insert(imageryAssets)
    .values({
      orgId: input.orgId,
      propertyId: input.propertyId,
      provider: candidate.provider,
      providerImageId: candidate.sourceReference,
      kind: input.kind ?? 'orthophoto',
      status: 'candidate',
      rights: candidate.rights,
      attribution: candidate.attribution,
      gsdM: candidate.gsdM === null ? null : String(candidate.gsdM),
      captureDate: candidate.captureDate,
      processingDate: candidate.processingDate,
      quality: candidate.quality,
      perspective: candidate.perspective,
      orthorectified: candidate.orthorectified,
      sharpnessScore: candidate.sharpnessScore === null ? null : String(candidate.sharpnessScore),
      roofVisibilityPct: String(candidate.roofVisibilityPct),
      shadowPct: String(candidate.shadowPct),
      georefConfidence: String(candidate.georefConfidence),
      buildingMatchConfidence: String(candidate.buildingMatchConfidence),
      mediaAssetId: input.mediaAssetId ?? null,
      consentId: input.consentId ?? null,
      objectKey: input.objectKey ?? null,
      widthPx: input.widthPx ?? null,
      heightPx: input.heightPx ?? null,
      expiresAt:
        candidate.retentionExpiresAt === null ? null : new Date(candidate.retentionExpiresAt),
    })
    .returning();

  if (!asset) throw new Error('Imagery candidate insert returned no row.');
  return asset;
}

/**
 * Converts a stored row back to the ranking contract. Returns null for display-only providers and
 * for rows that predate the required ranking metadata, so incomplete data never becomes a candidate.
 */
export function imageryAssetToCandidate(row: ImageryAssetRow): RoofImageryCandidate | null {
  if (!isAnalysisProvider(row.provider)) return null;
  if (
    row.orthorectified === null ||
    row.roofVisibilityPct === null ||
    row.georefConfidence === null ||
    row.buildingMatchConfidence === null
  ) {
    return null;
  }
  const rights = RoofImageryRightsSchema.safeParse(row.rights);
  if (!rights.success) return null;

  return {
    id: row.id,
    provider: row.provider,
    sourceReference: row.providerImageId ?? row.objectKey ?? row.id,
    captureDate: row.captureDate,
    processingDate: row.processingDate,
    gsdM: row.gsdM === null ? null : Number(row.gsdM),
    quality: row.quality,
    perspective: row.perspective,
    orthorectified: row.orthorectified,
    sharpnessScore: row.sharpnessScore === null ? null : Number(row.sharpnessScore),
    roofVisibilityPct: Number(row.roofVisibilityPct),
    shadowPct: row.shadowPct === null ? 0 : Number(row.shadowPct),
    georefConfidence: Number(row.georefConfidence),
    buildingMatchConfidence: Number(row.buildingMatchConfidence),
    rights: rights.data,
    attribution: row.attribution,
    retentionExpiresAt: row.expiresAt?.toISOString() ?? null,
    warnings: [],
  };
}

/** Client-facing candidate resource: all stored metadata plus current eligibility blockers. */
export function imageryAssetToApiCandidate(row: ImageryAssetRow): ImageryCandidate | null {
  const rights = RoofImageryRightsSchema.safeParse(row.rights);
  if (!rights.success) return null;
  const rankable = imageryAssetToCandidate(row);
  const blockers: string[] = rankable
    ? [...evaluateImageryEligibility(rankable, new Date()).reasons]
    : ['metadata_incomplete'];
  // Expiry is a hard gate even when the vision metadata has not been collected yet.
  if (
    (row.status === 'expired' ||
      (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now())) &&
    !blockers.includes('rights_expired')
  ) {
    blockers.push('rights_expired');
  }
  return {
    id: row.id,
    propertyId: row.propertyId,
    provider: row.provider,
    providerImageId: row.providerImageId,
    kind: row.kind,
    status: row.status,
    rights: {
      commercialUse: rights.data.commercialUse,
      storageAllowed: rights.data.storageAllowed,
      derivativeMeasurementAllowed: rights.data.derivativesAllowed,
      maxRetentionDays: rights.data.retentionDays,
      attributionRequired: true,
      licenseRef: null,
    },
    attribution: row.attribution,
    gsdM: row.gsdM === null ? null : Number(row.gsdM),
    captureDate: row.captureDate,
    processingDate: row.processingDate,
    quality: row.quality,
    perspective: row.perspective,
    orthorectified: row.orthorectified,
    sharpnessScore: row.sharpnessScore === null ? null : Number(row.sharpnessScore),
    roofVisibilityPct: row.roofVisibilityPct === null ? null : Number(row.roofVisibilityPct),
    shadowPct: row.shadowPct === null ? null : Number(row.shadowPct),
    georefConfidence: row.georefConfidence === null ? null : Number(row.georefConfidence),
    buildingMatchConfidence:
      row.buildingMatchConfidence === null ? null : Number(row.buildingMatchConfidence),
    footprint: null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    previewUrl: null,
    blockers,
  };
}

/** Loads all stored imagery rows for a property, newest first. */
export async function loadImageryAssets(
  tx: Tx,
  orgId: string,
  propertyId: string,
): Promise<ImageryAssetRow[]> {
  return tx
    .select()
    .from(imageryAssets)
    .where(and(eq(imageryAssets.orgId, orgId), eq(imageryAssets.propertyId, propertyId)))
    .orderBy(desc(imageryAssets.createdAt));
}

/** Loads only complete, analysis-provider candidates for a property, newest first. */
export async function loadRankableImageryCandidates(
  tx: Tx,
  orgId: string,
  propertyId: string,
): Promise<RoofImageryCandidate[]> {
  const rows = await tx
    .select()
    .from(imageryAssets)
    .where(
      and(
        eq(imageryAssets.orgId, orgId),
        eq(imageryAssets.propertyId, propertyId),
        inArray(imageryAssets.status, RANKABLE_STATUSES),
      ),
    )
    .orderBy(desc(imageryAssets.createdAt));

  return rows
    .map(imageryAssetToCandidate)
    .filter((candidate): candidate is RoofImageryCandidate => candidate !== null);
}
