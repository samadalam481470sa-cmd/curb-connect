import { describe, expect, it } from 'vitest';
import { invoiceComposeUrl, invoiceCsv, invoiceSummary, safeFilename, validateInstructionFile } from './invoiceTools';
import type { IssuedInvoice } from '@fieldline/contracts';

const invoice = {
  id: 'inv-1', number: 'INV-2026-003', currency: 'USD', recipientName: 'Acme Construction',
  issuedOn: '2026-11-10', dueOn: '2026-12-10', memo: 'Check details',
  subtotalMinor: 12500, taxMinor: 1000, totalMinor: 13500, deliveryStatus: 'draft',
  lines: [{ description: '=dangerous,"line"', quantity: '2', unit: 'each', unitPriceMinor: 6250, amountMinor: 12500 }],
} as unknown as IssuedInvoice;

describe('invoice email drafts and export', () => {
  it('opens correct prefilled Gmail, Outlook, and native email URLs', () => {
    const gmail = new URL(invoiceComposeUrl('gmail', invoice, 'ap@example.com'));
    expect(gmail.hostname).toBe('mail.google.com');
    expect(gmail.searchParams.get('to')).toBe('ap@example.com');
    expect(gmail.searchParams.get('body')).toContain('INV-2026-003');
    const outlook = new URL(invoiceComposeUrl('outlook', invoice, 'ap@example.com'));
    expect(outlook.hostname).toBe('outlook.office.com');
    expect(outlook.searchParams.get('subject')).toContain('INV-2026-003');
    expect(invoiceComposeUrl('default', invoice, 'ap@example.com')).toMatch(/^mailto:/);
  });

  it('rejects malformed recipient addresses', () => {
    expect(() => invoiceComposeUrl('gmail', invoice, 'not-an-email')).toThrow('valid recipient');
    expect(() => invoiceComposeUrl('outlook', invoice, 'bad\nx@example.com')).toThrow();
  });

  it('uses actual minor-unit totals and escapes spreadsheet formulas and quotes', () => {
    expect(invoiceSummary(invoice)).toContain('$135.00');
    const csv = invoiceCsv(invoice);
    expect(csv).toContain("'=dangerous,");
    expect(csv).toContain('""line""');
    expect(csv).toContain('"12500"');
  });

  it('validates imports and filenames', () => {
    expect(validateInstructionFile('specs.md', 100)).toBeNull();
    expect(validateInstructionFile('evil.html', 100)).not.toBeNull();
    expect(validateInstructionFile('big.csv', 2_000_000)).not.toBeNull();
    expect(safeFilename('../invoice 005')).toBe('___invoice_005');
  });
});
