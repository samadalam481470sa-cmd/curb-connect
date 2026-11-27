import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
export const salesDuplicatePolicyRevisions = suite.table('sales_duplicate_policy_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  revision: integer('revision').notNull(),
  enabled: boolean('enabled').notNull(),
  reason: text('reason').notNull(),
  updatedByUserId: uuid('updated_by_user_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  clientRequestId: uuid('client_request_id').notNull(),
});
