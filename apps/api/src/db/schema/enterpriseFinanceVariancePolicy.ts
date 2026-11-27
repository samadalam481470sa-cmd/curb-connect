import { bigint, integer, pgSchema, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
export const financeVarianceRuleRevisions = suite.table('finance_variance_rule_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  revision: integer('revision').notNull(),
  kind: text('kind').$type<'off' | 'amount' | 'percent'>().notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }),
  percentBps: integer('percent_bps'),
  ownerMembershipId: uuid('owner_membership_id'),
  reason: text('reason').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
