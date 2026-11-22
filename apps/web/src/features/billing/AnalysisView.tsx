'use client';
// Analysis: how the business is doing, from validated invoices and bills only. Each number shows
// its definition and how complete its data is, and opens the records behind it.
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ErrorNotice, PageHeader } from '../../components/common';
import { orgKey, useApi, useSession } from '../../lib/session';

interface Metric {
  value: number;
  definition: string;
  records: number;
  complete: boolean;
  note?: string;
}
interface Bucket {
  label: string;
  amountMinor: number;
  count: number;
  ids: string[];
}
interface DrillRec {
  id: string;
  href: string;
  number: string;
  party: string;
  direction: string;
  issueDate: string | null;
  dueDate: string | null;
  totalMinor: number;
  paidMinor: number;
  status: string;
  source: string;
}
interface Analysis {
  generatedAt: string;
  currency: string;
  range: { from: string; to: string };
  kpis: Record<string, Metric>;
  arAging: { buckets: Bucket[]; noDueDateMinor: number };
  apAging: { buckets: Bucket[]; noDueDateMinor: number };
  monthly: {
    month: string;
    invoicedMinor: number;
    collectedMinor: number;
    billedMinor: number;
    paidOutMinor: number;
  }[];
  customers: {
    name: string;
    invoicedMinor: number;
    invoices: number;
    outstandingMinor: number;
    overdueMinor: number;
    avgDaysToPay: number | null;
    lastInvoice: string | null;
    ids: string[];
  }[];
  vendors: {
    name: string;
    billedMinor: number;
    bills: number;
    outstandingMinor: number;
    categories: string[];
    ids: string[];
  }[];
  expenseCategories: { name: string; billedMinor: number; count: number }[];
  revenueCategories: { name: string; invoicedMinor: number; count: number }[];
  projects: {
    name: string;
    invoicedMinor: number;
    billedMinor: number;
    estimatedMarginMinor: number;
    marginPct: number | null;
    costsLinked: boolean;
  }[];
  locations: Analysis['projects'];
  forecast: {
    basis: string;
    confidence: string;
    nextMonths: {
      month: string;
      expectedInvoicedMinor: number;
      lowMinor: number;
      highMinor: number;
    }[];
    arDueNext30Minor: number;
    apDueNext30Minor: number;
    netDueNext30Minor: number;
  };
  insights: {
    id: string;
    severity: 'high' | 'medium' | 'low';
    title: string;
    detail: string;
    action: string;
    evidence: string[];
  }[];
  completeness: {
    records: number;
    receivables: number;
    payables: number;
    missingDate: number;
    otherCurrency: number;
    paidWithoutDate: number;
    missingCategory: number;
  };
  drill: DrillRec[];
}

