// Requisition + backorder contracts (blueprint gap 7). Requisition items use
// the same shape as supplier-order lines so conversion is a straight copy.
import { z } from 'zod';
import { UuidSchema } from './common';

export const RequisitionItemSchema = z.object({
  label: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(40),
  unitPriceMinor: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
});
export type RequisitionItem = z.infer<typeof RequisitionItemSchema>;

export const RequisitionStatusSchema = z.enum(['draft', 'submitted', 'approved', 'rejected', 'converted']);

export const RequisitionSchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema,
  jobNumber: z.string(),
  jobTitle: z.string(),
  costCode: z.string().nullable(),
  supplierName: z.string().nullable(),
  items: z.array(RequisitionItemSchema),
  totalMinor: z.number().int().nullable(),
  neededBy: z.string().nullable(),
  requesterUserId: UuidSchema.nullable(),
  status: RequisitionStatusSchema,
  convertedOrderId: UuidSchema.nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
  revision: z.number().int(),
  createdAt: z.string(),
});
export type Requisition = z.infer<typeof RequisitionSchema>;

export const CreateRequisitionRequestSchema = z.object({
  jobId: UuidSchema,
  costCode: z.string().trim().max(60).nullable().optional(),
  supplierName: z.string().trim().max(200).nullable().optional(),
  items: z.array(RequisitionItemSchema).min(1).max(200),
  neededBy: z.iso.date().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export const UpdateRequisitionRequestSchema = z.object({
  costCode: z.string().trim().max(60).nullable().optional(),
  supplierName: z.string().trim().max(200).nullable().optional(),
  items: z.array(RequisitionItemSchema).min(1).max(200).optional(),
  neededBy: z.iso.date().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export const ConvertRequisitionRequestSchema = z.object({
  /** Supplier for the draft PO; falls back to the requisition's entered supplier. */
  supplierName: z.string().trim().min(1).max(200).optional(),
  reference: z.string().trim().max(200).nullable().optional(),
});

export const BackorderLineSchema = z.object({
  supplierOrderId: UuidSchema,
  supplierName: z.string(),
  orderStatus: z.string(),
  lineIndex: z.number().int(),
  label: z.string(),
  orderedQty: z.number(),
  receivedQty: z.number(),
  backorderedQty: z.number(),
  expectedOn: z.string().nullable(),
  note: z.string().nullable(),
  ageDays: z.number().int(),
  overdue: z.boolean(),
});
export type BackorderLine = z.infer<typeof BackorderLineSchema>;

export const BackorderAgingResponseSchema = z.object({
  asOf: z.string(),
  items: z.array(BackorderLineSchema),
  openCount: z.number().int(),
  overdueCount: z.number().int(),
});

export const SetBackorderRequestSchema = z.object({
  expectedOn: z.iso.date().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});
