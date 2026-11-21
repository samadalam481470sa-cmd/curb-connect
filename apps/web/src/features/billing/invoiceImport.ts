// Reading invoices exported from another invoice app: a CSV file, or rows copied from a
// spreadsheet (tab separated). Column names differ between apps, so headers are matched by
// common names and the user can change any match before importing.
import type { ImportedInvoice, ImportedInvoiceStatus } from '@fieldline/contracts';

export const IMPORT_FIELDS = [
  { key: 'number', label: 'Invoice number', required: true },
  { key: 'client', label: 'Client name', required: true },
  { key: 'email', label: 'Client email', required: false },
  { key: 'date', label: 'Invoice date', required: false },
  { key: 'due', label: 'Due date', required: false },
  { key: 'status', label: 'Status', required: false },
  { key: 'total', label: 'Total', required: true },
  { key: 'tax', label: 'Tax', required: false },
  { key: 'paid', label: 'Amount paid', required: false },
  { key: 'balance', label: 'Balance due', required: false },
  { key: 'description', label: 'Item description', required: false },
  { key: 'qty', label: 'Item quantity', required: false },
  { key: 'rate', label: 'Item rate', required: false },
  { key: 'lineAmount', label: 'Item amount', required: false },
  { key: 'notes', label: 'Notes', required: false },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]['key'];
export type ColumnMap = Partial<Record<ImportField, number>>;

