import { z } from 'zod';
import { EnterpriseForecastRefreshSource } from './enterpriseForecastRefresh';
import { CurrencyCodeSchema, MinorUnitsSchema } from './common';
import { EnterprisePurchaseCostCode } from './enterprisePurchasing';
import { EnterpriseScheduleDate } from './enterpriseSchedule';

const id = z.uuid();
const positiveMinor = z.string().regex(/^\d+$/);
const signedMinor = z.string().regex(/^-?\d+$/);
const shareBps = z.number().int().min(0).max(10000);

export const ForecastCostInput = z.discriminatedUnion('method', [
  z.strictObject({
    method: z.literal('remaining_cost'),
    costCodeId: id,
    remainingMinor: MinorUnitsSchema.nonnegative(),
  }),
  z.strictObject({
    method: z.literal('percent_complete'),
    costCodeId: id,
    percentCompleteBps: shareBps,
  }),
]);

export const CreateEnterpriseCostForecast = z.strictObject({
  asOf: EnterpriseScheduleDate,
  assumptions: z.string().trim().min(3).max(4000),
  assumptionsApproved: z.literal(true),
  remainingCostByCode: z
    .array(ForecastCostInput)
    .refine(
      (items) => new Set(items.map(({ costCodeId }) => costCodeId)).size === items.length,
      'Each cost code can occur once.',
    ),
  clientRequestId: id,
});

export const EnterpriseCostForecast = z.object({
  refreshSource: EnterpriseForecastRefreshSource.optional(),
  id,
  projectId: id,
  budgetId: id,
  budgetVersion: z.number().int().positive(),
  asOf: EnterpriseScheduleDate,
  currency: CurrencyCodeSchema,
  assumptions: z.string(),
  createdAt: z.iso.datetime(),
  createdByUserId: id,
  status: z.enum(['complete', 'incomplete']),
  actualMinor: positiveMinor,
  knownRemainingMinor: positiveMinor,
  eacMinor: positiveMinor.nullable(),
  contractMinor: signedMinor.nullable(),
  marginMinor: signedMinor.nullable(),
  unconvertedCurrencies: z.array(CurrencyCodeSchema),
  lines: z.array(
    z.object({
      costCode: EnterprisePurchaseCostCode.extend({ id }),
      approvedBudgetMinor: positiveMinor,
      actualMinor: positiveMinor,
      remainingMinor: positiveMinor.nullable(),
      method: z.enum(['remaining_cost', 'percent_complete', 'missing']),
      percentCompleteBps: shareBps.nullable(),
    }),
  ),
});

export const EnterpriseCostForecastPage = z.object({
  items: z.array(EnterpriseCostForecast),
  nextCursor: z.string().nullable(),
});
