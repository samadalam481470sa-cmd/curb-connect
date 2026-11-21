import { ImportInvoicesRequestSchema } from '@fieldline/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildInvoices,
  guessColumns,
  parseDate,
  parseDelimited,
  parseMoney,
  parseStatus,
} from './invoiceImport';

describe('invoice import', () => {
  it('reads quoted CSV with commas inside cells', () => {
    const rows = parseDelimited('Invoice #,Client,Total\n"INV0001","Smith, Jane","$1,250.00"\n');
    expect(rows).toEqual([
      ['Invoice #', 'Client', 'Total'],
      ['INV0001', 'Smith, Jane', '$1,250.00'],
    ]);
  });

  it('reads rows pasted from a spreadsheet (tabs)', () => {
    expect(parseDelimited('Number\tCustomer\tAmount\nA-1\tBob\t10')).toEqual([
      ['Number', 'Customer', 'Amount'],
      ['A-1', 'Bob', '10'],
    ]);
  });

  it('matches common header names and never takes Due Date as the invoice date', () => {
    const map = guessColumns([
      'Invoice No.',
      'Customer Name',
      'Due Date',
      'Invoice Date',
      'Status',
      'Total',
      'Balance Due',
      'Email',
    ]);
    expect(map).toMatchObject({
      number: 0,
      client: 1,
      due: 2,
      date: 3,
      status: 4,
      total: 5,
      balance: 6,
      email: 7,
    });
  });

  it('parses money, dates and status words', () => {
    expect(parseMoney('$1,234.50')).toBe(123450);
    expect(parseMoney('(12.00)')).toBe(-1200);
    expect(parseMoney('')).toBeNull();
    expect(parseDate('11/20/2026')).toBe('2026-11-20');
    expect(parseDate('Nov 20, 2026')).toBe('2026-11-20');
    expect(parseDate('20 Nov 2026')).toBe('2026-11-20');
    expect(parseDate('2/30/2026')).toBeNull();
    expect(parseStatus('Paid')).toBe('paid');
    expect(parseStatus('Unpaid')).toBe('sent');
    expect(parseStatus('Partially Paid')).toBe('partially_paid');
    expect(parseStatus('Overdue')).toBe('sent');
    expect(parseStatus('Voided')).toBe('void');
  });

  it('builds invoices, groups line-item rows and works out paid status from the balance', () => {
    const rows = parseDelimited(
      [
        'Invoice Number,Customer,Date,Item,Qty,Rate,Total,Balance Due',
        'INV-7,Jane Homeowner,11/01/2026,Tear-off,30,350,"10,800.00",0',
        'INV-7,Jane Homeowner,11/01/2026,Drip edge,120,2.50,"10,800.00",0',
        'INV-8,Bob Builder,11/05/2026,Curb cut,1,400,400,150',
        ',No number,,,,,5,',
      ].join('\n'),
    );
    const [, ...body] = rows;
    const { invoices, problems } = buildInvoices(body, guessColumns(rows[0]!));
    expect(problems).toHaveLength(1);
    expect(invoices).toHaveLength(2);
    const [a, b] = invoices;
    expect(a).toMatchObject({
      number: 'INV-7',
      clientName: 'Jane Homeowner',
      issuedOn: '2026-11-01',
      status: 'paid',
      totalMinor: 1_080_000,
    });
    expect(a!.lines).toHaveLength(2);
    expect(b).toMatchObject({ number: 'INV-8', status: 'partially_paid', amountPaidMinor: 25_000 });
    expect(
      ImportInvoicesRequestSchema.safeParse({ source: 'Invoice Simple', invoices }).success,
    ).toBe(true);
  });
});
