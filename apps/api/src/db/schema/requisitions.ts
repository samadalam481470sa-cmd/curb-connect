// Tables owned by the `requisitions` module (blueprint gap 7):
//   * purchase_requisitions — field/office material requests (job, cost code,
//     items in the same shape as supplier-order lines, needed-by, requester)
//     with submit/approve flow. Conversion creates ONE draft supplier order
//     (converted_order_id is unique — converting twice cannot create two POs).
//   * po_line_backorders — entered expected date/note per PO line. The
//     backordered quantity itself is derived (ordered − received from
//     po_receipts), never stored stale.
import { sql } from 'drizzle-orm';
import { date, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { jobs, supplierOrders } from './jobs';

export const purchaseRequisitions = tenantTable(
  'purchase_requisitions',
  {
    jobId: uuid('job_id').notNull(),
    costCode: text('cost_code'),
    /** Supplier the requester intends to order from (entered; used at conversion). */
    supplierName: text('supplier_name'),
    items: jsonb('items')
      .notNull()
      .default(sql`'[]'::jsonb`),
    neededBy: date('needed_by'),
    requesterUserId: uuid('requester_user_id'),
    status: text('status')
      .$type<'draft' | 'submitted' | 'approved' | 'rejected' | 'converted'>()
      .notNull()
      .default('draft'),
    convertedOrderId: uuid('converted_order_id'),
    decidedByUserId: uuid('decided_by_user_id'),
    decidedAt: tsColumn('decided_at'),
    note: text('note'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('jobId', () => jobs),
    h.fk('convertedOrderId', () => supplierOrders),
    h.uniq('orgId', 'convertedOrderId'),
    h.idx('orgId', 'status'),
    h.idx('orgId', 'jobId', 'status'),
  ],
);

export const poLineBackorders = tenantTable(
  'po_line_backorders',
  {
    supplierOrderId: uuid('supplier_order_id').notNull(),
    lineIndex: integer('line_index').notNull(),
    /** Expected delivery date as entered by supplier/office. */
    expectedOn: date('expected_on'),
    note: text('note'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('supplierOrderId', () => supplierOrders, 'cascade'),
    h.uniq('orgId', 'supplierOrderId', 'lineIndex'),
    h.idx('orgId', 'expectedOn'),
  ],
);
