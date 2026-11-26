import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const dateTime = z.iso.datetime();
const revision = z.number().int().positive();
const minimum = z.number().int().min(1).max(20);

export const SetJobsiteEvidenceAssignment = z
  .strictObject({
    contractorMembershipId: z.uuid(),
    reviewerMembershipId: z.uuid(),
    active: z.boolean(),
    minimumMedia: minimum,
    clientRequestId: z.uuid(),
  })
  .refine(
    ({ contractorMembershipId, reviewerMembershipId }) =>
      contractorMembershipId !== reviewerMembershipId,
    {
      message: 'The inspector must be a different member.',
      path: ['reviewerMembershipId'],
    },
  );

export const JobsiteEvidenceAssignment = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  contractorMembershipId: z.uuid(),
  reviewerMembershipId: z.uuid(),
  minimumMedia: minimum,
  active: z.boolean(),
  revision,
  createdAt: dateTime,
});

export const SubmitJobsiteEvidence = z.strictObject({
  mediaRevisionIds: z
    .array(z.uuid())
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, 'Select each media revision only once.'),
  note: z.string().trim().max(1500),
  clientRequestId: z.uuid(),
});

const MediaReference = z.object({
  assetId: z.uuid(),
  mediaRevisionId: z.uuid(),
  taskLinkId: z.uuid(),
  filename: z.string().max(120),
  capturedAt: dateTime,
  originalSha256: hash,
});

export const JobsiteEvidenceCandidate = MediaReference.extend({
  ready: z.boolean(),
  availability: z.enum(['ready', 'pending', 'unavailable']),
  annotationRevision: revision.nullable(),
});

export const JobsiteEvidenceMediaSnapshot = MediaReference.extend({
  caption: z
    .object({
      id: z.uuid(),
      revision,
      text: z.string(),
      tags: z.array(z.string()),
    })
    .nullable(),
  annotation: z.object({ id: z.uuid(), revision, sha256: hash }).nullable(),
  videoPlayback: z.object({ id: z.uuid(), version: revision, sha256: hash }).nullable(),
});
export type JobsiteEvidenceMediaSnapshot = z.infer<typeof JobsiteEvidenceMediaSnapshot>;

export const JobsiteEvidenceSubmission = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  assignmentId: z.uuid(),
  revision,
  note: z.string(),
  media: z.array(JobsiteEvidenceMediaSnapshot),
  review: z.object({ id: z.uuid(), reviewerMembershipId: z.uuid(), createdAt: dateTime }),
  createdAt: dateTime,
});

export const JobsiteTaskEvidence = z.object({
  assignment: JobsiteEvidenceAssignment.nullable(),
  submission: JobsiteEvidenceSubmission.nullable(),
  candidates: z.array(JobsiteEvidenceCandidate),
  canSubmit: z.boolean(),
  canManage: z.boolean(),
});

export const JobsiteEvidenceTasks = z.object({
  items: z.array(z.object({ id: z.uuid(), title: z.string() })),
});
