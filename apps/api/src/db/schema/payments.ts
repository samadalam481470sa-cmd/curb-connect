// Tables owned by the `payments` module (OPS-067): payments, provider webhook events (dedupe on
// provider event id; append-only) and the double-entry ledger (append-only).
import { jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import {
  ledgerAccountEnum,
  ledgerDirectionEnum,
  paymentMethodEnum,
  paymentProviderEnum,
  paymentStatusEnum,
} from './_enums';
import { tenantTable } from './_tenant';
import { customers } from './crm';
import { invoices } from './invoices';

export const payments = tenantTable(
  'payments',
  {
    invoiceId: uuid('invoice_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    provider: paymentProviderEnum('provider').notNull(),
    providerPaymentId: text('provider_payment_id'),
    method: paymentMethodEnum('method').notNull(),
    status: paymentStatusEnum('status').notNull().default('pending'),
    amountMinor: minorUnits('amount_minor').notNull(),
    feeMinor: minorUnits('fee_minor').notNull().default(0),
    refundedMinor: minorUnits('refunded_minor').notNull().default(0),
    currency: currencyColumn(),
    idempotencyKey: text('idempotency_key'),
    receivedAt: tsColumn('received_at'),
    failureReason: text('failure_reason'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('invoiceId', () => invoices),
    h.fk('customerId', () => customers),
    h.uniq('orgId', 'provider', 'providerPaymentId'),
    h.idx('invoiceId'),
  ],
);

export const paymentEvents = tenantTable(
  'payment_events',
  {
    paymentId: uuid('payment_id'),
    provider: paymentProviderEnum('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    signatureVerified: text('signature_verified').notNull().default('unverified'),
    processedAt: tsColumn('processed_at'),
    error: text('error'),
  },
  (_t, h) => [h.fk('paymentId', () => payments), h.uniq('provider', 'providerEventId')],
);

export const ledgerEntries = tenantTable(
  'ledger_entries',
  {
    transactionId: uuid('transaction_id').notNull(),
    account: ledgerAccountEnum('account').notNull(),
    direction: ledgerDirectionEnum('direction').notNull(),
    amountMinor: minorUnits('amount_minor').notNull(),
    currency: currencyColumn(),
    invoiceId: uuid('invoice_id'),
    paymentId: uuid('payment_id'),
    customerId: uuid('customer_id'),
    memo: text('memo'),
    postedAt: tsColumn('posted_at').notNull().defaultNow(),
  },
  (_t, h) => [
    h.fk('invoiceId', () => invoices),
    h.fk('paymentId', () => payments),
    h.fk('customerId', () => customers),
    h.idx('orgId', 'transactionId'),
  ],
);
