import type { ApprovedSalesEstimatePricing } from '@fieldline/contracts';
import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

const suite = pgSchema('enterprise_suite');
type ApprovalSnapshot = Omit<
  z.infer<typeof ApprovedSalesEstimatePricing>,
  'id' | 'revision' | 'approvedAt' | 'approvalReason'
>;
export const salesEstimatePricingApprovals = suite.table('sales_estimate_pricing_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  opportunityId: uuid('opportunity_id').notNull(),
  estimateId: uuid('estimate_id').notNull(),
  revision: integer('revision').notNull(),
  approvalSnapshot: jsonb('approval_snapshot').$type<ApprovalSnapshot>().notNull(),
  reason: text('reason').notNull(),
  approvedByUserId: uuid('approved_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
