import { date, integer, pgSchema, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { EnterpriseDailyLogStatus } from '@fieldline/contracts';

export const enterpriseDailyLogs = pgSchema('enterprise_suite').table('daily_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  workDate: date('work_date').notNull(),
  weather: varchar('weather', { length: 250 }).notNull().default(''),
  crewCount: integer('crew_count').notNull(),
  laborMinutes: integer('labor_minutes').notNull(),
  workPerformed: text('work_performed').notNull(),
  safetyAndDelays: text('safety_and_delays').notNull().default(''),
  scheduleTaskId: uuid('schedule_task_id'),
  status: text('status')
    .$type<z.infer<typeof EnterpriseDailyLogStatus>>()
    .notNull()
    .default('draft'),
  reviewNote: text('review_note'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  revision: integer('revision').notNull().default(1),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