const KPI_ORDER: [string, string, 'money' | 'days' | 'pct'][] = [
  ['invoiced', 'Invoiced', 'money'],
  ['collected', 'Cash collected', 'money'],
  ['outstandingAr', 'Unpaid by customers', 'money'],
  ['overdueAr', 'Overdue from customers', 'money'],
  ['billed', 'Vendor bills', 'money'],
  ['paidOut', 'Paid to vendors', 'money'],
  ['outstandingAp', 'Unpaid to vendors', 'money'],
  ['estimatedMargin', 'Estimated margin', 'money'],
  ['dso', 'Days sales outstanding', 'days'],
  ['collectionRate', 'Collection rate', 'pct'],
  ['avgDaysToPay', 'Average days to get paid', 'days'],
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DONE_KEY = 'cc.analysis.doneInsights';

export function AnalysisView() {
  const { api } = useApi();
  const { orgId } = useSession();
  const now = new Date();
  const presets: Record<string, { from: string; to: string }> = {
    'This year': { from: `${now.getFullYear()}-01-01`, to: iso(now) },
    'Last 90 days': { from: iso(new Date(now.getTime() - 90 * 86400000)), to: iso(now) },
    'Last 12 months': {
      from: iso(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1)),
      to: iso(now),
    },
    'Last year': { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` },
  };
  const [range, setRange] = useState(presets['This year']!);
  const [drill, setDrill] = useState<{
    title: string;
    ids?: string[];
    filter?: (r: DrillRec) => boolean;
  } | null>(null);
  const [done, setDone] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const markDone = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDone(next);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify([...next]));
    } catch {
      /* storage off */
    }
  };

  const q = useQuery({
    queryKey: orgKey(orgId, 'invoice-intel', 'analysis', range.from, range.to),
    queryFn: async () =>
      (await api.get(`/v1/invoice-intel/analysis?from=${range.from}&to=${range.to}`)) as Analysis,
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const text = (await api.get(
        `/v1/invoice-intel/export.csv?view=analysis&from=${range.from}&to=${range.to}`,
      )) as string;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `analysis-${range.from}-to-${range.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const a = q.data;
  const money = (m: number) =>
    (m / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: a?.currency ?? 'USD',
      maximumFractionDigits: 0,
    });
  const byId = useMemo(() => new Map((a?.drill ?? []).map((r) => [r.id, r])), [a]);
  const drillRows = useMemo(() => {
    if (!drill || !a) return [];
    if (drill.ids) return drill.ids.map((id) => byId.get(id)).filter(Boolean) as DrillRec[];
    return a.drill.filter(drill.filter ?? (() => true));
  }, [drill, a, byId]);
  const inR = (d: string | null) => !!d && d >= range.from && d <= range.to;
  const kpiFilter: Record<string, (r: DrillRec) => boolean> = {
    invoiced: (r) =>
      r.direction === 'receivable' && inR(r.issueDate) && !['void', 'draft'].includes(r.status),
    collected: (r) => r.direction === 'receivable' && r.paidMinor > 0,
    outstandingAr: (r) =>
      r.direction === 'receivable' &&
      r.paidMinor < Math.abs(r.totalMinor) &&
      !['void', 'draft', 'written_off', 'uncollectible'].includes(r.status),
    overdueAr: (r) =>
      r.direction === 'receivable' &&
      !!r.dueDate &&
      r.dueDate < iso(now) &&
      r.paidMinor < Math.abs(r.totalMinor) &&
      !['void', 'draft'].includes(r.status),
    billed: (r) => r.direction === 'payable' && inR(r.issueDate),
    paidOut: (r) => r.direction === 'payable' && r.paidMinor > 0,
    outstandingAp: (r) =>
      r.direction === 'payable' && r.paidMinor < Math.abs(r.totalMinor) && r.status !== 'void',
    estimatedMargin: (r) => inR(r.issueDate),
  };

  return (
    <>
      <PageHeader
        title="Analysis"
        description="How the business is doing, built only from approved invoices and bills. Click any number to see the records behind it."
      />
      <p className="web-small">
        <Link href="/billing">Billing</Link> · <Link href="/billing/imports">Import invoices</Link>
      </p>
      <div
        className="cc-work-board__form"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'end' }}
      >
        {Object.entries(presets).map(([label, r]) => (
          <button
            key={label}
            type="button"
            className={`cc-btn${range.from === r.from && range.to === r.to ? ' cc-btn--primary' : ''}`}
            onClick={() => setRange(r)}
          >
            {label}
          </button>
        ))}
        <label className="web-small">
          From
          <input
            type="date"
            value={range.from}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </label>
        <label className="web-small">
          To
          <input
            type="date"
            value={range.to}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </label>
        <button
          type="button"
          className="cc-btn"
          disabled={exportCsv.isPending}
          onClick={() => exportCsv.mutate()}
        >
          Export CSV for accountant
        </button>
        <button type="button" className="cc-btn" onClick={() => window.print()}>
          Print report
        </button>
      </div>
      {q.error && (
        <ErrorNotice
          error={q.error}
          title="Analysis could not be loaded"
          onRetry={() => void q.refetch()}
        />
      )}
      {q.isPending && <p>Adding up your invoices and bills…</p>}
      {a && (
        <>
          <p className="web-muted web-small">
            {a.range.from} to {a.range.to} · {a.currency} · {a.completeness.records} records (
            {a.completeness.receivables} customer invoices, {a.completeness.payables} vendor bills)
            · updated {new Date(a.generatedAt).toLocaleString('en-US')}
          </p>
          {a.completeness.records === 0 && (
            <p className="web-card">
              No approved invoices or bills yet.{' '}
              <Link href="/billing/imports">Import invoices</Link> or create them in Billing to see
              Analysis.
            </p>
          )}

          <section className="web-section" aria-labelledby="kpi-heading">
            <h2 id="kpi-heading">Overview</h2>
            <div className="cc-work-board__cards">
              {KPI_ORDER.map(([key, label, kind]) => {
                const m = a.kpis[key];
                if (!m) return null;
                const shown =
                  kind === 'money'
                    ? money(m.value)
                    : kind === 'pct'
                      ? `${m.value}%`
                      : m.complete
                        ? `${m.value} days`
                        : '—';
                return (
                  <article key={key} className="web-card">
                    <small className="cc-work-board__source">
                      {label}
                      {!m.complete && ' · incomplete'}
                    </small>
                    {kpiFilter[key] ? (
                      <button
                        type="button"
                        className="cc-btn"
                        style={{ fontSize: '1.3rem', fontWeight: 700 }}
                        onClick={() => setDrill({ title: label, filter: kpiFilter[key]! })}
                      >
                        {shown}
                      </button>
                    ) : (
                      <strong style={{ fontSize: '1.3rem' }}>{shown}</strong>
                    )}
                    <p className="web-muted web-small">{m.records} records</p>
                    {m.note && <p className="web-small">{m.note}</p>}
                    <details className="web-small">
                      <summary>How this is counted</summary>
                      {m.definition}
                    </details>
                  </article>
                );
              })}
            </div>
          </section>

          {drill && (
            <section className="web-card" aria-labelledby="drill-heading">
              <h3 id="drill-heading">
                {drill.title}: {drillRows.length} records
              </h3>
              <button type="button" className="cc-btn" onClick={() => setDrill(null)}>
                Close
              </button>
              <div style={{ overflowX: 'auto', maxHeight: 420 }}>
                <table className="web-small">
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Party</th>
                      <th>Type</th>
                      <th>Date</th>
                      <th>Due</th>
                      <th>Total</th>
                      <th>Paid</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillRows.slice(0, 500).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link href={r.href}>{r.number || 'Open'}</Link>
                        </td>
                        <td>{r.party}</td>
                        <td>{r.direction === 'receivable' ? 'Customer invoice' : 'Vendor bill'}</td>
                        <td>{r.issueDate ?? '—'}</td>
                        <td>{r.dueDate ?? '—'}</td>
                        <td>{money(r.totalMinor)}</td>
                        <td>{money(r.paidMinor)}</td>
                        <td>{r.status.replace('_', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="web-section" aria-labelledby="insight-heading">
            <h2 id="insight-heading">Insights and next steps</h2>
            <p className="web-muted web-small">
              Rules over your own numbers. Each one links to the records it is based on. Check them
              before acting; they are not financial advice.
            </p>
            {a.insights.length === 0 && <p className="web-muted">Nothing stands out right now.</p>}
            {a.insights.map((i) => (
              <article
                key={i.id}
                className="web-card"
                style={{ opacity: done.has(i.id) ? 0.55 : 1 }}
              >
                <small className="cc-work-board__source">
                  {i.severity === 'high'
                    ? 'Important'
                    : i.severity === 'medium'
                      ? 'Worth a look'
                      : 'Data note'}
                  {done.has(i.id) ? ' · done' : ''}
                </small>
                <strong>{i.title}</strong>
                <p className="web-small">{i.detail}</p>
                <p className="web-small">
                  <strong>Next step:</strong> {i.action}
                </p>
                {i.evidence.length > 0 && (
                  <button
                    type="button"
                    className="cc-btn"
                    onClick={() => setDrill({ title: i.title, ids: i.evidence })}
                  >
                    See the {i.evidence.length} records
                  </button>
                )}{' '}
                <button type="button" className="cc-btn" onClick={() => markDone(i.id)}>
                  {done.has(i.id) ? 'Mark not done' : 'Mark done'}
                </button>
              </article>
            ))}
          </section>

          <section className="web-section" aria-labelledby="trend-heading">
            <h2 id="trend-heading">Last 12 months</h2>
            <TrendChart monthly={a.monthly} money={money} />
            <div style={{ overflowX: 'auto' }}>
              <table className="web-small">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Invoiced</th>
                    <th>Collected</th>
                    <th>Vendor bills</th>
                    <th>Paid to vendors</th>
                    <th>Invoiced − bills</th>
                  </tr>
                </thead>
                <tbody>
                  {a.monthly.map((m) => (
                    <tr key={m.month}>
                      <td>{m.month}</td>
                      <td>{money(m.invoicedMinor)}</td>
                      <td>{money(m.collectedMinor)}</td>
                      <td>{money(m.billedMinor)}</td>
                      <td>{money(m.paidOutMinor)}</td>
                      <td>{money(m.invoicedMinor - m.billedMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="web-section">
            <h2>Money owed to you (receivables aging)</h2>
            <AgingTable
              aging={a.arAging}
              money={money}
              onDrill={(b) => setDrill({ title: `Customers: ${b.label}`, ids: b.ids })}
            />
            <h2>Money you owe (payables aging)</h2>
            <AgingTable
              aging={a.apAging}
              money={money}
              onDrill={(b) => setDrill({ title: `Vendors: ${b.label}`, ids: b.ids })}
            />
          </section>

          <section className="web-section">
            <h2>Cash in the next 30 days</h2>
            <p className="web-small">
              Customer invoices due: {money(a.forecast.arDueNext30Minor)} · Vendor bills due (or
              with no due date): {money(a.forecast.apDueNext30Minor)} · Difference:{' '}
              {money(a.forecast.netDueNext30Minor)}
            </p>
            <h2>Forecast</h2>
            <p className="web-muted web-small">
              {a.forecast.basis} Confidence: {a.forecast.confidence}.
            </p>
            <table className="web-small">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Expected invoicing</th>
                  <th>Low</th>
                  <th>High</th>
                </tr>
              </thead>
              <tbody>
                {a.forecast.nextMonths.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{money(m.expectedInvoicedMinor)}</td>
                    <td>{money(m.lowMinor)}</td>
                    <td>{money(m.highMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="web-section">
            <h2>Customers</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="web-small">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Invoiced in range</th>
                    <th>Invoices</th>
                    <th>Unpaid</th>
                    <th>Overdue</th>
                    <th>Avg days to pay</th>
                    <th>Last invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {a.customers.slice(0, 50).map((c) => (
                    <tr key={c.name}>
                      <td>
                        <button
                          type="button"
                          className="cc-btn"
                          onClick={() => setDrill({ title: c.name, ids: c.ids })}
                        >
                          {c.name}
                        </button>
                      </td>
                      <td>{money(c.invoicedMinor)}</td>
                      <td>{c.invoices}</td>
                      <td>{money(c.outstandingMinor)}</td>
                      <td>{money(c.overdueMinor)}</td>
                      <td>{c.avgDaysToPay ?? '—'}</td>
                      <td>{c.lastInvoice ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h2>Vendors</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="web-small">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Billed in range</th>
                    <th>Bills</th>
                    <th>Unpaid</th>
                    <th>Categories</th>
                  </tr>
                </thead>
                <tbody>
                  {a.vendors.slice(0, 50).map((v) => (
                    <tr key={v.name}>
                      <td>
                        <button
                          type="button"
                          className="cc-btn"
                          onClick={() => setDrill({ title: v.name, ids: v.ids })}
                        >
                          {v.name}
                        </button>
                      </td>
                      <td>{money(v.billedMinor)}</td>
                      <td>{v.bills}</td>
                      <td>{money(v.outstandingMinor)}</td>
                      <td>{v.categories.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="web-section">
            <h2>Revenue and costs by category</h2>
            <div className="cc-work-board__cards">
              <article className="web-card">
                <strong>Revenue</strong>
                <ul className="web-small">
                  {a.revenueCategories.map((c) => (
                    <li key={c.name}>
                      {c.name}: {money(c.invoicedMinor)} ({c.count})
                    </li>
                  ))}
                </ul>
              </article>
              <article className="web-card">
                <strong>Costs</strong>
                <ul className="web-small">
                  {a.expenseCategories.map((c) => (
                    <li key={c.name}>
                      {c.name}: {money(c.billedMinor)} ({c.count})
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </section>

          {[
            ['Projects and jobs', a.projects],
            ['Locations', a.locations],
          ].map(([title, rows]) => (
            <section className="web-section" key={title as string}>
              <h2>{title as string}</h2>
              {(rows as Analysis['projects']).length === 0 ? (
                <p className="web-muted web-small">
                  No records have this set. Add a project or location column when importing, or set
                  it in review.
                </p>
              ) : (
                <table className="web-small">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Invoiced</th>
                      <th>Vendor bills</th>
                      <th>Estimated margin</th>
                      <th>Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rows as Analysis['projects']).slice(0, 50).map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td>{money(p.invoicedMinor)}</td>
                        <td>{money(p.billedMinor)}</td>
                        <td>{p.costsLinked ? money(p.estimatedMarginMinor) : 'No costs linked'}</td>
                        <td>{p.marginPct === null ? '—' : `${p.marginPct}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}

          <section className="web-section">
            <h2>Data completeness</h2>
            <ul className="web-small">
              <li>
                {a.completeness.missingDate} records have no date and are left out of dated numbers.
              </li>
              <li>{a.completeness.otherCurrency} records use another currency and are left out.</li>
              <li>
                {a.completeness.paidWithoutDate} paid customer invoices have no payment date, so
                cash collected leaves them out.
              </li>
              <li>{a.completeness.missingCategory} vendor bills have no category.</li>
            </ul>
            <p className="web-muted web-small">
              Analysis is a management view from invoices and bills. It is not a general ledger, tax
              return or certified financial statement.
            </p>
          </section>
        </>
      )}
    </>
  );
}

function AgingTable({
  aging,
  money,
  onDrill,
}: {
  aging: Analysis['arAging'];
  money: (m: number) => string;
  onDrill: (b: Bucket) => void;
}) {
  return (
    <table className="web-small">
      <thead>
        <tr>
          <th>Age</th>
          <th>Amount</th>
          <th>Invoices</th>
        </tr>
      </thead>
      <tbody>
        {aging.buckets.map((b) => (
          <tr key={b.label}>
            <td>{b.label}</td>
            <td>
              {b.count ? (
                <button type="button" className="cc-btn" onClick={() => onDrill(b)}>
                  {money(b.amountMinor)}
                </button>
              ) : (
                money(b.amountMinor)
              )}
            </td>
            <td>{b.count}</td>
          </tr>
        ))}
        {aging.noDueDateMinor > 0 && (
          <tr>
            <td>No due date</td>
            <td>{money(aging.noDueDateMinor)}</td>
            <td />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function TrendChart({
  monthly,
  money,
}: {
  monthly: Analysis['monthly'];
  money: (m: number) => string;
}) {
  const max = Math.max(
    1,
    ...monthly.flatMap((m) => [m.invoicedMinor, m.collectedMinor, m.billedMinor]),
  );
  const w = 720;
  const h = 200;
  const bw = w / monthly.length;
  const y = (v: number) => h - (Math.max(0, v) / max) * (h - 20);
  const line = monthly
    .map((m, i) => `${i === 0 ? 'M' : 'L'}${i * bw + bw / 2},${y(m.collectedMinor)}`)
    .join(' ');
  return (
    <figure>
      <svg
        viewBox={`0 0 ${w} ${h + 24}`}
        role="img"
        aria-label="Invoiced, collected and vendor bills by month"
        style={{ width: '100%', maxWidth: 760 }}
      >
        {monthly.map((m, i) => (
          <g key={m.month}>
            <rect
              x={i * bw + bw * 0.12}
              y={y(m.invoicedMinor)}
              width={bw * 0.36}
              height={h - y(m.invoicedMinor)}
              fill="#2563eb"
            >
              <title>{`${m.month} invoiced ${money(m.invoicedMinor)}`}</title>
            </rect>
            <rect
              x={i * bw + bw * 0.52}
              y={y(m.billedMinor)}
              width={bw * 0.36}
              height={h - y(m.billedMinor)}
              fill="#d97706"
            >
              <title>{`${m.month} vendor bills ${money(m.billedMinor)}`}</title>
            </rect>
            <text
              x={i * bw + bw / 2}
              y={h + 16}
              fontSize="10"
              textAnchor="middle"
              fill="currentColor"
            >
              {m.month.slice(5)}
            </text>
          </g>
        ))}
        <path d={line} fill="none" stroke="#16a34a" strokeWidth="2.5" />
      </svg>
      <figcaption className="web-small">
        Blue: invoiced. Orange: vendor bills. Green line: cash collected.
      </figcaption>
    </figure>
  );
}
