import { sql } from 'drizzle-orm';
import {
  bigint,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const scope = () => ({
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  orderId: uuid('order_id').notNull(),
});
const minor = (name: string) => numeric(name, { precision: 30, scale: 0 });

export const purchaseVarianceRequests = suite.table('purchase_variance_requests', {
  ...scope(),
  id: uuid('id').primaryKey().defaultRandom(),
  orderRevision: integer('order_revision').notNull(),
  budgetId: uuid('budget_id').notNull(),
  budgetVersion: integer('budget_version').notNull(),
  allocationMinor: minor('approved_allocation_minor').notNull(),
  committedMinor: minor('committed_minor').notNull(),
  orderMinor: bigint('requested_order_minor', { mode: 'number' }).notNull(),
  overrunMinor: minor('overrun_minor')
    .generatedAlwaysAs(sql`committed_minor + requested_order_minor - approved_allocation_minor`)
    .notNull(),
  reason: text('reason').notNull(),
  requestedByUserId: uuid('requested_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseVarianceDecisions = suite.table('purchase_variance_decisions', {
  ...scope(),
  varianceId: uuid('variance_id').notNull(),
  outcome: text('outcome').$type<'approved' | 'rejected'>().notNull(),
  authorizedDeltaMinor: bigint('authorized_delta_minor', { mode: 'number' }).notNull(),
  reason: text('reason').notNull(),
  decidedByUserId: uuid('decided_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
