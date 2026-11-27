import { z } from 'zod';
import { CurrencyCodeSchema } from './common';

const id = z.uuid();
const title = z.string().trim().min(3).max(200);
const text = z.string().trim().min(1).max(500);
const revision = z.number().int().positive();

export const ApproveSalesProposalTemplate = z.strictObject({
  name: title,
  terms: z.array(text).min(1).max(30),
  paymentTerms: z.array(text).min(1).max(30),
  taxTreatment: text,
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: id,
});
export const SalesProposalTemplate = ApproveSalesProposalTemplate.omit({
  clientRequestId: true,
}).extend({
  id,
  revision,
  approvedAt: z.iso.datetime(),
});
export const SalesProposalTemplateList = z.object({ items: z.array(SalesProposalTemplate) });

export const GenerateSalesProposal = z.strictObject({
  estimateRevisionId: id,
  templateRevisionId: id,
  contactId: id,
  validUntil: z.iso.date(),
  clientRequestId: id,
});
export const SalesProposalReceipt = z.object({
  id,
  opportunityId: id,
  estimateRevisionId: id,
  templateRevisionId: id,
  proposalId: id,
  proposalVersionId: id,
  proposalNumber: z.string(),
  totalMinor: z.number().int().nonnegative(),
  currency: CurrencyCodeSchema,
  validUntil: z.iso.date(),
  pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
  revision,
  createdAt: z.iso.datetime(),
});
export const SalesProposalOptions = z.object({
  opportunityId: id,
  opportunityName: z.string(),
  revision,
  approvedEstimateId: id.nullable(),
  canGenerate: z.boolean(),
  approvedTotalMinor: z.number().int().nonnegative().nullable(),
  currency: CurrencyCodeSchema.nullable(),
  eligibleContacts: z.array(
    z.object({ id, customerId: id, name: z.string(), customerName: z.string() }),
  ),
  templates: z.array(SalesProposalTemplate),
  earliestExpiration: z.iso.date(),
  existing: SalesProposalReceipt.nullable(),
});
