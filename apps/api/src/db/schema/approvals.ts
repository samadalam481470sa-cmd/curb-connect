// Tables owned by the `approvals` module (CP-059): named sign-offs on a subject, recorded with
// the rule version and evidence. Withdrawal sets withdrawn_at; the row is never deleted.
import { sql } from 'drizzle-orm';
import { boolean, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { minorUnits, revisionColumn, tsColumn } from './_columns';
import { approvalDecisionEnum, approvalSubjectTypeEnum, productLineEnum, signoffRoleEnum } from './_enums';
import { jurisdictions } from './properties';
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
    /** With a delegation: the member whose sign-off capacity was exercised. */
    actingForMembershipId: uuid('acting_for_membership_id'),
    /** The approval policy (and its revision) the decision was evaluated against. */
    policyId: uuid('policy_id'),
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

/**
 * CP-059 R: tenant- and jurisdiction-aware approval policies. The most specific active policy for
 * (subject type, product line, jurisdiction) applies: a jurisdiction policy beats the company
 * default (jurisdiction_id null). rule_version is `<policy id>@<revision>` on every decision.
 */
export const approvalPolicies = tenantTable(
  'approval_policies',
  {
    name: text('name').notNull(),
    subjectType: approvalSubjectTypeEnum('subject_type').notNull(),
    /** Null = every product line. */
    productLine: productLineEnum('product_line'),
    jurisdictionId: uuid('jurisdiction_id').references(() => jurisdictions.id),
    requiredSignoffs: signoffRoleEnum('required_signoffs').array().notNull(),
    /** One person may fill at most one sign-off on a subject, and never approve their own work. */
    separationOfDuties: boolean('separation_of_duties').notNull().default(true),
    /** Policy applies only at or above this amount (base total). Null = always. */
    minAmountMinor: minorUnits('min_amount_minor'),
    /** Optional override of which member roles may sign in each capacity. */
    eligibleRoles: jsonb('eligible_roles').notNull().default(sql`'{}'::jsonb`),
    active: boolean('active').notNull().default(true),
    revision: revisionColumn(),
  },
  (_t, h) => [h.idx('orgId', 'subjectType', 'active')],
);
