import { z } from 'zod';
import { EnterpriseScheduleDate } from './enterpriseSchedule';

export const EnterprisePurchaseCostCode = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(24)
    .regex(/^[A-Z0-9][A-Z0-9 .-]*$/),
  label: z.string().trim().min(2).max(160),
});

export const EnterprisePurchaseOrderDetails = z.object({
  costCode: EnterprisePurchaseCostCode.shape.code,
  deliveryAddress: z.string().trim().min(5).max(1000),
  requestedDeliveryOn: EnterpriseScheduleDate.nullable(),
});

export const EnterprisePurchaseOrder = EnterprisePurchaseOrderDetails.extend({
  id: z.uuid(),
  bidPackageId: z.uuid(),
  quoteId: z.uuid(),
  title: z.string(),
  scope: z.string(),
  vendorName: z.string(),
  amountMinor: z.number().int().positive(),
  quoteValidThrough: EnterpriseScheduleDate,
  status: z.enum(['draft', 'issued']),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  issuedAt: z.iso.datetime().nullable(),
});
export type EnterprisePurchaseOrder = z.infer<typeof EnterprisePurchaseOrder>;

export const EnterprisePurchaseOrderLookup = z.object({
  order: EnterprisePurchaseOrder.nullable(),
});
export const EnterprisePurchasingPage = z.object({
  items: z.array(EnterprisePurchaseOrder),
  nextCursor: z.string().nullable(),
  costCodes: z.array(EnterprisePurchaseCostCode),
  committedTotalMinor: z.string().regex(/^\d+$/),
  commitments: z.array(
    z.object({
      costCode: EnterprisePurchaseCostCode.shape.code,
      amountMinor: z.string().regex(/^\d+$/),
    }),
  ),
});
