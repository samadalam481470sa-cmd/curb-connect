import type { EnterpriseWipReportInput } from '@fieldline/contracts';
import { date, jsonb, pgSchema, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

const suite = pgSchema('enterprise_suite');
export const enterpriseWipReports = suite.table('wip_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  periodId: uuid('period_id').notNull(),
  monthStart: date('month_start').notNull(),
  projectIds: uuid('project_ids').array().notNull(),
  snapshot: jsonb('snapshot').$type<z.infer<typeof EnterpriseWipReportInput>>().notNull(),
  status: text('status')
    .$type<'queued' | 'processing' | 'ready' | 'failed'>()
    .notNull()
    .default('queued'),
  csvText: text('csv_text'),
  digest: varchar('digest', { length: 64 }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorCode: text('error_code').$type<'report_generation_failed'>(),
  requestedByUserId: uuid('requested_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
