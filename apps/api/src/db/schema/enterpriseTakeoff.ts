import { doublePrecision, integer, pgSchema, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');

export const enterpriseTakeoffPlanSets = suite.table('takeoff_plan_sets', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  title: varchar('title', { length: 180 }).notNull(),
  revisionLabel: varchar('revision_label', { length: 60 }).notNull(),
  sourceCount: integer('source_count').notNull(),
  sheetCount: integer('sheet_count').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseTakeoffPlanSheets = suite.table('takeoff_plan_sheets', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  planId: uuid('plan_id').notNull(),
  sourceVersionId: uuid('source_version_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  pageNumber: integer('page_number').notNull(),
  pageLabel: varchar('page_label', { length: 120 }).notNull(),
  widthPoints: doublePrecision('width_points').notNull(),
  heightPoints: doublePrecision('height_points').notNull(),
  rotation: integer('rotation').$type<0 | 90 | 180 | 270>().notNull(),
});
