import { bigint, integer, pgSchema, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { EnterpriseDocumentCategory, EnterpriseDocumentDecision } from '@fieldline/contracts';

const suite = pgSchema('enterprise_suite');

export const enterpriseDocumentSets = suite.table('document_sets', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  title: varchar('title', { length: 180 }).notNull(),
  category: text('category').$type<z.infer<typeof EnterpriseDocumentCategory>>().notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseDocumentVersions = suite.table('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  documentSetId: uuid('document_set_id'),
  clientRequestId: uuid('client_request_id'),
  filename: text('filename').notNull(),
  storageKey: text('storage_key').notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
  sha256Hex: varchar('sha256_hex', { length: 64 }).notNull(),
  version: integer('version').notNull().default(1),
  scanStatus: text('scan_status').$type<'clean' | 'not_scanned'>().notNull().default('not_scanned'),
  revisionNote: text('revision_note'),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseDocumentReviews = suite.table('document_reviews', {
  versionId: uuid('version_id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  decision: text('decision').$type<z.infer<typeof EnterpriseDocumentDecision>>().notNull(),
  note: text('note').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
