// Estimate template contracts: builder-authored templates that scope a job in one pass —
// budget lines (cost code + entered amount), schedule tasks (title + day offset), and a
// client questionnaire. Applying a template to a job copies the builder's own numbers
// into job-cost budget lines, PM schedule tasks, and a job questionnaire. Amounts are
// never invented: a template line with no amount stays unpriced.
import { z } from 'zod';
import { CurrencyCodeSchema, IsoDateTimeSchema, UuidSchema } from './common';

export const TemplateBudgetLineSchema = z.object({
  costCode: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(200),
  /** Builder-entered amount in minor units; null = unpriced line. */
  budgetMinor: z.number().int().min(0).nullable(),
});
export type TemplateBudgetLine = z.infer<typeof TemplateBudgetLineSchema>;

export const TemplateScheduleTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** Days from the apply date (the job start the builder picks). */
  startOffsetDays: z.number().int().min(0).max(3650),
  durationDays: z.number().int().min(1).max(3650),
});
export type TemplateScheduleTask = z.infer<typeof TemplateScheduleTaskSchema>;

export const TemplateQuestionSchema = z.object({
  key: z.string().trim().min(1).max(60),
  prompt: z.string().trim().min(1).max(500),
  kind: z.enum(['text', 'choice', 'yes_no']).default('text'),
  choices: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});
export type TemplateQuestion = z.infer<typeof TemplateQuestionSchema>;

export const EstimateTemplateSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  budgetLines: z.array(TemplateBudgetLineSchema),
  scheduleTasks: z.array(TemplateScheduleTaskSchema),
  questionnaire: z.array(TemplateQuestionSchema),
  active: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type EstimateTemplate = z.infer<typeof EstimateTemplateSchema>;

export const EstimateTemplateListSchema = z.object({
  items: z.array(EstimateTemplateSchema),
});

export const CreateEstimateTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  budgetLines: z.array(TemplateBudgetLineSchema).max(200).default([]),
  scheduleTasks: z.array(TemplateScheduleTaskSchema).max(200).default([]),
  questionnaire: z.array(TemplateQuestionSchema).max(100).default([]),
});
export type CreateEstimateTemplateRequest = z.infer<typeof CreateEstimateTemplateRequestSchema>;

export const ApplyTemplateRequestSchema = z.object({
  jobId: UuidSchema,
  /** ISO date the schedule offsets count from. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type ApplyTemplateRequest = z.infer<typeof ApplyTemplateRequestSchema>;

export const ApplyTemplateResponseSchema = z.object({
  templateId: UuidSchema,
  jobId: UuidSchema,
  budgetLinesCreated: z.number().int(),
  budgetLinesSkipped: z.number().int(),
  scheduleTasksCreated: z.number().int(),
  questionnaireId: UuidSchema.nullable(),
});
export type ApplyTemplateResponse = z.infer<typeof ApplyTemplateResponseSchema>;

// ---------------------------------------------------------------- job questionnaires

export const JobQuestionnaireSchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema,
  templateId: UuidSchema.nullable(),
  title: z.string(),
  questions: z.array(TemplateQuestionSchema),
  answers: z.array(z.object({ key: z.string(), value: z.string().nullable() })),
  status: z.enum(['open', 'answered', 'closed']),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type JobQuestionnaire = z.infer<typeof JobQuestionnaireSchema>;

export const JobQuestionnaireListSchema = z.object({
  items: z.array(JobQuestionnaireSchema),
});

export const AnswerQuestionnaireRequestSchema = z.object({
  answers: z
    .array(z.object({ key: z.string().trim().min(1).max(60), value: z.string().max(2000).nullable() }))
    .max(100),
});
export type AnswerQuestionnaireRequest = z.infer<typeof AnswerQuestionnaireRequestSchema>;

// Currency is carried for display parity with other builder-operations contracts.
export const TemplateCurrencySchema = CurrencyCodeSchema;
