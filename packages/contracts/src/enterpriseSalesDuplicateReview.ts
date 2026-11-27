import { z } from 'zod';
import { EnterpriseSalesLeadInput, SalesLeadConsent } from './enterpriseSalesLeads';

const id = z.uuid();
export const SalesDuplicatePolicy = z.object({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.string().nullable(),
  reason: z.string().nullable(),
});
export const UpdateSalesDuplicatePolicy = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: id,
});
export const SalesDuplicatePolicyHistory = z.object({
  current: SalesDuplicatePolicy,
  recent: z.array(SalesDuplicatePolicy),
});
export const ReviewSalesDuplicate = EnterpriseSalesLeadInput.extend({
  candidateId: id,
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export const SalesDuplicateComparison = z.object({
  existing: z.object({
    id,
    name: z.string(),
    revision: z.number().int().positive(),
    contactMethod: EnterpriseSalesLeadInput.shape.contactMethod,
    consent: SalesLeadConsent,
  }),
  incoming: z.object({
    name: z.string(),
    contactMethod: EnterpriseSalesLeadInput.shape.contactMethod,
    consent: SalesLeadConsent,
  }),
  sharedChannels: z.array(z.enum(['email', 'phone'])).min(1),
});
