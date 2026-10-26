/** Invoice records and totals. Money is stored and summed in whole cents. */

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
}

export interface Invoice {
  id: string;
  number: string;
  projectId: string;
  issueDate: string;
  dueDate: string;
  lineItems: InvoiceLineItem[];
  taxRatePercent: number;
  /** Share of the total held back until closeout, common on subcontracts (often 5–10%). */
  retainagePercent: number;
  notes: string;
  status: InvoiceStatus;
  sentDate?: string;
  paidDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  retainageCents: number;
  /** What the customer pays now: total minus retainage. */
  amountDueCents: number;
}

export function lineItemCents(item: Pick<InvoiceLineItem, "quantity" | "unitPriceCents">): number {
  if (!Number.isFinite(item.quantity) || !Number.isFinite(item.unitPriceCents)) {
    return 0;
  }
  return Math.round(item.quantity * item.unitPriceCents);
}

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
}

export function invoiceTotals(invoice: Pick<Invoice, "lineItems" | "taxRatePercent" | "retainagePercent">): InvoiceTotals {
  const subtotalCents = invoice.lineItems.reduce((total, item) => total + lineItemCents(item), 0);
  const taxCents = Math.round((subtotalCents * clampPercent(invoice.taxRatePercent)) / 100);
  const totalCents = subtotalCents + taxCents;
  const retainageCents = Math.round((totalCents * clampPercent(invoice.retainagePercent)) / 100);
  return { subtotalCents, taxCents, totalCents, retainageCents, amountDueCents: totalCents - retainageCents };
}

export type DisplayStatus = InvoiceStatus | "overdue";

/** Sent invoices past their due date show as overdue. */
export function displayStatus(invoice: Pick<Invoice, "status" | "dueDate">, todayIso: string): DisplayStatus {
  if (invoice.status === "sent" && invoice.dueDate && invoice.dueDate < todayIso) {
    return "overdue";
  }
  return invoice.status;
}

/** Next number after the highest existing one with the same prefix, e.g. INV-1007 -> INV-1008. */
export function nextInvoiceNumber(existing: Pick<Invoice, "number">[], prefix = "INV-", start = 1001): string {
  let highest = start - 1;
  for (const invoice of existing) {
    if (!invoice.number.startsWith(prefix)) {
      continue;
    }
    const value = Number.parseInt(invoice.number.slice(prefix.length), 10);
    if (Number.isFinite(value) && value > highest) {
      highest = value;
    }
  }
  return `${prefix}${highest + 1}`;
}

/** Adds `days` to a YYYY-MM-DD date without time-zone drift. */
export function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export interface InvoiceSummary {
  outstandingCents: number;
  overdueCents: number;
  paidCents: number;
  draftCount: number;
}

export function summarizeInvoices(invoices: Invoice[], todayIso: string): InvoiceSummary {
  return invoices.reduce<InvoiceSummary>(
    (summary, invoice) => {
      const due = invoiceTotals(invoice).amountDueCents;
      const status = displayStatus(invoice, todayIso);
      return {
        outstandingCents: summary.outstandingCents + (status === "sent" || status === "overdue" ? due : 0),
        overdueCents: summary.overdueCents + (status === "overdue" ? due : 0),
        paidCents: summary.paidCents + (status === "paid" ? due : 0),
        draftCount: summary.draftCount + (status === "draft" ? 1 : 0)
      };
    },
    { outstandingCents: 0, overdueCents: 0, paidCents: 0, draftCount: 0 }
  );
}
