import { z } from 'zod';
import { EnterpriseScheduleDate } from './enterpriseSchedule';

export const EnterpriseBidPackageInput = z.object({
  title: z.string().trim().min(2).max(180),
  scope: z.string().trim().min(3).max(8000),
  dueOn: EnterpriseScheduleDate,
  clientRequestId: z.uuid(),
});
export const EnterpriseBidQuoteInput = z.object({
  vendorName: z.string().trim().min(2).max(180),
  amountMinor: z.number().int().min(1).max(1_000_000_000_000),
  leadDays: z.number().int().min(0).max(3650),
  validThrough: EnterpriseScheduleDate,
  qualifications: z.string().trim().max(4000),
  clientRequestId: z.uuid(),
});

export const EnterpriseBidPackage = EnterpriseBidPackageInput.omit({
  clientRequestId: true,
}).extend({
  id: z.uuid(),
  revision: z.number().int().positive(),
  status: z.enum(['collecting', 'awarded', 'closed']),
  awardedQuoteId: z.uuid().nullable(),
  decisionNote: z.string().nullable(),
});
export type EnterpriseBidPackage = z.infer<typeof EnterpriseBidPackage>;

export const EnterpriseBidQuote = EnterpriseBidQuoteInput.omit({ clientRequestId: true }).extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type EnterpriseBidQuote = z.infer<typeof EnterpriseBidQuote>;
export const EnterpriseBidPackagePage = z.object({
  items: z.array(EnterpriseBidPackage),
  nextCursor: z.string().nullable(),
});
export const EnterpriseBidCollection = z.object({
  package: EnterpriseBidPackage,
  quotes: z.array(EnterpriseBidQuote),
});
