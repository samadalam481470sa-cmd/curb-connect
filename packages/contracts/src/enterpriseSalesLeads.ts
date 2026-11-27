import { z } from 'zod';

const id = z.uuid();
const name = z.string().trim().min(1).max(200);
const consentStatus = z.enum(['not_recorded', 'granted', 'declined']);
const contactMethod = z.enum(['none', 'email', 'phone']);
const channelConsent = z.strictObject({
  email: consentStatus.default('not_recorded'),
  phone: consentStatus.default('not_recorded'),
});
const blankConsent = { email: 'not_recorded', phone: 'not_recorded' } as const;
export const SalesLeadConsent = z.strictObject({
  inquiry: channelConsent.default(blankConsent),
  marketing: channelConsent.default(blankConsent),
});

export const EnterpriseSalesLeadSource = z.object({
  id,
  name,
});
export const CreateEnterpriseSalesLeadSource = z.strictObject({ name });
export const EnterpriseSalesLeadOptions = z.object({
  sources: z.array(EnterpriseSalesLeadSource),
  communities: z.array(z.object({ id, name })),
});

export const EnterpriseSalesLeadInput = z.strictObject({
  name,
  email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d(). -]{7,32}$/, 'Enter a valid phone number.')
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length >= 7 && value.length <= 15, 'Enter 7 to 15 phone digits.')
    .optional(),
  sourceId: id,
  communityId: id.optional(),
  contactMethod,
  consent: SalesLeadConsent,
});
export const CreateEnterpriseSalesLead = EnterpriseSalesLeadInput.extend({
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  clientRequestId: id,
  inboundEventId: z.string().trim().min(1).max(160).optional(),
  confirmSeparateLead: z.boolean().default(false),
});
export const EnterpriseSalesLeadPreview = z.object({
  possibleDuplicate: z.boolean(),
  duplicateCandidates: z.array(z.object({ id, name })),
  permittedInquiryChannels: z.array(z.enum(['email', 'phone'])),
  permittedMarketingChannels: z.array(z.enum(['email', 'phone'])),
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export const EnterpriseSalesLead = EnterpriseSalesLeadPreview.omit({
  previewFingerprint: true,
  duplicateCandidates: true,
}).extend({
  id,
  name,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  source: EnterpriseSalesLeadSource,
  community: z.object({ id, name }).nullable(),
  contactMethod,
  consent: SalesLeadConsent,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export const EnterpriseSalesLeadPage = z.object({
  items: z.array(EnterpriseSalesLead),
  nextCursor: z.string().nullable(),
});
