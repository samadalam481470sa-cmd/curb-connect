import { z } from 'zod';
import { CurrencyCodeSchema } from './common';

export const EnterpriseEstimateUnit = z.enum([
  'ft',
  'in',
  'yd',
  'm',
  'cm',
  'mm',
  'sq_ft',
  'sq_in',
  'sq_yd',
  'sq_m',
  'sq_cm',
  'sq_mm',
  'ea',
]);
export type EnterpriseEstimateUnit = z.infer<typeof EnterpriseEstimateUnit>;
export const EnterpriseEstimateStatus = z.enum(['draft', 'approved']);
export const EnterpriseEstimatePrecision = z.number().int().min(0).max(8);
const Quantity = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,8})?$/, 'Enter a nonnegative decimal quantity.');
const SavedQuantity = z.string().regex(/^\d+(\.\d+)?$/);
const Revision = z.number().int().positive();
const Reason = z.string().trim().min(3).max(1000);

export const CreateEnterpriseEstimate = z
  .object({
    title: z.string().trim().min(2).max(180),
    currency: CurrencyCodeSchema,
    quantityPrecision: EnterpriseEstimatePrecision.default(3),
    clientRequestId: z.uuid(),
  })
  .strict();

export const CreateEnterpriseEstimateLine = z
  .object({
    description: z.string().trim().min(2).max(300),
    unit: EnterpriseEstimateUnit,
    quantity: Quantity.nullable(),
    clientRequestId: z.uuid(),
  })
  .strict();

export const ApproveEnterpriseEstimate = z.object({ reason: Reason }).strict();
export const EnterpriseEstimateLine = z.object({
  id: z.uuid(),
  ordinal: Revision,
  description: z.string(),
  unit: EnterpriseEstimateUnit,
  quantity: SavedQuantity.nullable(),
});

export const EnterpriseEstimateRevision = z.object({
  id: z.uuid(),
  estimateId: z.uuid(),
  title: z.string(),
  revisionNumber: Revision,
  revision: Revision,
  currency: CurrencyCodeSchema,
  quantityPrecision: EnterpriseEstimatePrecision,
  status: EnterpriseEstimateStatus,
  createdAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  approvedByUserId: z.uuid().nullable(),
  approvalReason: Reason.nullable(),
});
export const EnterpriseEstimateDetail = EnterpriseEstimateRevision.extend({
  lines: z.array(EnterpriseEstimateLine),
});
export const EnterpriseEstimatePage = z.object({
  items: z.array(EnterpriseEstimateRevision),
  nextCursor: z.string().nullable(),
});
