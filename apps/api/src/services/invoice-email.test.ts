import { collectText, documentFor, renderToBuffer } from '@fieldline/pdf';
import { describe, expect, it } from 'vitest';
import { buildInvoiceEmail, invoiceFilename } from './invoice-email';
import type { InvoiceLineRow, InvoiceRow } from './invoice-exchange';

const at = new Date('2026-11-19T15:00:00.000Z');

const invoice = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  createdAt: at,
  updatedAt: at,
  number: 'INV-2026-0007',
  kind: 'standalone',
  status: 'issued',
  customerId: null,
  contactId: null,
  jobId: null,
  proposalId: null,
  contractId: null,
  changeOrderId: null,
  currency: 'USD',
  subtotalMinor: 125_000,
  taxMinor: 10_313,
  totalMinor: 135_313,
  amountPaidMinor: 0,
  amountRefundedMinor: 0,
  issuedOn: '2026-11-19',
  dueOn: '2026-12-19',
  issuedAt: at,
  voidedAt: null,
  voidReason: null,
  memo: 'Thanks for the quick approval.',
  billingAddress: null,
  recipientOrgId: '33333333-3333-4333-8333-333333333333',
  recipientName: 'Partner GC LLC',
  deliveryStatus: 'sent',
  networkProjectId: null,
  sentAt: at,
  approvedAt: null,
  disputedAt: null,
  disputeReason: null,
  recipientEmail: 'ap@partner.test',
  emailVia: 'gmail',
  emailStatus: 'queued',
  emailFrom: null,
  emailSentAt: null,
  emailError: null,
  emailSenderUserId: '44444444-4444-4444-8444-444444444444',
  emailAttempt: 1,
  revision: 2,
} as InvoiceRow;

const lines = [
  {
    id: '55555555-5555-4555-8555-555555555555',
    orgId: invoice.orgId,
    createdAt: at,
    updatedAt: at,
    invoiceId: invoice.id,
    sortOrder: 0,
    description: 'Roof replacement — final invoice',
    quantity: '1.0000',
    unit: 'each',
    unitPriceMinor: 125_000,
    amountMinor: 125_000,
    taxRate: '0.0825',
    taxMinor: 10_313,
    sourceType: null,
    sourceId: null,
  },
] as InvoiceLineRow[];

const issuer = { displayName: 'Acme Roofing', timezone: 'America/Chicago', locale: 'en-US' };

describe('invoice email', () => {
  it('writes a plain subject and body with the totals and due date', () => {
    const email = buildInvoiceEmail(invoice, lines, issuer);
    expect(email.subject).toBe('Invoice INV-2026-0007 from Acme Roofing');
    expect(email.text).toContain('Acme Roofing sent you invoice INV-2026-0007 for $1,353.13, due');
    expect(email.text).toContain('Roof replacement — final invoice: 1 x $1,250.00 = $1,250.00');
    expect(email.text).toContain('Tax: $103.13');
    expect(email.text).toContain('Thanks for the quick approval.');
    expect(email.filename).toBe('INV-2026-0007.pdf');
  });

  it('renders an issued PDF without a draft banner', async () => {
    const { snapshot } = buildInvoiceEmail(invoice, lines, issuer);
    expect(snapshot.status).toBe('issued');
    expect(snapshot.taxes[0]?.rate).toBe('8.25%');
    const text = collectText(documentFor(snapshot));
    expect(text).toContain('INV-2026-0007');
    expect(text).not.toContain('DRAFT');
    const pdf = await renderToBuffer(snapshot);
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('makes safe attachment names', () => {
    expect(invoiceFilename('INV/2026 #7')).toBe('INV-2026-7.pdf');
    expect(invoiceFilename('///')).toBe('invoice.pdf');
  });
});
