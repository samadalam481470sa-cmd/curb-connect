// Business-wide reporting contracts: rollups over the job-cost ledger, draws, and AP
// the builder already entered. Every number is computed from those records — a job
// with no budget or no contract shows nulls ("insufficient data"), never an invented
// figure. Percentages are rounded to one decimal.
import { z } from 'zod';
import { CurrencyCodeSchema, UuidSchema } from './common';

export const JobMarginRowSchema = z.object({
  jobId: UuidSchema,
  jobNumber: z.string(),
  jobTitle: z.string(),
  currency: CurrencyCodeSchema,
  budgetMinor: z.number().int(),
  actualMinor: z.number().int(),
  /** budget − actual (positive = under budget). */
  varianceMinor: z.number().int(),
  /** Latest draw contract value; null when no draw exists yet. */
  contractMinor: z.number().int().nullable(),
  /** contract − actual; null without a contract. */
  marginMinor: z.number().int().nullable(),
  /** actual / budget × 100, one decimal; null when budget is 0. */
  percentSpent: z.number().nullable(),
});
export type JobMarginRow = z.infer<typeof JobMarginRowSchema>;

export const JobMarginsReportSchema = z.object({
  rows: z.array(JobMarginRowSchema),
  totals: z.object({
    budgetMinor: z.number().int(),
    actualMinor: z.number().int(),
    varianceMinor: z.number().int(),
    jobCount: z.number().int(),
  }),
});
export type JobMarginsReport = z.infer<typeof JobMarginsReportSchema>;

export const WipRowSchema = z.object({
  jobId: UuidSchema,
  jobNumber: z.string(),
  jobTitle: z.string(),
  currency: CurrencyCodeSchema,
  contractMinor: z.number().int().nullable(),
  budgetMinor: z.number().int(),
  costsToDateMinor: z.number().int(),
  /** Sum of paid draw requests. */
  billedToDateMinor: z.number().int(),
  /** costs / budget × 100, one decimal; null when budget is 0. */
  percentComplete: z.number().nullable(),
  /** contract × percent complete; null without contract or budget. */
  earnedMinor: z.number().int().nullable(),
  /** billed − earned (positive = overbilled); null without earned. */
  overUnderBilledMinor: z.number().int().nullable(),
});
export type WipRow = z.infer<typeof WipRowSchema>;

export const WipReportSchema = z.object({ rows: z.array(WipRowSchema) });
export type WipReport = z.infer<typeof WipReportSchema>;

export const DrawForecastRowSchema = z.object({
  jobId: UuidSchema,
  jobNumber: z.string(),
  jobTitle: z.string(),
  currency: CurrencyCodeSchema,
  contractMinor: z.number().int().nullable(),
  billedToDateMinor: z.number().int(),
  /** contract − billed; null without a contract. */
  remainingContractMinor: z.number().int().nullable(),
  draftDrawsMinor: z.number().int(),
  submittedDrawsMinor: z.number().int(),
  approvedDrawsMinor: z.number().int(),
});
export type DrawForecastRow = z.infer<typeof DrawForecastRowSchema>;

export const DrawForecastReportSchema = z.object({
  rows: z.array(DrawForecastRowSchema),
  totals: z.object({
    draftDrawsMinor: z.number().int(),
    submittedDrawsMinor: z.number().int(),
    approvedDrawsMinor: z.number().int(),
  }),
});
export type DrawForecastReport = z.infer<typeof DrawForecastReportSchema>;

export const ApAgingReportSchema = z.object({
  buckets: z.array(
    z.object({
      bucket: z.enum(['overdue', 'due_7_days', 'due_30_days', 'due_later', 'no_due_date']),
      count: z.number().int(),
      amountMinor: z.number().int(),
    }),
  ),
  byStatus: z.array(
    z.object({
      status: z.string(),
      count: z.number().int(),
      amountMinor: z.number().int(),
    }),
  ),
  openTotalMinor: z.number().int(),
});
export type ApAgingReport = z.infer<typeof ApAgingReportSchema>;
