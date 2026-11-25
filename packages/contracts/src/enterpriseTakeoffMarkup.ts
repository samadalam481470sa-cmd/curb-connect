import { z } from 'zod';
import { EnterpriseTakeoffMeasurementKind } from './enterpriseTakeoffCondition';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Selection = z
  .array(EnterpriseTakeoffMeasurementKind)
  .min(1)
  .max(3)
  .refine((layers) => new Set(layers).size === layers.length, 'Select each layer once.');
export const PreviewTakeoffMarkup = z.object({ visibleLayers: Selection });
const MarkupTotal = z.object({
  layer: EnterpriseTakeoffMeasurementKind,
  quantity: z.string(),
  unit: z.string(),
});
export const TakeoffMarkupPreview = z.object({
  sheetId: z.uuid(),
  revisionId: z.uuid(),
  revisionLabel: z.string(),
  scaleLabel: z.string(),
  visibleLayers: Selection,
  approvedCount: z.number().int().nonnegative(),
  totals: z.array(MarkupTotal),
  selectionDigest: Digest,
});
export const ExportTakeoffMarkup = PreviewTakeoffMarkup.extend({
  sheetId: z.uuid(),
  revisionId: z.uuid(),
  format: z.literal('pdf'),
  selectionDigest: Digest,
  clientRequestId: z.uuid(),
});
export const TakeoffMarkupExport = TakeoffMarkupPreview.extend({
  id: z.uuid(),
  filename: z.string(),
  format: z.literal('pdf'),
  sha256: Digest,
  byteSize: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export const TakeoffMarkupExportPage = z.object({
  items: z.array(TakeoffMarkupExport),
  nextCursor: z.string().nullable(),
});
