// Tables owned by the cross-company network (blueprint workstreams 06-09): company connections,
// shared project pairs, bills delivered into the recipient's own tenant, payment links.
//
// Each company owns its own row of every relationship and document. Nothing here references another
// tenant's table: cross-company ids are plain uuid columns, and the only way a record is created in
// another tenant is a named platform operation that verifies both sides of an active connection
// (src/db/runtime.ts PLATFORM_OPERATIONS). RLS then keeps every subsequent read inside one company.
import { sql } from 'drizzle-orm';
import { date, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import {
  billStatusEnum,
  connectionDirectionEnum,
  connectionScopeEnum,
  connectionStatusEnum,
  networkProjectStatusEnum,
  paymentLinkStatusEnum,
  paymentProviderEnum,
} from './_enums';
import { tenantTable } from './_tenant';

/** One company's side of a relationship. The partner has a mirrored row with the same pair key. */
export const companyConnections = tenantTable(
  'company_connections',
  {
    pairKey: uuid('pair_key').notNull(),
    partnerOrgId: uuid('partner_org_id').notNull(),
    partnerDisplayName: text('partner_display_name').notNull(),
    partnerSlug: text('partner_slug').notNull(),
    direction: connectionDirectionEnum('direction').notNull(),
    status: connectionStatusEnum('status').notNull().default('pending'),
    /** Workflow-scoped grants only (invoices, projects, directory). Never blanket access. */
    scopes: connectionScopeEnum('scopes').array().notNull().default(sql`'{invoices}'`),
    message: text('message'),
    requestedByUserId: uuid('requested_by_user_id'),
    respondedAt: tsColumn('responded_at'),
    revokedAt: tsColumn('revoked_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.uniq('orgId', 'partnerOrgId'),
    h.uniq('orgId', 'pairKey'),
    h.idx('orgId', 'status'),
  ],
);

/** A project is shared as a mirrored pair (lead + partner) under one network key. */
export const networkProjects = tenantTable(
  'network_projects',
  {
    networkKey: uuid('network_key').notNull(),
    reference: text('reference').notNull(),
    name: text('name').notNull(),
    clientName: text('client_name'),
    siteAddress: text('site_address'),
    status: networkProjectStatusEnum('status').notNull().default('active'),
    side: text('side').notNull(),
    partnerOrgId: uuid('partner_org_id').notNull(),
    partnerDisplayName: text('partner_display_name').notNull(),
    connectionId: uuid('connection_id'),
    contractValueMinor: minorUnits('contract_value_minor'),
    currency: currencyColumn(),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'networkKey'), h.idx('orgId', 'status')],
);

/**
 * The recipient's payable record. `invoice_id` is the issuer's invoice id, kept for reconciliation
 * only; the issuer's rows are not reachable from here (different tenant, RLS).
 */
export const networkBills = tenantTable(
  'network_bills',
  {
    invoiceId: uuid('invoice_id').notNull(),
    issuerOrgId: uuid('issuer_org_id').notNull(),
    issuerName: text('issuer_name').notNull(),
    issuerSlug: text('issuer_slug').notNull(),
    projectName: text('project_name'),
    number: text('number').notNull(),
    status: billStatusEnum('status').notNull().default('received'),
    currency: currencyColumn(),
    subtotalMinor: minorUnits('subtotal_minor').notNull().default(0),
    taxMinor: minorUnits('tax_minor').notNull().default(0),
    totalMinor: minorUnits('total_minor').notNull().default(0),
    issuedOn: date('issued_on'),
    dueOn: date('due_on'),
    memo: text('memo'),
    /** Frozen copy of the issuer's lines: a later correction never rewrites a received bill. */
    lines: jsonb('lines').notNull().default(sql`'[]'::jsonb`),
    disputeReason: text('dispute_reason'),
    approvedAt: tsColumn('approved_at'),
    approvedByUserId: uuid('approved_by_user_id'),
    paidAt: tsColumn('paid_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    // One bill per issuer invoice per recipient: a retried delivery cannot duplicate a payable.
    h.uniq('orgId', 'invoiceId'),
    h.idx('orgId', 'status'),
    h.idx('orgId', 'issuerOrgId'),
  ],
);

/**
 * Payment links are handed to the recipient's AP team as a reference. No card data, no token and no
 * hosted checkout exist here: a live processor session would own those, and none is configured.
 */
export const networkPaymentLinks = tenantTable(
  'network_payment_links',
  {
    billId: uuid('bill_id').notNull(),
    providerReference: text('provider_reference').notNull(),
    amountMinor: minorUnits('amount_minor').notNull(),
    currency: currencyColumn(),
    provider: paymentProviderEnum('provider').notNull().default('stand_in'),
    status: paymentLinkStatusEnum('status').notNull().default('open'),
    expiresAt: tsColumn('expires_at').notNull(),
    paidAt: tsColumn('paid_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('billId', () => networkBills, 'cascade'),
    h.uniq('orgId', 'providerReference'),
    h.idx('orgId', 'billId'),
  ],
);
