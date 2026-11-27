import { CurrencyCodeSchema } from './common';
import { z } from 'zod';

const id = z.uuid();
const instant = z.iso.datetime();
const revision = z.number().int().nonnegative();
const probability = z.number().int().min(0).max(10_000);
const minor = z.string().regex(/^\d+$/);

export const SalesRevenuePreference = z.object({
  enabled: z.boolean(),
  defaultEnabled: z.boolean(),
  revision,
  changedAt: instant.nullable(),
});
export const SetSalesRevenuePreference = z.strictObject({ enabled: z.boolean() });
export const SalesRevenueForecast = z.object({
  totals: z.array(
    z.object({
      currency: CurrencyCodeSchema,
      projectedMinor: minor,
      approvedMinor: minor,
      opportunities: z.number().int().nonnegative(),
    }),
  ),
  includedCount: z.number().int().nonnegative(),
  missingInputsCount: z.number().int().nonnegative(),
});
export const SalesRevenuePipeline = z.object({
  preference: SalesRevenuePreference,
  forecast: SalesRevenueForecast.nullable(),
});
export const SalesOpportunityProbability = z.object({
  opportunityId: id,
  revision,
  basisPoints: probability.nullable(),
  reason: z.string().nullable(),
  changedAt: instant.nullable(),
});
export const SetSalesOpportunityProbability = z.strictObject({
  basisPoints: probability,
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: id,
});
