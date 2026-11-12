import type { IssuedInvoice } from '@fieldline/contracts';

export function invoiceSummary(invoice: IssuedInvoice): string {
  const money = (minor: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency }).format(minor / 100);
  const lines = invoice.lines.map(
    (line) =>
      [line.description, String(line.quantity), line.unit, money(line.unitPriceMinor), money(line.amountMinor)].join(' | '),
  );
  return [
    'INVOICE ' + invoice.number,
    'Bill to: ' + (invoice.recipientName ?? 'Recipient'),
    'Issue date: ' + (invoice.issuedOn ?? 'Not issued'),
    'Due date: ' + (invoice.dueOn ?? 'Not set'),
    '',
    'Item | Quantity | Unit | Unit price | Amount',
    ...lines,
    '',
    'Subtotal: ' + money(invoice.subtotalMinor),
    'Tax: ' + money(invoice.taxMinor),
    'Total: ' + money(invoice.totalMinor),
    invoice.memo ? 'Notes: ' + invoice.memo : '',
  ].filter(Boolean).join('\n');
}

export type EmailProvider = 'gmail' | 'outlook' | 'default';

export function invoiceComposeUrl(
  provider: EmailProvider,
  invoice: IssuedInvoice,
  recipientEmail: string,
): string {
  const email = recipientEmail.trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 254) {
    throw new Error('Enter a valid recipient email address.');
  }
  const subject = 'Invoice ' + invoice.number + ' — ' + (invoice.recipientName ?? 'Field Pro');
  const body =
    'Hello,\n\nPlease review the invoice details below.\n\n' +
    invoiceSummary(invoice) +
    '\n\nThank you.\n\nSent manually from Field Pro';
  if (provider === 'gmail') {
    const url = new URL('https://mail.google.com/mail/');
    url.searchParams.set('view', 'cm');
    url.searchParams.set('fs', '1');
    url.searchParams.set('to', email);
    url.searchParams.set('su', subject);
    url.searchParams.set('body', body);
    return url.toString();
  }
  if (provider === 'outlook') {
    const url = new URL('https://outlook.office.com/mail/deeplink/compose');
    url.searchParams.set('to', email);
    url.searchParams.set('subject', subject);
    url.searchParams.set('body', body);
    return url.toString();
  }
  return 'mailto:' + encodeURIComponent(email) +
    '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

/** Standard CSV export, safe even if descriptions contain newlines, quotes or spreadsheet formulas. */
export function invoiceCsv(invoice: IssuedInvoice): string {
  const escape = (value: string | number) => {
    const s = String(value);
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows = [
    ['Invoice', 'Recipient', 'Description', 'Quantity', 'Unit', 'Unit price minor', 'Line total minor', 'Currency', 'Due'],
    ...invoice.lines.map((line) => [
      invoice.number,
      invoice.recipientName ?? '',
      line.description,
      line.quantity,
      line.unit,
      line.unitPriceMinor,
      line.amountMinor,
      invoice.currency,
      invoice.dueOn ?? '',
    ]),
  ];
  return rows.map((row) => row.map(escape).join(',')).join('\r\n') + '\r\n';
}

export function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '_').slice(0, 72) || 'invoice';
}

export const ACCEPTED_INSTRUCTION_TYPES = ['.txt', '.md', '.csv', '.json'] as const;
export function validateInstructionFile(name: string, bytes: number): string | null {
  if (!Number.isInteger(bytes) || bytes < 0 || bytes > 1024 * 1024)
    return 'Choose an instruction file of 1 MB or smaller.';
  if (!ACCEPTED_INSTRUCTION_TYPES.some((ext) => name.toLowerCase().endsWith(ext)))
    return 'Supported instruction files: TXT, MD, CSV and JSON.';
  return null;
}
