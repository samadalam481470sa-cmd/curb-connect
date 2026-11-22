// Invoice Intelligence extraction: maps spreadsheet columns to invoice fields, reads values with
// a confidence and the place each came from, groups line rows into invoices, classifies direction,
// document type and category, checks the arithmetic and decides what a person must review.
// AI and PDF text only propose values; these rules decide what can be approved.

export const FIELDS = [
  'invoiceNumber',
  'partyName',
  'partyEmail',
  'issueDate',
  'dueDate',
  'currency',
  'subtotal',
  'tax',
  'discount',
  'shipping',
  'total',
  'amountPaid',
  'balance',
  'status',
  'docType',
  'direction',
  'category',
  'project',
  'location',
  'costCode',
  'poNumber',
  'memo',
  'paidDate',
  'description',
  'quantity',
  'rate',
  'lineAmount',
] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Partial<Record<Field, number>>;

export const FIELD_LABEL: Record<Field, string> = {
  invoiceNumber: 'Invoice number',
  partyName: 'Customer or vendor',
  partyEmail: 'Email',
  issueDate: 'Invoice date',
  dueDate: 'Due date',
  currency: 'Currency',
  subtotal: 'Subtotal',
  tax: 'Tax',
  discount: 'Discount',
  shipping: 'Shipping',
  total: 'Total',
  amountPaid: 'Amount paid',
  balance: 'Balance due',
  status: 'Status',
  docType: 'Document type',
  direction: 'Sent or received',
  category: 'Category',
  project: 'Project / job',
  location: 'Location',
  costCode: 'Cost code',
  poNumber: 'PO number',
  memo: 'Memo / notes',
  paidDate: 'Paid date',
  description: 'Line description',
  quantity: 'Line quantity',
  rate: 'Line rate',
  lineAmount: 'Line amount',
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Header names used by common platforms (normalized). Earlier names win. */
export const ALIASES: Record<Field, string[]> = {
  invoiceNumber: [
    'invoicenumber',
    'invoiceno',
    'invoicenum',
    'invoiceid',
    'invoice',
    'billnumber',
    'billno',
    'refnumber',
    'referencenumber',
    'docnumber',
    'documentnumber',
    'num',
    'number',
    'no',
    'transactionnumber',
  ],
  partyName: [
    'customer',
    'customername',
    'client',
    'clientname',
    'vendor',
    'vendorname',
    'supplier',
    'suppliername',
    'payee',
    'billto',
    'contact',
    'contactname',
    'company',
    'companyname',
    'name',
    'customerfullname',
    'clientorganization',
    'organization',
  ],
  partyEmail: [
    'email',
    'customeremail',
    'clientemail',
    'vendoremail',
    'emailaddress',
    'billingemail',
  ],
  issueDate: [
    'invoicedate',
    'billdate',
    'issuedate',
    'date',
    'txndate',
    'transactiondate',
    'created',
    'datecreated',
    'dateissued',
    'issued',
  ],
  dueDate: ['duedate', 'due', 'paymentdue', 'datedue'],
  currency: ['currency', 'currencycode', 'curr'],
  subtotal: ['subtotal', 'amountbeforetax', 'netamount', 'pretaxamount', 'taxableamount'],
  tax: ['tax', 'taxamount', 'salestax', 'totaltax', 'vat', 'gst'],
  discount: ['discount', 'discountamount', 'discounts'],
  shipping: ['shipping', 'shippingamount', 'freight', 'delivery', 'deliveryfee'],
  total: [
    'total',
    'invoicetotal',
    'totalamount',
    'amount',
    'grandtotal',
    'billtotal',
    'amountdue',
    'totaldue',
    'invoiceamount',
  ],
  amountPaid: ['amountpaid', 'paid', 'paidamount', 'paymentsapplied', 'totalpaid', 'payments'],
  balance: [
    'balance',
    'balancedue',
    'openbalance',
    'outstanding',
    'amountoutstanding',
    'remaining',
  ],
  status: ['status', 'invoicestatus', 'paymentstatus', 'billstatus', 'state'],
  docType: ['type', 'transactiontype', 'documenttype', 'doctype'],
  direction: ['direction', 'flow'],
  category: ['category', 'account', 'expenseaccount', 'incomeaccount', 'expensecategory', 'class'],
  project: ['project', 'job', 'jobname', 'projectname', 'jobnumber', 'workorder'],
  location: [
    'location',
    'jobaddress',
    'serviceaddress',
    'siteaddress',
    'address',
    'city',
    'branch',
  ],
  costCode: ['costcode', 'phase', 'glcode', 'accountcode'],
  poNumber: ['ponumber', 'po', 'purchaseorder', 'purchaseordernumber'],
  memo: ['memo', 'notes', 'note', 'message', 'terms'],
  paidDate: ['paiddate', 'datepaid', 'paymentdate', 'lastpaymentdate'],
  description: [
    'description',
    'itemdescription',
    'productservice',
    'item',
    'itemname',
    'service',
    'lineitem',
    'product',
  ],
  quantity: ['quantity', 'qty', 'hours', 'units'],
  rate: ['rate', 'unitprice', 'price', 'unitcost', 'itemrate'],
  lineAmount: ['lineamount', 'linetotal', 'itemamount', 'itemtotal', 'extendedamount'],
};

/** Header fingerprints of known exports. Identifies the platform and direction. */
export const PLATFORM_PROFILES: {
  id: string;
  label: string;
  match: (h: Set<string>) => boolean;
  direction?: Direction;
}[] = [
  {
    id: 'quickbooks_bills',
    label: 'QuickBooks bills',
    match: (h) => h.has('vendor') && (h.has('billno') || h.has('duedate')),
    direction: 'payable',
  },
  {
    id: 'quickbooks_invoices',
    label: 'QuickBooks invoices',
    match: (h) => h.has('customer') && h.has('num') && (h.has('openbalance') || h.has('amount')),
    direction: 'receivable',
  },
  {
    id: 'xero',
    label: 'Xero',
    match: (h) => h.has('contactname') && h.has('invoicenumber'),
    direction: undefined,
  },
  {
    id: 'freshbooks',
    label: 'FreshBooks',
    match: (h) => h.has('clientname') && h.has('invoicenumber'),
    direction: 'receivable',
  },
  {
    id: 'wave',
    label: 'Wave',
    match: (h) => h.has('customer') && h.has('invoicenumber') && h.has('amountdue'),
    direction: 'receivable',
  },
  {
    id: 'jobber',
    label: 'Jobber',
    match: (h) => h.has('client') && h.has('invoice') && (h.has('job') || h.has('jobnumber')),
    direction: 'receivable',
  },
  {
    id: 'servicetitan',
    label: 'ServiceTitan',
    match: (h) => h.has('invoice') && h.has('jobnumber') && h.has('customername'),
    direction: 'receivable',
  },
  {
    id: 'stripe',
    label: 'Stripe',
    match: (h) => h.has('customeremail') && h.has('amountdue') && h.has('id'),
    direction: 'receivable',
  },
  {
    id: 'square',
    label: 'Square',
    match: (h) => h.has('invoiceid') && h.has('customername') && h.has('requestedamount'),
    direction: 'receivable',
  },
  {
    id: 'zoho',
    label: 'Zoho Books',
    match: (h) => h.has('invoicenumber') && h.has('customername') && h.has('balance'),
    direction: 'receivable',
  },
];

export type Direction = 'receivable' | 'payable' | 'unknown';
export type DocType = 'invoice' | 'credit_note' | 'debit_note' | 'receipt' | 'statement' | 'other';
export type Status =
  'open' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'disputed' | 'written_off';

export interface FieldEvidence {
  value: string | number | null;
  confidence: number;
  source: string;
  raw: string;
}

export interface CandidateLine {
  description: string;
  quantity: number | null;
  rateMinor: number | null;
  amountMinor: number | null;
}

export interface Candidate {
  rowIndex: number;
  direction: Direction;
  docType: DocType;
  invoiceNumber: string | null;
  partyName: string | null;
  partyKey: string | null;
  partyEmail: string | null;
  issueDate: string | null;
  dueDate: string | null;
  paidDate: string | null;
  currency: string;
  subtotalMinor: number | null;
  taxMinor: number | null;
  discountMinor: number | null;
  shippingMinor: number | null;
  totalMinor: number | null;
  calculatedTotalMinor: number | null;
  amountPaidMinor: number;
  sourceStatus: string | null;
  status: Status;
  category: string | null;
  projectLabel: string | null;
  location: string | null;
  costCode: string | null;
  memo: string | null;
  lines: CandidateLine[];
  fields: Partial<Record<Field, FieldEvidence>>;
  reviewReasons: string[];
  dedupeKey: string | null;
  confidence: number;
}

export function headerSignature(headers: string[]): string {
  return headers.map(norm).filter(Boolean).join('|').slice(0, 2000);
}

/** Auto-map columns. Returns mapping, per-field confidence and detected platform. */
export function autoMap(headers: string[]): {
  mapping: Mapping;
  confidence: Partial<Record<Field, number>>;
  platform: string | null;
  direction?: Direction;
} {
  const normed = headers.map(norm);
  const set = new Set(normed);
  const profile = PLATFORM_PROFILES.find((p) => p.match(set));
  const mapping: Mapping = {};
  const confidence: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  for (const field of FIELDS) {
    const aliases = ALIASES[field];
    let best = -1;
    let bestScore = 0;
    normed.forEach((h, i) => {
      if (used.has(i) || !h) return;
      const exact = aliases.indexOf(h);
      let score = 0;
      if (exact >= 0) score = 0.97 - exact * 0.005;
      else if (aliases.some((a) => a.length >= 4 && (h.startsWith(a) || h.endsWith(a))))
        score = 0.75;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) {
      mapping[field] = best;
      confidence[field] = profile ? Math.min(0.99, bestScore + 0.02) : bestScore;
      used.add(best);
    }
  }
  // "Amount" alone in a file with a separate total is a line amount.
  if (
    mapping.total !== undefined &&
    normed[mapping.total] === 'amount' &&
    mapping.description !== undefined &&
    mapping.lineAmount === undefined
  ) {
    const other = normed.findIndex(
      (h, i) => i !== mapping.total && ['total', 'invoicetotal', 'totalamount'].includes(h),
    );
    if (other >= 0) {
      mapping.lineAmount = mapping.total;
      mapping.total = other;
    }
  }
  return {
    mapping,
    confidence,
    platform: profile?.id ?? null,
    ...(profile?.direction ? { direction: profile.direction } : {}),
  };
}

/** Money text to integer cents. Handles $, commas, (negatives), trailing minus, CR. */
export function parseMoney(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s) || /\bCR$/i.test(s)) {
    neg = true;
    s = s.replace(/-\s*$/, '').replace(/\bCR$/i, '');
  }
  s = s.replace(/[$€£\s]|USD|EUR|GBP|CAD|MXN/gi, '');
  if (/^-/.test(s)) {
    neg = !neg;
    s = s.slice(1);
  }
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents) || cents > 1e13) return null;
  return neg ? -cents : cents;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
