import {
  bigint,
  date,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');

export const enterpriseCostPeriodRevisions = suite.table('cost_period_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  monthStart: date('period_start').notNull(),
  revision: integer('version').notNull(),
  state: text('state').$type<'open' | 'closed'>().notNull(),
  reason: text('reason').notNull(),
  actorUserId: uuid('actor_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseActualBillPostings = suite.table('actual_bill_postings', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  adjustmentRequestId: uuid('adjustment_request_id'),
  sourceId: uuid('bill_id').notNull(),
  sourceRevisionId: uuid('approval_event_id').notNull(),
  billNumber: text('bill_number').notNull(),
  issuerName: text('issuer_name').notNull(),
  postingDate: date('posting_on').notNull(),
  monthStart: date('period_start').notNull(),
  periodRevisionId: uuid('period_revision_id').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
  postedByUserId: uuid('posted_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseActualBillAllocations = suite.table('actual_bill_allocations', {
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  postingId: uuid('posting_id').notNull(),
  costCodeId: uuid('cost_code_id').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
});
