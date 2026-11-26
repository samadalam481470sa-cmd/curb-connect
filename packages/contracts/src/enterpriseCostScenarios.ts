import { z } from 'zod';
import { CurrencyCodeSchema } from './common';
import { EnterpriseCostForecast, ForecastCostInput } from './enterpriseCostForecasts';
import { EnterpriseScheduleDate } from './enterpriseSchedule';

const id = z.uuid();
const amount = z.string().regex(/^\d+$/);
const signed = z.string().regex(/^-?\d+$/);

export const RunEnterpriseCostScenario = z.strictObject({
  forecastId: id,
  scenarioName: z.string().trim().min(2).max(140),
  overrides: z
    .array(ForecastCostInput)
    .refine(
      (items) => new Set(items.map((line) => line.costCodeId)).size === items.length,
      'Each cost code can occur once.',
    ),
  clientRequestId: id,
});

export const EnterpriseCostScenarioResult = z.object({
  sourceVersion: z.number().int().positive(),
  asOf: EnterpriseScheduleDate,
  currency: CurrencyCodeSchema,
  actualMinor: amount,
  priorEacMinor: amount.nullable(),
  eacMinor: amount.nullable(),
  eacDifferenceMinor: signed.nullable(),
  priorMarginMinor: signed.nullable(),
  marginMinor: signed.nullable(),
  knownRemainingMinor: amount,
  status: z.enum(['incomplete', 'complete']),
  unconvertedCurrencies: z.array(CurrencyCodeSchema),
  overrides: RunEnterpriseCostScenario.shape.overrides,
  lines: EnterpriseCostForecast.shape.lines,
});

export const EnterpriseCostScenario = EnterpriseCostScenarioResult.extend({
  id,
  projectId: id,
  forecastId: id,
  scenarioName: RunEnterpriseCostScenario.shape.scenarioName,
  createdByUserId: id,
  createdAt: z.iso.datetime(),
});

export const EnterpriseCostScenarioPage = z.object({
  items: z.array(EnterpriseCostScenario),
  nextCursor: z.string().nullable(),
});
