// Invoice Intelligence Analysis: business reporting from validated records only. Every metric has
// a written definition, says how complete its data is, and lists the records behind it. Invoice
// value, cash collected, bills and estimated margin are kept apart and never mixed.

export interface Rec {
  id: string;
  source: 'invoice' | 'imported' | 'network_bill';
  direction: 'receivable' | 'payable';
  docType: 'invoice' | 'credit_note' | 'debit_note' | 'receipt' | 'statement' | 'other';
  number: string;
  party: string;
  issueDate: string | null;
  dueDate: string | null;
  totalMinor: number;
  paidMinor: number;
  status: string;
  category: string | null;
  project: string | null;
  location: string | null;
  currency: string;
  /** Cash movements with dates (payments received or paid). */
  payments: { date: string; amountMinor: number }[];
  href: string;
}

export interface Range {
  from: string;
  to: string;
}

export const DEFINITIONS: Record<string, string> = {
  invoiced:
    'Total of customer invoices dated in the range. Credit notes subtract. Void, draft and written-off invoices are left out. This is invoice value, not cash.',
  collected:
    'Customer payments with a payment date in the range. Invoices marked paid without a payment date are counted in "paid, date unknown" and not here.',
  outstandingAr: 'Unpaid balance today on customer invoices that are not void or written off.',
  overdueAr: 'Part of the unpaid customer balance whose due date has passed.',
  billed:
    'Total of vendor bills dated in the range. Vendor credits subtract. This is cost incurred, not cash paid.',
  paidOut: 'Payments to vendors with a payment date in the range.',
  outstandingAp: 'Unpaid balance today on vendor bills that are not void.',
  estimatedMargin:
    'Invoiced minus billed in the range. An estimate from invoices and bills only: it leaves out payroll, owner pay, depreciation and anything not invoiced. Not a profit and loss statement.',
  dso: 'Days sales outstanding: unpaid customer balance divided by the average daily invoiced amount over the last 90 days.',
  collectionRate:
    'Collected divided by invoiced in the same range. Payments can belong to invoices from earlier months, so it can be above 100%.',
  avgDaysToPay:
    'Average days from invoice date to the last payment, for fully paid invoices with both dates.',
};

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const inRange = (d: string | null, r: Range) => !!d && d >= r.from && d <= r.to;
const sign = (r: Rec) => (r.docType === 'credit_note' ? -1 : 1);
const excluded = (r: Rec) =>
  ['void', 'draft', 'written_off', 'uncollectible', 'pending_approval'].includes(r.status) ||
  r.docType === 'statement' ||
  r.docType === 'receipt';
const balance = (r: Rec) => Math.max(0, Math.abs(r.totalMinor) - r.paidMinor);
const month = (d: string) => d.slice(0, 7);

export function monthsBack(to: string, n: number): string[] {
  const d = new Date(to + 'T00:00:00Z');
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}

interface Metric {
  value: number;
  definition: string;
  records: number;
  complete: boolean;
  note?: string;
}