function validDate(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Dates as US exports write them. Day-first only when the first number is above 12. */
export function parseDate(raw: string | undefined | null): {
  iso: string | null;
  ambiguous: boolean;
} {
  const s = String(raw ?? '').trim();
  if (!s) return { iso: null, ambiguous: false };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { iso: validDate(+m[1]!, +m[2]!, +m[3]!), ambiguous: false };
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const a = +m[1]!,
      b = +m[2]!;
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    if (a > 12) return { iso: validDate(y, b, a), ambiguous: false };
    return { iso: validDate(y, a, b), ambiguous: b <= 12 && a !== b };
  }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS[m[1]!.slice(0, 3).toLowerCase()])
    return {
      iso: validDate(+m[3]!, MONTHS[m[1]!.slice(0, 3).toLowerCase()]!, +m[2]!),
      ambiguous: false,
    };
  m = /^(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})$/.exec(s);
  if (m && MONTHS[m[2]!.slice(0, 3).toLowerCase()])
    return {
      iso: validDate(+m[3]!, MONTHS[m[2]!.slice(0, 3).toLowerCase()]!, +m[1]!),
      ambiguous: false,
    };
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      return {
        iso: new Date(Math.round((serial - 25569) * 86_400_000)).toISOString().slice(0, 10),
        ambiguous: false,
      };
    }
  }
  return { iso: null, ambiguous: false };
}

