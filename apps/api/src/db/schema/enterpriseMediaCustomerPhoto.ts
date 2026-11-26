import { integer, pgSchema, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const hash = (name: string) => varchar(name, { length: 64 }).notNull();
const scope = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  assetId: uuid('asset_id').notNull(),
  requestHash: hash('request_hash'),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const enterpriseMediaCustomerPhotoPreviews = suite.table('media_customer_photo_previews', {
  ...scope(),
  revision: integer('revision').notNull(),
  sourceAnnotationRevision: integer('source_annotation_revision').notNull(),
  sourceSha256: hash('source_sha256'),
  sha256: hash('sha256'),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  byteSize: integer('byte_size').notNull(),
  redactionCount: integer('redaction_count').notNull(),
});

export const enterpriseMediaCustomerPhotoApprovals = suite.table('media_customer_photo_approvals', {
  ...scope(),
  previewId: uuid('preview_id').notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
});
