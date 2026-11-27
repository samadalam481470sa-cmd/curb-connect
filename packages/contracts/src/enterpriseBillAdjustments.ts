import { z } from 'zod';
import { CurrencyCodeSchema } from './common';
import { PostEnterpriseBillActual, EnterpriseBillActualPosting } from './enterpriseActualBillCosts';

export const RequestEnterpriseBillAdjustment = PostEnterpriseBillActual.extend({
  reason: z.string().trim().min(3).max(1000),
});
export const DecideEnterpriseBillAdjustment = z.strictObject({
  outcome: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: z.uuid(),
});
export const EnterpriseBillAdjustment = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  input: RequestEnterpriseBillAdjustment,
  bill: z.object({
    billNumber: z.string(),
    issuerName: z.string(),
    currency: CurrencyCodeSchema,
    totalMinor: z.number().int().safe().positive(),
  }),
  requestedByUserId: z.uuid(),
  requestedAt: z.iso.datetime(),
  periodId: z.uuid(),
  periodRevision: z.number().int().positive(),
  decision: z
    .object({
      outcome: z.enum(['approved', 'rejected']),
      reason: z.string(),
      decidedByUserId: z.uuid(),
      decidedAt: z.iso.datetime(),
      posting: EnterpriseBillActualPosting.nullable(),
    })
    .nullable(),
  canDecide: z.boolean(),
});

export const EnterpriseBillAdjustmentPage = z.object({
  items: z.array(EnterpriseBillAdjustment),
  nextCursor: z.string().nullable(),
});
