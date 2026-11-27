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
import { FinanceActivityPanel } from './FinanceActivityPanel';

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
type Period = z.infer<typeof EnterpriseWipOptions>['periods'][number];

export function EnterpriseWipReports({ initialProjectId }: { initialProjectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const permitted = session.can('bill:approve');
  const key = orgKey(session.orgId, 'enterprise', 'work-in-progress');
  const [selected, setSelected] = useState(
    () => new Set(initialProjectId ? [initialProjectId] : []),
  );
  const [reviewedPeriod, setReviewedPeriod] = useState<Period | null>(null);
  const [methodology, setMethodology] = useState('');
  const [inspectedReportId, setInspectedReportId] = useState<string>();
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
  const checkingOptions = options.isFetching && !options.isFetchedAfterMount;
  const checkingProject = linked.isFetching && !linked.isFetchedAfterMount;
  const checkingHistory = history.isFetching && !history.isFetchedAfterMount;
  const linkedProject = linked.isSuccess && !checkingProject ? linked.data : undefined;
  const reportDenied =
    history.isError && isApiError(history.error) && [401, 403, 404].includes(history.error.status);
  const periods = options.data?.pages[0]?.periods ?? [];
  const projects = new Map(
    (options.data?.pages.flatMap(({ projects }) => projects) ?? []).map((project) => [
      project.id,
      project.name,
    ]),
  );
  if (linkedProject && initialProjectId) projects.set(initialProjectId, linkedProject.projectName);
  const projectIds = [...selected].filter((id) => projects.has(id)).sort();
  const period = periods.find((item) => item.monthStart === reviewedPeriod?.monthStart);
  const periodChanged = Boolean(
    reviewedPeriod &&
    (period?.id !== reviewedPeriod.id || period.revision !== reviewedPeriod.revision),
  );
  const items =
    reportDenied || checkingHistory
      ? []
      : (history.data?.pages.flatMap((page) => page.items) ?? []);
  const inspectedReport = items.find(({ id }) => id === inspectedReportId) ?? items[0];
  const company = session.me.memberships.find(
    (membership) => membership.orgId === session.orgId,
  )?.orgDisplayName;
  const budgetLink = '/enterprise/projects/' + initialProjectId + '/budget';
  const submitReport = useMutation({
    mutationFn: () => {
      if (!period || periodChanged || projectIds.length === 0)
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
      setInspectedReportId(report.id);
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
    setReviewedPeriod(null);
    setMethodology('');
    setNotice('');
    receipt.current = null;
    submitReport.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !submitReport.isPending &&
      !checkingOptions &&
      options.isSuccess &&
      period &&
      !periodChanged &&
      projectIds.length > 0
    )
      submitReport.mutate();
  }

  return (
    <main className="enterprise-suite enterprise-finance-layout enterprise-financials-view">
      <header className="enterprise-hero">
        <nav className="enterprise-media-toolbar" aria-label="WIP breadcrumb">
          <Link href="/enterprise/costing" className="enterprise-back">
            ← Job Costing
          </Link>
          {permitted && linkedProject && <Link href={budgetLink}>Project budget</Link>}
        </nav>
        <h1>Work in progress</h1>
        {permitted && !denied && !checkingOptions && company && (
          <p>{linkedProject ? company + ' · ' + linkedProject.projectName : company}</p>
        )}
      </header>
      {(!permitted || denied) && (
        <section className="enterprise-panel" role="alert">
          <p>WIP reporting is unavailable.</p>
        </section>
      )}
      {permitted && !denied && (
        <>
          {!checkingOptions && options.isSuccess && (
            <nav className="enterprise-finance-primary-actions" aria-label="WIP actions">
              <a href="#wip-export">Export WIP</a>
              <a href="#saved-wip-reports">Saved reports</a>
            </nav>
          )}
          <div className="enterprise-stack">
            <section
              className="enterprise-panel"
              id="wip-export"
              aria-label="Export work in progress"
            >
              <h2>Export WIP</h2>
              {notice && <p role="status">{notice}</p>}
              {(options.isPending || checkingOptions) && (
                <Skeleton variant="card" label="Loading reporting options" />
              )}
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
              {!checkingOptions && options.isSuccess && !periods.length && (
                <p>
                  Open an accounting month to start a WIP report.{' '}
                  {linkedProject ? (
                    <Link href={budgetLink + '#actual-costs'}>Open project actual costs</Link>
                  ) : (
                    <Link href="/enterprise/finance/projects">Choose a finance project</Link>
                  )}
                </p>
              )}
              {!checkingOptions && options.isSuccess && !projects.size && (
                <p>
                  No projects are available for your reporting access.{' '}
                  <Link href="/enterprise/finance/projects">Open Finance Projects</Link>
                </p>
              )}
              {!checkingOptions && options.isSuccess && periods.length > 0 && projects.size > 0 && (
                <form className="enterprise-form" aria-label="Queue WIP export" onSubmit={submit}>
                  <label>
                    Accounting period
                    <select
                      required
                      value={period?.id ?? ''}
                      disabled={submitReport.isPending || periodChanged}
                      onChange={(event) => {
                        const id = event.currentTarget.value;
                        setReviewedPeriod(periods.find((item) => item.id === id) ?? null);
                        submitReport.reset();
                      }}
                    >
                      <option value="">Choose a period</option>
                      {periods.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.monthStart} through {item.through} · {item.state} · Revision{' '}
                          {item.revision}
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
                  {periodChanged && reviewedPeriod && (
                    <div role="status" className="enterprise-budget-adjustment">
                      <p>
                        The selected period changed. You selected {reviewedPeriod.state} revision{' '}
                        {reviewedPeriod.revision} for {reviewedPeriod.monthStart}.
                        {period
                          ? ' The current period is ' +
                            period.state +
                            ' revision ' +
                            period.revision +
                            '.'
                          : ' That month is currently unavailable.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setReviewedPeriod(period ?? null);
                          submitReport.reset();
                        }}
                      >
                        {period
                          ? 'Use period revision ' + period.revision
                          : 'Clear unavailable period'}
                      </button>
                    </div>
                  )}
                  {submitReport.isError && (
                    <div role="alert" className="enterprise-budget-adjustment">
                      <p>{errorHint(submitReport.error)}</p>
                      {isApiError(submitReport.error) && (
                        <p>Support reference {submitReport.error.correlationId}</p>
                      )}
                    </div>
                  )}
                  <div className="enterprise-wip-actions">
                    <button
                      type="submit"
                      disabled={
                        submitReport.isPending ||
                        periodChanged ||
                        !period ||
                        !methodology ||
                        projectIds.length === 0
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
            <section
              className="enterprise-panel"
              id="saved-wip-reports"
              aria-label="Saved WIP reports"
            >
              <h2>Saved WIP reports</h2>
              {(history.isPending || checkingHistory) && (
                <Skeleton variant="card" label="Loading WIP reports" />
              )}
              {history.isError && (
                <div role="alert">
                  <p>
                    {reportDenied ? 'WIP report history is unavailable.' : errorHint(history.error)}
                  </p>
                  {!reportDenied && (
                    <>
                      {isApiError(history.error) && (
                        <p>Support reference {history.error.correlationId}</p>
                      )}
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
                    </>
                  )}
                </div>
              )}
              {history.isSuccess && !checkingHistory && !items.length && (
                <p>No reports have been queued.</p>
              )}
              {items.length > 0 && (
                <ul className="enterprise-change-history">
                  {items.map((report) => (
                    <li key={report.id}>
                      <WipReportCard report={report} />
                      <button
                        type="button"
                        aria-pressed={inspectedReport?.id === report.id}
                        onClick={() => setInspectedReportId(report.id)}
                      >
                        Show activity for {report.request.period.monthStart}
                      </button>
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
          {!checkingOptions && options.isSuccess && (
            <FinanceActivityPanel>
              {inspectedReport ? (
                <WipActivity report={inspectedReport} />
              ) : (
                <p>
                  {checkingHistory
                    ? 'Loading report activity…'
                    : 'Queue or select a report to see its activity.'}
                </p>
              )}
            </FinanceActivityPanel>
          )}
        </>
      )}
    </main>
  );
}

function WipActivity({ report }: { report: Report }) {
  const { period, rows } = report.request;
  const exceptions = rows.filter((row) => row.issues.length > 0);
  return (
    <>
      <section aria-label="Selected report activity">
        <h3>Report activity</h3>
        <p>
          {period.monthStart} through {period.through} · {period.state} revision {period.revision}
        </p>
        <dl>
          <dt>Status</dt>
          <dd>{statusLabels[report.status]}</dd>
          <dt>Requested</dt>
          <dd>
            <time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleString()}</time>
          </dd>
          {report.completedAt && (
            <>
              <dt>Finished</dt>
              <dd>
                <time dateTime={report.completedAt}>
                  {new Date(report.completedAt).toLocaleString()}
                </time>
              </dd>
            </>
          )}
        </dl>
      </section>
      <section aria-label="Report exceptions">
        <h3>Exceptions</h3>
        {report.errorCode && (
          <p>The export worker could not generate the file. Queue another export to retry.</p>
        )}
        {!exceptions.length && !report.errorCode && (
          <p>No reporting exceptions in this snapshot.</p>
        )}
        <ul className="enterprise-change-history">
          {exceptions.map((row) => (
            <li key={row.projectId}>
              <Link href={'/enterprise/projects/' + row.projectId + '/budget'}>
                {row.projectName}
              </Link>
              <ul>
                {row.issues.map((issue) => (
                  <li key={issue}>{issueLabels[issue]}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </>
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
                        {posting.adjustmentRequestId && (
                          <span>Adjustment {posting.adjustmentRequestId}</span>
                        )}
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
