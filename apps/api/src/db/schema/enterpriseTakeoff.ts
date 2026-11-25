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
  EnterpriseTakeoffConditionKind,
  EnterpriseTakeoffMeasurementKind,
  EnterpriseTakeoffMarkerSymbol,
  EnterpriseTakeoffPoint,
  EnterpriseTakeoffReviewStatus,
  EnterpriseTakeoffUnit,
  TakeoffComparisonAlignment,
  TakeoffCalibrationLockMode,
  TakeoffCalibrationChange,
  TakeoffMarkupPreview,
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

export const enterpriseTakeoffAreas = suite.table('takeoff_areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  planId: uuid('plan_id').notNull(),
  sheetId: uuid('sheet_id').notNull(),
  calibrationId: uuid('calibration_id').notNull(),
  exterior: jsonb('exterior').$type<EnterpriseTakeoffPoint[]>().notNull(),
  holes: jsonb('holes').$type<EnterpriseTakeoffPoint[][]>().notNull(),
  exteriorArea: doublePrecision('exterior_area').notNull(),
  deductedArea: doublePrecision('deducted_area').notNull(),
  netArea: doublePrecision('net_area').notNull(),
  exteriorPerimeter: doublePrecision('exterior_perimeter').notNull(),
  deductionPerimeter: doublePrecision('deduction_perimeter').notNull(),
  unit: text('unit').$type<EnterpriseTakeoffUnit>().notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseTakeoffCountSets = suite.table('takeoff_count_sets', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  planId: uuid('plan_id').notNull(),
  sheetId: uuid('sheet_id').notNull(),
  categoryId: uuid('category_id').notNull(),
  symbol: text('symbol').$type<EnterpriseTakeoffMarkerSymbol>().notNull(),
  activeCount: integer('active_count').notNull(),
  revision: integer('revision').notNull().default(1),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseTakeoffCountMarkers = suite.table('takeoff_count_markers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  planId: uuid('plan_id').notNull(),
  sheetId: uuid('sheet_id').notNull(),
  countSetId: uuid('count_set_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  x: doublePrecision('x').notNull(),
  y: doublePrecision('y').notNull(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  removedByUserId: uuid('removed_by_user_id'),
});

export const enterpriseTakeoffConditions = suite.table('takeoff_conditions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  kind: text('kind').$type<z.infer<typeof EnterpriseTakeoffConditionKind>>().notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  nameKey: text('name_key').generatedAlwaysAs(sql`lower(trim(name))`),
  parentFloorId: uuid('parent_floor_id'),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseTakeoffConditionAssignments = suite.table('takeoff_condition_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  planId: uuid('plan_id').notNull(),
  sheetId: uuid('sheet_id').notNull(),
  lengthId: uuid('length_id'),
  areaId: uuid('area_id'),
  countId: uuid('count_id'),
  measurementId: uuid('measurement_id')
    .notNull()
    .generatedAlwaysAs(sql`coalesce(length_id, area_id, count_id)`),
  measurementKind: text('measurement_kind')
    .$type<z.infer<typeof EnterpriseTakeoffMeasurementKind>>()
    .notNull()
    .generatedAlwaysAs(
      sql`case when length_id is not null then 'length' when area_id is not null then 'area' else 'count' end`,
    ),
  conditionId: uuid('condition_id').notNull(),
  floorId: uuid('floor_id'),
  roomId: uuid('room_id'),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseTakeoffReviews = suite.table('takeoff_measurement_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  planId: uuid('plan_id').notNull(),
  sheetId: uuid('sheet_id').notNull(),
  lengthId: uuid('length_id'),
  areaId: uuid('area_id'),
  countId: uuid('count_id'),
  measurementId: uuid('measurement_id')
    .notNull()
    .generatedAlwaysAs(sql`coalesce(length_id, area_id, count_id)`),
  measurementKind: text('measurement_kind')
    .$type<z.infer<typeof EnterpriseTakeoffMeasurementKind>>()
    .notNull()
    .generatedAlwaysAs(
      sql`case when length_id is not null then 'length' when area_id is not null then 'area' else 'count' end`,
    ),
  measurementRevision: integer('measurement_revision').notNull(),
  calibrationId: uuid('calibration_id'),
  quantity: doublePrecision('quantity').notNull(),
  unit: varchar('unit', { length: 16 }).$type<EnterpriseTakeoffUnit>(),
  status: text('status')
    .$type<z.infer<typeof EnterpriseTakeoffReviewStatus>>()
    .notNull()
    .default('review_required'),
  revision: integer('revision').notNull().default(1),
  submitNote: text('submit_note').notNull(),
  submittedByUserId: uuid('submitted_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reviewNote: text('review_note'),
  reviewedByUserId: uuid('reviewed_by_user_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  clientRequestId: uuid('client_request_id').notNull(),
});

export const enterpriseTakeoffComparisonNotes = suite.table('takeoff_comparison_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  oldPlanId: uuid('old_plan_id').notNull(),
  oldSheetId: uuid('old_sheet_id').notNull(),
  oldCalibrationId: uuid('old_calibration_id'),
  newPlanId: uuid('new_plan_id').notNull(),
  newSheetId: uuid('new_sheet_id').notNull(),
  newCalibrationId: uuid('new_calibration_id'),
  comparisonKey: varchar('comparison_key', { length: 64 }).notNull(),
  alignment: jsonb('alignment').$type<z.infer<typeof TakeoffComparisonAlignment>>().notNull(),
  x: doublePrecision('x').notNull(),
  y: doublePrecision('y').notNull(),
  body: text('body').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
});

export const enterpriseTakeoffMarkupExports = suite.table('takeoff_markup_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  planId: uuid('plan_id').notNull(),
  sheetId: uuid('sheet_id').notNull(),
  calibrationId: uuid('calibration_id'),
  sourceVersionId: uuid('source_version_id').notNull(),
  selectedReviewIds: uuid('selected_review_ids').array().notNull(),
  preview: jsonb('preview').$type<z.infer<typeof TakeoffMarkupPreview>>().notNull(),
  templateVersion: varchar('template_version', { length: 48 }).notNull(),
  storageKey: text('storage_key').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  byteSize: integer('byte_size').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
});

export const enterpriseTakeoffCalibrationLockRevisions = suite.table(
  'takeoff_calibration_lock_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    planId: uuid('plan_id').notNull(),
    sheetId: uuid('sheet_id').notNull(),
    revision: integer('revision').notNull(),
    mode: text('mode').$type<z.infer<typeof TakeoffCalibrationLockMode>>().notNull(),
    reason: text('reason').notNull(),
    clientRequestId: uuid('client_request_id').notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
export const enterpriseTakeoffCalibrationChangeRequests = suite.table(
  'takeoff_calibration_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    planId: uuid('plan_id').notNull(),
    sheetId: uuid('sheet_id').notNull(),
    baseCalibrationId: uuid('base_calibration_id').notNull(),
    appliedCalibrationId: uuid('applied_calibration_id'),
    input: jsonb('input')
      .$type<Omit<z.infer<typeof EnterpriseTakeoffCalibrationInput>, 'clientRequestId'>>()
      .notNull(),
    computedResult: jsonb('computed_result')
      .$type<ReturnType<typeof computeTakeoffCalibration>>()
      .notNull(),
    reason: text('reason').notNull(),
    status: text('status')
      .$type<z.infer<typeof TakeoffCalibrationChange>['status']>()
      .notNull()
      .default('pending'),
    revision: integer('revision').notNull().default(1),
    clientRequestId: uuid('client_request_id').notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    submittedByUserId: uuid('submitted_by_user_id').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    decisionReason: text('decision_reason'),
    decidedByUserId: uuid('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
);
