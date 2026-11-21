// Pure helpers for the invoice editor (InvoiceEditor.tsx): money math, terms to due date, and
// turning the on-screen draft into the API request.
import {
  type CreateNetworkInvoiceRequest,
  type InvoiceDiscount,
  type InvoiceParty,
  type IssuedInvoice,
  invoiceTotalsWithDiscount,
  paymentScheduleAmounts,
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

export interface DraftPayment {
  key: string;
  label: string;
  dueOn: string;
  percent: string;
}

export interface DraftState {
  title: string;
  from: DraftParty;
  billTo: DraftParty;
  /** Set when Bill To is a company connected to you in Network (delivered inside Field Pro). */
  billToCompanyId?: string | null;
  issuedOn: string;
  terms: string;
  lines: DraftLine[];
  notes: string;
  taxType: 'none' | 'total';
  taxPercent: string;
  payments: DraftPayment[];
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
  if (d.payments.length > 0) {
    if (d.payments.some((p) => !p.label.trim() || !p.dueOn))
      problems.push('Give every scheduled payment a name and a due date.');
    if (Math.abs(paymentPercentSum(d.payments) - 100) > 0.001)
      problems.push('Scheduled payments must add up to 100%.');
  }
  return problems;
}

export function paymentPercentSum(payments: readonly DraftPayment[]): number {
  return payments.reduce((sum, p) => sum + (Number(p.percent) || 0), 0);
}

export function draftPaymentAmounts(
  totalMinor: number,
  payments: readonly DraftPayment[],
): number[] {
  return paymentScheduleAmounts(
    totalMinor,
    payments.map((p) => ({ percent: String(Number(p.percent) || 0) })),
  );
}

/** Tax percent actually charged (none when the tax type is None). */
export function effectiveTaxPercent(d: Pick<DraftState, 'taxType' | 'taxPercent'>): string {
  return d.taxType === 'total' ? d.taxPercent : '';
}

/** A saved invoice turned back into the editor's shape, to view it on the dashboard. */
export function draftFromInvoice(invoice: IssuedInvoice): DraftState {
  const toParty = (p: InvoiceParty | null | undefined): DraftParty => ({
    ...EMPTY_PARTY,
    ...(p ?? {}),
    email: p?.email ?? '',
  });
  const billTo = invoice.billTo
    ? toParty(invoice.billTo)
    : { ...EMPTY_PARTY, name: invoice.recipientName ?? '', email: invoice.email?.recipient ?? '' };
  const taxable = invoice.subtotalMinor - (invoice.discountMinor ?? 0);
  const taxPercent =
    taxable > 0 && invoice.taxMinor > 0
      ? String(Math.round((invoice.taxMinor / taxable) * 100000) / 1000)
      : '';
  return {
    title: invoice.title ?? 'Invoice',
    from: toParty(invoice.from),
    billTo,
    issuedOn: invoice.issuedOn ?? invoice.createdAt.slice(0, 10),
    terms: invoice.terms ?? 'On Receipt',
    lines: invoice.lines.map((line, index) => {
      const [first, ...rest] = line.description.split('\n');
      return {
        key: `saved-${index}`,
        description: first ?? '',
        details: rest.join('\n'),
        rate: (line.unitPriceMinor / 100).toFixed(2),
        qty: line.quantity,
      };
    }),
    notes: invoice.memo ?? '',
    taxType: taxPercent ? 'total' : 'none',
    taxPercent,
    payments: (invoice.paymentSchedule ?? []).map((p, index) => ({ key: `pay-${index}`, ...p })),
    discountType: invoice.discount?.type ?? 'none',
    discountValue: invoice.discount?.value ?? '',
  };
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
    ...(d.billToCompanyId ? { recipientOrgId: d.billToCompanyId } : { billTo }),
    ...(from ? { from } : {}),
    title: d.title.trim() || 'Invoice',
    terms: term.label,
    issuedOn: d.issuedOn,
    dueOn: addDays(d.issuedOn, term.days),
    ...(discount ? { discount } : {}),
    taxRate: taxRateFromPercent(effectiveTaxPercent(d)),
    ...(d.payments.length > 0
      ? {
          paymentSchedule: d.payments.map((p) => ({
            label: p.label.trim(),
            dueOn: p.dueOn,
            percent: String(Math.round((Number(p.percent) || 0) * 100) / 100),
          })),
        }
      : {}),
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