export function analyze(records: Rec[], range: Range, today: string, currency: string) {
  const usable = records.filter((r) => r.currency === currency);
  const otherCurrency = records.length - usable.length;
  const ar = usable.filter((r) => r.direction === 'receivable' && !excluded(r));
  const ap = usable.filter((r) => r.direction === 'payable' && !excluded(r));
  const noDate = usable.filter((r) => !r.issueDate && !excluded(r)).length;

  const invoicedRecs = ar.filter((r) => inRange(r.issueDate, range));
  const billedRecs = ap.filter((r) => inRange(r.issueDate, range));
  const sum = (rs: Rec[]) => rs.reduce((s, r) => s + sign(r) * Math.abs(r.totalMinor), 0);
  const cashIn = ar.flatMap((r) => r.payments.filter((p) => inRange(p.date, range)));
  const cashOut = ap.flatMap((r) => r.payments.filter((p) => inRange(p.date, range)));
  const paidNoDate = ar.filter((r) => r.paidMinor > 0 && r.payments.length === 0);
  const openAr = ar.filter((r) => r.docType !== 'credit_note' && balance(r) > 0);
  const openAp = ap.filter((r) => r.docType !== 'credit_note' && balance(r) > 0);
  const overdue = openAr.filter((r) => r.dueDate && r.dueDate < today);

  const invoiced = sum(invoicedRecs);
  const billed = sum(billedRecs);
  const collected = cashIn.reduce((s, p) => s + p.amountMinor, 0);
  const paidOut = cashOut.reduce((s, p) => s + p.amountMinor, 0);
  const outstandingAr = openAr.reduce((s, r) => s + balance(r), 0);
  const overdueAr = overdue.reduce((s, r) => s + balance(r), 0);
  const outstandingAp = openAp.reduce((s, r) => s + balance(r), 0);
  const from90 = new Date(Date.parse(today) - 90 * DAY).toISOString().slice(0, 10);
  const inv90 = sum(ar.filter((r) => inRange(r.issueDate, { from: from90, to: today })));
  const dso = inv90 > 0 ? Math.round(outstandingAr / (inv90 / 90)) : null;

  const paidFull = ar.filter(
    (r) => r.issueDate && r.payments.length && balance(r) === 0 && r.docType === 'invoice',
  );
  const dtp = paidFull
    .map((r) =>
      days(
        r.issueDate!,
        r.payments
          .map((p) => p.date)
          .sort()
          .at(-1)!,
      ),
    )
    .filter((d) => d >= 0);
  const avgDaysToPay = dtp.length ? Math.round(dtp.reduce((a, b) => a + b, 0) / dtp.length) : null;

  const kpis: Record<string, Metric> = {
    invoiced: {
      value: invoiced,
      definition: DEFINITIONS.invoiced!,
      records: invoicedRecs.length,
      complete: noDate === 0,
    },
    collected: {
      value: collected,
      definition: DEFINITIONS.collected!,
      records: cashIn.length,
      complete: paidNoDate.length === 0,
      ...(paidNoDate.length
        ? { note: `${paidNoDate.length} paid invoices have no payment date and are not counted.` }
        : {}),
    },
    outstandingAr: {
      value: outstandingAr,
      definition: DEFINITIONS.outstandingAr!,
      records: openAr.length,
      complete: true,
    },
    overdueAr: {
      value: overdueAr,
      definition: DEFINITIONS.overdueAr!,
      records: overdue.length,
      complete: openAr.every((r) => r.dueDate),
    },
    billed: {
      value: billed,
      definition: DEFINITIONS.billed!,
      records: billedRecs.length,
      complete: ap.length > 0,
    },
    paidOut: {
      value: paidOut,
      definition: DEFINITIONS.paidOut!,
      records: cashOut.length,
      complete: ap.every((r) => r.paidMinor === 0 || r.payments.length > 0),
    },
    outstandingAp: {
      value: outstandingAp,
      definition: DEFINITIONS.outstandingAp!,
      records: openAp.length,
      complete: true,
    },
    estimatedMargin: {
      value: invoiced - billed,
      definition: DEFINITIONS.estimatedMargin!,
      records: invoicedRecs.length + billedRecs.length,
      complete: billedRecs.length > 0 && invoicedRecs.length > 0,
      ...(billedRecs.length === 0
        ? {
            note: 'No vendor bills in this range, so margin cannot be estimated. Import your bills.',
          }
        : {}),
    },
    dso: {
      value: dso ?? 0,
      definition: DEFINITIONS.dso!,
      records: openAr.length,
      complete: dso !== null,
    },
    collectionRate: {
      value: invoiced > 0 ? Math.round((collected / invoiced) * 1000) / 10 : 0,
      definition: DEFINITIONS.collectionRate!,
      records: invoicedRecs.length,
      complete: invoiced > 0 && paidNoDate.length === 0,
    },
    avgDaysToPay: {
      value: avgDaysToPay ?? 0,
      definition: DEFINITIONS.avgDaysToPay!,
      records: dtp.length,
      complete: avgDaysToPay !== null,
    },
  };

  const aging = (rs: Rec[]) => {
    const buckets = [
      { label: 'Not due yet', min: -Infinity, max: 0 },
      { label: '1–30 days late', min: 1, max: 30 },
      { label: '31–60 days late', min: 31, max: 60 },
      { label: '61–90 days late', min: 61, max: 90 },
      { label: 'Over 90 days late', min: 91, max: Infinity },
    ].map((b) => ({ ...b, amountMinor: 0, count: 0, ids: [] as string[] }));
    let noDue = 0;
    for (const r of rs) {
      if (!r.dueDate) {
        noDue += balance(r);
        continue;
      }
      const late = days(r.dueDate, today);
      const b = buckets.find((x) => late >= x.min && late <= x.max)!;
      b.amountMinor += balance(r);
      b.count += 1;
      if (b.ids.length < 200) b.ids.push(r.id);
    }
    return { buckets: buckets.map(({ min: _m, max: _x, ...b }) => b), noDueDateMinor: noDue };
  };

  const months = monthsBack(range.to, 12);
  const monthly = months.map((m) => ({
    month: m,
    invoicedMinor: sum(ar.filter((r) => r.issueDate && month(r.issueDate) === m)),
    collectedMinor: ar
      .flatMap((r) => r.payments)
      .filter((p) => month(p.date) === m)
      .reduce((s, p) => s + p.amountMinor, 0),
    billedMinor: sum(ap.filter((r) => r.issueDate && month(r.issueDate) === m)),
    paidOutMinor: ap
      .flatMap((r) => r.payments)
      .filter((p) => month(p.date) === m)
      .reduce((s, p) => s + p.amountMinor, 0),
  }));

  const groupBy = (rs: Rec[], key: (r: Rec) => string | null) => {
    const g = new Map<string, Rec[]>();
    for (const r of rs) {
      const k = key(r) || 'Not set';
      g.set(k, [...(g.get(k) ?? []), r]);
    }
    return g;
  };

  const customers = [...groupBy(ar, (r) => r.party)]
    .map(([name, rs]) => {
      const inR = rs.filter((r) => inRange(r.issueDate, range));
      const paid = rs.filter((r) => r.issueDate && r.payments.length && balance(r) === 0);
      const d = paid
        .map((r) =>
          days(
            r.issueDate!,
            r.payments
              .map((p) => p.date)
              .sort()
              .at(-1)!,
          ),
        )
        .filter((x) => x >= 0);
      return {
        name,
        invoicedMinor: sum(inR),
        invoices: inR.length,
        outstandingMinor: rs.reduce(
          (s, r) => s + (r.docType === 'credit_note' ? 0 : balance(r)),
          0,
        ),
        overdueMinor: rs
          .filter((r) => r.dueDate && r.dueDate < today)
          .reduce((s, r) => s + (r.docType === 'credit_note' ? 0 : balance(r)), 0),
        avgDaysToPay: d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null,
        lastInvoice:
          rs
            .map((r) => r.issueDate)
            .filter(Boolean)
            .sort()
            .at(-1) ?? null,
        ids: rs.slice(0, 200).map((r) => r.id),
      };
    })
    .sort((a, b) => b.invoicedMinor - a.invoicedMinor);

  const vendors = [...groupBy(ap, (r) => r.party)]
    .map(([name, rs]) => {
      const inR = rs.filter((r) => inRange(r.issueDate, range));
      return {
        name,
        billedMinor: sum(inR),
        bills: inR.length,
        outstandingMinor: rs.reduce(
          (s, r) => s + (r.docType === 'credit_note' ? 0 : balance(r)),
          0,
        ),
        categories: [...new Set(rs.map((r) => r.category ?? 'Uncategorized'))].slice(0, 5),
        ids: rs.slice(0, 200).map((r) => r.id),
      };
    })
    .sort((a, b) => b.billedMinor - a.billedMinor);

  const categories = [...groupBy(billedRecs, (r) => r.category)]
    .map(([name, rs]) => ({ name, billedMinor: sum(rs), count: rs.length }))
    .sort((a, b) => b.billedMinor - a.billedMinor);
  const revenueCategories = [...groupBy(invoicedRecs, (r) => r.category)]
    .map(([name, rs]) => ({ name, invoicedMinor: sum(rs), count: rs.length }))
    .sort((a, b) => b.invoicedMinor - a.invoicedMinor);

  const byDim = (key: (r: Rec) => string | null) => {
    const inv = groupBy(invoicedRecs, key);
    const bil = groupBy(billedRecs, key);
    return [...new Set([...inv.keys(), ...bil.keys()])]
      .filter((k) => k !== 'Not set')
      .map((k) => {
        const i = sum(inv.get(k) ?? []);
        const b = sum(bil.get(k) ?? []);
        return {
          name: k,
          invoicedMinor: i,
          billedMinor: b,
          estimatedMarginMinor: i - b,
          marginPct: i > 0 && b > 0 ? Math.round(((i - b) / i) * 1000) / 10 : null,
          costsLinked: b > 0,
        };
      })
      .sort((a, b) => b.invoicedMinor - a.invoicedMinor);
  };

  // Forecast: last 6 full months of invoiced value. Range = lowest to highest month.
  const full = monthly.slice(-7, -1);
  const withData = full.filter((m) => m.invoicedMinor !== 0);
  const avg = withData.length
    ? Math.round(withData.reduce((s, m) => s + m.invoicedMinor, 0) / withData.length)
    : 0;
  const lo = withData.length ? Math.min(...withData.map((m) => m.invoicedMinor)) : 0;
  const hi = withData.length ? Math.max(...withData.map((m) => m.invoicedMinor)) : 0;
  const due30 = openAr
    .filter((r) => r.dueDate && r.dueDate >= today && r.dueDate <= addDays(today, 30))
    .reduce((s, r) => s + balance(r), 0);
  const ap30 = openAp
    .filter((r) => !r.dueDate || r.dueDate <= addDays(today, 30))
    .reduce((s, r) => s + balance(r), 0);
  const forecast = {
    basis:
      'Average of the last 6 full months with invoices. Range is the lowest and highest of those months. Not a promise.',
    confidence: withData.length >= 6 ? 'medium' : withData.length >= 3 ? 'low' : 'not enough data',
    nextMonths: monthsAfter(range.to, 3).map((m) => ({
      month: m,
      expectedInvoicedMinor: avg,
      lowMinor: lo,
      highMinor: hi,
    })),
    arDueNext30Minor: due30,
    apDueNext30Minor: ap30,
    netDueNext30Minor: due30 - ap30,
  };

  const insights = buildInsights({
    customers,
    vendors,
    categories,
    kpis,
    overdue,
    openAr,
    monthly,
    otherCurrency,
    noDate,
    ap30,
    due30,
  });

  return {
    currency,
    range,
    today,
    kpis,
    arAging: aging(openAr),
    apAging: aging(openAp),
    monthly,
    customers: customers.slice(0, 100),
    vendors: vendors.slice(0, 100),
    expenseCategories: categories,
    revenueCategories,
    projects: byDim((r) => r.project),
    locations: byDim((r) => r.location),
    forecast,
    insights,
    completeness: {
      records: records.length,
      receivables: ar.length,
      payables: ap.length,
      missingDate: noDate,
      otherCurrency,
      paidWithoutDate: paidNoDate.length,
      missingCategory: ap.filter((r) => !r.category || r.category === 'Uncategorized').length,
    },
  };
}

