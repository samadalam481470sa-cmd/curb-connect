import { z } from 'zod';
import { EnterpriseEstimateUnit, EnterpriseEstimatePrecision } from './enterpriseEstimates';
import { EnterpriseTakeoffMeasurementKind } from './enterpriseTakeoffCondition';
import { EnterpriseTakeoffUnit } from './enterpriseTakeoffCalibration';

const Quantity = z.string().regex(/^\d+(\.\d+)?$/);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Revision = z.number().int().positive();
const Mapping = z
  .object({
    estimateLineId: z.uuid(),
    replacementReason: z.string().trim().min(3).max(1000).nullable().default(null),
  })
  .strict();
const Fields = {
  takeoffRevisionId: z.uuid(),
  mappings: z
    .array(Mapping)
    .min(1)
    .max(30)
    .refine(
      (entries) =>
        new Set(entries.map(({ estimateLineId }) => estimateLineId)).size === entries.length,
      'Select each target line once.',
    ),
};
export const PreviewEnterpriseTakeoffTransfer = z.object(Fields).strict();
export const ConfirmEnterpriseTakeoffTransfer = z
  .object({
    ...Fields,
    previewDigest: Digest,
    clientRequestId: z.uuid(),
    confirmed: z.literal(true),
  })
  .strict();

const TransferLine = z.object({
  estimateLineId: z.uuid(),
  description: z.string(),
  targetUnit: EnterpriseEstimateUnit,
  oldQuantity: Quantity.nullable(),
  oldSourceReviewId: z.uuid().nullable(),
  unroundedQuantity: Quantity,
  roundedQuantity: Quantity,
  replacementReason: z.string().nullable(),
  disposition: z.enum(['ready', 'requires_replacement', 'already_applied']),
});
export const EnterpriseTakeoffTransferPreview = z.object({
  estimateRevisionId: z.uuid(),
  revision: Revision,
  quantityPrecision: EnterpriseEstimatePrecision,
  sourceReviewId: z.uuid(),
  sourceKind: EnterpriseTakeoffMeasurementKind,
  sourceQuantity: z.number().nonnegative(),
  sourceUnit: EnterpriseTakeoffUnit.nullable(),
  mappings: z.array(TransferLine),
  previewDigest: Digest,
});
export const EnterpriseTakeoffTransferResult = z.object({
  estimateRevisionId: z.uuid(),
  sourceReviewId: z.uuid(),
  revision: Revision,
  transferId: z.uuid().nullable(),
  applied: z.boolean(),
  mappings: z.array(TransferLine),
});

export const EnterpriseApprovedTakeoffSource = z.object({
  id: z.uuid(),
  measurementKind: EnterpriseTakeoffMeasurementKind,
  quantity: z.number().nonnegative(),
  unit: EnterpriseTakeoffUnit.nullable(),
  planTitle: z.string(),
  revisionLabel: z.string(),
  sheetLabel: z.string(),
  createdAt: z.iso.datetime(),
});

export const EnterpriseApprovedTakeoffSources = z.object({
  items: z.array(EnterpriseApprovedTakeoffSource),
  nextCursor: z.string().nullable(),
});
