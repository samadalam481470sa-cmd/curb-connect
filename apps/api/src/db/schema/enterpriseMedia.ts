import type {
  JobsiteMediaMime,
  JobsitePhotoScanState,
  JobsiteVideoState,
} from '@fieldline/contracts';
import { boolean, integer, pgSchema, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

const suite = pgSchema('enterprise_suite');
const instant = (column: string) => timestamp(column, { withTimezone: true, mode: 'date' });
const createdAt = () => instant('created_at').notNull().defaultNow();
const orgId = () => uuid('org_id').notNull();
const projectId = () => uuid('project_id').notNull();
const hash = (column: string) => varchar(column, { length: 64 }).notNull();
const version = () => integer('revision').notNull().default(1);

export const enterpriseMediaProjectGrants = suite.table('media_project_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: orgId(),
  projectId: projectId(),
  membershipId: uuid('membership_id').notNull(),
  revision: integer('revision').notNull(),
  active: boolean('active').notNull(),
  reason: text('reason').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: hash('request_hash'),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: createdAt(),
});

export const enterpriseMediaUploadSessions = suite.table('media_upload_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: orgId(),
  projectId: projectId(),
  localCaptureId: uuid('local_capture_id').notNull(),
  uploaderUserId: uuid('uploader_user_id').notNull(),
  filename: varchar('filename', { length: 120 }).notNull(),
  mimeType: text('mime_type').$type<z.infer<typeof JobsiteMediaMime>>().notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: hash('sha256'),
  manifestHash: hash('manifest_hash'),
  capturedAt: instant('captured_at').notNull(),
  declaredDurationMs: integer('declared_duration_ms'),
  createdAt: createdAt(),
  revision: version(),
  finalizedAt: instant('finalized_at'),
  finalizedRequestId: uuid('finalized_request_id'),
});

export const enterpriseMediaUploadParts = suite.table('media_upload_parts', {
  orgId: orgId(),
  projectId: projectId(),
  sessionId: uuid('session_id').notNull(),
  partNumber: integer('part_number').notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: hash('sha256'),
  createdAt: createdAt(),
});

export const enterpriseMediaAssets = suite.table('media_assets', {
  id: uuid('id').primaryKey(),
  orgId: orgId(),
  projectId: projectId(),
  scanState: text('scan_state')
    .$type<z.infer<typeof JobsitePhotoScanState>>()
    .notNull()
    .default('pending'),
  createdAt: createdAt(),
  scannedAt: instant('scanned_at'),
  revision: version(),
  videoState: text('video_state').$type<z.infer<typeof JobsiteVideoState>>(),
  captionRevision: integer('caption_revision').notNull().default(0),
  captionSearch: text('caption_search').notNull().default(''),
});

export const enterpriseMediaCaptionRevisions = suite.table('media_caption_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: orgId(),
  projectId: projectId(),
  assetId: uuid('asset_id').notNull(),
  revision: integer('revision').notNull(),
  caption: text('caption').notNull(),
  tags: text('tags').array().notNull().default([]),
  requestHash: hash('request_hash'),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: createdAt(),
});

export const enterpriseMediaVideoDerivatives = suite.table('media_video_derivatives', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: orgId(),
  projectId: projectId(),
  assetId: uuid('asset_id').notNull(),
  version: integer('version').notNull().default(1),
  sourceSha256: hash('source_sha256'),
  sha256: hash('sha256'),
  byteSize: integer('byte_size').notNull(),
  durationMs: integer('duration_ms').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  createdAt: createdAt(),
});
