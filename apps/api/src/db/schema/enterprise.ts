// Schema is wholly isolated from the existing public construction tables.
// The corresponding hand-reviewed DDL/RLS is in drizzle/0005_enterprise_suite.sql.
import { pgSchema, uuid, text, varchar, integer, boolean, timestamp, bigint, jsonb } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();
const org = () => uuid('org_id').notNull();
const project = () => uuid('project_id').notNull();
const revision = () => integer('revision').notNull().default(1);

export const enterpriseSettings = suite.table('settings', {
  orgId: uuid('org_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  updatedByUserId: uuid('updated_by_user_id'),
  updatedAt: instant('updated_at'),
});

export const enterpriseProjects = suite.table('projects', {
  id: id(),
  orgId: org(),
  name: varchar('name', { length: 255 }).notNull(),
  originalContractMinor: bigint('original_contract_minor', { mode: 'number' }).notNull().default(0),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
});

export const enterpriseRfis = suite.table('rfis', {
  id: id(),
  orgId: org(),
  projectId: project(),
  rfiNumber: integer('rfi_number').notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  question: text('question').notNull(),
  status: text('status').notNull().default('draft'),
  ballInCourt: varchar('ball_in_court', { length: 255 }).notNull(),
  officialResponse: text('official_response'),
  costImpact: boolean('cost_impact').notNull().default(false),
  scheduleImpactDays: integer('schedule_impact_days').notNull().default(0),
  answeredAt: timestamp('answered_at', { withTimezone: true, mode: 'date' }),
  createdByUserId: uuid('created_by_user_id').notNull(),
  revision: revision(),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
});

export const enterpriseSubmittals = suite.table('submittals', {
  id: id(),
  orgId: org(),
  projectId: project(),
  number: varchar('number', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  specSection: varchar('spec_section', { length: 50 }).notNull().default(''),
  documentReference: text('document_reference'),
  reviewer: varchar('reviewer', { length: 255 }).notNull(),
  status: text('status').notNull().default('required'),
  currentRevision: integer('current_revision').notNull().default(1),
  createdByUserId: uuid('created_by_user_id').notNull(),
  revision: revision(),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
});

export const enterpriseChangeOrders = suite.table('change_orders', {
  id: id(),
  orgId: org(),
  projectId: project(),
  number: varchar('number', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('pco_draft'),
  amountDeltaMinor: bigint('amount_delta_minor', { mode: 'number' }).notNull().default(0),
  scheduleImpactDays: integer('schedule_impact_days').notNull().default(0),
  approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
  approvedByUserId: uuid('approved_by_user_id'),
  createdByUserId: uuid('created_by_user_id').notNull(),
  revision: revision(),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
});

export const enterpriseSovLines = suite.table('sov_lines', {
  id: id(),
  orgId: org(),
  projectId: project(),
  lineNumber: integer('line_number').notNull(),
  costCode: varchar('cost_code', { length: 20 }).notNull(),
  description: text('description').notNull(),
  scheduledMinor: bigint('scheduled_minor', { mode: 'number' }).notNull(),
  previousMinor: bigint('previous_minor', { mode: 'number' }).notNull().default(0),
  currentMinor: bigint('current_minor', { mode: 'number' }).notNull().default(0),
  storedMinor: bigint('stored_minor', { mode: 'number' }).notNull().default(0),
  retainageBps: integer('retainage_bps').notNull().default(1000),
  revision: revision(),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
});

export const enterpriseAuditEvents = suite.table('audit_events', {
  id: id(),
  orgId: org(),
  actorUserId: uuid('actor_user_id').notNull(),
  objectType: text('object_type').notNull(),
  objectId: uuid('object_id').notNull(),
  action: text('action').notNull(),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  createdAt: instant('created_at'),
});