function monthsAfter(to: string, n: number): string[] {
  const d = new Date(to + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1 + i, 1)).toISOString().slice(0, 7),
  );
}

function addDays(iso: string, n: number) {
  return new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
}

const money = (m: number) => '$' + Math.round(m / 100).toLocaleString('en-US');

interface Insight {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  action: string;
  evidence: string[];
}

function buildInsights(x: {
  customers: {
    name: string;
    invoicedMinor: number;
    overdueMinor: number;
    avgDaysToPay: number | null;
    ids: string[];
  }[];
  vendors: { name: string; billedMinor: number; ids: string[] }[];
  categories: { name: string; billedMinor: number }[];
  kpis: Record<string, Metric>;
  overdue: Rec[];
  openAr: Rec[];
  monthly: { month: string; invoicedMinor: number; billedMinor: number; collectedMinor: number }[];
  otherCurrency: number;
  noDate: number;
  ap30: number;
  due30: number;
}): Insight[] {
  const out: Insight[] = [];
  const invoiced = x.kpis.invoiced!.value;
  const overdueAr = x.kpis.overdueAr!.value;
  const outstanding = x.kpis.outstandingAr!.value;
  if (overdueAr > 0 && outstanding > 0 && overdueAr / outstanding >= 0.3) {
    const worst = [...x.overdue].sort((a, b) => balance(b) - balance(a)).slice(0, 5);
    out.push({
      id: 'overdue-share',
      severity: overdueAr / outstanding >= 0.5 ? 'high' : 'medium',
      title: `${Math.round((overdueAr / outstanding) * 100)}% of unpaid customer money is late`,
      detail: `${money(overdueAr)} of ${money(outstanding)} is past due on ${x.overdue.length} invoices.`,
      action: `Call the largest late accounts first: ${worst.map((r) => `${r.party} (${money(balance(r))})`).join(', ')}.`,
      evidence: worst.map((r) => r.id),
    });
  }
  const top = x.customers[0];
  if (top && invoiced > 0 && top.invoicedMinor / invoiced >= 0.4 && x.customers.length > 1) {
    out.push({
      id: 'customer-concentration',
      severity: top.invoicedMinor / invoiced >= 0.6 ? 'high' : 'medium',
      title: `${top.name} is ${Math.round((top.invoicedMinor / invoiced) * 100)}% of invoiced value`,
      detail: 'Losing or waiting on one customer would hit revenue hard.',
      action: 'Add more customers in this trade, and keep payment terms with this customer tight.',
      evidence: top.ids.slice(0, 20),
    });
  }
  for (const c of x.customers
    .filter((c) => c.avgDaysToPay !== null && c.avgDaysToPay > 45)
    .slice(0, 3)) {
    out.push({
      id: `slow-${c.name}`,
      severity: 'medium',
      title: `${c.name} pays in about ${c.avgDaysToPay} days`,
      detail: 'Slow payment ties up cash you could use for materials and payroll.',
      action: 'Ask for a deposit before work, shorter terms, or card payment at completion.',
      evidence: c.ids.slice(0, 20),
    });
  }
  const last3 = x.monthly.slice(-4, -1);
  const prev3 = x.monthly.slice(-7, -4);
  const sumB = (ms: typeof last3) => ms.reduce((s, m) => s + m.billedMinor, 0);
  const sumI = (ms: typeof last3) => ms.reduce((s, m) => s + m.invoicedMinor, 0);
  if (sumB(prev3) > 0 && sumB(last3) > sumB(prev3) * 1.25 && sumI(last3) <= sumI(prev3) * 1.05) {
    out.push({
      id: 'costs-rising',
      severity: 'medium',
      title: 'Costs grew faster than invoicing',
      detail: `Bills in the last 3 months: ${money(sumB(last3))}, up from ${money(sumB(prev3))}. Invoicing did not keep pace.`,
      action: `Check the largest cost categories (${
        x.categories
          .slice(0, 3)
          .map((c) => c.name)
          .join(', ') || 'none recorded'
      }) and update your prices or supplier terms.`,
      evidence: [],
    });
  }
  if (x.ap30 > x.due30 && x.ap30 > 0) {
    out.push({
      id: 'cash-gap',
      severity: 'medium',
      title: 'More bills are due in 30 days than customer money is due',
      detail: `Vendor bills due: ${money(x.ap30)}. Customer invoices due: ${money(x.due30)}.`,
      action:
        'Collect late invoices now and ask vendors with the biggest bills about payment dates.',
      evidence: [],
    });
  }
  if (
    x.kpis.estimatedMargin!.complete &&
    invoiced > 0 &&
    x.kpis.estimatedMargin!.value / invoiced < 0.15
  ) {
    out.push({
      id: 'thin-margin',
      severity: 'high',
      title: `Estimated margin is ${Math.round((x.kpis.estimatedMargin!.value / invoiced) * 100)}%`,
      detail: 'Invoices minus bills leaves little room for payroll and overhead.',
      action: 'Review pricing on your most common jobs and the largest vendor costs.',
      evidence: [],
    });
  }
  if (x.noDate > 0 || x.otherCurrency > 0) {
    out.push({
      id: 'data-gaps',
      severity: 'low',
      title: 'Some records are left out of the numbers',
      detail: `${x.noDate} records have no date and ${x.otherCurrency} use another currency.`,
      action: 'Fix them in the review queue so every number includes them.',
      evidence: [],
    });
  }
  return out;
}
