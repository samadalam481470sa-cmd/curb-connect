'use client';

import {
  EnterpriseFinanceProjectActivity,
  EnterpriseFinanceProjectPage,
} from '@fieldline/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Drawer, formatMinorUnits, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useState } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const apiPath = '/v1/enterprise/finance/projects';
const workspace = '/enterprise/finance/compliance';

export function EnterpriseFinanceCompliance({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const allowed = session.can('enterprise_budget:read');
  const scope = orgKey(session.orgId, 'enterprise', 'finance-compliance');
  const projects = useInfiniteQuery({
    queryKey: [...scope, 'projects'],
    initialPageParam: null as string | null,
    enabled: allowed,
    queryFn: ({ pageParam }) =>
      api.get(apiPath, {
        schema: EnterpriseFinanceProjectPage,
        query: { cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const active = useQuery({
    queryKey: [...scope, projectId],
    enabled: allowed && Boolean(projectId),
    refetchOnMount: 'always',
    queryFn: () =>
      api.get(apiPath + '/' + projectId + '/activity', {
        schema: EnterpriseFinanceProjectActivity,
      }),
  });
  const denied = [active.error, projects.error].some(
    (error) => isApiError(error) && [401, 403, 404].includes(error.status),
  );
  const data = active.isSuccess && !active.isFetching ? active.data : undefined;
  const selected = data?.currentVariances.find(({ id }) => id === selectedId);
  const currentHref = projectId ? '?projectId=' + projectId : '';
  const amount = (minor: string) => formatMinorUnits(BigInt(minor), 'USD', session.me.user.locale);
  const projectOptions = projects.data?.pages.flatMap(({ items }) => items) ?? [];
  const company = session.me.memberships.find(
    (item) => item.orgId === session.orgId,
  )?.orgDisplayName;
  const detail = selected ? (
    <>
      <p>Reviewed amount {amount(selected.overrunMinor)}</p>
      <p>
        Order version {selected.orderRevision} · Allocation version {selected.budgetVersion}
      </p>
      <Link
        href={
          '/enterprise/projects/' + projectId + '/purchase-orders/' + selected.orderId + '/variance'
        }
      >
        {selected.canDecide ? 'Review owner decision' : 'View review history'}
      </Link>
    </>
  ) : (
    <p role="status">
      {active.isFetching
        ? 'Checking the current exception…'
        : selectedId
          ? 'This exception has changed. Select a current request to review it.'
          : 'Select an exception to see its reviewed amount and available actions.'}
    </p>
  );

  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href={'/enterprise/finance/projects' + currentHref}>← Finance projects</Link>
        <h1>Finance compliance</h1>
        {data && (
          <p>
            {company ? company + ' · ' : ''}
            {data.projectName}
          </p>
        )}
      </header>
      {!allowed || denied ? (
        <section className="enterprise-panel" role="alert">
          This finance compliance workspace is unavailable.
        </section>
      ) : (
        <div className="enterprise-finance-layout">
          <div className="enterprise-stack">
            {projects.isPending && <Skeleton variant="card" label="Loading available projects" />}
            <section className="enterprise-panel" aria-label="Compliance projects">
              <h2>Projects</h2>
              {projects.isSuccess && projectOptions.length === 0 && (
                <p>No projects are available for your finance access.</p>
              )}
              <ul className="enterprise-change-history">
                {projectOptions.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={workspace + '?projectId=' + project.id}
                      aria-current={project.id === projectId ? 'page' : undefined}
                    >
                      {project.name}
                    </Link>
                  </li>
                ))}
              </ul>
              {projects.hasNextPage && (
                <button
                  type="button"
                  disabled={projects.isFetchingNextPage}
                  onClick={() => void projects.fetchNextPage()}
                >
                  Load more projects
                </button>
              )}
            </section>
            {projectId && active.isFetching && (
              <Skeleton variant="card" label="Checking current purchase exceptions" />
            )}
            {[
              { error: projects.error, retry: projects.refetch },
              { error: active.error, retry: active.refetch },
            ]
              .filter(({ error }) => error)
              .map(({ error, retry }, index) => (
                <section key={index} className="enterprise-panel" role="alert">
                  <p>{errorHint(error)}</p>
                  {isApiError(error) && <p>Support reference {error.correlationId}</p>}
                  <button type="button" onClick={() => void retry()}>
                    Retry
                  </button>
                </section>
              ))}
            <section className="enterprise-panel" aria-label="Current purchase exceptions">
              <h2>Current purchase exceptions</h2>
              {!projectId && <p>Select a project to check purchase overrun requests.</p>}
              {data?.currentVariances.length === 0 && (
                <p>No purchase overruns awaiting owner review.</p>
              )}
              {data && (
                <ul className="enterprise-change-history">
                  {data.currentVariances.map((variance) => (
                    <li key={variance.id}>
                      <strong>{amount(variance.overrunMinor)} purchase overrun</strong>
                      <span>
                        Order version {variance.orderRevision} · Allocation version{' '}
                        {variance.budgetVersion}
                      </span>
                      <button
                        type="button"
                        aria-pressed={selectedId === variance.id}
                        onClick={() => {
                          setSelectedId(variance.id);
                          setDetailOpen(window.matchMedia('(max-width: 1100px)').matches);
                          void active.refetch();
                        }}
                      >
                        View exception
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {projectId && (
            <aside
              className="enterprise-panel enterprise-finance-activity"
              aria-label="Purchase exception detail"
            >
              <h2>Purchase exception</h2>
              {detail}
            </aside>
          )}
          <Drawer title="Purchase exception" open={detailOpen} onClose={() => setDetailOpen(false)}>
            <div className="enterprise-suite enterprise-finance-activity-drawer">{detail}</div>
          </Drawer>
        </div>
      )}
    </main>
  );
}
