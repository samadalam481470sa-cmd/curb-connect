// Pure helpers for the invoice editor (InvoiceEditor.tsx): money math, terms to due date, and
// turning the on-screen draft into the API request.
import {
  type CreateNetworkInvoiceRequest,
  type InvoiceDiscount,
  type InvoiceParty,
  invoiceTotalsWithDiscount,
} from '@fieldline/contracts';

export interface DraftLine {
  key: string;
  description: string;
  details: string;
  rate: string;
  qty: string;
}

export interface DraftParty {
  name: string;
  email: string;
  street: string;
  cityState: string;
  zip: string;
  phone: string;
  mobile: string;
  fax: string;
  businessNumber: string;
}

export const EMPTY_PARTY: DraftParty = {
  name: '',
  email: '',
  street: '',
  cityState: '',
  zip: '',
  phone: '',
  mobile: '',
  fax: '',
  businessNumber: '',
};

export const TERMS = [
  { label: 'On Receipt', days: 0 },
  { label: 'Net 7', days: 7 },
  { label: 'Net 15', days: 15 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 45', days: 45 },
  { label: 'Net 60', days: 60 },
] as const;

/** The whole line (description plus additional details) must fit the API's 500 characters. */
export const LINE_TEXT_LIMIT = 500;

export function newLine(key: string): DraftLine {
  return { key, description: '', details: '', rate: '0.00', qty: '1' };
}

/** "12.5" -> 1250 cents. Bad input counts as 0. */
export function toMinor(value: string): number {
  const n = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export function cleanQty(value: string): string {
  const n = Number(value.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? String(Math.round(n * 10000) / 10000) : '0';
}

export function lineText(line: DraftLine): string {
  const details = line.details.trim();
  return details ? `${line.description.trim()}\n${details}` : line.description.trim();
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayLocalIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Lines that count: a description and a positive quantity. */
export function usableLines(lines: readonly DraftLine[]): DraftLine[] {
  return lines.filter((l) => l.description.trim() && Number(cleanQty(l.qty)) > 0);
}

export function draftDiscount(
  type: 'none' | 'percent' | 'flat',
  value: string,
): InvoiceDiscount | null {
  if (type === 'none') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { type, value: String(Math.round(n * 10000) / 10000) };
}

/** Tax percent "8.25" -> rate "0.0825". */
export function taxRateFromPercent(percent: string): string {
  const n = Number(percent);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return String(Math.min(n, 99.99) / 100);
}

export function draftTotals(
  lines: readonly DraftLine[],
  taxPercent: string,
  discount: InvoiceDiscount | null,
) {
  return invoiceTotalsWithDiscount(
    lines.map((l) => ({ quantity: cleanQty(l.qty), unitPriceMinor: toMinor(l.rate) })),
    taxRateFromPercent(taxPercent),
    discount,
  );
}

function party(p: DraftParty): InvoiceParty | undefined {
  if (!p.name.trim()) return undefined;
  const out: InvoiceParty = { name: p.name.trim() };
  for (const key of [
    'email',
    'street',
    'cityState',
    'zip',
    'phone',
    'mobile',
    'fax',
    'businessNumber',
  ] as const) {
    const v = p[key].trim();
    if (v) out[key] = v;
  }
  return out;
}

export interface DraftState {
  title: string;
  from: DraftParty;
  billTo: DraftParty;
  issuedOn: string;
  terms: string;
  lines: DraftLine[];
  notes: string;
  taxPercent: string;
  discountType: 'none' | 'percent' | 'flat';
  discountValue: string;
}

/** Problems that stop saving, in plain words. Empty when the draft can be saved. */
export function draftProblems(d: DraftState): string[] {
  const problems: string[] = [];
  if (!d.billTo.name.trim()) problems.push('Add the client name under Bill To.');
  if (d.billTo.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.billTo.email.trim()))
    problems.push('The Bill To email address does not look right.');
  if (usableLines(d.lines).length === 0)
    problems.push('Add at least one line item with a description.');
  if (d.lines.some((l) => lineText(l).length > LINE_TEXT_LIMIT))
    problems.push(`Each line item can be at most ${LINE_TEXT_LIMIT} characters in total.`);
  return problems;
}

export function draftRequest(
  d: DraftState,
  opts: { autoSend: boolean },
): CreateNetworkInvoiceRequest {
  const term = TERMS.find((t) => t.label === d.terms) ?? TERMS[0];
  const discount = draftDiscount(d.discountType, d.discountValue);
  const billTo = party(d.billTo)!;
  const from = party(d.from);
  return {
    billTo,
    ...(from ? { from } : {}),
    title: d.title.trim() || 'Invoice',
    terms: term.label,
    issuedOn: d.issuedOn,
    dueOn: addDays(d.issuedOn, term.days),
    ...(discount ? { discount } : {}),
    taxRate: taxRateFromPercent(d.taxPercent),
    ...(d.notes.trim() ? { memo: d.notes.trim().slice(0, 2000) } : {}),
    lines: usableLines(d.lines).map((l) => ({
      description: lineText(l),
      quantity: cleanQty(l.qty),
      unit: 'each',
      unitPriceMinor: toMinor(l.rate),
    })),
    ...(billTo.email ? { recipientEmail: billTo.email } : {}),
    autoSend: opts.autoSend,
  };
}
