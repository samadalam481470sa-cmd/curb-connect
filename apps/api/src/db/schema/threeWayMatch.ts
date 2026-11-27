// Tables owned by the `threeWayMatch` module (blueprint gap 4):
//   * po_receipts / po_receipt_lines — minimal receiving against supplier
//     orders (PO lines live in supplier_orders.lines jsonb, referenced by
//     index). Full/partial receipts with shortage/damage notes.
//   * ap_invoice_matches — one match record per AP invoice: the linked PO,
//     invoice-side figures entered from the supplier's invoice (billed qty /
//     unit price per line, tax, freight, vendor, cost code), the computed
//     match status, and the variance decision. When a match record exists,
//     the AP approve step is blocked until the invoice is matched or the
//     variance is approved (enforced in the jobCost decide handler).
import { date, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { minorUnits, rateColumn, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { apInvoices } from './jobCost';
import { supplierOrders } from './jobs';

export const poReceipts = tenantTable(
  'po_receipts',
  {
    supplierOrderId: uuid('supplier_order_id').notNull(),
    receivedOn: date('received_on').notNull(),
    receivedByUserId: uuid('received_by_user_id'),
    note: text('note'),
  },
  (t, h) => [h.fk('supplierOrderId', () => supplierOrders), h.idx('orgId', 'supplierOrderId')],
);

export const poReceiptLines = tenantTable(
  'po_receipt_lines',
  {
    receiptId: uuid('receipt_id').notNull(),
    /** Index into supplier_orders.lines jsonb. */
    lineIndex: integer('line_index').notNull(),
    qtyReceived: rateColumn('qty_received').notNull(),
    condition: text('condition').$type<'ok' | 'short' | 'damaged'>().notNull().default('ok'),
    note: text('note'),
  },
  (t, h) => [h.fk('receiptId', () => poReceipts, 'cascade'), h.idx('orgId', 'receiptId')],
);

export const apInvoiceMatches = tenantTable(
  'ap_invoice_matches',
  {
    apInvoiceId: uuid('ap_invoice_id').notNull(),
    supplierOrderId: uuid('supplier_order_id'),
    status: text('status')
      .$type<'unmatched' | 'matched' | 'price_variance' | 'quantity_variance' | 'variance_approved' | 'variance_rejected'>()
      .notNull()
      .default('unmatched'),
    /** Invoice-side figures entered from the supplier's invoice. */
    billedLines: jsonb('billed_lines').notNull().default([]),
    billedTaxMinor: minorUnits('billed_tax_minor').notNull().default(0),
    billedFreightMinor: minorUnits('billed_freight_minor').notNull().default(0),
    billedVendorName: text('billed_vendor_name').notNull().default(''),
    billedCostCode: text('billed_cost_code'),
    /** Computed billed total (lines + tax + freight) at match time. */
    computedBilledTotalMinor: minorUnits('computed_billed_total_minor').notNull().default(0),
    reasons: jsonb('reasons').notNull().default([]),
    varianceReason: text('variance_reason'),
    decidedByUserId: uuid('decided_by_user_id'),
    decidedAt: tsColumn('decided_at'),
    matchedAt: tsColumn('matched_at'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('apInvoiceId', () => apInvoices, 'cascade'),
    h.fk('supplierOrderId', () => supplierOrders),
    h.uniq('orgId', 'apInvoiceId'),
    h.idx('orgId', 'status'),
  ],
);
