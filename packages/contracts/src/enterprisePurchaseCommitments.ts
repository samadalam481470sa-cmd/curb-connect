import { z } from 'zod';
import { MinorUnitsSchema } from './common';
import { EnterprisePurchaseCostCode } from './enterprisePurchasing';

const amount = MinorUnitsSchema.min(1).max(1_000_000_000_000);
const reason = z.string().trim().min(3).max(1000);
const outcome = z.enum(['approved', 'rejected']);

export const ProposeEnterprisePurchaseAmendment = z.strictObject({
  allocations: z
    .array(z.strictObject({ costCodeId: z.uuid(), amountMinor: amount }))
    .min(1)
    .max(100)
    .refine(
      (items) => new Set(items.map(({ costCodeId }) => costCodeId)).size === items.length,
      'Combine allocations to the same cost code into one line.',
    ),
  reason,
  clientRequestId: z.uuid(),
});

export const DecideEnterprisePurchaseAmendment = z.strictObject({
  outcome,
  reason,
  clientRequestId: z.uuid(),
});

export const EnterprisePurchaseCommitmentRevision = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  kind: z.enum(['issuance', 'amendment']),
  baseVersion: z.number().int().nonnegative(),
  totalMinor: amount,
  reason: z.string(),
  createdAt: z.iso.datetime(),
  state: z.enum(['pending', 'stale', 'approved', 'rejected']),
  allocations: z.array(
    z.object({
      costCode: EnterprisePurchaseCostCode.extend({ id: z.uuid() }),
      priorMinor: MinorUnitsSchema.nonnegative(),
      revisedMinor: MinorUnitsSchema.nonnegative(),
      deltaMinor: MinorUnitsSchema,
    }),
  ),
  decision: z
    .object({
      outcome,
      reason: z.string(),
      activatedVersion: z.number().int().positive().nullable(),
      decidedAt: z.iso.datetime(),
    })
    .nullable(),
  canDecide: z.boolean(),
});

export const EnterprisePurchaseCommitmentHistory = z.object({
  active: EnterprisePurchaseCommitmentRevision,
  items: z.array(EnterprisePurchaseCommitmentRevision),
  nextCursor: z.string().nullable(),
  costCodes: z.array(EnterprisePurchaseCostCode.extend({ id: z.uuid() })),
  canPropose: z.boolean(),
});
