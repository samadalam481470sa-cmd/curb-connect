import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const historyColumns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  revision: integer('revision').notNull(),
  reason: text('reason').notNull(),
  actorUserId: uuid('actor_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const salesTerritoryRevisions = suite.table('sales_territory_revisions', {
  ...historyColumns(),
  membershipId: uuid('membership_id').notNull(),
  communityId: uuid('community_id'),
  capacity: integer('capacity').notNull(),
  active: boolean('active').notNull(),
});

export const salesAssignmentPolicyRevisions = suite.table('sales_assignment_policy_revisions', {
  ...historyColumns(),
  pipelineKey: text('pipeline_key').$type<'home_sales'>().notNull(),
  enabled: boolean('enabled').notNull(),
});

export const salesLeadAssignments = suite.table('sales_lead_assignments', {
  ...historyColumns(),
  leadId: uuid('lead_id').notNull(),
  ownerMembershipId: uuid('owner_membership_id').notNull(),
  previousOwnerMembershipId: uuid('previous_owner_membership_id'),
  territoryRevisionId: uuid('territory_revision_id').notNull(),
  mode: text('mode').$type<'direct' | 'round_robin'>().notNull(),
});
