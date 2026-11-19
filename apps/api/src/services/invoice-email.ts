// Builds the invoice email (subject, plain text, PDF snapshot) from the stored invoice. Pure: the
// worker task loads the rows, renders the PDF with @fieldline/pdf and hands this to the mail server.
import { BRAND } from '@fieldline/contracts';
import { formatDate, formatMoney, type InvoiceSnapshot } from '@fieldline/pdf';
import type { InvoiceLineRow, InvoiceRow } from './invoice-exchange';

export interface IssuerDetails {
  displayName: string;
  timezone: string;
  locale: string;
}

export interface InvoiceEmailContent {
  subject: string;
  text: string;
  filename: string;
  snapshot: InvoiceSnapshot;
}

/** The PDF template knows five states; the ledger has a few more that print as the nearest one. */
const PDF_STATUS: Record<InvoiceRow['status'], InvoiceSnapshot['status']> = {
  draft: 'draft',
  pending_approval: 'draft',
  issued: 'issued',
  uncollectible: 'issued',
  partially_paid: 'partially_paid',
  partially_refunded: 'partially_paid',
  paid: 'paid',
  refunded: 'paid',
  void: 'void',
};

/** Same characters on every OS and in every mail client. */
export function invoiceFilename(number: string): string {
  const safe = number.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'invoice';
  return `${safe}.pdf`;
}

function percent(rate: string): string {
  const value = Number(rate) * 100;
  if (!Number.isFinite(value)) return '';
  return `${Number(value.toFixed(3))}%`;
}

export function buildInvoiceEmail(
  invoice: InvoiceRow,
  lines: readonly InvoiceLineRow[],
  issuer: IssuerDetails,
): InvoiceEmailContent {
  const money = (amountMinor: number) => ({ amountMinor, currency: invoice.currency });
  const issuedAt = (invoice.issuedAt ?? invoice.createdAt).toISOString();
  const dueIso = invoice.dueOn ? `${invoice.dueOn}T12:00:00.000Z` : issuedAt;
  const rates = [...new Set(lines.map((l) => l.taxRate))];
  const balance = Math.max(
    0,
    invoice.totalMinor - invoice.amountPaidMinor + invoice.amountRefundedMinor,
  );

  const snapshot: InvoiceSnapshot = {
    kind: 'invoice',
    meta: {
      documentId: invoice.number,
      revision: invoice.revision,
      issuedAt,
      timeZone: issuer.timezone,
      locale: issuer.locale,
      organization: { name: issuer.displayName },
      productName: BRAND.name,
    },
    billTo: {
      name: invoice.recipientName ?? 'Customer',
      addressLines: [],
      ...(invoice.recipientEmail && { email: invoice.recipientEmail }),
    },
    status: PDF_STATUS[invoice.status],
    dueDate: dueIso,
    lines: lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: money(line.unitPriceMinor),
      total: money(line.amountMinor),
    })),
    subtotal: money(invoice.subtotalMinor),
    discounts: [],
    taxes:
      invoice.taxMinor > 0
        ? [
            {
              label: 'Tax',
              rate: rates.length === 1 ? percent(rates[0]!) : '',
              amount: money(invoice.taxMinor),
            },
          ]
        : [],
    total: money(invoice.totalMinor),
    payments: [],
    balanceDue: money(balance),
    ...(invoice.memo && { notes: invoice.memo }),
  };

  const total = formatMoney(money(invoice.totalMinor));
  const due = invoice.dueOn ? formatDate(dueIso, issuer.timezone) : null;
  const lineText = lines.map((l) => {
    const qty = l.quantity.replace(/\.0+$/, '');
    return `- ${l.description}: ${qty} x ${formatMoney(money(l.unitPriceMinor))} = ${formatMoney(money(l.amountMinor))}`;
  });
  const text = [
    'Hello,',
    '',
    `${issuer.displayName} sent you invoice ${invoice.number} for ${total}${due ? `, due ${due}` : ''}.`,
    ...(invoice.memo ? ['', invoice.memo] : []),
    '',
    ...lineText,
    '',
    `Subtotal: ${formatMoney(money(invoice.subtotalMinor))}`,
    ...(invoice.taxMinor > 0 ? [`Tax: ${formatMoney(money(invoice.taxMinor))}`] : []),
    `Total: ${total}`,
    '',
    'The invoice is attached as a PDF.',
    '',
    'Thank you,',
    issuer.displayName,
  ].join('\n');

  return {
    subject: `Invoice ${invoice.number} from ${issuer.displayName}`,
    text,
    filename: invoiceFilename(invoice.number),
    snapshot,
  };
}
