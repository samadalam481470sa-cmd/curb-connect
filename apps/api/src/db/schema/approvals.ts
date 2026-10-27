// Tables owned by the `approvals` module (CP-059): named sign-offs on a subject, recorded with
// the rule version and evidence. Withdrawal sets withdrawn_at; the row is never deleted.
import { jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { minorUnits, tsColumn } from './_columns';
import { approvalDecisionEnum, approvalSubjectTypeEnum, signoffRoleEnum } from './_enums';
import { tenantTable } from './_tenant';
import { approvalDelegations, memberships } from './team';

export const approvals = tenantTable(
  'approvals',
  {
    subjectType: approvalSubjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    signoffRole: signoffRoleEnum('signoff_role').notNull(),
    decision: approvalDecisionEnum('decision').notNull(),
    approverMembershipId: uuid('approver_membership_id').notNull(),
    delegationId: uuid('delegation_id'),
    ruleVersion: text('rule_version').notNull(),
    evidence: jsonb('evidence'),
    amountMinor: minorUnits('amount_minor'),
    comment: text('comment'),
    decidedAt: tsColumn('decided_at').notNull().defaultNow(),
    withdrawnAt: tsColumn('withdrawn_at'),
    withdrawnReason: text('withdrawn_reason'),
  },
  (_t, h) => [
    h.idx('orgId', 'subjectType', 'subjectId'),
    h.fk('approverMembershipId', () => memberships),
    h.fk('delegationId', () => approvalDelegations),
  ],
);
