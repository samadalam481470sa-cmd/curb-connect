import {
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  computeTakeoffCalibration,
  EnterpriseTakeoffCalibrationInput,
  EnterpriseTakeoffPoint,
  EnterpriseTakeoffUnit,
} from '@fieldline/contracts';
import type { z } from 'zod';

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

export const enterpriseTakeoffCalibrations = suite.table('takeoff_calibrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  planId: uuid('plan_id').notNull(),
  sheetId: uuid('sheet_id').notNull(),
  revision: integer('revision').notNull(),
  input: jsonb('input')
    .$type<Omit<z.infer<typeof EnterpriseTakeoffCalibrationInput>, 'clientRequestId'>>()
    .notNull(),
  result: jsonb('result').$type<ReturnType<typeof computeTakeoffCalibration>>().notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseTakeoffCategories = suite.table('takeoff_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  nameKey: text('name_key').generatedAlwaysAs(sql`lower(trim(name))`),
  createdByUserId: uuid('created_by_user_id').notNull(),
});

export const enterpriseTakeoffLengths = suite.table('takeoff_lengths', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  planId: uuid('plan_id').notNull(),
  sheetId: uuid('sheet_id').notNull(),
  calibrationId: uuid('calibration_id').notNull(),
  categoryId: uuid('category_id').notNull(),
  vertices: jsonb('vertices').$type<EnterpriseTakeoffPoint[]>().notNull(),
  drawingLength: doublePrecision('drawing_length').notNull(),
  length: doublePrecision('length').notNull(),
  unit: text('unit').$type<EnterpriseTakeoffUnit>().notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
