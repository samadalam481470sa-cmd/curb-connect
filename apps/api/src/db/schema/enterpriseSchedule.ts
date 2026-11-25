import { date, integer, jsonb, pgSchema, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');

export const enterpriseScheduleTasks = suite.table('schedule_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  title: varchar('title', { length: 180 }).notNull(),
  phase: varchar('phase', { length: 80 }).notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  predecessorId: uuid('predecessor_id'),
  lagDays: integer('lag_days').notNull().default(0),
  progressPercent: integer('progress_percent').notNull().default(0),
  actualStartOn: date('actual_start_on'),
  actualFinishOn: date('actual_finish_on'),
  revision: integer('revision').notNull().default(1),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseScheduleBaselines = suite.table('schedule_baselines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  label: varchar('label', { length: 160 }).notNull(),
  tasks: jsonb('tasks')
    .$type<{ id: string; startOn: string; endOn: string; revision: number }[]>()
    .notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseScheduleTemplates = suite.table('schedule_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  sourceProjectId: uuid('source_project_id').notNull(),
  label: varchar('label', { length: 160 }).notNull(),
  tasks: jsonb('tasks')
    .$type<
      {
        key: string;
        title: string;
        phase: string;
        startOffset: number;
        endOffset: number;
        predecessorKey: string | null;
        lagDays: number;
      }[]
    >()
    .notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseScheduleTemplateApplications = suite.table(
  'schedule_template_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    templateId: uuid('template_id').notNull(),
    startsOn: date('starts_on').notNull(),
    taskCount: integer('task_count').notNull(),
    clientRequestId: uuid('client_request_id').notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
  },
);
