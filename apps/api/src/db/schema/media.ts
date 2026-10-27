// Tables owned by the `media` module: media assets with a generic owner (owner_type + owner_id),
// original/sanitized/thumbnail object keys, restricted EXIF, quality scores, scan status and
// consent; redactions; upload sessions.
import { boolean, bigint, integer, jsonb, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { deletedAtColumn, revisionColumn, tsColumn } from './_columns';
import {
  mediaKindEnum,
  mediaOwnerTypeEnum,
  mediaScanStatusEnum,
  mediaStatusEnum,
  mediaViewTypeEnum,
  redactionKindEnum,
  uploadSessionStatusEnum,
} from './_enums';
import { type TenantParent, tenantTable } from './_tenant';
import { consents } from './notifications';

export const mediaAssets = tenantTable(
  'media_assets',
  {
    ownerType: mediaOwnerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    kind: mediaKindEnum('kind').notNull().default('photo'),
    viewType: mediaViewTypeEnum('view_type'),
    status: mediaStatusEnum('status').notNull().default('pending_upload'),
    originalObjectKey: text('original_object_key').notNull(),
    sanitizedObjectKey: text('sanitized_object_key'),
    thumbnailObjectKey: text('thumbnail_object_key'),
    fileName: text('file_name'),
    sha256: text('sha256').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    capturedAt: tsColumn('captured_at'),
    /** Restricted EXIF (location, device) kept server-side only; never served to the portal. */
    exifRestricted: jsonb('exif_restricted'),
    qualityScores: jsonb('quality_scores'),
    qualityPassed: boolean('quality_passed'),
    blurScore: numeric('blur_score', { precision: 6, scale: 4 }),
    scanStatus: mediaScanStatusEnum('scan_status').notNull().default('not_scanned'),
    consentId: uuid('consent_id'),
    uploadedByUserId: uuid('uploaded_by_user_id'),
    uploadedViaPortal: boolean('uploaded_via_portal').notNull().default(false),
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id'),
    revision: revisionColumn(),
    deletedAt: deletedAtColumn(),
  },
  (_t, h) => [
    h.uniq('orgId', 'sha256'),
    h.idx('orgId', 'ownerType', 'ownerId'),
    h.fk('consentId', () => consents),
    h.fk('supersedesId', (): TenantParent => mediaAssets),
  ],
);

export const mediaRedactions = tenantTable(
  'media_redactions',
  {
    mediaAssetId: uuid('media_asset_id').notNull(),
    kind: redactionKindEnum('kind').notNull(),
    /** Normalized [x, y, w, h] in 0..1 image space. */
    region: jsonb('region').notNull(),
    automatic: boolean('automatic').notNull().default(false),
    confirmedByUserId: uuid('confirmed_by_user_id'),
  },
  (_t, h) => [h.fk('mediaAssetId', (): TenantParent => mediaAssets, 'cascade'), h.idx('mediaAssetId')],
);

export const uploadSessions = tenantTable(
  'upload_sessions',
  {
    ownerType: mediaOwnerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    objectKey: text('object_key').notNull(),
    expectedMimeType: text('expected_mime_type').notNull(),
    maxBytes: bigint('max_bytes', { mode: 'number' }).notNull(),
    status: uploadSessionStatusEnum('status').notNull().default('pending'),
    mediaAssetId: uuid('media_asset_id'),
    expiresAt: tsColumn('expires_at').notNull(),
  },
  (_t, h) => [h.uniq('orgId', 'objectKey'), h.fk('mediaAssetId', (): TenantParent => mediaAssets)],
);
