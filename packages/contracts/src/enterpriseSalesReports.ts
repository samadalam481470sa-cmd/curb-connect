import { z } from 'zod';
import { SalesPipelineFilters } from './enterpriseSalesPipeline';

export const HOME_SALES_PIPELINE_ID = '8d6659d1-ec6c-4243-96c2-730e849a0001';
export const SalesReportColumn = z.enum([
  'lead_name',
  'source',
  'community',
  'owner',
  'stage',
  'entered_stage_at',
  'last_activity_at',
  'next_activity_at',
  'approved_sell_minor',
  'currency',
  'converted',
  'email',
  'phone',
]);
const id = z.uuid();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const format = z.enum(['csv', 'json']);
const purpose = z.enum(['inquiry', 'marketing']);
const columns = z
  .array(SalesReportColumn)
  .min(1)
  .max(13)
  .refine((items) => new Set(items).size === items.length, 'Choose each column once.');

export const PreviewSalesReport = z.strictObject({
  pipelineId: z.literal(HOME_SALES_PIPELINE_ID),
  filters: SalesPipelineFilters,
  columns,
  format,
  contactPurpose: purpose.optional(),
});
export const QueueSalesReport = PreviewSalesReport.extend({
  viewFingerprint: sha,
  clientRequestId: id,
});
export const SalesReportPreview = z.object({
  rowCount: z.number().int().nonnegative(),
  includedColumns: z.array(SalesReportColumn),
  omittedColumns: z.array(SalesReportColumn),
  viewFingerprint: sha,
});
export const SalesReport = z.object({
  id,
  filters: SalesPipelineFilters,
  format,
  columns: z.array(SalesReportColumn),
  omittedColumns: z.array(SalesReportColumn),
  rowCount: z.number().int().nonnegative(),
  status: z.enum(['queued', 'ready', 'failed']),
  sha256: sha.nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export const SalesReportPage = z.object({
  items: z.array(SalesReport),
  nextCursor: z.string().nullable(),
});
