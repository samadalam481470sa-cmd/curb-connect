import { z } from 'zod';
import { MinorUnitsSchema } from './common';

const id = z.uuid();
const revision = z.number().int().positive();
const unsigned = z.string().regex(/^\d+$/);
const reason = z.string().trim().min(3).max(1000);
const decision = z.enum(['approved', 'rejected']);

export const RequestEnterprisePurchaseVariance = z.strictObject({
  reviewedBudgetVersion: revision,
  reviewedCommittedMinor: unsigned,
  reason,
  clientRequestId: id,
});

export const DecideEnterprisePurchaseVariance = z
  .strictObject({
    decision,
    authorizedDeltaMinor: MinorUnitsSchema.nonnegative(),
    reason,
    clientRequestId: id,
  })
  .refine(
    (body) => (body.decision === 'approved') === body.authorizedDeltaMinor > 0,
    'Approved waivers need a positive amount. Rejections authorize zero.',
  );

const varianceBasis = z.object({
  budgetId: id,
  budgetVersion: revision,
  orderRevision: revision,
  allocationMinor: unsigned,
  committedMinor: unsigned,
  orderMinor: unsigned,
  overrunMinor: unsigned,
});

export const EnterprisePurchaseVariance = varianceBasis.extend({
  id,
  orderId: id,
  reason: z.string(),
  createdAt: z.iso.datetime(),
  status: z.enum(['awaiting_review', 'approved', 'rejected', 'superseded']),
  decision: z
    .object({
      outcome: decision,
      authorizedDeltaMinor: MinorUnitsSchema.nonnegative(),
      reason: z.string(),
      decidedAt: z.iso.datetime(),
    })
    .nullable(),
  canDecide: z.boolean(),
});

export const EnterprisePurchaseVarianceView = z.object({
  current: varianceBasis.nullable(),
  canRequest: z.boolean(),
  gate: z.enum(['clear', 'review_required', 'approved']),
  items: z.array(EnterprisePurchaseVariance),
  nextCursor: z.string().nullable(),
});
