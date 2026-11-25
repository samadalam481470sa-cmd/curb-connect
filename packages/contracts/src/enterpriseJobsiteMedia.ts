import { z } from 'zod';

export const JOBSITE_PHOTO_CHUNK_BYTES = 1024 * 1024;
export const JOBSITE_PHOTO_MAX_BYTES = 25 * JOBSITE_PHOTO_CHUNK_BYTES;
export const JobsitePhotoMime = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const JobsiteVideoMime = z.enum(['video/mp4', 'video/webm']);
export const JobsiteMediaMime = z.union([JobsitePhotoMime, JobsiteVideoMime]);
export const JOBSITE_VIDEO_MAX_DURATION_MS = 60_000;
export const JobsiteVideoState = z.enum(['queued', 'processing', 'ready', 'rejected', 'failed']);
export const JobsitePhotoScanState = z.enum([
  'pending',
  'clean',
  'infected',
  'unsupported',
  'scan_failed',
]);

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const dateTime = z.iso.datetime({ offset: true });
const photoSize = z.number().int().positive().max(JOBSITE_PHOTO_MAX_BYTES);
const partNumber = z.number().int().min(0).max(24);
const videoDuration = z.number().int().min(1).max(JOBSITE_VIDEO_MAX_DURATION_MS);

export const StartJobsitePhotoUpload = z
  .object({
    localCaptureId: z.uuid(),
    filename: z.string().trim().min(1).max(120),
    mimeType: JobsitePhotoMime,
    byteSize: photoSize,
    sha256: SHA256,
    capturedAt: dateTime,
  })
  .strict();

export const StartJobsiteMediaUpload = z.union([
  StartJobsitePhotoUpload,
  StartJobsitePhotoUpload.extend({ mimeType: JobsiteVideoMime, durationMs: videoDuration }),
]);

export const PutJobsitePhotoUploadPart = z
  .object({
    sha256: SHA256,
    contentBase64: z
      .base64()
      .min(4)
      .max(4 * Math.ceil(JOBSITE_PHOTO_CHUNK_BYTES / 3)),
  })
  .strict();

export const FinalizeJobsitePhotoUpload = z.object({ clientRequestId: z.uuid() }).strict();

export const JobsitePhotoUploadProgress = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  localCaptureId: z.uuid(),
  revision: z.number().int().positive(),
  partBytes: z.literal(JOBSITE_PHOTO_CHUNK_BYTES),
  totalParts: z.number().int().min(1).max(25),
  receivedParts: z.array(partNumber).max(25),
  finalizedAt: dateTime.nullable(),
});

export const JobsitePhotoAsset = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  filename: z.string(),
  mimeType: JobsitePhotoMime,
  byteSize: photoSize,
  sha256: SHA256,
  capturedAt: dateTime,
  createdAt: dateTime,
  scannedAt: dateTime.nullable(),
  scanState: JobsitePhotoScanState,
  uploaderUserId: z.uuid(),
  revision: z.number().int().positive(),
});

export const JobsitePhotoPage = z.object({
  items: z.array(JobsitePhotoAsset),
  nextCursor: z.string().nullable(),
  projectName: z.string(),
  canUpload: z.boolean(),
  canManageGrants: z.boolean(),
  maxBytes: photoSize,
});

export const JobsiteVideoPlayback = z.object({
  version: z.number().int().positive(),
  sha256: SHA256,
  byteSize: photoSize,
  durationMs: videoDuration,
  width: z.number().int().min(2).max(1280),
  height: z.number().int().min(2).max(1280),
});

export const MAX_JOBSITE_CAPTION_LENGTH = 2000;
export const MAX_JOBSITE_MEDIA_TAGS = 20;

const plainCaption = z
  .string()
  .trim()
  .max(MAX_JOBSITE_CAPTION_LENGTH)
  .refine(
    (value) =>
      ![...value].some((character) => {
        const point = character.codePointAt(0)!;
        return (point < 32 && !['\n', '\r', '\t'].includes(character)) || point === 127;
      }),
    'Caption contains an unsupported control character.',
  );
const mediaTag = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .toLowerCase()
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u,
    'Use letters, numbers, spaces, hyphens, or underscores for tags.',
  );

export const SetJobsiteMediaCaption = z.strictObject({
  caption: plainCaption,
  tags: z
    .array(mediaTag)
    .max(MAX_JOBSITE_MEDIA_TAGS)
    .transform((items) => [...new Set(items)]),
  clientRequestId: z.uuid(),
});

export const JobsiteMediaCaption = z.object({
  revision: z.number().int().min(0),
  caption: z.string(),
  tags: z.array(z.string()),
  createdByUserId: z.uuid().nullable(),
  createdAt: dateTime.nullable(),
});
export type JobsiteCaptionView = z.infer<typeof JobsiteMediaCaption>;

export const JobsiteMediaAsset = JobsitePhotoAsset.extend({
  mimeType: JobsiteMediaMime,
  declaredDurationMs: videoDuration.nullable(),
  videoState: JobsiteVideoState.nullable(),
  playback: JobsiteVideoPlayback.nullable(),
  caption: JobsiteMediaCaption,
});

export const JobsiteMediaPage = JobsitePhotoPage.extend({
  items: z.array(JobsiteMediaAsset),
  maxVideoDurationMs: videoDuration.nullable(),
});

export const SetJobsiteMediaGrant = z
  .object({
    active: z.boolean(),
    reason: z.string().trim().min(3).max(1000),
    clientRequestId: z.uuid(),
  })
  .strict();

export const JobsiteMediaGrant = z.object({
  membershipId: z.uuid(),
  active: z.boolean(),
  reason: z.string(),
  revision: z.number().int().positive(),
  createdByUserId: z.uuid(),
  createdAt: dateTime,
});
