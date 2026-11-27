import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');

export const salesRevenuePreferences = suite.table('sales_revenue_preferences', {
  orgId: uuid('org_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  userId: uuid('user_id').notNull(),
  enabled: boolean('enabled').notNull(),
  revision: integer('revision').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});
export const salesOpportunityProbabilities = suite.table('sales_opportunity_probabilities', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  revision: integer('revision').notNull(),
  basisPoints: integer('basis_points').notNull(),
  reason: text('reason').notNull(),
  changedByUserId: uuid('changed_by_user_id').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  clientRequestId: uuid('client_request_id').notNull(),
});
