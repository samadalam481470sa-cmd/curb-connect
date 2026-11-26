import { z } from 'zod';
import { JobsiteEvidenceDecisionType } from './enterpriseJobsiteEvidence';

const ContractorJob = z.object({
  id: z.uuid(),
  name: z.string(),
  taskCount: z.number().int().positive(),
  completedTaskCount: z.number().int().nonnegative(),
});

export const ContractorMediaJobs = z.object({
  companyName: z.string(),
  items: z.array(ContractorJob),
  nextCursor: z.string().nullable(),
});

export const ContractorMediaJob = z.object({
  companyName: z.string(),
  job: ContractorJob,
  tasks: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      requiredMedia: z.number().int().positive(),
      evidenceRevision: z.number().int().positive().nullable(),
      evidenceStatus: z.union([
        z.literal('unsubmitted'),
        z.literal('pending'),
        JobsiteEvidenceDecisionType,
      ]),
      completed: z.boolean(),
    }),
  ),
  files: z.array(
    z.object({
      id: z.uuid(),
      filename: z.string(),
      kind: z.enum(['photo', 'video']),
      revision: z.number().int().positive(),
      capturedAt: z.iso.datetime(),
      status: z.enum(['processing', 'available', 'unavailable']),
    }),
  ),
  nextFileCursor: z.string().nullable(),
});
