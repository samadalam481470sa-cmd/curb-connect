// Tables owned by the `jobCost` module: the in-app job-cost ledger (budget lines per cost code
// against a job, actuals recorded from POs / AP invoices / manual entries), draw (progress
// billing) requests, accounts-payable invoices (capture → approval → payment recorded; moving
// money stays gated on a payments provider), and lien-release document tracking. Every amount
// is builder-entered or carried from an existing record — never invented.
import { integer, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, rateColumn, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { jobs } from './jobs';

export const jobCostBudgets = tenantTable(
  'job_cost_budgets',
  {
    jobId: uuid('job_id').notNull(),
    costCode: text('cost_code').notNull(),
    label: text('label').notNull(),
    budgetMinor: minorUnits('budget_minor').notNull(),
    currency: currencyColumn(),
  },
  (_t, h) => [h.fk('jobId', () => jobs), h.uniq('orgId', 'jobId', 'costCode'), h.idx('orgId', 'jobId')],
);

export const jobCostEntries = tenantTable(
  'job_cost_entries',
  {
    jobId: uuid('job_id').notNull(),
    costCode: text('cost_code').notNull(),
    description: text('description').notNull(),
    amountMinor: minorUnits('amount_minor').notNull(),
    currency: currencyColumn(),
    source: text('source').$type<'purchase_order' | 'ap_invoice' | 'manual'>().notNull(),
    sourceId: uuid('source_id'),
    incurredOn: text('incurred_on').notNull(),
  },
  (_t, h) => [h.fk('jobId', () => jobs), h.idx('jobId', 'costCode'), h.idx('orgId', 'jobId')],
);

export const drawRequests = tenantTable(
  'draw_requests',
  {
    jobId: uuid('job_id').notNull(),
    number: integer('number').notNull(),
    status: text('status')
      .$type<'draft' | 'submitted' | 'approved' | 'paid' | 'rejected'>()
      .notNull()
      .default('draft'),
    contractMinor: minorUnits('contract_minor').notNull(),
    requestedMinor: minorUnits('requested_minor').notNull(),
    retainagePct: rateColumn('retainage_pct').notNull().default('0'),
    currency: currencyColumn(),
    note: text('note'),
    submittedAt: tsColumn('submitted_at'),
    decidedAt: tsColumn('decided_at'),
    paidAt: tsColumn('paid_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('jobId', () => jobs), h.uniq('orgId', 'jobId', 'number'), h.idx('orgId', 'status')],
);

export const apInvoices = tenantTable(
  'ap_invoices',
  {
    vendorName: text('vendor_name').notNull(),
    invoiceNumber: text('invoice_number'),
    jobId: uuid('job_id'),
    costCode: text('cost_code'),
    amountMinor: minorUnits('amount_minor').notNull(),
    currency: currencyColumn(),
    dueOn: text('due_on'),
    status: text('status')
      .$type<
        'captured' | 'pending_approval' | 'approved' | 'payment_recorded' | 'rejected' | 'disputed'
      >()
      .notNull()
      .default('captured'),
    source: text('source').$type<'manual' | 'invoice_intel' | 'network_bill'>().notNull(),
    sourceId: uuid('source_id'),
    approvalNote: text('approval_note'),
    approvedByUserId: uuid('approved_by_user_id'),
    approvedAt: tsColumn('approved_at'),
    paymentRecordedAt: tsColumn('payment_recorded_at'),
    lienReleaseId: uuid('lien_release_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('jobId', () => jobs), h.idx('orgId', 'status'), h.idx('orgId', 'dueOn')],
);

export const lienReleases = tenantTable(
  'lien_releases',
  {
    jobId: uuid('job_id'),
    apInvoiceId: uuid('ap_invoice_id'),
    claimantName: text('claimant_name').notNull(),
    kind: text('kind')
      .$type<
        | 'conditional_progress'
        | 'unconditional_progress'
        | 'conditional_final'
        | 'unconditional_final'
      >()
      .notNull(),
    status: text('status')
      .$type<'draft' | 'requested' | 'received' | 'verified' | 'void'>()
      .notNull()
      .default('draft'),
    amountMinor: minorUnits('amount_minor'),
    currency: currencyColumn(),
    throughOn: text('through_on'),
    receivedAt: tsColumn('received_at'),
    note: text('note'),
  },
  (_t, h) => [h.fk('jobId', () => jobs), h.fk('apInvoiceId', () => apInvoices), h.idx('orgId', 'status')],
);
