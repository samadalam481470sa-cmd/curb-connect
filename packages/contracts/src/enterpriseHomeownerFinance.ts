import { z } from 'zod';
import { CurrencyCodeSchema, MinorUnitsSchema } from './common';

const id = z.uuid();
const instant = z.iso.datetime();

export const HomeownerFinancialFields = z.object({
  contractMinor: MinorUnitsSchema.nonnegative(),
  currency: CurrencyCodeSchema,
  approvedInternalCostMinor: z.string().regex(/^\d+$/).optional(),
  approvedMarginMinor: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
});

export const PreviewHomeownerFinanceVisibility = z.strictObject({
  contactId: id,
  acceptedProposalId: id,
  acceptedProposalVersionId: id,
  discloseInternalCost: z.boolean().default(false),
  discloseMargin: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(90),
});

const publish = PreviewHomeownerFinanceVisibility.extend({
  enabled: z.literal(true),
  contractDisclosureConfirmed: z.literal(true),
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: id,
});

export const HomeownerFinanceVisibilityPreview = z.object({
  recipientName: z.string(),
  proposalNumber: z.string(),
  proposalVersion: z.number().int().positive(),
  disclosure: HomeownerFinancialFields,
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const SetHomeownerFinanceVisibility = z.discriminatedUnion('enabled', [
  publish,
  z.strictObject({
    enabled: z.literal(false),
    reason: z.string().trim().min(3).max(1000),
    clientRequestId: id,
  }),
]);

export const HomeownerFinanceVisibilityRevision = z.object({
  id,
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  reason: z.string(),
  recordedAt: instant,
  contactId: id.nullable(),
  acceptedProposalId: id.nullable(),
  acceptedProposalVersionId: id.nullable(),
  expiresAt: instant.nullable(),
  disclosure: HomeownerFinancialFields.nullable(),
});
export const ProjectHomeownerFinanceSettings = z.object({
  current: HomeownerFinanceVisibilityRevision.nullable(),
  history: z.array(HomeownerFinanceVisibilityRevision),
  projectName: z.string(),
  shareUrl: z.url().nullable(),
  eligibleContracts: z.array(
    z.object({
      id,
      versionId: id,
      number: z.string(),
      title: z.string(),
      contactId: id,
    }),
  ),
});
export const ProjectHomeownerFinanceReceipt = HomeownerFinanceVisibilityRevision.extend({
  shareUrl: z.url().nullable(),
});
export const HomeownerFinanceLinkAccess = z.strictObject({
  token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
});
export const HomeownerFinanceLinkView = z.object({
  companyName: z.string(),
  projectName: z.string(),
  recipientName: z.string(),
  disclosure: HomeownerFinancialFields,
  expiresAt: instant,
});
