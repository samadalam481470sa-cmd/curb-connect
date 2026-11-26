import { z } from 'zod';

const timestamp = z.iso.datetime();
const reason = z.string().trim().min(3).max(500);
const revision = z.number().int().min(0);

export const SetJobsiteHomeownerRecipient = z.strictObject({
  active: z.boolean(),
  reason,
  clientRequestId: z.uuid(),
});

export const JobsiteHomeownerRecipient = z.object({
  contactId: z.uuid(),
  displayName: z.string(),
  active: z.boolean(),
  revision,
});

export const CreateJobsiteHomeownerShare = z.strictObject({
  mediaRevisionIds: z
    .array(z.uuid())
    .min(1)
    .max(40)
    .refine((ids) => new Set(ids).size === ids.length, 'Select each approved image only once.'),
  homeownerId: z.uuid(),
  expiresAt: timestamp,
  clientRequestId: z.uuid(),
});

export const RevokeJobsiteHomeownerShare = z.strictObject({
  reason,
  clientRequestId: z.uuid(),
});

export const JobsiteHomeownerShare = z.object({
  id: z.uuid(),
  homeownerId: z.uuid(),
  expiresAt: timestamp,
  createdAt: timestamp,
  revision: revision.min(1),
  mediaCount: z.number().int().min(1).max(40),
  revokedAt: timestamp.nullable(),
  status: z.enum(['active', 'expired', 'revoked', 'recipient_access_ended']),
});

export const JobsiteHomeownerShareReceipt = JobsiteHomeownerShare.extend({
  galleryUrl: z.url(),
});

export const JobsiteHomeownerShareView = z.object({
  revision,
  shares: z.array(JobsiteHomeownerShare),
  recipients: z.array(JobsiteHomeownerRecipient),
  available: z.array(
    z.object({
      previewId: z.uuid(),
      assetId: z.uuid(),
      filename: z.string(),
      previewHref: z.string(),
      approvedAt: timestamp,
    }),
  ),
});

export const JobsiteGalleryAccess = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const JobsiteHomeownerGallery = z.object({
  companyName: z.string(),
  recipientName: z.string(),
  expiresAt: timestamp,
  images: z.array(
    z.object({
      id: z.uuid(),
      width: z.number().int().min(1).max(1920),
      height: z.number().int().min(1).max(1920),
    }),
  ),
});
