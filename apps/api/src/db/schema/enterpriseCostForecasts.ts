import {
  date,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const projectScope = () => ({
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
});
const minor = (column: string) => numeric(column, { precision: 30, scale: 0 });

export const enterpriseCostForecastSnapshots = suite.table('cost_forecast_snapshots', {
  ...projectScope(),
  id: uuid('id').primaryKey().defaultRandom(),
  refreshKind: text('refresh_kind').$type<'purchase_commitment' | 'change_order' | 'actual_bill'>(),
  refreshResourceId: uuid('refresh_resource_id'),
  refreshEventId: uuid('refresh_event_id'),
  priorForecastId: uuid('prior_forecast_id'),
  budgetId: uuid('budget_id').notNull(),
  budgetVersion: integer('budget_version').notNull(),
  asOf: date('as_of').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  assumptions: text('assumptions').notNull(),
  actualMinor: minor('actual_minor').notNull(),
  knownRemainingMinor: minor('known_remaining_minor').notNull(),
  eacMinor: minor('eac_minor'),
  contractMinor: minor('contract_minor'),
  marginMinor: minor('margin_minor'),
  status: text('status').$type<'complete' | 'incomplete'>().notNull(),
  unconvertedCurrencies: text('unconverted_currencies').array().notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseCostForecastLines = suite.table('cost_forecast_lines', {
  ...projectScope(),
  forecastId: uuid('forecast_id').notNull(),
  costCodeId: uuid('cost_code_id').notNull(),
  approvedBudgetMinor: minor('approved_budget_minor').notNull(),
  actualMinor: minor('actual_minor').notNull(),
  remainingMinor: minor('remaining_minor'),
  method: text('method').$type<'remaining_cost' | 'percent_complete' | 'missing'>().notNull(),
  percentCompleteBps: integer('percent_complete_bps'),
});
