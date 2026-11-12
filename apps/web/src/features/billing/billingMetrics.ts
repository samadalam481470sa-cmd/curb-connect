import type { Bill, IssuedInvoice } from '@fieldline/contracts';

export interface InvoiceBucket {
  currency: string;
  draftMinor: number;
  sentMinor: number;
  sentCount: number;
  receivedMinor: number;
  receivedCount: number;
  receivableMinor: number;
  payableMinor: number;
  paidReceivableMinor: number;
  paidPayableMinor: number;
}

export function billingMetrics(
  invoices: readonly IssuedInvoice[],
  bills: readonly Bill[],
): InvoiceBucket[] {
  const buckets = new Map<string, InvoiceBucket>();
  function group(currency: string) {
    if (!buckets.has(currency)) buckets.set(currency, {
      currency, draftMinor: 0, sentMinor: 0, sentCount: 0,
      receivedMinor: 0, receivedCount: 0,
      receivableMinor: 0, payableMinor: 0,
      paidReceivableMinor: 0, paidPayableMinor: 0,
    });
    return buckets.get(currency)!;
  }
  for (const invoice of invoices) {
    const row = group(invoice.currency);
    if (invoice.deliveryStatus === 'draft') {
      row.draftMinor += invoice.totalMinor;
    } else if (invoice.deliveryStatus !== 'void') {
      row.sentMinor += invoice.totalMinor;
      row.sentCount += 1;
      row.paidReceivableMinor += Math.min(invoice.totalMinor, Math.max(0, invoice.amountPaidMinor));
      row.receivableMinor += Math.max(0, invoice.totalMinor - invoice.amountPaidMinor);
    }
  }
  for (const bill of bills) {
    if (bill.status === 'void') continue;
    const row = group(bill.currency);
    row.receivedMinor += bill.totalMinor;
    row.receivedCount += 1;
    if (bill.status === 'paid') row.paidPayableMinor += bill.totalMinor;
    else row.payableMinor += bill.totalMinor;
  }
  return [...buckets.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export function moneyMinor(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);
}