export function partyKey(name: string | null): string | null {
  if (!name) return null;
  const k = name
    .toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(/\b(llc|inc|ltd|lp|llp|co|corp|corporation|company|the)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return k || null;
}

const EXPENSE_CATEGORIES: [string, RegExp][] = [
  [
    'Materials',
    /lumber|concrete|cement|rebar|shingle|roofing|asphalt|aggregate|gravel|sand|supply|supplies|home depot|lowe'?s|abc supply|beacon|srs|materials?|building products|84 lumber|ferguson/i,
  ],
  ['Subcontractors', /subcontract|sub-contract|\bsub\b|labor services|crew|installer/i],
  [
    'Equipment rental',
    /rental|rent(ed|al)? equipment|united rentals|sunbelt|herc|bobcat|skid steer|excavator|lift/i,
  ],
  [
    'Fuel and vehicles',
    /fuel|gas station|diesel|shell|exxon|chevron|qt\b|quiktrip|valero|vehicle|truck repair|tires?|auto parts/i,
  ],
  ['Permits and fees', /permit|inspection fee|city of|county of|license fee|plan review/i],
  ['Disposal and dumpsters', /dumpster|disposal|landfill|haul(ing)?|waste|roll-?off/i],
  ['Insurance', /insurance|bond|workers'? comp/i],
  [
    'Utilities and phone',
    /electric|water bill|utility|internet|phone|wireless|at&t|verizon|t-mobile|spectrum/i,
  ],
  [
    'Software and office',
    /software|subscription|saas|office|staples|adobe|microsoft|google|quickbooks|intuit/i,
  ],
  ['Tools', /tool|harbor freight|milwaukee|dewalt|makita|blade/i],
];
const INCOME_CATEGORIES: [string, RegExp][] = [
  ['Roofing', /roof|shingle|re-?roof|gutter|flashing/i],
  ['Concrete', /concrete|driveway|slab|flatwork|sidewalk|patio|foundation/i],
  ['Curb cutting', /curb/i],
  ['Repairs', /repair|fix|patch|leak/i],
  ['Inspections and estimates', /inspect|estimate|assessment/i],
];

export function classifyCategory(
  direction: Direction,
  text: string,
  given: string | null,
): { category: string | null; confidence: number } {
  if (given && given.trim()) return { category: given.trim().slice(0, 80), confidence: 0.95 };
  const table =
    direction === 'payable'
      ? EXPENSE_CATEGORIES
      : direction === 'receivable'
        ? INCOME_CATEGORIES
        : [];
  for (const [label, re] of table) if (re.test(text)) return { category: label, confidence: 0.7 };
  return { category: direction === 'unknown' ? null : 'Uncategorized', confidence: 0.4 };
}

export function classifyDocType(text: string, totalMinor: number | null): DocType {
  const t = text.toLowerCase();
  if (/credit ?(note|memo)|refund/.test(t)) return 'credit_note';
  if (/debit ?(note|memo)/.test(t)) return 'debit_note';
  if (/receipt|sales receipt|payment received/.test(t)) return 'receipt';
  if (/statement/.test(t)) return 'statement';
  if (totalMinor !== null && totalMinor < 0) return 'credit_note';
  return 'invoice';
}

export function deriveStatus(
  source: string | null,
  total: number | null,
  paid: number,
  due: string | null,
  today: string,
): Status {
  const s = (source ?? '').toLowerCase();
  if (/void|cancel|deleted/.test(s)) return 'void';
  if (/dispute/.test(s)) return 'disputed';
  if (/write.?off|written|bad debt/.test(s)) return 'written_off';
  const t = total ?? 0;
  if (t !== 0 && Math.abs(paid) >= Math.abs(t)) return 'paid';
  if (/^paid$|^closed$/.test(s) && t !== 0 && paid === 0) return 'paid';
  if (due && due < today && t !== 0) return 'overdue';
  if (paid > 0) return 'partially_paid';
  return 'open';
}

export function dedupeKey(
  direction: Direction,
  party: string | null,
  number: string | null,
  issueDate: string | null,
  total: number | null,
): string | null {
  if (!party) return null;
  if (number) return `${direction}|${party}|${number.trim().toLowerCase().replace(/^#/, '')}`;
  if (issueDate && total !== null) return `${direction}|${party}|${issueDate}|${total}`;
  return null;
}

interface RowContext {
  headers: string[];
  mapping: Mapping;
  mapConfidence: Partial<Record<Field, number>>;
  directionHint: Direction;
  defaultCurrency: string;
  today: string;
  scanNote: string | null;
}

const cell = (row: string[], idx: number | undefined) =>
  idx === undefined ? undefined : (row[idx] ?? '').trim();

/**
 * Turn spreadsheet rows into candidate records. Rows with the same invoice number and party are
 * line rows of one invoice: their line amounts become lines, the header values come from the first.
 */
export function rowsToCandidates(
  dataRows: { index: number; row: string[] }[],
  ctx: RowContext,
): Candidate[] {
  const groups = new Map<string, { index: number; row: string[] }[]>();
  const order: string[] = [];
  for (const r of dataRows) {
    const num = cell(r.row, ctx.mapping.invoiceNumber) ?? '';
    const party = cell(r.row, ctx.mapping.partyName) ?? '';
    const key = num ? `${num}|${party.toLowerCase()}` : `row:${r.index}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(r);
  }
  return order.map((k) => buildCandidate(groups.get(k)!, ctx));
}

function buildCandidate(rows: { index: number; row: string[] }[], ctx: RowContext): Candidate {
  const first = rows[0]!;
  const fields: Partial<Record<Field, FieldEvidence>> = {};
  const reasons: string[] = [];
  const take = (f: Field): string | undefined => {
    const idx = ctx.mapping[f];
    if (idx === undefined) return undefined;
    // For header values, use the first non-empty value across the group's rows.
    const raw = rows.map((r) => (r.row[idx] ?? '').trim()).find((v) => v !== '') ?? '';
    fields[f] = {
      value: raw || null,
      confidence: raw ? (ctx.mapConfidence[f] ?? 0.8) : 0,
      source: `column "${ctx.headers[idx] ?? idx + 1}"`,
      raw,
    };
    return raw || undefined;
  };
  const money = (f: Field) => {
    const raw = take(f);
    if (raw === undefined) return null;
    const v = parseMoney(raw);
    if (v === null) {
      fields[f]!.confidence = 0.2;
      reasons.push(`${FIELD_LABEL[f]} "${raw}" is not a number.`);
    } else fields[f]!.value = v;
    return v;
  };
  const date = (f: Field) => {
    const raw = take(f);
    if (raw === undefined) return null;
    const d = parseDate(raw);
    if (!d.iso) {
      fields[f]!.confidence = 0.2;
      reasons.push(`${FIELD_LABEL[f]} "${raw}" is not a date.`);
      return null;
    }
    fields[f]!.value = d.iso;
    if (d.ambiguous) {
      fields[f]!.confidence = Math.min(fields[f]!.confidence, 0.75);
    }
    return d.iso;
  };

  const invoiceNumber = take('invoiceNumber')?.slice(0, 120) ?? null;
  const partyName = take('partyName')?.slice(0, 300) ?? null;
  const partyEmail = take('partyEmail')?.slice(0, 200) ?? null;
  const issueDate = date('issueDate');
  const dueDate = date('dueDate');
  const paidDate = date('paidDate');
  const currencyRaw = take('currency');
  const currency =
    currencyRaw && /^[A-Za-z]{3}$/.test(currencyRaw)
      ? currencyRaw.toUpperCase()
      : ctx.defaultCurrency;
  const subtotal = money('subtotal');
  const tax = money('tax');
  const discount = money('discount');
  const shipping = money('shipping');
  let total = money('total');
  const paidRaw = money('amountPaid');
  const balance = money('balance');
  const sourceStatus = take('status')?.slice(0, 60) ?? null;
  const docTypeRaw = take('docType') ?? '';
  const directionRaw = (take('direction') ?? '').toLowerCase();
  const categoryRaw = take('category') ?? null;
  const projectLabel = take('project')?.slice(0, 200) ?? null;
  const location = take('location')?.slice(0, 200) ?? null;
  const costCode = take('costCode')?.slice(0, 60) ?? null;
  const memo = take('memo')?.slice(0, 1000) ?? null;

  const lines: CandidateLine[] = [];
  for (const r of rows) {
    const desc = cell(r.row, ctx.mapping.description) ?? '';
    const amount = parseMoney(cell(r.row, ctx.mapping.lineAmount));
    const qty = Number(cell(r.row, ctx.mapping.quantity) ?? '');
    const rate = parseMoney(cell(r.row, ctx.mapping.rate));
    if (!desc && amount === null && rate === null) continue;
    const computed =
      amount ?? (rate !== null && Number.isFinite(qty) && qty ? Math.round(rate * qty) : null);
    lines.push({
      description: desc.slice(0, 500),
      quantity: Number.isFinite(qty) && qty ? qty : null,
      rateMinor: rate,
      amountMinor: computed,
    });
  }
  const lineSum =
    lines.length && lines.every((l) => l.amountMinor !== null)
      ? lines.reduce((s, l) => s + l.amountMinor!, 0)
      : null;

  if (total === null && balance !== null && paidRaw !== null) total = balance + paidRaw;
  if (total === null && subtotal !== null)
    total = subtotal + (tax ?? 0) - Math.abs(discount ?? 0) + (shipping ?? 0);
  if (total === null && lineSum !== null && rows.length > 1) total = lineSum + (tax ?? 0);
  const paid = paidRaw ?? (balance !== null && total !== null ? total - balance : 0);

  let calculated: number | null = null;
  if (subtotal !== null)
    calculated = subtotal + (tax ?? 0) - Math.abs(discount ?? 0) + (shipping ?? 0);
  else if (lineSum !== null && rows.length > 1)
    calculated = lineSum + (tax ?? 0) - Math.abs(discount ?? 0) + (shipping ?? 0);
  if (calculated !== null && total !== null && Math.abs(calculated - total) > 1) {
    reasons.push(
      `Parts add up to ${(calculated / 100).toFixed(2)} but the total is ${(total / 100).toFixed(2)}.`,
    );
  }

  // Direction: explicit column, then platform/batch hint, then column names.
  let direction: Direction = 'unknown';
  if (/receiv|sale|income|out|sent|customer|ar\b/.test(directionRaw)) direction = 'receivable';
  else if (/payab|bill|expense|purchase|in\b|received|vendor|ap\b/.test(directionRaw))
    direction = 'payable';
  else if (ctx.directionHint !== 'unknown') direction = ctx.directionHint;
  else {
    const partyHeader =
      ctx.mapping.partyName !== undefined ? norm(ctx.headers[ctx.mapping.partyName] ?? '') : '';
    if (/vendor|supplier|payee/.test(partyHeader) || /bill/.test(norm(docTypeRaw)))
      direction = 'payable';
    else if (/customer|client|billto/.test(partyHeader)) direction = 'receivable';
  }
  fields.direction = {
    value: direction,
    confidence: directionRaw
      ? 0.95
      : ctx.directionHint !== 'unknown'
        ? 0.9
        : direction === 'unknown'
          ? 0
          : 0.75,
    source: directionRaw
      ? 'column'
      : ctx.directionHint !== 'unknown'
        ? 'import setting / platform'
        : 'column names',
    raw: directionRaw,
  };

  const text = [
    docTypeRaw,
    invoiceNumber,
    memo,
    partyName,
    categoryRaw,
    ...lines.map((l) => l.description),
  ].join(' ');
  const docType = classifyDocType(`${docTypeRaw} ${invoiceNumber ?? ''}`, total);
  const cat = classifyCategory(direction, text, categoryRaw);
  fields.category = {
    value: cat.category,
    confidence: cat.confidence,
    source: categoryRaw ? 'column' : 'keyword rules',
    raw: categoryRaw ?? '',
  };
  const status = deriveStatus(sourceStatus, total, paid, dueDate, ctx.today);
  const pKey = partyKey(partyName);

  if (!invoiceNumber) reasons.push('No invoice number.');
  if (!partyName) reasons.push('No customer or vendor name.');
  if (total === null) reasons.push('No total.');
  if (!issueDate) reasons.push('No invoice date.');
  if (direction === 'unknown')
    reasons.push('Not clear if this was sent to a customer or received from a vendor.');
  if (issueDate && dueDate && dueDate < issueDate)
    reasons.push('Due date is before the invoice date.');
  if (issueDate && issueDate > addDays(ctx.today, 60))
    reasons.push('Invoice date is more than 60 days in the future.');
  if (total !== null && total < 0 && docType !== 'credit_note')
    reasons.push('Negative total on something that is not a credit note.');
  if (currency !== ctx.defaultCurrency)
    reasons.push(`Currency is ${currency}, not ${ctx.defaultCurrency}. Totals are not converted.`);
  if (paid > Math.abs(total ?? 0) && total !== null)
    reasons.push('Amount paid is more than the total.');
  for (const [f, ev] of Object.entries(fields)) {
    if (
      ev &&
      ev.raw &&
      ev.confidence > 0 &&
      ev.confidence < 0.7 &&
      ['invoiceNumber', 'partyName', 'total', 'issueDate'].includes(f)
    )
      reasons.push(`Check ${FIELD_LABEL[f as Field].toLowerCase()} (low confidence).`);
  }
  if (fields.issueDate && fields.issueDate.confidence < 0.8 && fields.issueDate.value)
    reasons.push('Date could be month/day or day/month.');
  if (ctx.scanNote) reasons.push(ctx.scanNote);

  const keyFields: Field[] = ['invoiceNumber', 'partyName', 'total', 'issueDate', 'direction'];
  const confidence =
    Math.round(
      (keyFields.reduce((s, f) => s + (fields[f]?.confidence ?? 0), 0) / keyFields.length) * 100,
    ) / 100;

  return {
    rowIndex: first.index,
    direction,
    docType,
    invoiceNumber,
    partyName,
    partyKey: pKey,
    partyEmail,
    issueDate,
    dueDate,
    paidDate,
    currency,
    subtotalMinor: subtotal,
    taxMinor: tax,
    discountMinor: discount,
    shippingMinor: shipping,
    totalMinor: total,
    calculatedTotalMinor: calculated,
    amountPaidMinor: Math.max(0, paid),
    sourceStatus,
    status,
    category: cat.category,
    projectLabel,
    location,
    costCode,
    memo,
    lines,
    fields,
    reviewReasons: [...new Set(reasons)],
    dedupeKey: dedupeKey(direction, pKey, invoiceNumber, issueDate, total),
    confidence,
  };
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}

/** Read invoice fields from a PDF's text with simple patterns. Low confidence: always reviewed. */
export function candidateFromText(
  text: string,
  ctx: Omit<RowContext, 'headers' | 'mapping' | 'mapConfidence'>,
  source = 'PDF text',
): Candidate {
  const t = text.replace(/\s+/g, ' ');
  const grab = (re: RegExp) => re.exec(t)?.[1]?.trim() ?? '';
  const number = grab(
    /(?:invoice|bill|inv)\s*(?:number|no\.?|#)\s*:?\s*([A-Z0-9][A-Z0-9-/]{1,30})/i,
  );
  const amt = '(\\(?-?\\$?\\s?[\\d,]+\\.\\d{2}\\)?)';
  const total =
    [
      'total due',
      'amount due',
      'balance due',
      'invoice total',
      'grand total',
      '(?<!sub\\s?-?)total',
    ]
      .map((label) => grab(new RegExp(`${label}\\s*:?\\s*${amt}`, 'i')))
      .find(Boolean) ?? '';
  const tax = grab(/(?:sales tax|tax)\s*(?:\([^)]*\))?\s*:?\s*(\$?\s?[\d,]+\.\d{2})/i);
  const sub = grab(/sub\s?-?total\s*:?\s*(\$?\s?[\d,]+\.\d{2})/i);
  const date = grab(
    /(?:invoice date|date of issue|issue date|date)\s*:?\s*([A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
  );
  const due = grab(
    /(?:due date|payment due|due)\s*:?\s*([A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
  );
  const party =
    grab(
      /(?:bill to|billed to|customer|sold to)\s*:?\s*([A-Z][A-Za-z0-9&.,' -]{2,60}?)(?=\s{2,}|\s(?:\d|invoice|date|attn|phone|email|address))/i,
    ) ||
    grab(
      /(?:from|vendor|remit to)\s*:?\s*([A-Z][A-Za-z0-9&.,' -]{2,60}?)(?=\s{2,}|\s(?:\d|invoice|date))/i,
    );
  const headers = [
    'Invoice number',
    'Customer or vendor',
    'Invoice date',
    'Due date',
    'Subtotal',
    'Tax',
    'Total',
  ];
  const row = [number, party, date, due, sub, tax, total];
  const conf = 0.6;
  const c = buildCandidate([{ index: 0, row }], {
    ...ctx,
    headers,
    mapping: {
      invoiceNumber: 0,
      partyName: 1,
      issueDate: 2,
      dueDate: 3,
      subtotal: 4,
      tax: 5,
      total: 6,
    },
    mapConfidence: {
      invoiceNumber: conf,
      partyName: 0.5,
      issueDate: conf,
      dueDate: conf,
      subtotal: conf,
      tax: conf,
      total: conf,
    },
  });
  for (const ev of Object.values(c.fields))
    if (ev && ev.source.startsWith('column')) ev.source = source;
  c.reviewReasons.unshift(`Read from ${source}: check every field.`);
  return c;
}

/** Prompt for the server AI. The answer must be JSON; it is validated before use. */
export const AI_PROMPT = `You read one invoice, bill, receipt or credit note. Answer with JSON only, no prose:
{"invoiceNumber":string|null,"partyName":string|null,"partyRole":"customer"|"vendor"|null,"issueDate":"YYYY-MM-DD"|null,"dueDate":"YYYY-MM-DD"|null,"currency":"USD"|string,"subtotal":number|null,"tax":number|null,"discount":number|null,"shipping":number|null,"total":number|null,"amountPaid":number|null,"docType":"invoice"|"credit_note"|"receipt"|"statement"|null,"lines":[{"description":string,"quantity":number|null,"rate":number|null,"amount":number|null}]}
Copy values exactly as printed. Use null when a value is not printed. Do not guess. Amounts in dollars.`;

/** Validate an AI JSON answer and turn it into a candidate that always goes to review. */
export function candidateFromAi(
  reply: string,
  ctx: Omit<RowContext, 'headers' | 'mapping' | 'mapConfidence'>,
  model: string,
): Candidate | null {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0];
  if (!json) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
  const lines = Array.isArray(o.lines) ? o.lines.slice(0, 200) : [];
  const headers = [
    'Invoice number',
    'Customer or vendor',
    'Invoice date',
    'Due date',
    'Currency',
    'Subtotal',
    'Tax',
    'Discount',
    'Shipping',
    'Total',
    'Amount paid',
    'Type',
    'Direction',
    'Description',
    'Quantity',
    'Rate',
    'Line amount',
  ];
  const head = [
    s(o.invoiceNumber),
    s(o.partyName),
    s(o.issueDate),
    s(o.dueDate),
    s(o.currency),
    s(o.subtotal),
    s(o.tax),
    s(o.discount),
    s(o.shipping),
    s(o.total),
    s(o.amountPaid),
    s(o.docType),
    o.partyRole === 'vendor' ? 'payable' : o.partyRole === 'customer' ? 'receivable' : '',
  ];
  const rows = (lines.length ? lines : [{}]).map((l, i) => {
    const line = (l ?? {}) as Record<string, unknown>;
    return {
      index: i,
      row: [...head, s(line.description), s(line.quantity), s(line.rate), s(line.amount)],
    };
  });
  const conf = 0.55;
  const mapping: Mapping = {
    invoiceNumber: 0,
    partyName: 1,
    issueDate: 2,
    dueDate: 3,
    currency: 4,
    subtotal: 5,
    tax: 6,
    discount: 7,
    shipping: 8,
    total: 9,
    amountPaid: 10,
    docType: 11,
    direction: 12,
    description: 13,
    quantity: 14,
    rate: 15,
    lineAmount: 16,
  };
  const mapConfidence = Object.fromEntries(Object.keys(mapping).map((k) => [k, conf])) as Partial<
    Record<Field, number>
  >;
  const c = buildCandidate(rows, { ...ctx, headers, mapping, mapConfidence });
  for (const ev of Object.values(c.fields))
    if (ev && ev.source.startsWith('column')) ev.source = `AI (${model})`;
  c.reviewReasons.unshift(`Read by AI (${model}): check every field against the original.`);
  return c;
}
