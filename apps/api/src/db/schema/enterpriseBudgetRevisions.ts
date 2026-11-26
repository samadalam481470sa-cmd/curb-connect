import { bigint, integer, pgSchema, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const projectBudget = () => ({
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  budgetId: uuid('budget_id').notNull(),
});
const request = () => ({
  ...projectBudget(),
  id: uuid('id').primaryKey().defaultRandom(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const financeBudgetRevisionRequests = suite.table('finance_budget_revision_requests', {
  ...request(),
  baseVersion: integer('base_version').notNull(),
  kind: text('kind').$type<'allocation_change' | 'transfer'>().notNull(),
  reason: varchar('reason', { length: 1000 }).notNull(),
  reviewerMembershipId: uuid('reviewer_membership_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
});

export const financeBudgetRevisionDeltas = suite.table('finance_budget_revision_deltas', {
  ...projectBudget(),
  revisionId: uuid('revision_id').notNull(),
  costCodeId: uuid('cost_code_id').notNull(),
  priorMinor: bigint('prior_minor', { mode: 'bigint' }).notNull(),
  deltaMinor: bigint('delta_minor', { mode: 'number' }).notNull(),
  proposedMinor: bigint('proposed_minor', { mode: 'bigint' }).notNull(),
});

export const financeBudgetRevisionDecisions = suite.table('finance_budget_revision_decisions', {
  ...request(),
  revisionId: uuid('revision_id').notNull(),
  outcome: text('outcome').$type<'approved' | 'rejected'>().notNull(),
  reason: varchar('reason', { length: 1000 }).notNull(),
  activatedVersion: integer('activated_version'),
  decidedByUserId: uuid('decided_by_user_id').notNull(),
});
