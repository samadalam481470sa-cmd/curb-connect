// Invoice Intelligence (migration 0028): bulk invoice import batches, the files in them, the
// records read from those files with field evidence and review state, payments on imported
// records and saved column-mapping profiles. Existing invoices, bills and payments are unchanged.
import { bigint, date, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { minorUnits, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';

export const invoiceImportBatches = tenantTable('invoice_import_batches', {
  createdByUserId: uuid('created_by_user_id'),
  sourcePlatform: text('source_platform').notNull().default('other'),
  directionHint: text('direction_hint').notNull().default('auto'),
  status: text('status').notNull().default('uploaded'),
  fileCount: integer('file_count').notNull().default(0),
  rejectedCount: integer('rejected_count').notNull().default(0),
  recordCount: integer('record_count').notNull().default(0),
  needsReviewCount: integer('needs_review_count').notNull().default(0),
  importedCount: integer('imported_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  error: text('error'),
  finishedAt: tsColumn('finished_at'),
  revision: revisionColumn(),
});

export const invoiceImportFiles = tenantTable('invoice_import_files', {
  batchId: uuid('batch_id').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  kind: text('kind').notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key'),
  status: text('status').notNull().default('staged'),
  rejectReason: text('reject_reason'),
  parserVersion: text('parser_version').notNull().default('v1'),
  sheet: jsonb('sheet'),
  mapping: jsonb('mapping'),
  attempts: integer('attempts').notNull().default(0),
  revision: revisionColumn(),
});

export const importedInvoices = tenantTable('imported_invoices', {
  batchId: uuid('batch_id').notNull(),
  fileId: uuid('file_id').notNull(),
  rowIndex: integer('row_index').notNull().default(0),
  direction: text('direction').notNull().default('unknown'),
  docType: text('doc_type').notNull().default('invoice'),
  invoiceNumber: text('invoice_number'),
  partyName: text('party_name'),
  partyKey: text('party_key'),
  issueDate: date('issue_date'),
  dueDate: date('due_date'),
  currency: text('currency').notNull().default('USD'),
  subtotalMinor: minorUnits('subtotal_minor'),
  taxMinor: minorUnits('tax_minor'),
  discountMinor: minorUnits('discount_minor'),
  shippingMinor: minorUnits('shipping_minor'),
  totalMinor: minorUnits('total_minor'),
  calculatedTotalMinor: minorUnits('calculated_total_minor'),
  amountPaidMinor: bigint('amount_paid_minor', { mode: 'number' }).notNull().default(0),
  sourceStatus: text('source_status'),
  status: text('status').notNull().default('open'),
  category: text('category'),
  jobId: uuid('job_id'),
  projectLabel: text('project_label'),
  location: text('location'),
  costCode: text('cost_code'),
  reviewStatus: text('review_status').notNull().default('needs_review'),
  reviewReasons: text('review_reasons').array().notNull().default([]),
  fields: jsonb('fields').notNull().default({}),
  lines: jsonb('lines').notNull().default([]),
  sourceMeta: jsonb('source_meta').notNull().default({}),
  dedupeKey: text('dedupe_key'),
  duplicateOfId: uuid('duplicate_of_id'),
  duplicateOverrideReason: text('duplicate_override_reason'),
  reviewedByUserId: uuid('reviewed_by_user_id'),
  reviewedAt: tsColumn('reviewed_at'),
  revision: revisionColumn(),
});

export const importedInvoicePayments = tenantTable('imported_invoice_payments', {
  importedInvoiceId: uuid('imported_invoice_id').notNull(),
  paidOn: date('paid_on').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  method: text('method'),
  reference: text('reference'),
  source: text('source').notNull().default('manual'),
  note: text('note'),
  createdByUserId: uuid('created_by_user_id'),
});

export const invoiceImportProfiles = tenantTable('invoice_import_profiles', {
  name: text('name').notNull(),
  sourcePlatform: text('source_platform').notNull().default('other'),
  headerSignature: text('header_signature').notNull(),
  mapping: jsonb('mapping').notNull(),
  version: integer('version').notNull().default(1),
  createdByUserId: uuid('created_by_user_id'),
  revision: revisionColumn(),
});
