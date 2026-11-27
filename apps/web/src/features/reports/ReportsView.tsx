'use client';

// Business-wide reporting: job margins, WIP, draw forecast, and AP aging — all computed
// server-side from the job-cost, draw, and AP records the builder entered. Missing
// inputs show as "Insufficient data", never as a made-up number.
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { orgKey, useApi, useSession } from '../../lib/session';
import { money, prettyStatus } from '../builderOps/shared';

const MarginRow = z.object({
  jobId: z.string(),
  jobNumber: z.string(),
  jobTitle: z.string(),
  currency: z.string(),
  budgetMinor: z.number(),
  actualMinor: z.number(),
  varianceMinor: z.number(),
  contractMinor: z.number().nullable(),
  marginMinor: z.number().nullable(),
  percentSpent: z.number().nullable(),
});
const Margins = z.object({
  rows: z.array(MarginRow),
  totals: z.object({
    budgetMinor: z.number(),
    actualMinor: z.number(),
    varianceMinor: z.number(),
    jobCount: z.number(),
  }),
});
const WipRow = z.object({
  jobId: z.string(),
  jobNumber: z.string(),
  jobTitle: z.string(),
  currency: z.string(),
  contractMinor: z.number().nullable(),
  budgetMinor: z.number(),
  costsToDateMinor: z.number(),
  billedToDateMinor: z.number(),
  percentComplete: z.number().nullable(),
  earnedMinor: z.number().nullable(),
  overUnderBilledMinor: z.number().nullable(),
});
const Wip = z.object({ rows: z.array(WipRow) });
const ForecastRow = z.object({
  jobId: z.string(),
  jobNumber: z.string(),
  jobTitle: z.string(),
  currency: z.string(),
  contractMinor: z.number().nullable(),
  billedToDateMinor: z.number(),
  remainingContractMinor: z.number().nullable(),
  draftDrawsMinor: z.number(),
  submittedDrawsMinor: z.number(),
  approvedDrawsMinor: z.number(),
});
const Forecast = z.object({
  rows: z.array(ForecastRow),
  totals: z.object({
    draftDrawsMinor: z.number(),
    submittedDrawsMinor: z.number(),
    approvedDrawsMinor: z.number(),
  }),
});
const ApAging = z.object({
  buckets: z.array(z.object({ bucket: z.string(), count: z.number(), amountMinor: z.number() })),
  byStatus: z.array(z.object({ status: z.string(), count: z.number(), amountMinor: z.number() })),
  openTotalMinor: z.number(),
});

const dash = (v: string | null) => v ?? 'Insufficient data';
const pctText = (v: number | null) => (v === null ? null : `${v}%`);

export function ReportsView() {
  return (
    <RouteGate routeId="reports">
      <ReportsContent />
    </RouteGate>
  );
}

