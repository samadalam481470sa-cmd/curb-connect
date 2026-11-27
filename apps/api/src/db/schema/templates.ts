// Tables owned by the `templates` module: estimate templates that scope a job in one
// pass (budget lines + schedule tasks + client questionnaire) and the questionnaires
// generated from them. Every amount is builder-entered in the template — applying a
// template copies the builder's own numbers, never invents any.
import { boolean, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantTable } from './_tenant';
import { jobs } from './jobs';

export const estimateTemplates = tenantTable(
  'estimate_templates',
  {
    name: text('name').notNull(),
    description: text('description'),
    budgetLines: jsonb('budget_lines')
      .notNull()
      .default(sql`'[]'::jsonb`),
    scheduleTasks: jsonb('schedule_tasks')
      .notNull()
      .default(sql`'[]'::jsonb`),
    questionnaire: jsonb('questionnaire')
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
  },
  (_t, h) => [h.idx('orgId', 'name')],
);

export const jobQuestionnaires = tenantTable(
  'job_questionnaires',
  {
    jobId: uuid('job_id').notNull(),
    templateId: uuid('template_id'),
    title: text('title').notNull(),
    questions: jsonb('questions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    answers: jsonb('answers')
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text('status').$type<'open' | 'answered' | 'closed'>().notNull().default('open'),
  },
  (_t, h) => [h.fk('jobId', () => jobs), h.fk('templateId', () => estimateTemplates), h.idx('orgId', 'jobId')],
);
