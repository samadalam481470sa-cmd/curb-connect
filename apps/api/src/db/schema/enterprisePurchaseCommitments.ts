import { bigint, integer, pgSchema, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const suite = pgSchema('enterprise_suite');
const scope = () => ({
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  orderId: uuid('order_id').notNull(),
});

export const purchaseCommitmentRevisions = suite.table('purchase_commitment_revisions', {
  ...scope(),
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').$type<'issuance' | 'amendment'>().notNull(),
  baseVersion: integer('base_version').notNull(),
  totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
  reason: text('reason').notNull(),
  requestedByUserId: uuid('requested_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id'),
  requestHash: varchar('request_hash', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseCommitmentAllocations = suite.table('purchase_commitment_allocations', {
  ...scope(),
  revisionId: uuid('revision_id').notNull(),
  costCodeId: uuid('cost_code_id').notNull(),
  priorMinor: bigint('prior_minor', { mode: 'number' }).notNull(),
  revisedMinor: bigint('revised_minor', { mode: 'number' }).notNull(),
  deltaMinor: bigint('delta_minor', { mode: 'number' })
    .generatedAlwaysAs(sql`revised_minor - prior_minor`)
    .notNull(),
});

export const purchaseCommitmentDecisions = suite.table('purchase_commitment_decisions', {
  ...scope(),
  revisionId: uuid('revision_id').notNull(),
  outcome: text('outcome').$type<'approved' | 'rejected'>().notNull(),
  activatedVersion: integer('activated_version'),
  reason: text('reason').notNull(),
  decidedByUserId: uuid('decided_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id'),
  requestHash: varchar('request_hash', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
