// Tables for critical-path scheduling (blueprint gap 1), owned by the
// `projectManagement` module: extra finish-to-start dependency links between
// schedule tasks (the legacy single predecessorTaskId on schedule_tasks still
// counts as a lag-0 link in the CPM math) and immutable schedule baselines
// (a dated snapshot of every task's entered dates for variance reporting).
import { date, integer, text, uuid } from 'drizzle-orm/pg-core';
import { tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { jobs } from './jobs';
import { scheduleTasks } from './projectManagement';

export const scheduleDependencies = tenantTable(
  'schedule_dependencies',
  {
    jobId: uuid('job_id').notNull(),
    predecessorTaskId: uuid('predecessor_task_id').notNull(),
    successorTaskId: uuid('successor_task_id').notNull(),
    /** Finish-to-start lag in whole days (0 = successor starts the day after the predecessor ends). */
    lagDays: integer('lag_days').notNull().default(0),
    createdByUserId: uuid('created_by_user_id'),
  },
  (t, h) => [
    h.fk('jobId', () => jobs),
    h.fk('predecessorTaskId', () => scheduleTasks),
    h.fk('successorTaskId', () => scheduleTasks),
    h.uniq('orgId', 'predecessorTaskId', 'successorTaskId'),
    h.idx('orgId', 'jobId'),
  ],
);

export const scheduleBaselines = tenantTable(
  'schedule_baselines',
  {
    jobId: uuid('job_id').notNull(),
    name: text('name').notNull(),
    note: text('note'),
    capturedAt: tsColumn('captured_at').notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id'),
  },
  (t, h) => [h.fk('jobId', () => jobs), h.idx('orgId', 'jobId', 'capturedAt')],
);

export const scheduleBaselineTasks = tenantTable(
  'schedule_baseline_tasks',
  {
    baselineId: uuid('baseline_id').notNull(),
    taskId: uuid('task_id').notNull(),
    title: text('title').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    progressPercent: integer('progress_percent').notNull().default(0),
  },
  (t, h) => [
    h.fk('baselineId', () => scheduleBaselines, 'cascade'),
    h.uniq('orgId', 'baselineId', 'taskId'),
    h.idx('orgId', 'baselineId'),
  ],
);
