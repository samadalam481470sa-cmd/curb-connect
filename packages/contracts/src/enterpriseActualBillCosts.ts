import { z } from 'zod';
import { CurrencyCodeSchema, MinorUnitsSchema } from './common';
import { EnterprisePurchaseCostCode } from './enterprisePurchasing';
import { EnterpriseScheduleDate as DateOnly } from './enterpriseSchedule';

const id = z.uuid();
const amount = MinorUnitsSchema.min(1);
const monthStart = DateOnly.refine(
  (date) => date.endsWith('-01'),
  'Choose the first day of the month.',
);
const state = z.enum(['open', 'closed']);

export const SetEnterpriseCostPeriod = z.strictObject({
  state,
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: id,
});

export const EnterpriseCostPeriod = z.object({
  id,
  monthStart,
  revision: z.number().int().min(1).max(2),
  state,
  reason: z.string(),
  recordedAt: z.iso.datetime(),
});

export const EnterpriseCostPeriods = z.object({
  period: EnterpriseCostPeriod.nullable(),
});

export const EnterpriseApprovedBillSource = z.object({
  sourceId: id,
  sourceRevisionId: id,
  billNumber: z.string(),
  issuerName: z.string(),
  currency: CurrencyCodeSchema,
  totalMinor: amount,
  approvedAt: z.iso.datetime(),
  status: z.enum(['approved', 'paid']),
});

export const EnterpriseApprovedBillSources = z.object({
  items: z.array(EnterpriseApprovedBillSource),
  nextCursor: z.string().nullable(),
});

export const PostEnterpriseBillActual = z.strictObject({
  sourceId: id,
  sourceRevisionId: id,
  postingDate: DateOnly,
  allocations: z
    .array(z.strictObject({ costCodeId: id, amountMinor: amount }))
    .min(1)
    .max(100)
    .refine(
      (lines) => new Set(lines.map((line) => line.costCodeId)).size === lines.length,
      'Each cost code can appear once.',
    ),
  clientRequestId: id,
});

export const EnterpriseBillActualPosting = z.object({
  id,
  projectId: id,
  sourceId: id,
  sourceRevisionId: id,
  billNumber: z.string(),
  issuerName: z.string(),
  currency: CurrencyCodeSchema,
  totalMinor: amount,
  postingDate: DateOnly,
  periodStart: monthStart,
  createdAt: z.iso.datetime(),
  allocations: z.array(
    z.object({
      costCode: EnterprisePurchaseCostCode.extend({ id }),
      amountMinor: amount,
    }),
  ),
});

export const EnterpriseBillActuals = z.object({
  items: z.array(EnterpriseBillActualPosting),
  nextCursor: z.string().nullable(),
});

const aggregateMinor = z.string().regex(/^\d+$/);
export const EnterpriseBillActualTotals = z.array(
  z.object({
    currency: CurrencyCodeSchema,
    totalMinor: aggregateMinor,
    rows: z.array(
      z.object({
        costCodeId: id,
        costCode: EnterprisePurchaseCostCode.shape.code,
        amountMinor: aggregateMinor,
      }),
    ),
  }),
);
