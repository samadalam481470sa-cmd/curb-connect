import { z } from 'zod';
import { CurrencyCodeSchema } from './common';

const id = z.uuid();
const minor = z.number().int().nonnegative();
const description = z.string().trim().min(1).max(500);
const allowance = z.strictObject({ description, amountMinor: minor });
const pricedOption = z.strictObject({ optionId: id, amountMinor: minor });
const revision = z.number().int().positive();

export const ReviewSalesEstimatePricing = z.strictObject({
  baseSellMinor: minor,
  taxMinor: minor.default(0),
  includedScope: z.array(description).min(1).max(50),
  excludedScope: z.array(description).max(50).default([]),
  allowances: z.array(allowance).max(50).default([]),
  optionPricing: z
    .array(pricedOption)
    .max(100)
    .default([])
    .refine(
      (rows) => rows.length === new Set(rows.map((row) => row.optionId)).size,
      'Each option can be priced once.',
    ),
});

export const ApproveSalesEstimatePricing = ReviewSalesEstimatePricing.extend({
  priceReview: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: id,
});

export const SalesEstimatePricingReview = z.object({
  opportunityId: id,
  estimateId: id,
  revision,
  currency: CurrencyCodeSchema,
  baseSellMinor: minor,
  taxMinor: minor,
  includedScope: z.array(description),
  excludedScope: z.array(description),
  allowances: z.array(allowance),
  options: z.array(z.object({ id, name: z.string(), amountMinor: minor.nullable() })),
  allowancesMinor: minor,
  optionsMinor: minor,
  subtotalMinor: minor,
  totalMinor: minor,
  readyForApproval: z.boolean(),
  priceReview: z.string().regex(/^[a-f0-9]{64}$/),
});

export const ApprovedSalesEstimatePricing = SalesEstimatePricingReview.omit({
  priceReview: true,
}).extend({
  id,
  approvedAt: z.iso.datetime(),
  approvalReason: z.string(),
});

export const SalesEstimatePricingStatus = z.object({
  opportunityId: id,
  estimateId: id,
  estimateTitle: z.string(),
  currency: CurrencyCodeSchema,
  revision,
  approved: ApprovedSalesEstimatePricing.nullable(),
  canApprove: z.boolean(),
  sourceOptions: z.array(z.object({ id, name: z.string(), amountMinor: minor.nullable() })),
});
