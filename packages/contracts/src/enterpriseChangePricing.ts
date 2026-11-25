import { z } from 'zod';

export const ChangePricingLineInput = z.object({
  description: z.string().trim().min(2).max(180),
  unit: z.string().trim().min(1).max(24),
  direction: z.enum(['add', 'deduct']),
  quantityMilli: z.number().int().min(1).max(100_000_000),
  unitCostMinor: z.number().int().min(0).max(1_000_000_000),
  markupBps: z.number().int().min(0).max(10_000),
  taxBps: z.number().int().min(0).max(10_000),
});

export const ChangePricingInput = z.object({
  scope: z.string().trim().min(3).max(10000),
  scheduleImpactDays: z.number().int().min(-3650).max(3650),
  revisionNote: z.string().trim().min(3).max(1000),
  evidenceVersionId: z.uuid().nullable(),
  lines: z.array(ChangePricingLineInput).min(1).max(50),
  clientRequestId: z.uuid(),
});
export type ChangePricingInput = z.infer<typeof ChangePricingInput>;

export const ChangePricedLine = ChangePricingLineInput.extend({
  costMinor: z.number().int(),
  markupMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
});
export type ChangePricedLine = z.infer<typeof ChangePricedLine>;

export const ChangePricingRevision = ChangePricingInput.omit({
  lines: true,
  clientRequestId: true,
}).extend({
  id: z.uuid(),
  orderRevision: z.number().int().positive(),
  totalMinor: z.number().int(),
  lines: z.array(ChangePricedLine),
  createdAt: z.iso.datetime(),
});
export type ChangePricingRevision = z.infer<typeof ChangePricingRevision>;
export const ChangePricingHistory = z.object({ items: z.array(ChangePricingRevision) });

function roundAmount(amount: bigint, scale: bigint) {
  return (amount + scale / 2n) / scale;
}

/** Quantity, markup and tax are fixed-point. Round each component to cents before summing. */
export function priceChangeLines(lines: ChangePricingInput['lines']) {
  return lines.map((line) => {
    const cost = roundAmount(BigInt(line.quantityMilli) * BigInt(line.unitCostMinor), 1000n);
    const markup = roundAmount(cost * BigInt(line.markupBps), 10000n);
    const tax = roundAmount((cost + markup) * BigInt(line.taxBps), 10000n);
    const sign = line.direction === 'deduct' ? -1 : 1;
    return {
      ...line,
      costMinor: Number(cost) * sign,
      markupMinor: Number(markup) * sign,
      taxMinor: Number(tax) * sign,
      totalMinor: Number(cost + markup + tax) * sign,
    };
  });
}

export function canEditChangePricing(status: string): boolean {
  return status === 'pco_draft' || status === 'pricing_requested' || status === 'priced';
}
