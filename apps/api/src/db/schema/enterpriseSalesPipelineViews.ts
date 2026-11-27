import type { SaveSalesPipelineView } from '@fieldline/contracts';
import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

type View = z.infer<typeof SaveSalesPipelineView>;
const suite = pgSchema('enterprise_suite');
export const salesPipelineViews = suite.table('sales_pipeline_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  name: text('name').notNull(),
  filters: jsonb('filters').$type<View['filters']>().notNull(),
  columns: jsonb('columns').$type<View['columns']>().notNull(),
  visibility: text('visibility').$type<View['visibility']>().notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
