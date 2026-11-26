import { z } from 'zod';
import { JobsiteEvidenceDecisionType } from './enterpriseJobsiteEvidence';

export const JobsiteMediaReviewQuery = z.object({
  status: z.enum(['pending', 'all']).default('pending'),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const JobsiteMediaReviewQueue = z.object({
  items: z.array(
    z.object({
      reviewId: z.uuid(),
      projectId: z.uuid(),
      projectName: z.string(),
      taskId: z.uuid(),
      title: z.string(),
      submissionRevision: z.number().int().positive(),
      submittedAt: z.iso.datetime(),
      status: z.union([z.literal('pending'), JobsiteEvidenceDecisionType]),
    }),
  ),
  nextCursor: z.string().nullable(),
});
