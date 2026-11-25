import { z } from 'zod';

const Reason = z.string().trim().min(3).max(1000);
export const SetTakeoffSymbolDetection = z
  .object({
    enabled: z.boolean(),
    reason: Reason,
    clientRequestId: z.uuid(),
  })
  .strict();
export const TakeoffSymbolDetectionRevision = SetTakeoffSymbolDetection.omit({
  clientRequestId: true,
}).extend({
  revision: z.number().int().positive(),
  createdByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export const TakeoffSymbolDetectionSetting = z.object({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  recentChanges: z.array(TakeoffSymbolDetectionRevision),
});