/** Header names used by common invoice apps, lower case, spaces and symbols removed. */
const ALIASES: Record<ImportField, string[]> = {
  number: [
    'invoicenumber',
    'invoiceno',
    'invoice',
    'invoiceid',
    'number',
    'no',
    'num',
    'docnumber',
    'documentnumber',
    'invoicenum',
  ],
  client: [
    'client',
    'clientname',
    'customer',
    'customername',
    'customerfullname',
    'billto',
    'billedto',
    'company',
    'companyname',
    'contact',
    'contactname',
    'name',
    'organization',
  ],
  email: ['email', 'clientemail', 'customeremail', 'emailaddress', 'billingemail', 'contactemail'],
  date: [
    'date',
    'invoicedate',
    'issuedate',
    'dateissued',
    'issued',
    'issuedon',
    'created',
    'createddate',
    'txndate',
    'transactiondate',
  ],
  due: ['duedate', 'due', 'paymentdue', 'dueon'],
  status: ['status', 'invoicestatus', 'state', 'paymentstatus'],
  total: [
    'total',
    'invoicetotal',
    'totalamount',
    'grandtotal',
    'amount',
    'invoiceamount',
    'totalinclusivetax',
  ],
  tax: ['tax', 'taxamount', 'salestax', 'taxtotal', 'totaltax'],
  paid: ['paid', 'amountpaid', 'paidamount', 'paymentsreceived', 'totalpaid'],
  balance: [
    'balance',
    'balancedue',
    'amountdue',
    'openbalance',
    'outstanding',
    'due amount',
    'remaining',
  ],
  description: [
    'description',
    'item',
    'items',
    'itemdescription',
    'productservice',
    'product',
    'service',
    'lineitem',
    'itemname',
  ],
  qty: ['qty', 'quantity', 'itemquantity', 'hours'],
  rate: ['rate', 'unitprice', 'price', 'unitcost', 'itemrate', 'itemprice'],
  lineAmount: ['lineamount', 'linetotal', 'itemamount', 'itemtotal', 'lineitemamount'],
  notes: ['notes', 'note', 'memo', 'message', 'comments', 'terms'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Splits CSV / TSV / semicolon text into rows, honoring double quotes. */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = clean.split('\n', 1)[0] ?? '';
  const counts = { '\t': 0, ',': 0, ';': 0 } as Record<string, number>;
  for (const ch of firstLine) if (ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
  const delimiter = (['\t', ',', ';'] as const).reduce((best, d) =>
    (counts[d] ?? 0) > (counts[best] ?? 0) ? d : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** Best guess of which column holds each field. */
export function guessColumns(headers: readonly string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<number>();
  const normalized = headers.map(norm);
  // Exact header names for every field first, so "Due Date" is never taken as the invoice date.
  for (const field of IMPORT_FIELDS) {
    const aliases = ALIASES[field.key].map(norm);
    const index = normalized.findIndex((h, i) => !used.has(i) && aliases.includes(h));
    if (index >= 0) {
      map[field.key] = index;
      used.add(index);
    }
  }
  // Then headers that contain a known name ("Customer Name (Billing)").
  for (const field of IMPORT_FIELDS) {
    if (map[field.key] !== undefined || field.key === 'number' || field.key === 'total') continue;
    const aliases = ALIASES[field.key].map(norm).filter((a) => a.length > 3);
    const index = normalized.findIndex(
      (h, i) => !used.has(i) && aliases.some((a) => h.includes(a)),
    );
    if (index >= 0) {
      map[field.key] = index;
      used.add(index);
    }
  }
  return map;
}

/** "$1,234.50", "1234.5", "(12.00)" -> cents. Empty or bad -> null. */
export function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const negative = /^\(.*\)$/.test(value.trim()) || value.trim().startsWith('-');
  const n = Number(value.replace(/[^0-9.]/g, ''));
  if (!value.replace(/[^0-9]/g, '') || !Number.isFinite(n)) return null;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "2026-11-20", "11/20/2026", "11/20/26", "Nov 20, 2026", "20 Nov 2026" -> "2026-11-20". */
export function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const us = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  const named = v.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  const named2 = v.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/);
  let y: number;
  let m: number;
  let d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) {
    y = Number(us[3]);
    if (y < 100) y += 2000;
    [m, d] = [Number(us[1]), Number(us[2])];
  } else if (named) {
    [y, m, d] = [
      Number(named[3]),
      MONTHS.indexOf(named[1]!.slice(0, 3).toLowerCase()) + 1,
      Number(named[2]),
    ];
  } else if (named2) {
    [y, m, d] = [
      Number(named2[3]),
      MONTHS.indexOf(named2[2]!.slice(0, 3).toLowerCase()) + 1,
      Number(named2[1]),
    ];
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** Maps another app's status words onto ours. */
export function parseStatus(value: string | undefined): ImportedInvoiceStatus | null {
  const v = (value ?? '').toLowerCase();
  if (!v.trim()) return null;
  if (/partial/.test(v)) return 'partially_paid';
  if (/void|cancel|delet|written off|write.?off/.test(v)) return 'void';
  if (/draft|unsent|not sent/.test(v)) return 'draft';
  if (/\bpaid\b|closed|complete|settled|received/.test(v) && !/unpaid/.test(v)) return 'paid';
  return 'sent';
}

export interface ImportPreview {
  invoices: ImportedInvoice[];
  problems: { row: number; message: string }[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Turns rows into invoices. Rows that share an invoice number are one invoice with several
 * items (line-item exports). Totals come from the Total column when there is one.
 */
export function buildInvoices(rows: readonly string[][], map: ColumnMap): ImportPreview {
  const problems: ImportPreview['problems'] = [];
  const cell = (row: readonly string[], field: ImportField) =>
    map[field] === undefined ? undefined : (row[map[field]!] ?? '').trim();
  const groups = new Map<string, { row: number; cells: readonly string[] }[]>();
  rows.forEach((cells, i) => {
    const number = cell(cells, 'number');
    if (!number) {
      problems.push({ row: i + 2, message: 'No invoice number, so this row was left out.' });
      return;
    }
    const list = groups.get(number) ?? [];
    list.push({ row: i + 2, cells });
    groups.set(number, list);
  });

  const invoices: ImportedInvoice[] = [];
  for (const [number, group] of groups) {
    const first = group[0]!.cells;
    const client = group.map((g) => cell(g.cells, 'client')).find(Boolean);
    if (!client) {
      problems.push({ row: group[0]!.row, message: `Invoice ${number} has no client name.` });
      continue;
    }
    const lines: ImportedInvoice['lines'] = [];
    let lineSum = 0;
    for (const g of group) {
      const description = cell(g.cells, 'description');
      if (!description) continue;
      const qtyRaw = Number((cell(g.cells, 'qty') ?? '').replace(/[^0-9.]/g, ''));
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
      const rate = parseMoney(cell(g.cells, 'rate'));
      const amount = parseMoney(cell(g.cells, 'lineAmount'));
      const unitPriceMinor = Math.max(
        0,
        rate ??
          (amount !== null
            ? Math.round(amount / qty)
            : group.length > 1
              ? (parseMoney(cell(g.cells, 'total')) ?? 0)
              : 0),
      );
      lines.push({ description: description.slice(0, 500), quantity: String(qty), unitPriceMinor });
      lineSum += Math.round(qty * unitPriceMinor);
    }
    const totals = group
      .map((g) => parseMoney(cell(g.cells, 'total')))
      .filter((v): v is number => v !== null);
    const sameTotal = totals.length > 0 && totals.every((t) => t === totals[0]);
    let totalMinor = sameTotal
      ? totals[0]!
      : totals.length > 0
        ? totals.reduce((a, b) => a + b, 0)
        : lineSum;
    if (group.length > 1 && !sameTotal && lineSum > 0) totalMinor = lineSum;
    if (totalMinor < 0) {
      problems.push({
        row: group[0]!.row,
        message: `Invoice ${number} has a negative total (credit note), so it was left out.`,
      });
      continue;
    }
    const taxMinor = Math.max(0, parseMoney(cell(first, 'tax')) ?? 0);
    const paidCol = parseMoney(cell(first, 'paid'));
    const balance = parseMoney(cell(first, 'balance'));
    const amountPaidMinor = Math.max(0, paidCol ?? (balance !== null ? totalMinor - balance : 0));
    let status = parseStatus(cell(first, 'status'));
    if (!status) {
      if (totalMinor > 0 && amountPaidMinor >= totalMinor) status = 'paid';
      else if (amountPaidMinor > 0) status = 'partially_paid';
      else status = 'sent';
    }
    // Keep only lines that add up to the subtotal; otherwise the server makes one summary line.
    const subtotal = totalMinor - Math.min(taxMinor, totalMinor);
    const keepLines = lines.length > 0 && Math.abs(lineSum - subtotal) <= lines.length;
    const email = cell(first, 'email');
    const issuedOn = parseDate(cell(first, 'date'));
    const dueOn = parseDate(cell(first, 'due'));
    const notes = cell(first, 'notes');
    const descriptionNote =
      !keepLines && lines.length > 0
        ? lines
            .map((l) => l.description)
            .join('; ')
            .slice(0, 1500)
        : '';
    const memo = [notes, descriptionNote].filter(Boolean).join('\n').slice(0, 2000);
    invoices.push({
      number: number.slice(0, 60),
      clientName: client.slice(0, 200),
      ...(email && EMAIL_RE.test(email) ? { clientEmail: email } : {}),
      ...(issuedOn ? { issuedOn } : {}),
      ...(dueOn ? { dueOn } : {}),
      status,
      totalMinor,
      taxMinor: Math.min(taxMinor, totalMinor),
      amountPaidMinor: Math.min(amountPaidMinor, totalMinor),
      ...(memo ? { memo } : {}),
      lines: keepLines ? lines.slice(0, 100) : [],
    });
  }
  return { invoices, problems };
}
