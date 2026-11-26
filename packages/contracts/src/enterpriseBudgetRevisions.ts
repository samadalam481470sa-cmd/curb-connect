import { z } from 'zod';
import { MinorUnitsSchema } from './common';

const uuid = z.uuid();
const instant = z.iso.datetime();
const revision = z.number().int().positive();
const deltaAmount = MinorUnitsSchema.min(-1_000_000_000_000).max(1_000_000_000_000);

export const ProposeEnterpriseBudgetRevision = z.strictObject({
  kind: z.enum(['allocation_change', 'transfer']),
  reviewerMembershipId: uuid,
  reason: z.string().trim().min(3).max(1000),
  deltas: z
    .array(
      z.strictObject({
        costCodeId: uuid,
        deltaMinor: deltaAmount.refine((amount) => amount !== 0, 'Enter a nonzero change.'),
      }),
    )
    .min(1)
    .max(200)
    .refine(
      (items) => new Set(items.map(({ costCodeId }) => costCodeId)).size === items.length,
      'Combine adjustments to the same cost code into one line.',
    ),
  clientRequestId: uuid,
});

export const DecideEnterpriseBudgetRevision = z.strictObject({
  outcome: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: uuid,
});

export const EnterpriseBudgetRevision = z.object({
  id: uuid,
  budgetId: uuid,
  baseVersion: revision,
  kind: ProposeEnterpriseBudgetRevision.shape.kind,
  reason: z.string(),
  reviewerMembershipId: uuid,
  createdAt: instant,
  state: z.enum(['pending', 'approved', 'rejected', 'stale']),
  deltas: z.array(
    z.object({
      costCode: z.object({ id: uuid, code: z.string(), label: z.string() }),
      priorMinor: z.string().regex(/^\d+$/),
      deltaMinor: deltaAmount,
      proposedMinor: z.string().regex(/^\d+$/),
    }),
  ),
  decision: z
    .object({
      outcome: DecideEnterpriseBudgetRevision.shape.outcome,
      reason: z.string(),
      decidedAt: instant,
      activatedVersion: revision.nullable(),
    })
    .nullable(),
  canDecide: z.boolean(),
});

export const EnterpriseBudgetRevisionQueue = z.object({
  activeVersion: revision,
  items: z.array(EnterpriseBudgetRevision),
  nextCursor: z.string().nullable(),
});

const signedMinor = z.string().regex(/^-?\d+$/);
export const EnterpriseBudgetAllocation = z.object({
  version: revision,
  baselineMinor: z.string().regex(/^\d+$/),
  approvedChangeMinor: signedMinor,
  currentMinor: z.string().regex(/^\d+$/),
  byCostCode: z.array(
    z.object({
      costCodeId: uuid,
      amountMinor: z.string().regex(/^\d+$/),
    }),
  ),
});
