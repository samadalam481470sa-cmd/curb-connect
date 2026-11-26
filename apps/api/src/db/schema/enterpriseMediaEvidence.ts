import type { JobsiteEvidenceMediaSnapshot } from '@fieldline/contracts';
import { boolean, integer, jsonb, pgSchema, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const scope = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  taskId: uuid('task_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
const receipt = () => ({
  revision: integer('revision').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
});

export const enterpriseEvidenceAssignments = suite.table('media_evidence_assignments', {
  ...scope(),
  ...receipt(),
  contractorMembershipId: uuid('contractor_membership_id').notNull(),
  reviewerMembershipId: uuid('reviewer_membership_id').notNull(),
  minimumMedia: integer('minimum_media').notNull(),
  active: boolean('active').notNull(),
});

export const enterpriseEvidenceSubmissions = suite.table('media_evidence_submissions', {
  ...scope(),
  ...receipt(),
  assignmentId: uuid('assignment_id').notNull(),
  mediaSnapshot: jsonb('media_snapshot').$type<JobsiteEvidenceMediaSnapshot[]>().notNull(),
  note: varchar('note', { length: 1500 }).notNull(),
});

export const enterpriseEvidenceReviewTasks = suite.table('media_evidence_review_tasks', {
  ...scope(),
  submissionId: uuid('submission_id').notNull(),
  reviewerMembershipId: uuid('reviewer_membership_id').notNull(),
});
