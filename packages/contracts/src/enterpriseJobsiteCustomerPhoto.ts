import { z } from 'zod';

const revision = z.number().int().min(0);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const dateTime = z.iso.datetime();

export const CreateJobsiteCustomerPhotoPreview = z.strictObject({
  baseAnnotationRevision: revision,
  clientRequestId: z.uuid(),
});

export const ApproveJobsiteCustomerPhotoPreview = z.strictObject({
  confirmedCustomerSafe: z.literal(true),
  reason: z.string().trim().min(3).max(500),
  clientRequestId: z.uuid(),
});

export const JobsiteCustomerPhotoPreview = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  revision: revision.min(1),
  sourceAnnotationRevision: revision,
  sourceSha256: hash,
  sha256: hash,
  width: z.number().int().min(1).max(1920),
  height: z.number().int().min(1).max(1920),
  byteSize: z.number().int().min(1).max(26_214_400),
  redactionCount: z.number().int().min(0).max(50),
  createdAt: dateTime,
});

export const JobsiteCustomerPhotoApproval = z.object({
  id: z.uuid(),
  previewId: z.uuid(),
  reason: z.string(),
  approvedByUserId: z.uuid(),
  approvedAt: dateTime,
});

export const JobsiteCustomerPhotoView = z.object({
  revision,
  annotationRevision: revision,
  preview: JobsiteCustomerPhotoPreview.nullable(),
  approval: JobsiteCustomerPhotoApproval.nullable(),
  current: z.boolean(),
});
