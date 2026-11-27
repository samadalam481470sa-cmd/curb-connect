import { date, jsonb, pgSchema, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { PostEnterpriseBillActual } from '@fieldline/contracts';

const suite = pgSchema('enterprise_suite');
type Split = z.infer<typeof PostEnterpriseBillActual>['allocations'];
const record = () => ({
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  reason: text('reason').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const closedBillAdjustments = suite.table('closed_bill_adjustments', {
  ...record(),
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('bill_id').notNull(),
  sourceRevisionId: uuid('approval_event_id').notNull(),
  monthStart: date('period_start').notNull(),
  periodRevisionId: uuid('period_revision_id').notNull(),
  postingDate: date('posting_on').notNull(),
  split: jsonb('allocation_split').$type<Split>().notNull(),
  requestedByUserId: uuid('requested_by_user_id').notNull(),
});

export const closedBillAdjustmentDecisions = suite.table('closed_bill_adjustment_decisions', {
  ...record(),
  adjustmentId: uuid('adjustment_id').notNull(),
  outcome: text('outcome').$type<'approved' | 'rejected'>().notNull(),
  postingId: uuid('posting_id'),
  decidedByUserId: uuid('decided_by_user_id').notNull(),
});
