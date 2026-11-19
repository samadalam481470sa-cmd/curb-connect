// Tables owned by the `imagery` module (RR pages 021-024): imagery candidates and ingested assets
// with license rights, attribution, ground sample distance, capture date, georeference and expiry.
// Candidate metadata mirrors the provider-independent engine fields (ROOF-AI-001) so a ranked
// analysis candidate can be stored without inventing missing values: unknown remains null or
// `unknown`, never a fabricated score.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { geometry, revisionColumn, tsColumn } from './_columns';
import {
  imageryKindEnum,
  imageryPerspectiveEnum,
  imageryProviderEnum,
  imageryQualityEnum,
  imageryStatusEnum,
} from './_enums';
import { tenantTable } from './_tenant';
import { mediaAssets } from './media';
import { consents } from './notifications';
import { properties } from './properties';

/** 0–100 scores are stored as numeric(5,2) and range-checked in Postgres. */
const scoreCheck = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} is null or (${column} >= 0 and ${column} <= 100)`);

export const imageryAssets = tenantTable(
  'imagery_assets',
  {
    propertyId: uuid('property_id').notNull(),
    provider: imageryProviderEnum('provider').notNull(),
    providerImageId: text('provider_image_id'),
    kind: imageryKindEnum('kind').notNull().default('orthophoto'),
    status: imageryStatusEnum('status').notNull().default('candidate'),
    /** License terms: { commercialUse, analysisAllowed, storageAllowed, derivativesAllowed, ... }. */
    rights: jsonb('rights').notNull(),
    attribution: text('attribution').notNull(),
    /** Ground sample distance in meters per pixel. */
    gsdM: numeric('gsd_m', { precision: 10, scale: 5 }),
    captureDate: date('capture_date'),
    /** Provider pipeline date when reported; distinct from the capture date. */
    processingDate: date('processing_date'),
    /** Provider-declared quality (high/medium/low/base/unknown). */
    quality: imageryQualityEnum('quality').notNull().default('unknown'),
    /** Camera geometry: nadir/oblique/unknown. */
    perspective: imageryPerspectiveEnum('perspective').notNull().default('unknown'),
    /** Null when the provider has not stated it; false is a real answer, not "unknown". */
    orthorectified: boolean('orthorectified'),
    /** 0–100 image-quality and match scores from the imagery worker or provider metadata. */
    sharpnessScore: numeric('sharpness_score', { precision: 5, scale: 2 }),
    roofVisibilityPct: numeric('roof_visibility_pct', { precision: 5, scale: 2 }),
    shadowPct: numeric('shadow_pct', { precision: 5, scale: 2 }),
    georefConfidence: numeric('georef_confidence', { precision: 5, scale: 2 }),
    buildingMatchConfidence: numeric('building_match_confidence', { precision: 5, scale: 2 }),
    /** Affine/world-file or control points; crs is always EPSG:4326 for footprint. */
    georef: jsonb('georef'),
    footprint: geometry('footprint', 'Polygon'),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    objectKey: text('object_key'),
    mediaAssetId: uuid('media_asset_id'),
    /** Consent ledger row that authorises storage and analysis of this asset. */
    consentId: uuid('consent_id'),
    /** Licence retention end; also the candidate `retentionExpiresAt`. */
    expiresAt: tsColumn('expires_at'),
    cost: jsonb('cost'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('propertyId', () => properties),
    h.fk('mediaAssetId', () => mediaAssets),
    h.fk('consentId', () => consents),
    h.idx('propertyId', 'status'),
    h.uniq('orgId', 'provider', 'providerImageId'),
    /**
     * A contractor upload can only exist with a recorded consent, a future retention end and licence
     * rights that permit storage. Other providers are not constrained here.
     */
    check(
      h.name('contractor_consent_ck'),
      sql`${t.provider} <> 'contractor_upload' or (
        ${t.consentId} is not null
        and ${t.expiresAt} is not null
        and ${t.expiresAt} > ${t.createdAt}
        and (${t.rights} ->> 'storageAllowed')::boolean is true
        and (${t.rights} ->> 'retentionDays')::int > 0
      )`,
    ),
    scoreCheck(h.name('sharpness_ck'), t.sharpnessScore),
    scoreCheck(h.name('roof_visibility_ck'), t.roofVisibilityPct),
    scoreCheck(h.name('shadow_ck'), t.shadowPct),
    scoreCheck(h.name('georef_confidence_ck'), t.georefConfidence),
    scoreCheck(h.name('building_match_confidence_ck'), t.buildingMatchConfidence),
  ],
);
