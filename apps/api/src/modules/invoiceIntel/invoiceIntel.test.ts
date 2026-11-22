import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyze, type Rec } from './analysis';
import {
  autoMap,
  candidateFromAi,
  candidateFromText,
  parseDate,
  parseMoney,
  rowsToCandidates,
} from './extract';
import { csvCell } from './index';
import {
  dangerousContent,
  expandZip,
  findHeaderRow,
  parseDelimited,
  parseXlsx,
  sniffKind,
} from './intake';

const today = '2026-11-22';
const ctx = { directionHint: 'unknown' as const, defaultCurrency: 'USD', today, scanNote: null };

describe('intake', () => {
  it('knows file types by their bytes, not their names', () => {
    expect(sniffKind('a.pdf', strToU8('%PDF-1.7'))).toBe('pdf');
    expect(sniffKind('evil.csv', new Uint8Array([0x4d, 0x5a, 0, 0]))).toBe('unsupported');
    expect(sniffKind('x.csv', strToU8('a,b\n1,2'))).toBe('csv');
    expect(dangerousContent('run.exe', strToU8('x'))).toMatch(/not accepted/);
    expect(dangerousContent('a.pdf', strToU8('%PDF-1.4 /Encrypt 1 0 R'))).toMatch(/Password/);
    expect(dangerousContent('a.pdf', strToU8('%PDF-1.4 /JavaScript (x)'))).toMatch(/scripts/);
  });

  it('parses quoted CSV and TSV and finds the header row', () => {
    const rows = parseDelimited(
      '﻿Report,,\n\nInvoice #,Customer,Total\n"1001","Acme, Inc","1,250.00"\n1002,"Say ""Hi""",50\n',
    );
    expect(rows[2]).toEqual(['1001', 'Acme, Inc', '1,250.00']);
    expect(rows[3]![1]).toBe('Say "Hi"');
    expect(findHeaderRow(rows)).toBe(1);
    expect(parseDelimited('a\tb\n1\t2')[1]).toEqual(['1', '2']);
  });

  it('opens ZIPs with limits and refuses unsafe paths and nested archives', () => {
    const zip = zipSync({
      'export/inv.csv': strToU8('a,b\n1,2'),
      'inner.zip': zipSync({ 'x.csv': strToU8('1') }),
      '__MACOSX/._inv.csv': strToU8('x'),
    });
    const out = expandZip(zip);
    expect(out.files.map((f) => f.name)).toEqual(['inv.csv']);
    expect(out.skipped.some((s) => /inside archives/.test(s.reason))).toBe(true);
  });

  it('reads the first sheet of an xlsx', () => {
    const xlsx = zipSync({
      'xl/sharedStrings.xml': strToU8(
        '<sst><si><t>Invoice</t></si><si><t>Client</t></si><si><t>Total</t></si><si><t>Bob &amp; Co</t></si></sst>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2"><v>77</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>99.5</v></c></row></sheetData></worksheet>',
      ),
    });
    expect(parseXlsx(xlsx)).toEqual([
      ['Invoice', 'Client', 'Total'],
      ['77', 'Bob & Co', '99.5'],
    ]);
  });

  it('guards CSV exports against spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
});

describe('extraction', () => {
  it('reads money and dates the way exports write them', () => {
    expect(parseMoney('$1,234.56')).toBe(123456);
    expect(parseMoney('(50.00)')).toBe(-5000);
    expect(parseMoney('12.00 CR')).toBe(-1200);
    expect(parseMoney('1.234,50')).toBe(123450);
    expect(parseMoney('abc')).toBeNull();
    expect(parseDate('11/05/2026')).toEqual({ iso: '2026-11-05', ambiguous: true });
    expect(parseDate('25/11/2026').iso).toBe('2026-11-25');
    expect(parseDate('Nov 3, 2026').iso).toBe('2026-11-03');
    expect(parseDate('46000').iso).toBe('2025-12-09');
    expect(parseDate('2026-02-30').iso).toBeNull();
  });

  it('maps QuickBooks bill columns and marks them as received bills', () => {
    const headers = ['Date', 'Bill No.', 'Vendor', 'Due Date', 'Amount', 'Open Balance', 'Memo'];
    const m = autoMap(headers);
    expect(m.platform).toBe('quickbooks_bills');
    expect(m.direction).toBe('payable');
    expect(m.mapping).toMatchObject({
      issueDate: 0,
      invoiceNumber: 1,
      partyName: 2,
      dueDate: 3,
      total: 4,
      balance: 5,
      memo: 6,
    });
    const [c] = rowsToCandidates(
      [
        {
          index: 1,
          row: [
            '10/01/2026',
            'B-77',
            'ABC Supply Co',
            '10/31/2026',
            '2,400.00',
            '400.00',
            'Shingles for Elm St',
          ],
        },
      ],
      {
        ...ctx,
        headers,
        mapping: m.mapping,
        mapConfidence: m.confidence,
        directionHint: m.direction!,
      },
    );
    expect(c).toMatchObject({
      direction: 'payable',
      totalMinor: 240000,
      amountPaidMinor: 200000,
      status: 'overdue',
      category: 'Materials',
      invoiceNumber: 'B-77',
    });
    expect(c!.dedupeKey).toBe('payable|abc supply|b-77');
  });

  it('groups line rows into one invoice and checks the arithmetic', () => {
    const headers = [
      'Invoice Number',
      'Customer',
      'Invoice Date',
      'Description',
      'Line Amount',
      'Subtotal',
      'Tax',
      'Total',
    ];
    const m = autoMap(headers);
    const rows = [
      {
        index: 1,
        row: ['1001', 'Jane Doe', '2026-11-01', 'Roof repair', '800', '1000', '82.50', '1082.50'],
      },
      { index: 2, row: ['1001', 'Jane Doe', '2026-11-01', 'Gutter', '200', '', '', ''] },
      { index: 3, row: ['1002', 'Bob', '2026-11-02', 'Driveway', '500', '500', '0', '600'] },
    ];
    const cs = rowsToCandidates(rows, {
      ...ctx,
      headers,
      mapping: m.mapping,
      mapConfidence: m.confidence,
    });
    expect(cs).toHaveLength(2);
    expect(cs[0]!.lines).toHaveLength(2);
    expect(cs[0]!.direction).toBe('receivable');
    expect(cs[0]!.category).toBe('Roofing');
    expect(cs[0]!.reviewReasons).toEqual([]);
    expect(cs[1]!.reviewReasons.join(' ')).toMatch(
      /Parts add up to 500.00 but the total is 600.00/,
    );
  });

  it('flags missing fields and credit notes', () => {
    const headers = ['Customer', 'Total', 'Type'];
    const [c] = rowsToCandidates([{ index: 1, row: ['Acme', '-50', 'Credit Memo'] }], {
      ...ctx,
      headers,
      mapping: autoMap(headers).mapping,
      mapConfidence: {},
    });
    expect(c!.docType).toBe('credit_note');
    expect(c!.reviewReasons).toContain('No invoice number.');
    expect(c!.reviewReasons).toContain('No invoice date.');
  });

  it('reads PDF text and AI answers only as proposals that need review', () => {
    const pdf = candidateFromText(
      'INVOICE  Invoice Number: INV-204  Invoice Date: 11/02/2026  Bill To: Lone Star Homes   123 Main  Subtotal: $1,000.00 Tax: $82.50 Total Due: $1,082.50',
      ctx,
    );
    expect(pdf).toMatchObject({
      invoiceNumber: 'INV-204',
      totalMinor: 108250,
      issueDate: '2026-11-02',
    });
    expect(pdf.reviewReasons[0]).toMatch(/check every field/);
    const ai = candidateFromAi(
      'Sure: {"invoiceNumber":"77","partyName":"Home Depot","partyRole":"vendor","issueDate":"2026-11-10","total":312.4,"tax":23.8,"subtotal":288.6,"lines":[{"description":"Lumber","amount":288.6}]}',
      ctx,
      'qwen',
    );
    expect(ai).toMatchObject({ direction: 'payable', totalMinor: 31240, category: 'Materials' });
    expect(ai!.reviewReasons[0]).toMatch(/Read by AI/);
    expect(candidateFromAi('no json here', ctx, 'qwen')).toBeNull();
  });
});

describe('analysis', () => {
  const base = {
    source: 'imported' as const,
    docType: 'invoice' as const,
    category: null,
    project: null,
    location: null,
    currency: 'USD',
    href: '#',
  };
  const recs: Rec[] = [
    {
      ...base,
      id: 'a',
      direction: 'receivable',
      number: '1',
      party: 'Acme',
      issueDate: '2026-09-01',
      dueDate: '2026-10-01',
      totalMinor: 100000,
      paidMinor: 100000,
      status: 'paid',
      project: 'Elm St',
      payments: [{ date: '2026-09-21', amountMinor: 100000 }],
    },
    {
      ...base,
      id: 'b',
      direction: 'receivable',
      number: '2',
      party: 'Acme',
      issueDate: '2026-10-15',
      dueDate: '2026-10-30',
      totalMinor: 50000,
      paidMinor: 0,
      status: 'overdue',
      payments: [],
    },
    {
      ...base,
      id: 'c',
      direction: 'receivable',
      number: '3',
      party: 'Bob',
      issueDate: '2026-11-01',
      dueDate: '2026-12-01',
      totalMinor: 30000,
      paidMinor: 10000,
      status: 'partially_paid',
      payments: [{ date: '2026-11-05', amountMinor: 10000 }],
    },
    {
      ...base,
      id: 'd',
      direction: 'receivable',
      docType: 'credit_note',
      number: 'CM1',
      party: 'Bob',
      issueDate: '2026-11-02',
      dueDate: null,
      totalMinor: -5000,
      paidMinor: 0,
      status: 'open',
      payments: [],
    },
    {
      ...base,
      id: 'e',
      direction: 'payable',
      number: 'B1',
      party: 'ABC Supply',
      issueDate: '2026-09-02',
      dueDate: '2026-10-02',
      totalMinor: 60000,
      paidMinor: 60000,
      status: 'paid',
      category: 'Materials',
      project: 'Elm St',
      payments: [{ date: '2026-09-30', amountMinor: 60000 }],
    },
    {
      ...base,
      id: 'f',
      direction: 'receivable',
      number: 'V',
      party: 'Void Co',
      issueDate: '2026-10-01',
      dueDate: null,
      totalMinor: 99999,
      paidMinor: 0,
      status: 'void',
      payments: [],
    },
    {
      ...base,
      id: 'g',
      direction: 'receivable',
      number: 'X',
      party: 'Euro',
      issueDate: '2026-10-01',
      dueDate: null,
      totalMinor: 1000,
      paidMinor: 0,
      status: 'open',
      currency: 'EUR',
      payments: [],
    },
  ];
  const a = analyze(recs, { from: '2026-01-01', to: today }, today, 'USD');

  it('keeps invoiced, collected, outstanding and margin apart', () => {
    expect(a.kpis.invoiced!.value).toBe(175000);
    expect(a.kpis.collected!.value).toBe(110000);
    expect(a.kpis.outstandingAr!.value).toBe(70000);
    expect(a.kpis.overdueAr!.value).toBe(50000);
    expect(a.kpis.billed!.value).toBe(60000);
    expect(a.kpis.estimatedMargin!.value).toBe(115000);
    expect(a.kpis.avgDaysToPay!.value).toBe(20);
    expect(a.completeness.otherCurrency).toBe(1);
  });

  it('ages receivables, ranks customers, splits projects and explains insights', () => {
    const late = a.arAging.buckets.find((b) => b.label === '1–30 days late')!;
    expect(late).toMatchObject({ amountMinor: 50000, ids: ['b'] });
    expect(a.customers[0]).toMatchObject({
      name: 'Acme',
      invoicedMinor: 150000,
      overdueMinor: 50000,
    });
    expect(a.projects.find((p) => p.name === 'Elm St')).toMatchObject({
      invoicedMinor: 100000,
      billedMinor: 60000,
      marginPct: 40,
    });
    expect(a.insights.map((i) => i.id)).toEqual(
      expect.arrayContaining(['overdue-share', 'customer-concentration', 'data-gaps']),
    );
    expect(a.forecast.nextMonths).toHaveLength(3);
  });
});
