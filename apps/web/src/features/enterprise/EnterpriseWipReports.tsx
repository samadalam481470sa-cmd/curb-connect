'use client';

import {
  EnterpriseBudgetSummary,
  EnterpriseWipOptions,
  EnterpriseWipReport,
  EnterpriseWipReportPage,
  QueueEnterpriseWipReport,
  WIP_METHODOLOGY_VERSION,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { formatMinorUnits, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const path = '/v1/enterprise/finance/wip';
const statusLabels = {
  queued: 'Queued',
  processing: 'Generating report',
  ready: 'Ready to download',
  failed: 'Report generation failed',
};
const issueLabels = {
  missing_forecast: 'A saved forecast is missing.',
  incomplete_forecast: 'The forecast has incomplete estimates.',
  missing_contract: 'The forecast contract value is unavailable in this currency.',
  different_currency: 'Posted costs include a currency different from the forecast.',
  unmatched_allocations: 'One or more posted bill amounts differ from their allocations.',
  invalid_completion_basis: 'The forecast has no positive completion cost.',
};
type Report = z.infer<typeof EnterpriseWipReport>;

export function EnterpriseWipReports({ initialProjectId }: { initialProjectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const permitted = session.can('bill:approve');
  const key = orgKey(session.orgId, 'enterprise', 'work-in-progress');
  const [selected, setSelected] = useState(
    () => new Set(initialProjectId ? [initialProjectId] : []),
  );
  const [periodId, setPeriod] = useState('');
  const [methodology, setMethodology] = useState('');
  const [notice, setNotice] = useState('');
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const options = useInfiniteQuery({
    queryKey: [...key, 'options'],
    enabled: permitted,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path + '/options', {
        schema: EnterpriseWipOptions,
        query: { cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextProjectCursor,
    refetchOnMount: 'always',
  });
  const linked = useQuery({
    queryKey: orgKey(session.orgId, 'enterprise', 'project-budget', initialProjectId, '', ''),
    enabled: permitted && Boolean(initialProjectId),
    queryFn: () =>
      api.get('/v1/enterprise/projects/' + initialProjectId + '/budget', {
        schema: EnterpriseBudgetSummary,
      }),
    refetchOnMount: 'always',
  });
  const history = useInfiniteQuery({
    queryKey: [...key, 'reports'],
    enabled: permitted,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { schema: EnterpriseWipReportPage, query: { cursor: pageParam, limit: 10 } }),
    getNextPageParam: (page) => page.nextCursor,
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      query.state.data?.pages.some(({ items }) =>
        items.some(({ status }) => status === 'queued' || status === 'processing'),
      )
        ? 1500
        : false,
  });
  const denied =
    options.isError && isApiError(options.error) && [401, 403, 404].includes(options.error.status);
  const reportDenied =
    history.isError && isApiError(history.error) && [401, 403, 404].includes(history.error.status);
  const periods = options.data?.pages[0]?.periods ?? [];
  const projects = new Map(
    (options.data?.pages.flatMap(({ projects }) => projects) ?? []).map((project) => [
      project.id,
      project.name,
    ]),
  );
  if (linked.isSuccess && initialProjectId) projects.set(initialProjectId, linked.data.projectName);
  const projectIds = [...selected].filter((id) => projects.has(id)).sort();
  const period = periods.find((item) => item.id === periodId);
  const items = reportDenied ? [] : (history.data?.pages.flatMap((page) => page.items) ?? []);
  const submitReport = useMutation({
    mutationFn: () => {
      if (!period || projectIds.length === 0)
        throw new Error('Choose a period and at least one project.');
      const input = { projectIds, periodId: period.id, methodologyVersion: methodology };
      const signature = JSON.stringify({ input, revision: period.revision });
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      const body = QueueEnterpriseWipReport.parse({
        ...input,
        clientRequestId: receipt.current.id,
      });
      return api.post(path, body, { ifMatch: period.revision, schema: EnterpriseWipReport });
    },
    onSuccess: (report) => {
      setNotice(report.status === 'queued' ? 'WIP export queued.' : statusLabels[report.status]);
      receipt.current = null;
      void history.refetch();
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 412) void options.refetch();
    },
  });

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setSelected(new Set(initialProjectId ? [initialProjectId] : []));
    setPeriod('');
    setMethodology('');
    setNotice('');
    receipt.current = null;
    submitReport.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submitReport.isPending && options.isSuccess && period && projectIds.length > 0)
      submitReport.mutate();
  }

  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <nav className="enterprise-media-toolbar" aria-label="WIP breadcrumb">
          <Link href="/enterprise/costing" className="enterprise-back">
            ← Job Costing
          </Link>
          {permitted && linked.isSuccess && (
            <Link href={'/enterprise/projects/' + initialProjectId + '/budget'}>
              Project budget
            </Link>
          )}
        </nav>
        <h1>Work in progress</h1>
      </header>
      {(!permitted || denied) && (
        <section className="enterprise-panel" role="alert">
          <p>WIP reporting is unavailable.</p>
        </section>
      )}
      {permitted && !denied && (
        <div className="enterprise-stack">
          <section className="enterprise-panel" aria-label="Export work in progress">
            <h2>Export WIP</h2>
            {notice && <p role="status">{notice}</p>}
            {options.isPending && <Skeleton variant="card" label="Loading reporting options" />}
            {options.isError && (
              <div role="alert">
                <p>{errorHint(options.error)}</p>
                {isApiError(options.error) && (
                  <p>Support reference {options.error.correlationId}</p>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void (options.isFetchNextPageError
                      ? options.fetchNextPage()
                      : options.refetch())
                  }
                >
                  Retry reporting options
                </button>
              </div>
            )}
            {options.isSuccess && !periods.length && (
              <p>Open an accounting month to start a WIP report.</p>
            )}
            {options.isSuccess && !projects.size && (
              <p>No projects are available for your reporting access.</p>
            )}
            {options.isSuccess && periods.length > 0 && projects.size > 0 && (
              <form className="enterprise-form" aria-label="Queue WIP export" onSubmit={submit}>
                <label>
                  Accounting period
                  <select
                    required
                    value={periodId}
                    disabled={submitReport.isPending}
                    onChange={(event) => setPeriod(event.currentTarget.value)}
                  >
                    <option value="">Choose a period</option>
                    {periods.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.monthStart} through {item.through} · {item.state}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reporting methodology
                  <select
                    required
                    value={methodology}
                    disabled={submitReport.isPending}
                    onChange={(event) => setMethodology(event.currentTarget.value)}
                  >
                    <option value="">Choose a methodology</option>
                    <option value={WIP_METHODOLOGY_VERSION}>Bill cost-to-cost · v1</option>
                  </select>
                </label>
                <fieldset
                  className="enterprise-budget-adjustment"
                  disabled={submitReport.isPending}
                >
                  <legend>Projects</legend>
                  <div className="enterprise-wip-projects">
                    {[...projects].map(([id, name]) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={() => toggle(id)}
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                  {options.hasNextPage && (
                    <button
                      type="button"
                      disabled={options.isFetchingNextPage}
                      onClick={() => void options.fetchNextPage()}
                    >
                      Load more projects
                    </button>
                  )}
                </fieldset>
                {periodId && !period && (
                  <p role="status">
                    The selected period changed. Choose the current period version.
                  </p>
                )}
                {submitReport.isError && (
                  <p role="alert" className="enterprise-budget-adjustment">
                    {isApiError(submitReport.error)
                      ? (submitReport.error.problem.detail ?? errorHint(submitReport.error))
                      : errorHint(submitReport.error)}
                  </p>
                )}
                <div className="enterprise-wip-actions">
                  <button
                    type="submit"
                    disabled={
                      submitReport.isPending || !period || !methodology || projectIds.length === 0
                    }
                  >
                    {submitReport.isPending ? 'Queuing…' : 'Queue WIP export'}
                  </button>
                  <button type="button" disabled={submitReport.isPending} onClick={reset}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
          <section className="enterprise-panel" aria-label="Saved WIP reports">
            <h2>Saved WIP reports</h2>
            {history.isPending && <Skeleton variant="card" label="Loading WIP reports" />}
            {history.isError && (
              <div role="alert">
                <p>
                  {reportDenied ? 'WIP report history is unavailable.' : errorHint(history.error)}
                </p>
                {!reportDenied && (
                  <button
                    type="button"
                    onClick={() =>
                      void (history.isFetchNextPageError
                        ? history.fetchNextPage()
                        : history.refetch())
                    }
                  >
                    Retry WIP reports
                  </button>
                )}
              </div>
            )}
            {history.isSuccess && !items.length && <p>No reports have been queued.</p>}
            {items.length > 0 && (
              <ul className="enterprise-change-history">
                {items.map((report) => (
                  <li key={report.id}>
                    <WipReportCard report={report} />
                  </li>
                ))}
              </ul>
            )}
            {history.hasNextPage && !reportDenied && (
              <button
                type="button"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                Load more reports
              </button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function WipReportCard({ report }: { report: Report }) {
  const { me } = useSession();
  const money = (minor: string, currency: string) =>
    formatMinorUnits(BigInt(minor), currency, me.user.locale);
  const { period, capturedAt, currencyTotals, rows } = report.request;
  return (
    <>
      <strong>
        {period.monthStart} through {period.through}
      </strong>
      <span>{statusLabels[report.status]}</span>
      <p>
        Inputs captured <time dateTime={capturedAt}>{new Date(capturedAt).toLocaleString()}</time>
      </p>
      {report.status === 'ready' && (
        <a href={path + '/' + report.id + '/file'} download>
          Download WIP CSV
        </a>
      )}
      <details>
        <summary>Period results and source bills</summary>
        <p>Bill cost-to-cost · v1 · {period.state} period</p>
        {currencyTotals.map((total) => (
          <dl key={total.currency}>
            <dt>Period actuals · {total.currency}</dt>
            <dd>{money(total.periodMinor, total.currency)}</dd>
            <dt>Actuals through period · {total.currency}</dt>
            <dd>{money(total.totalThroughPeriodMinor, total.currency)}</dd>
          </dl>
        ))}
        <ul className="enterprise-change-history">
          {rows.map((row) => (
            <li key={row.projectId}>
              <strong>{row.projectName}</strong>
              {row.issues.length > 0 && (
                <ul>
                  {row.issues.map((issue) => (
                    <li key={issue}>{issueLabels[issue]}</li>
                  ))}
                </ul>
              )}
              {row.forecastCurrency && row.earnedToDateMinor !== null && (
                <span>
                  Earned to date {money(row.earnedToDateMinor, row.forecastCurrency)}
                  {row.percentCompleteBps !== null && (
                    <> · {row.percentCompleteBps / 100}% complete</>
                  )}
                </span>
              )}
              {row.postingSources.length > 0 && (
                <details>
                  <summary>Source bill references</summary>
                  <ul className="enterprise-change-history">
                    {row.postingSources.map((posting) => (
                      <li key={posting.postingId}>
                        <strong>
                          {posting.postingDate} · {money(posting.recordedMinor, posting.currency)}
                        </strong>
                        <span>Bill {posting.sourceId}</span>
                        <span>Posting {posting.postingId}</span>
                        <span>Approval {posting.sourceRevisionId}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
