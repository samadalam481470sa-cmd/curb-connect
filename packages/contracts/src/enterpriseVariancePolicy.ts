import { z } from 'zod';

export const FinanceVarianceRule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('off') }),
  z.object({ kind: z.literal('percent'), percentBps: z.number().int().min(1).max(1_000_000) }),
  z.object({ kind: z.literal('amount'), amountMinor: z.number().int().safe().positive() }),
]);

export const SetFinanceVarianceRule = z
  .strictObject({
    rule: FinanceVarianceRule,
    ownerMembershipId: z.uuid().nullable(),
    reason: z.string().trim().min(3).max(500),
    clientRequestId: z.uuid(),
  })
  .refine(({ rule, ownerMembershipId }) => rule.kind === 'off' || ownerMembershipId !== null, {
    path: ['ownerMembershipId'],
    message: 'Choose an active person to receive the company alerts.',
  });

export const FinanceVarianceRuleRevision = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  rule: FinanceVarianceRule,
  ownerMembershipId: z.uuid().nullable(),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});

export const FinanceVariancePolicyView = z.object({
  current: FinanceVarianceRuleRevision.nullable(),
  history: z.array(FinanceVarianceRuleRevision),
  recipients: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export const PreviewFinanceVarianceRule = z.strictObject({
  projectId: z.uuid(),
  orderId: z.uuid(),
  rule: FinanceVarianceRule,
});

export const FinanceVariancePolicyPreview = z.object({
  projectId: z.uuid(),
  orderId: z.uuid(),
  orderRevision: z.number().int().positive(),
  budgetVersion: z.number().int().positive(),
  allocationMinor: z.string(),
  committedMinor: z.string(),
  proposedMinor: z.string(),
  currentAlert: z.boolean(),
  proposedAlert: z.boolean(),
});
