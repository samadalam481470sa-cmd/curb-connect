// Tables owned by the `reviews` module: human review queue with claim leases and second review.
import { boolean, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { revisionColumn, tsColumn } from './_columns';
import { priorityEnum, reviewDecisionEnum, reviewTaskKindEnum, reviewTaskStatusEnum } from './_enums';
import { tenantTable } from './_tenant';
import { memberships } from './team';

export const reviewTasks = tenantTable(
  'review_tasks',
  {
    kind: reviewTaskKindEnum('kind').notNull(),
    status: reviewTaskStatusEnum('status').notNull().default('open'),
    priority: priorityEnum('priority').notNull().default('normal'),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    claimedByMembershipId: uuid('claimed_by_membership_id'),
    leaseExpiresAt: tsColumn('lease_expires_at'),
    dueAt: tsColumn('due_at'),
    requiresSecondReview: boolean('requires_second_review').notNull().default(false),
    firstReviewerMembershipId: uuid('first_reviewer_membership_id'),
    secondReviewerMembershipId: uuid('second_reviewer_membership_id'),
    decision: reviewDecisionEnum('decision'),
    checklist: jsonb('checklist'),
    comments: text('comments'),
    completedAt: tsColumn('completed_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.idx('orgId', 'status', 'kind'),
    h.idx('orgId', 'subjectType', 'subjectId'),
    h.fk('claimedByMembershipId', () => memberships),
    h.fk('firstReviewerMembershipId', () => memberships),
    h.fk('secondReviewerMembershipId', () => memberships),
  ],
);