function ReportsContent() {
  const session = useSession();
  const { api } = useApi();
  const margins = useQuery({
    queryKey: orgKey(session.orgId, 'reports', 'margins'),
    queryFn: () => api.get('/v1/reports/job-margins', { schema: Margins }),
  });
  const wip = useQuery({
    queryKey: orgKey(session.orgId, 'reports', 'wip'),
    queryFn: () => api.get('/v1/reports/wip', { schema: Wip }),
  });
  const forecast = useQuery({
    queryKey: orgKey(session.orgId, 'reports', 'forecast'),
    queryFn: () => api.get('/v1/reports/draw-forecast', { schema: Forecast }),
  });
  const aging = useQuery({
    queryKey: orgKey(session.orgId, 'reports', 'ap-aging'),
    queryFn: () => api.get('/v1/reports/ap-aging', { schema: ApAging }),
  });

  return (
    <main>
      <PageHeader title="Reports" />
      <p className="web-muted">
        Computed from your job-cost budgets, actuals, draws, and payables. Jobs without a
        budget or contract show “Insufficient data” instead of a guess.
      </p>

      <section className="web-card" aria-label="Job margins">
        <h2>Job margins</h2>
        {margins.error ? <ErrorNotice error={margins.error} /> : null}
        {(margins.data?.rows ?? []).length === 0 && !margins.isLoading ? (
          <p className="web-muted">No jobs with budgets, actuals, or draws yet.</p>
        ) : null}
        <div className="web-table-scroll">
          <table className="web-matrix">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Budget</th>
                <th scope="col">Actual</th>
                <th scope="col">Variance</th>
                <th scope="col">Contract</th>
                <th scope="col">Margin</th>
                <th scope="col">% spent</th>
              </tr>
            </thead>
            <tbody>
              {(margins.data?.rows ?? []).map((r) => (
                <tr key={r.jobId}>
                  <th scope="row">
                    {r.jobNumber} — {r.jobTitle}
                  </th>
                  <td>{money(r.budgetMinor, r.currency)}</td>
                  <td>{money(r.actualMinor, r.currency)}</td>
                  <td>{money(r.varianceMinor, r.currency)}</td>
                  <td>{r.contractMinor === null ? dash(null) : money(r.contractMinor, r.currency)}</td>
                  <td>{r.marginMinor === null ? dash(null) : money(r.marginMinor, r.currency)}</td>
                  <td>{dash(pctText(r.percentSpent))}</td>
                </tr>
              ))}
            </tbody>
            {margins.data ? (
              <tfoot>
                <tr>
                  <th scope="row">Totals ({margins.data.totals.jobCount} jobs)</th>
                  <td>{money(margins.data.totals.budgetMinor)}</td>
                  <td>{money(margins.data.totals.actualMinor)}</td>
                  <td>{money(margins.data.totals.varianceMinor)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <section className="web-card" aria-label="Work in progress">
        <h2>Work in progress</h2>
        {wip.error ? <ErrorNotice error={wip.error} /> : null}
        <div className="web-table-scroll">
          <table className="web-matrix">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Contract</th>
                <th scope="col">Costs to date</th>
                <th scope="col">% complete</th>
                <th scope="col">Earned</th>
                <th scope="col">Billed</th>
                <th scope="col">Over/under billed</th>
              </tr>
            </thead>
            <tbody>
              {(wip.data?.rows ?? []).map((r) => (
                <tr key={r.jobId}>
                  <th scope="row">
                    {r.jobNumber} — {r.jobTitle}
                  </th>
                  <td>{r.contractMinor === null ? dash(null) : money(r.contractMinor, r.currency)}</td>
                  <td>{money(r.costsToDateMinor, r.currency)}</td>
                  <td>{dash(pctText(r.percentComplete))}</td>
                  <td>{r.earnedMinor === null ? dash(null) : money(r.earnedMinor, r.currency)}</td>
                  <td>{money(r.billedToDateMinor, r.currency)}</td>
                  <td>
                    {r.overUnderBilledMinor === null ? dash(null) : money(r.overUnderBilledMinor, r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="web-card" aria-label="Draw forecast">
        <h2>Draw forecast</h2>
        {forecast.error ? <ErrorNotice error={forecast.error} /> : null}
        <div className="web-table-scroll">
          <table className="web-matrix">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Contract</th>
                <th scope="col">Billed</th>
                <th scope="col">Remaining</th>
                <th scope="col">Draft draws</th>
                <th scope="col">Submitted</th>
                <th scope="col">Approved</th>
              </tr>
            </thead>
            <tbody>
              {(forecast.data?.rows ?? []).map((r) => (
                <tr key={r.jobId}>
                  <th scope="row">
                    {r.jobNumber} — {r.jobTitle}
                  </th>
                  <td>{r.contractMinor === null ? dash(null) : money(r.contractMinor, r.currency)}</td>
                  <td>{money(r.billedToDateMinor, r.currency)}</td>
                  <td>
                    {r.remainingContractMinor === null ? dash(null) : money(r.remainingContractMinor, r.currency)}
                  </td>
                  <td>{money(r.draftDrawsMinor, r.currency)}</td>
                  <td>{money(r.submittedDrawsMinor, r.currency)}</td>
                  <td>{money(r.approvedDrawsMinor, r.currency)}</td>
                </tr>
              ))}
            </tbody>
            {forecast.data ? (
              <tfoot>
                <tr>
                  <th scope="row">Open pipeline</th>
                  <td colSpan={3} />
                  <td>{money(forecast.data.totals.draftDrawsMinor)}</td>
                  <td>{money(forecast.data.totals.submittedDrawsMinor)}</td>
                  <td>{money(forecast.data.totals.approvedDrawsMinor)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <section className="web-card" aria-label="Payables aging">
        <h2>Payables aging</h2>
        {aging.error ? <ErrorNotice error={aging.error} /> : null}
        {aging.data ? (
          <>
            <p>Open payables: {money(aging.data.openTotalMinor)}</p>
            <div className="web-table-scroll">
              <table className="web-matrix">
                <thead>
                  <tr>
                    <th scope="col">Bucket</th>
                    <th scope="col">Invoices</th>
                    <th scope="col">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {aging.data.buckets.map((b) => (
                    <tr key={b.bucket}>
                      <th scope="row">{prettyStatus(b.bucket)}</th>
                      <td>{b.count}</td>
                      <td>{money(b.amountMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="web-muted web-small">
              {aging.data.byStatus.map((s) => (
                <li key={s.status}>
                  {prettyStatus(s.status)}: {s.count} · {money(s.amountMinor)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </main>
  );
}
