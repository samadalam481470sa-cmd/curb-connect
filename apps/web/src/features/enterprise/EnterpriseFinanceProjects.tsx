'use client';

import { EnterpriseFinanceProjectPage } from '@fieldline/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { formatMinorUnits, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { FinanceProjectActivity } from './FinanceProjectActivity';

const apiPath = '/v1/enterprise/finance/projects';
const pagePath = '/enterprise/finance/projects';

export function EnterpriseFinanceProjects({ initialProjectId }: { initialProjectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const allowed = session.can('enterprise_budget:read');
  const key = orgKey(session.orgId, 'enterprise', 'finance-projects');
  const projects = useInfiniteQuery({
    queryKey: [...key, 'list'],
    enabled: allowed,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(apiPath, { schema: EnterpriseFinanceProjectPage, query: { cursor: pageParam } }),
    getNextPageParam: (page) => page.nextCursor,
    refetchOnMount: 'always',
  });
  const selection = useQuery({
    queryKey: [...key, initialProjectId],
    enabled: allowed && Boolean(initialProjectId),
    queryFn: () =>
      api.get(apiPath, {
        schema: EnterpriseFinanceProjectPage,
        query: { projectId: initialProjectId },
      }),
    refetchOnMount: 'always',
  });
  const denied = isApiError(projects.error) && [401, 403, 404].includes(projects.error.status);
  const projectsReady = projects.isSuccess && !projects.isRefetching;
  const selectionReady = selection.isSuccess && !selection.isFetching;
  const items =
    !denied && !projects.isRefetching
      ? (projects.data?.pages.flatMap((page) => page.items) ?? [])
      : [];
  const chosen = initialProjectId
    ? selectionReady
      ? selection.data.items[0]
      : undefined
    : items[0];
  const company = session.me.memberships.find(
    (item) => item.orgId === session.orgId,
  )?.orgDisplayName;
  const money = (minor: string, currency: string) =>
    formatMinorUnits(BigInt(minor), currency, session.me.user.locale);

  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <nav className="enterprise-media-toolbar" aria-label="Finance breadcrumb">
          <Link className="enterprise-back" href="/enterprise/costing">
            ← Job Costing
          </Link>
        </nav>
        <h1>Finance projects</h1>
        {projects.isSuccess && company && <p>{company}</p>}
      </header>
      {(!allowed || denied) && (
        <section className="enterprise-panel" role="alert">
          <p>Project finance is unavailable.</p>
        </section>
      )}
      {allowed && !denied && (
        <div className="enterprise-finance-layout">
          {chosen && projectsReady && (
            <nav
              className="enterprise-finance-primary-actions"
              aria-label="Finance project actions"
            >
              <Link href={'/enterprise/projects/' + chosen.id + '/financials'}>Open budget</Link>
              {chosen.budget?.state === 'approved' && session.can('enterprise_budget:approve') && (
                <Link href={'/enterprise/projects/' + chosen.id + '/financials#cost-forecasts'}>
                  Create forecast
                </Link>
              )}
              {chosen.forecast && session.can('enterprise_budget:run_scenario') && (
                <Link href={'/enterprise/finance/scenarios?projectId=' + chosen.id}>
                  Run scenario
                </Link>
              )}
              {session.can('bill:approve') && (
                <Link href={'/enterprise/finance/wip?projectId=' + chosen.id}>
                  Open WIP reports
                </Link>
              )}
            </nav>
          )}
          <div className="enterprise-stack">
            {(projects.isPending || projects.isRefetching) && (
              <Skeleton variant="card" label="Loading finance projects" />
            )}
            {projects.isError && (
              <section className="enterprise-panel" role="alert">
                <p>{errorHint(projects.error)}</p>
                {isApiError(projects.error) && (
                  <p>Support reference {projects.error.correlationId}</p>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void (projects.isFetchNextPageError
                      ? projects.fetchNextPage()
                      : projects.refetch())
                  }
                >
                  Retry finance projects
                </button>
              </section>
            )}
            {chosen && projectsReady && (
              <section className="enterprise-panel" aria-label="Selected finance project">
                <h2>{chosen.name}</h2>
                <p>
                  {chosen.budget
                    ? (chosen.budget.state === 'approved' ? 'Approved budget' : 'Draft budget') +
                      ' · Version ' +
                      chosen.budget.version
                    : 'Budget baseline needed'}
                </p>
                {chosen.forecast?.eacMinor && (
                  <p>
                    Forecast at completion{' '}
                    {money(chosen.forecast.eacMinor, chosen.forecast.currency)}
                  </p>
                )}
              </section>
            )}
            {initialProjectId && selection.isFetching && (
              <Skeleton variant="card" label="Loading selected project" />
            )}
            {initialProjectId && selectionReady && !chosen && (
              <section className="enterprise-panel" role="alert">
                <p>This finance project is unavailable.</p>
              </section>
            )}
            {initialProjectId && selection.isError && (
              <section className="enterprise-panel" role="alert">
                <p>{errorHint(selection.error)}</p>
                {isApiError(selection.error) && (
                  <p>Support reference {selection.error.correlationId}</p>
                )}
                <button type="button" onClick={() => void selection.refetch()}>
                  Retry selected project
                </button>
              </section>
            )}
            <section className="enterprise-panel" aria-label="Finance project list">
              <h2>Projects</h2>
              {projectsReady && items.length === 0 && (
                <>
                  <p>No projects are available for your finance access.</p>
                  <Link href="/enterprise/costing">Open Job Costing</Link>
                </>
              )}
              {items.length > 0 && (
                <ul className="enterprise-change-history">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Link
                        aria-current={chosen?.id === item.id ? 'page' : undefined}
                        href={pagePath + '?projectId=' + item.id}
                      >
                        {item.name}
                      </Link>
                      <span>
                        {item.budget
                          ? (item.budget.state === 'approved' ? 'Approved' : 'Draft') +
                            ' · Version ' +
                            item.budget.version
                          : 'No budget'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {projects.hasNextPage && (
                <button
                  type="button"
                  disabled={projects.isFetchingNextPage}
                  onClick={() => void projects.fetchNextPage()}
                >
                  Load more finance projects
                </button>
              )}
            </section>
          </div>
          {chosen && projectsReady && <FinanceProjectActivity projectId={chosen.id} />}
        </div>
      )}
    </main>
  );
}
