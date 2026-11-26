import type {
  JobsiteExportFormat,
  JobsiteExportItem,
  JobsiteExportSelection,
  JobsiteExportStatus,
} from '@fieldline/contracts';
import { integer, jsonb, pgSchema, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const enterpriseMediaExports = suite.table('media_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  requesterMembershipId: uuid('requester_membership_id').notNull(),
  requesterUserId: uuid('requester_user_id').notNull(),
  format: varchar('format', { length: 8 }).$type<JobsiteExportFormat>().notNull(),
  selection: varchar('selection', { length: 16 }).$type<JobsiteExportSelection>().notNull(),
  manifest: jsonb('manifest').$type<JobsiteExportItem[]>().notNull(),
  status: varchar('status', { length: 16 })
    .$type<JobsiteExportStatus>()
    .notNull()
    .default('queued'),
  failureCode: varchar('failure_code', { length: 40 }),
  byteSize: integer('byte_size'),
  sha256: varchar('sha256', { length: 64 }),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
  completedAt: instant('completed_at'),
});
