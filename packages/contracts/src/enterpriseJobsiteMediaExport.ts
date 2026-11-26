import { z } from 'zod';
import { JobsiteMediaMime } from './enterpriseJobsiteMedia';

export const JOBSITE_MEDIA_EXPORT_MAX_BYTES = 64 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const dateTime = z.iso.datetime();

export const JobsiteExportFormat = z.enum(['zip', 'pdf']);
export type JobsiteExportFormat = z.infer<typeof JobsiteExportFormat>;

export const JobsiteExportSelection = z.enum(['original', 'current']);
export type JobsiteExportSelection = z.infer<typeof JobsiteExportSelection>;

export const JobsiteExportStatus = z.enum(['queued', 'processing', 'ready', 'failed']);
export type JobsiteExportStatus = z.infer<typeof JobsiteExportStatus>;

export const CreateJobsiteMediaExport = z.strictObject({
  mediaIds: z
    .array(z.uuid())
    .min(1)
    .max(40)
    .refine((ids) => new Set(ids).size === ids.length, 'Select each media item only once.'),
  format: JobsiteExportFormat,
  selection: JobsiteExportSelection,
  clientRequestId: z.uuid(),
});

export const JobsiteExportItem = z.object({
  mediaId: z.uuid(),
  name: z.string().max(120),
  fileName: z.string().max(180),
  source: z.enum(['original', 'annotation', 'playback']),
  revisionId: z.uuid().nullable(),
  revision: z.number().int().positive().nullable(),
  sha256: hash,
  originalSha256: hash,
  byteSize: z.number().int().positive(),
  mimeType: JobsiteMediaMime,
  capturedAt: dateTime,
});
export type JobsiteExportItem = z.infer<typeof JobsiteExportItem>;

export const JobsiteMediaExport = z.object({
  id: z.uuid(),
  format: JobsiteExportFormat,
  selection: JobsiteExportSelection,
  status: JobsiteExportStatus,
  failureCode: z.string().nullable(),
  byteSize: z.number().int().positive().nullable(),
  sha256: hash.nullable(),
  manifest: z.array(JobsiteExportItem),
  createdAt: dateTime,
  completedAt: dateTime.nullable(),
});

export const JobsiteMediaExports = z.object({
  items: z.array(JobsiteMediaExport),
});

export const JobsiteMediaExportDownload = z.object({
  href: z.string(),
  expiresAt: dateTime,
});
