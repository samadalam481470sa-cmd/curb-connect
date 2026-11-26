import {
  bigint,
  boolean,
  date,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const scope = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});
const receipt = () => ({
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
});
const versioned = () => ({
  ...scope(),
  ...receipt(),
  revision: integer('revision').notNull(),
});

export const financeProjectGrants = suite.table('finance_project_grants', {
  ...versioned(),
  membershipId: uuid('membership_id').notNull(),
  active: boolean('active').notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
});

export const financeBudgetBaselines = suite.table('finance_budget_baselines', {
  ...scope(),
  ...receipt(),
  currency: varchar('currency', { length: 3 }).notNull(),
  effectiveOn: date('effective_on').notNull(),
  revision: integer('revision').notNull().default(1),
  createdByUserId: uuid('created_by_user_id').notNull(),
});

type BudgetUnit =
  'allowance' | 'lump_sum' | 'each' | 'linear_ft' | 'square_ft' | 'cubic_yd' | 'hour';

export const financeBudgetLines = suite.table('finance_budget_lines', {
  ...versioned(),
  budgetId: uuid('budget_id').notNull(),
  costCodeId: uuid('cost_code_id').notNull(),
  description: varchar('description', { length: 200 }).notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  unit: text('unit').$type<BudgetUnit>().notNull(),
  phase: varchar('phase', { length: 80 }).notNull(),
  fundingSource: varchar('funding_source', { length: 120 }).notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
});

export const financeBudgetApprovals = suite.table('finance_budget_approvals', {
  ...versioned(),
  budgetId: uuid('budget_id').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
  approvedByUserId: uuid('approved_by_user_id').notNull(),
});
