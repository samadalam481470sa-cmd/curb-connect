import { z } from 'zod';
import {
  JobsiteEvidenceCandidate,
  JobsiteEvidenceDecisionType,
  JobsiteEvidenceSubmission,
} from './enterpriseJobsiteEvidence';
import {
  JobsiteMediaCaption,
  JobsiteMediaPage,
  JobsiteMediaTaskLink,
  JobsiteMediaTaskLinkList,
  JobsiteMediaTaskLinkResult,
} from './enterpriseJobsiteMedia';

const ContractorMediaTaskLink = JobsiteMediaTaskLink.omit({ createdByUserId: true });
export const ContractorMediaTaskLinks = JobsiteMediaTaskLinkList.extend({
  items: z.array(ContractorMediaTaskLink),
});
export const ContractorMediaTaskLinkResult = JobsiteMediaTaskLinkResult.extend({
  link: ContractorMediaTaskLink,
});

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

export const ContractorMediaJob = JobsiteMediaPage.pick({
  canUpload: true,
  maxBytes: true,
  maxVideoDurationMs: true,
}).extend({
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
      caption: JobsiteMediaCaption,
      canEditMetadata: z.boolean(),
    }),
  ),
  nextFileCursor: z.string().nullable(),
});

export const ContractorEvidenceReceipt = JobsiteEvidenceSubmission.pick({
  revision: true,
  createdAt: true,
});

export const ContractorEvidenceTask = z.object({
  revision: z.number().int().nonnegative(),
  canSubmit: z.boolean(),
  minimumMedia: z.number().int().min(1).max(20),
  candidates: z.array(
    JobsiteEvidenceCandidate.pick({
      mediaRevisionId: true,
      filename: true,
      availability: true,
      ready: true,
      annotationRevision: true,
    }).extend({ annotationRevision: z.null() }),
  ),
});
