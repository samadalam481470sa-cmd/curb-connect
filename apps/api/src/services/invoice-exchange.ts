// DTO mapping and notification helpers shared by the invoices, bills and network modules.
//
// Everything here assumes the caller has already established tenant scope. Cross-tenant writes go
// through platformTx() in the modules, never from this file.
import {
  type Bill,
  type BillLine,
  type IssuedInvoice,
  type NetworkInvoiceLine,
  type NotificationCategory,
} from '@fieldline/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { invoiceLines, invoices, memberships, networkProjects } from '../db/schema';
import type { networkBills } from '../db/schema';
import type { Tx } from '../db/runtime';
import { notify } from './notifications';

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceLineRow = typeof invoiceLines.$inferSelect;
export type BillRow = typeof networkBills.$inferSelect;
export type NetworkProjectRow = typeof networkProjects.$inferSelect;

/** Accounting roles that must see a bill, a dispute or a payment on behalf of the company. */
export const BILL_NOTICE_ROLES = ['owner', 'admin', 'finance'] as const;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function lineDto(row: InvoiceLineRow): NetworkInvoiceLine {
  return {
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    unitPriceMinor: row.unitPriceMinor,
    amountMinor: row.amountMinor,
  };
}

export function issuedInvoiceDto(
  row: InvoiceRow,
  lines: readonly InvoiceLineRow[],
  projectName: string | null,
): IssuedInvoice {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    number: row.number,
    status: row.status,
    deliveryStatus: row.deliveryStatus,
    recipientOrgId: row.recipientOrgId,
    recipientName: row.recipientName,
    projectId: row.networkProjectId,
    projectName,
    currency: row.currency,
    subtotalMinor: row.subtotalMinor,
    taxMinor: row.taxMinor,
    totalMinor: row.totalMinor,
    amountPaidMinor: row.amountPaidMinor,
    issuedOn: row.issuedOn,
    dueOn: row.dueOn,
    memo: row.memo,
    lines: lines.map(lineDto),
    disputeReason: row.disputeReason,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
  };
}

export function billDto(row: BillRow): Bill {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    invoiceId: row.invoiceId,
    issuerOrgId: row.issuerOrgId,
    issuerName: row.issuerName,
    issuerSlug: row.issuerSlug,
    number: row.number,
    projectName: row.projectName,
    status: row.status,
    currency: row.currency,
    subtotalMinor: row.subtotalMinor,
    taxMinor: row.taxMinor,
    totalMinor: row.totalMinor,
    issuedOn: row.issuedOn,
    dueOn: row.dueOn,
    memo: row.memo,
    lines: (row.lines ?? []) as BillLine[],
    disputeReason: row.disputeReason,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
  };
}

/** Loads an invoice (with lines and project name) inside an already-scoped transaction. */
export async function loadIssuedInvoice(
  tx: Tx,
  orgId: string,
  invoiceId: string,
): Promise<IssuedInvoice | null> {
  const [row] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, invoiceId)))
    .limit(1);
  if (!row) return null;
  const lines = await tx
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, row.id))
    .orderBy(invoiceLines.sortOrder);
  let projectName: string | null = null;
  if (row.networkProjectId) {
    const [project] = await tx
      .select({ name: networkProjects.name })
      .from(networkProjects)
      .where(and(eq(networkProjects.orgId, orgId), eq(networkProjects.id, row.networkProjectId)))
      .limit(1);
    projectName = project?.name ?? null;
  }
  return issuedInvoiceDto(row, lines, projectName);
}

export interface CompanyNotice {
  orgId: string;
  category: NotificationCategory;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Base key; the recipient membership is appended so each person gets exactly one notice. */
  dedupeKey: string;
  correlationId?: string | null;
}

/**
 * Notifies every active owner, admin and finance member of a company. Used when a record arrives
 * from another tenant. Failures must not undo the business write: notify() only enqueues, and the
 * email delivery happens later through the outbox job.
 */
export async function notifyCompany(tx: Tx, notice: CompanyNotice): Promise<void> {
  const recipients = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, notice.orgId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, [...BILL_NOTICE_ROLES]),
      ),
    );
  for (const recipient of recipients) {
    await notify(tx, {
      orgId: notice.orgId,
      recipientMembershipId: recipient.id,
      category: notice.category,
      title: notice.title,
      body: notice.body ?? null,
      link: notice.link ?? null,
      dedupeKey: `${notice.dedupeKey}:${recipient.id}`,
      correlationId: notice.correlationId ?? null,
    });
  }
}
