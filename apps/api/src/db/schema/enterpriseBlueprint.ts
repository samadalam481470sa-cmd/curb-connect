// Enterprise blueprint records: one tenant-scoped row per work-package record.
// Isolated in enterprise_suite; no existing public tables are modified.
import type { EnterpriseFieldValues } from '@fieldline/contracts';
import {
  date,
  index,
  pgSchema,
  uuid,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');

export const enterpriseBlueprintRecords = suite.table(
  'work_package_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id'),
    packageCode: varchar('package_code', { length: 3 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    status: text('status').notNull(),
    fields: jsonb('fields').$type<EnterpriseFieldValues>().notNull().default({}),
    ownerUserId: uuid('owner_user_id'),
    dueOn: date('due_on'),
    slaHours: integer('sla_hours'),
    blockedReason: text('blocked_reason'),
    blockedAt: timestamp('blocked_at', { withTimezone: true, mode: 'date' }),
    notes: text('notes'),
    clientRequestId: varchar('client_request_id', { length: 80 }),
    createdByUserId: uuid('created_by_user_id').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('enterprise_blueprint_owner_due_idx').on(table.orgId, table.ownerUserId, table.dueOn),
    index('enterprise_blueprint_due_idx').on(table.orgId, table.dueOn),
    index('enterprise_blueprint_blocked_idx').on(table.orgId, table.blockedAt),
  ],
);
