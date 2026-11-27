import { z } from 'zod';
const id = z.uuid();

export const EnterpriseForecastRefreshSource = z.object({
  kind: z.enum(['purchase_commitment', 'change_order', 'actual_bill']),
  resourceId: id,
  sourceEventId: id,
  priorForecastId: id,
});

export const SetEnterpriseForecastRefresh = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: id,
});

export const EnterpriseForecastRefreshRevision = z.object({
  id,
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  reason: z.string(),
  recordedAt: z.iso.datetime(),
});

export const EnterpriseForecastRefreshSettings = z.object({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  ready: z.boolean(),
  history: z.array(EnterpriseForecastRefreshRevision),
});
