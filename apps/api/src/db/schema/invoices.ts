// Tables owned by the `invoices` module (OPS-066): invoices and their lines. Issued invoices are
// corrected by credit notes/voids, never edited (status machine in contracts).
import { date, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, rateColumn, revisionColumn, tsColumn } from './_columns';
import { invoiceKindEnum, invoiceStatusEnum, pricingUnitEnum } from './_enums';
import { tenantTable } from './_tenant';
import { contacts, customers } from './crm';
import { jobs } from './jobs';
import { proposals } from './proposals';
import { contracts } from './signatures';

export const invoices = tenantTable(
  'invoices',
  {
    number: text('number').notNull(),
    kind: invoiceKindEnum('kind').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    customerId: uuid('customer_id').notNull(),
    contactId: uuid('contact_id'),
    jobId: uuid('job_id'),
    proposalId: uuid('proposal_id'),
    contractId: uuid('contract_id'),
    changeOrderId: uuid('change_order_id'),
    currency: currencyColumn(),
    subtotalMinor: minorUnits('subtotal_minor').notNull().default(0),
    taxMinor: minorUnits('tax_minor').notNull().default(0),
    totalMinor: minorUnits('total_minor').notNull().default(0),
    amountPaidMinor: minorUnits('amount_paid_minor').notNull().default(0),
    amountRefundedMinor: minorUnits('amount_refunded_minor').notNull().default(0),
    issuedOn: date('issued_on'),
    dueOn: date('due_on'),
    issuedAt: tsColumn('issued_at'),
    voidedAt: tsColumn('voided_at'),
    voidReason: text('void_reason'),
    memo: text('memo'),
    billingAddress: jsonb('billing_address'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.uniq('orgId', 'number'),
    h.idx('orgId', 'status'),
    h.fk('customerId', () => customers),
    h.fk('contactId', () => contacts),
    h.fk('jobId', () => jobs),
    h.fk('proposalId', () => proposals),
    h.fk('contractId', () => contracts),
  ],
);

export const invoiceLines = tenantTable(
  'invoice_lines',
  {
    invoiceId: uuid('invoice_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    description: text('description').notNull(),
    quantity: rateColumn('quantity').notNull(),
    unit: pricingUnitEnum('unit').notNull().default('each'),
    unitPriceMinor: minorUnits('unit_price_minor').notNull(),
    amountMinor: minorUnits('amount_minor').notNull(),
    taxRate: rateColumn('tax_rate').notNull().default('0'),
    taxMinor: minorUnits('tax_minor').notNull().default(0),
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
  },
  (_t, h) => [h.fk('invoiceId', () => invoices, 'cascade'), h.idx('invoiceId')],
);
