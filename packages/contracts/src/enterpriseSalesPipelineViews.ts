import { z } from 'zod';
import { SalesPipelineFilters } from './enterpriseSalesPipeline';

const id = z.uuid();
export const SalesPipelineColumn = z.enum([
  'source',
  'community',
  'lot',
  'owner',
  'last_contact',
  'next_activity',
  'approved_value',
  'probability',
  'days_in_stage',
]);
export type SalesPipelineColumn = z.infer<typeof SalesPipelineColumn>;
export const SalesPipelineColumns = z
  .array(SalesPipelineColumn)
  .max(SalesPipelineColumn.options.length)
  .refine((values) => new Set(values).size === values.length, 'Select each column only once.');
export const SalesPipelineViewVisibility = z.enum(['private', 'company']);
const name = z.string().trim().min(1).max(120);
export const SaveSalesPipelineView = z.strictObject({
  name,
  filters: SalesPipelineFilters,
  columns: SalesPipelineColumns,
  visibility: SalesPipelineViewVisibility,
  clientRequestId: id,
});
export const SalesPipelineView = SaveSalesPipelineView.omit({ clientRequestId: true }).extend({
  id,
  owner: z.string(),
  owned: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const SalesPipelineViewPage = z.object({
  items: z.array(SalesPipelineView),
  nextCursor: z.string().nullable(),
});
