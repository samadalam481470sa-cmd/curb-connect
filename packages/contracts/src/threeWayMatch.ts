// Three-way match contracts (blueprint gap 4): PO receiving, invoice↔PO↔
// receipt matching with entered invoice-side figures, variance decisions, and
// duplicate-invoice detection. Money is integer minor units.
import { z } from 'zod';
import { UuidSchema } from './common';

export const OrderListItemSchema = z.object({
  id: UuidSchema,
  supplierName: z.string(),
  status: z.string(),
  reference: z.string().nullable(),
  totalMinor: z.number().int().nullable(),
  jobId: UuidSchema,
});

export const ReceiptLineInputSchema = z.object({
  lineIndex: z.number().int().min(0).max(1000),
  qtyReceived: z.number().min(0).max(1_000_000_000),
  condition: z.enum(['ok', 'short', 'damaged']).default('ok'),
  note: z.string().trim().max(500).nullable().optional(),
});

export const CreateReceiptRequestSchema = z.object({
  receivedOn: z.iso.date(),
  note: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(ReceiptLineInputSchema).min(1).max(200),
});

export const ReceiptLineSchema = z.object({
  id: UuidSchema,
  lineIndex: z.number().int(),
  qtyReceived: z.number(),
  condition: z.enum(['ok', 'short', 'damaged']),
  note: z.string().nullable(),
});

export const PoReceiptSchema = z.object({
  id: UuidSchema,
  supplierOrderId: UuidSchema,
  receivedOn: z.string(),
  note: z.string().nullable(),
  lines: z.array(ReceiptLineSchema),
  createdAt: z.string(),
});
export type PoReceipt = z.infer<typeof PoReceiptSchema>;

export const ReceivingSummaryLineSchema = z.object({
  lineIndex: z.number().int(),
  label: z.string(),
  unit: z.string(),
  orderedQty: z.number(),
  receivedQty: z.number(),
  unitPriceMinor: z.number().int().nullable(),
});

export const ReceivingSummarySchema = z.object({
  supplierOrderId: UuidSchema,
  supplierName: z.string(),
  status: z.string(),
  lines: z.array(ReceivingSummaryLineSchema),
});
export type ReceivingSummary = z.infer<typeof ReceivingSummarySchema>;

export const BilledLineInputSchema = z.object({
  lineIndex: z.number().int().min(0).max(1000),
  billedQty: z.number().min(0).max(1_000_000_000),
  billedUnitPriceMinor: z.number().int().min(0).max(1_000_000_000_000),
});

export const MatchApInvoiceRequestSchema = z.object({
  supplierOrderId: UuidSchema,
  billedLines: z.array(BilledLineInputSchema).max(200),
  billedTaxMinor: z.number().int().min(0).max(1_000_000_000_000).default(0),
  billedFreightMinor: z.number().int().min(0).max(1_000_000_000_000).default(0),
  billedVendorName: z.string().trim().min(1).max(200),
  billedCostCode: z.string().trim().max(60).nullable().optional(),
});

export const MatchStatusSchema = z.enum([
  'unmatched',
  'matched',
  'price_variance',
  'quantity_variance',
  'variance_approved',
  'variance_rejected',
]);

export const MatchLineResultSchema = z.object({
  lineIndex: z.number().int(),
  label: z.string(),
  orderedQty: z.number(),
  receivedQty: z.number(),
  billedQty: z.number(),
  poUnitPriceMinor: z.number().int().nullable(),
  billedUnitPriceMinor: z.number().int(),
  quantityOk: z.boolean(),
  priceOk: z.boolean().nullable(),
});

export const ApInvoiceMatchSchema = z.object({
  id: UuidSchema,
  apInvoiceId: UuidSchema,
  supplierOrderId: UuidSchema.nullable(),
  status: MatchStatusSchema,
  billedLines: z.array(BilledLineInputSchema),
  billedTaxMinor: z.number().int(),
  billedFreightMinor: z.number().int(),
  billedVendorName: z.string(),
  billedCostCode: z.string().nullable(),
  computedBilledTotalMinor: z.number().int(),
  invoiceAmountMinor: z.number().int(),
  amountMatchesInvoice: z.boolean(),
  vendorMatches: z.boolean(),
  costCodeMatches: z.boolean(),
  lines: z.array(MatchLineResultSchema),
  reasons: z.array(z.string()),
  varianceReason: z.string().nullable(),
  decidedAt: z.string().nullable(),
  matchedAt: z.string().nullable(),
  duplicateInvoiceIds: z.array(UuidSchema),
  revision: z.number().int(),
});
export type ApInvoiceMatch = z.infer<typeof ApInvoiceMatchSchema>;

export const DecideMatchRequestSchema = z.object({
  decision: z.enum(['approve_variance', 'reject_variance']),
  reason: z.string().trim().min(1).max(2000),
});
