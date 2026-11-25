// Enterprise blueprint records: one tenant-scoped row per work-package record.
// Isolated in enterprise_suite; no existing public tables are modified.
import { pgSchema, uuid, text, varchar, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');

export const enterpriseBlueprintRecords = suite.table('work_package_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id'),
  packageCode: varchar('package_code', { length: 3 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  status: text('status').notNull(),
  fields: jsonb('fields').$type<Record<string, string>>().notNull().default({}),
  notes: text('notes'),
  clientRequestId: varchar('client_request_id', { length: 80 }),
  createdByUserId: uuid('created_by_user_id').notNull(),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
