import type { PreviewSalesReport, SalesReportColumn } from '@fieldline/contracts';
import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

type Input = z.infer<typeof PreviewSalesReport>;
export type SalesReportRow = {
  id: string;
  fields: Partial<Record<z.infer<typeof SalesReportColumn>, string | number | boolean | null>>;
};
const suite = pgSchema('enterprise_suite');
export const salesReportRuns = suite.table('sales_report_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  requestedByUserId: uuid('requested_by_user_id').notNull(),
  requestedByMembershipId: uuid('requested_by_membership_id').notNull(),
  pipelineId: uuid('pipeline_id').notNull(),
  filters: jsonb('filters').$type<Input['filters']>().notNull(),
  format: text('format').$type<Input['format']>().notNull(),
  columns: jsonb('columns').$type<Input['columns']>().notNull(),
  omittedColumns: jsonb('omitted_columns').$type<Input['columns']>().notNull(),
  contactPurpose: text('contact_purpose').$type<NonNullable<Input['contactPurpose']>>(),
  snapshot: jsonb('snapshot').$type<SalesReportRow[]>().notNull(),
  rowCount: integer('row_count').notNull(),
  status: text('status').$type<'queued' | 'ready' | 'failed'>().notNull().default('queued'),
  fileText: text('file_text'),
  sha256: text('sha256'),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
