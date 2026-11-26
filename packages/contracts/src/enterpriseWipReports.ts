import { z } from 'zod';
import { CurrencyCodeSchema } from './common';
import { EnterpriseScheduleDate } from './enterpriseSchedule';

const id = z.uuid();
const date = EnterpriseScheduleDate;
const unsigned = z.string().regex(/^\d+$/);
const signed = z.string().regex(/^-?\d+$/);
const instant = z.iso.datetime();
export const WIP_METHODOLOGY_VERSION = 'bill-cost-to-cost-v1';
export const WipMethodologyVersion = z.literal(WIP_METHODOLOGY_VERSION);
const period = z.object({
  id,
  monthStart: date,
  through: date,
  state: z.enum(['open', 'closed']),
  revision: z.number().int().positive(),
});

export const QueueEnterpriseWipReport = z.strictObject({
  periodId: id,
  projectIds: z
    .array(id)
    .min(1)
    .refine(
      (projects) => new Set(projects).size === projects.length,
      'Each project can occur once.',
    ),
  methodologyVersion: WipMethodologyVersion,
  clientRequestId: id,
});

export const EnterpriseWipOptions = z.object({
  periods: z.array(period),
  projects: z.array(z.object({ id, name: z.string() })),
  nextProjectCursor: z.string().nullable(),
});

const posting = z.object({
  postingId: id,
  sourceId: id,
  sourceRevisionId: id,
  postingDate: date,
  currency: CurrencyCodeSchema,
  recordedMinor: unsigned,
  allocatedMinor: unsigned,
  inPeriod: z.boolean(),
});

const currencyTotal = z.object({
  currency: CurrencyCodeSchema,
  periodMinor: unsigned,
  totalThroughPeriodMinor: unsigned,
});

export const EnterpriseWipReportInput = z.object({
  period,
  methodologyVersion: WipMethodologyVersion,
  projectIds: z.array(id),
  capturedAt: instant,
  currencyTotals: z.array(currencyTotal),
  rows: z.array(
    z.object({
      projectId: id,
      projectName: z.string(),
      sourceForecastId: id.nullable(),
      sourceBudgetVersion: z.number().int().positive().nullable(),
      forecastCurrency: CurrencyCodeSchema.nullable(),
      contractMinor: signed.nullable(),
      estimatedAtCompletionMinor: unsigned.nullable(),
      earnedToDateMinor: signed.nullable(),
      percentCompleteBps: z.number().int().min(0).max(10000).nullable(),
      currencyTotals: z.array(currencyTotal),
      issues: z.array(
        z.enum([
          'missing_forecast',
          'incomplete_forecast',
          'missing_contract',
          'different_currency',
          'unmatched_allocations',
          'invalid_completion_basis',
        ]),
      ),
      postingSources: z.array(posting),
    }),
  ),
});

export const EnterpriseWipReport = z.object({
  id,
  request: EnterpriseWipReportInput,
  status: z.enum(['queued', 'processing', 'ready', 'failed']),
  digest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  completedAt: instant.nullable(),
  createdAt: instant,
  errorCode: z.literal('report_generation_failed').nullable(),
});

export const EnterpriseWipReportPage = z.object({
  items: z.array(EnterpriseWipReport),
  nextCursor: z.string().nullable(),
});
