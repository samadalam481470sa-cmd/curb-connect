import type { SalesEstimateSnapshot } from '@fieldline/contracts';
import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

const suite = pgSchema('enterprise_suite');
type Snapshot = z.infer<typeof SalesEstimateSnapshot>;
const meta = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  revision: integer('revision').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const salesEstimateTemplateRevisions = suite.table('sales_estimate_template_revisions', {
  ...meta(),
  sourceTemplateId: uuid('source_template_id').notNull(),
  approvedSnapshot: jsonb('approved_snapshot')
    .$type<Omit<NonNullable<Snapshot['template']>, 'id' | 'revision' | 'sourceTemplateId'>>()
    .notNull(),
  reason: text('reason').notNull(),
  approvedByUserId: uuid('approved_by_user_id').notNull(),
});

export const salesEstimateDrafts = suite.table('sales_estimate_drafts', {
  ...meta(),
  opportunityId: uuid('opportunity_id').notNull(),
  title: text('title').notNull(),
  currency: text('currency').notNull(),
  lotId: uuid('lot_id'),
  priceBookRevisionId: uuid('price_book_revision_id'),
  templateRevisionId: uuid('template_revision_id'),
  snapshot: jsonb('snapshot').$type<Snapshot>().notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
});
