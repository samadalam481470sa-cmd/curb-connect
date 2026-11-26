import { z } from 'zod';

export const JOBSITE_MEDIA_ACTIVITY_ACTIONS = [
  'media.capture_registered',
  'media.upload_completed',
  'media.scan_completed',
  'media.video_processing_completed',
  'media.caption_changed',
  'media.task_linked',
  'media.photo_annotated',
] as const;
export const JobsiteMediaActivityAction = z.enum(JOBSITE_MEDIA_ACTIVITY_ACTIONS);
export type JobsiteMediaActivityAction = z.infer<typeof JobsiteMediaActivityAction>;

export const JobsiteMediaIssue = z.enum([
  'infected',
  'unsupported',
  'scan_failed',
  'video_rejected',
  'video_failed',
]);
export type JobsiteMediaIssue = z.infer<typeof JobsiteMediaIssue>;

export const JobsiteMediaActivity = z.object({
  events: z.array(
    z.object({
      id: z.uuid(),
      mediaId: z.uuid(),
      filename: z.string(),
      action: JobsiteMediaActivityAction,
      createdAt: z.iso.datetime(),
    }),
  ),
  exceptions: z.array(
    z.object({
      mediaId: z.uuid(),
      filename: z.string(),
      reason: JobsiteMediaIssue,
      revision: z.number().int().positive(),
    }),
  ),
});
