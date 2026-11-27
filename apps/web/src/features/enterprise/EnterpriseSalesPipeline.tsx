'use client';

import {
  SALES_PIPELINE_STAGES,
  type SalesPipelineFilters,
  SalesPipelinePage,
  type SalesPipelineSort,
  type SalesStageKey,
} from '@fieldline/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatMinorUnits, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';
import { SalesRevenueControl } from './SalesRevenueControls';
import {
  SalesPipelineFilterPanel,
  salesPipelineAddress as address,
  salesPipelinePath as path,
} from './SalesPipelineFilterPanel';

type Filters = z.infer<typeof SalesPipelineFilters>;
const sortControls = [
  { label: 'Lead name', asc: 'name_asc', desc: 'name_desc' },
  { label: 'Source', asc: 'source_asc', desc: 'source_desc' },
  { label: 'Community', asc: 'community_asc', desc: 'community_desc' },
  { label: 'Assigned salesperson', asc: 'owner_asc', desc: 'owner_desc' },
  { label: 'Days in stage', asc: 'stage_age_asc', desc: 'stage_age_desc' },
  { label: 'Next activity', asc: 'next_activity_asc', desc: 'next_activity_desc' },
  { label: 'Approved value by currency', asc: 'approved_value_asc', desc: 'approved_value_desc' },
  { label: 'Probability', asc: 'probability_asc', desc: 'probability_desc' },
  { label: 'Date created', asc: 'created_asc', desc: 'created_desc' },
] as const satisfies ReadonlyArray<{
  label: string;
  asc: SalesPipelineSort;
  desc: SalesPipelineSort;
}>;

export function EnterpriseSalesPipeline({ filters }: { filters: Filters | null }) {
  const stageFilter = filters?.stage;
  const viewFilters = filters ?? {};
  const { api } = useApi();
  const session = useSession();
  const permitted = session.can('enterprise_sales:intake');
  const query = useInfiniteQuery({
    queryKey: orgKey(session.orgId, 'enterprise', 'sales-leads', 'pipeline', viewFilters),
    queryFn: ({ pageParam, signal }) =>
      api.get('/v1' + path, {
        schema: SalesPipelinePage,
        signal,
        query: { cursor: pageParam, ...viewFilters },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: ({ nextCursor }) => nextCursor,
    enabled: permitted && Boolean(filters),
    refetchOnMount: 'always',
  });
  const denied =
    !permitted || (isApiError(query.error) && [401, 403, 404].includes(query.error.status));
  const pending =
    Boolean(filters) && (query.isPending || (query.isFetching && !query.isFetchedAfterMount));
  const view = !denied && !pending ? query.data?.pages[0] : undefined;
  const items = view ? (query.data?.pages.flatMap(({ items }) => items) ?? []) : [];
  const company = session.me.memberships.find(
    ({ orgId }) => orgId === session.orgId,
  )?.orgDisplayName;

  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href="/enterprise/sales/leads" className="enterprise-back">
          ← Sales leads
        </Link>
        <h1>Sales pipeline</h1>
        {view && company && <p>{company}</p>}
      </header>
      {denied && <p role="alert">The sales pipeline is unavailable.</p>}
      {!denied && !filters && (
        <p role="alert">
          The selected pipeline filters are invalid. <Link href={path}>Clear filters</Link>
        </p>
      )}
      {!denied && pending && <Skeleton variant="card" label="Loading sales pipeline" />}
      {!denied && query.isError && (
        <SalesLeadFailure
          error={query.error}
          retry={() => {
            void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch());
          }}
        />
      )}
      {view && (
        <div className="enterprise-stack">
          <nav className="enterprise-finance-primary-actions" aria-label="Sales pipeline actions">
            <Link href="/enterprise/sales/leads">Create or find a lead</Link>
            {session.can('enterprise_sales:manage') && (
              <Link href={address('/enterprise/sales/reports', viewFilters)}>
                Export sales report
              </Link>
            )}
            <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
              Refresh pipeline
            </button>
          </nav>
          <section className="enterprise-panel" aria-label="Pipeline stage filter">
            <h2>Stages</h2>
            <form action={path} method="get" className="enterprise-form">
              {Object.entries(viewFilters)
                .filter(([name, value]) => name !== 'search' && value)
                .map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                ))}
              <label>
                Search lead names
                <input
                  name="search"
                  type="search"
                  maxLength={160}
                  defaultValue={viewFilters.search ?? ''}
                  required
                />
              </label>
              <button type="submit">Search pipeline</button>
              {viewFilters.search && (
                <Link href={address(path, { ...viewFilters, search: undefined })}>
                  Clear search
                </Link>
              )}
            </form>
            <nav aria-label="Pipeline stages" className="enterprise-media-toolbar">
              <Link
                href={address(path, { ...viewFilters, stage: undefined })}
                aria-current={!stageFilter ? 'page' : undefined}
              >
                All stages
              </Link>
              {SALES_PIPELINE_STAGES.map((stage) => {
                const count = view.counts.find((item) => item.stage.key === stage.key)?.count ?? 0;
                return (
                  <Link
                    key={stage.id}
                    href={address(path, { ...viewFilters, stage: stage.key as SalesStageKey })}
                    aria-current={stageFilter === stage.key ? 'page' : undefined}
                  >
                    {stage.label}
                    {!stageFilter || stageFilter === stage.key ? ' (' + count + ')' : ''}
                  </Link>
                );
              })}
            </nav>
            <p>
              Updated <time dateTime={view.readAt}>{new Date(view.readAt).toLocaleString()}</time>
            </p>
          </section>
          <SalesPipelineFilterPanel filters={viewFilters} />
          <SalesRevenueControl filters={viewFilters} />
          <section className="enterprise-panel" aria-label="Pipeline opportunities">
            <h2>Opportunities</h2>
            <nav className="enterprise-media-toolbar" aria-label="Sort opportunities">
              {sortControls.map(({ label, asc, desc }) => {
                const active = viewFilters.sort ?? 'created_desc';
                const direction =
                  active === asc ? 'ascending' : active === desc ? 'descending' : undefined;
                return (
                  <Link
                    key={label}
                    href={address(path, { ...viewFilters, sort: active === asc ? desc : asc })}
                    aria-current={direction ? 'true' : undefined}
                  >
                    {label}
                    {direction && ' · ' + direction}
                  </Link>
                );
              })}
            </nav>
            {!items.length && (
              <p>
                No opportunities match this view.{' '}
                <Link
                  href={
                    stageFilter
                      ? address(path, { ...viewFilters, stage: undefined })
                      : '/enterprise/sales/leads'
                  }
                >
                  {stageFilter ? 'Show all stages' : 'Open Sales leads'}
                </Link>
              </p>
            )}
            <ul className="enterprise-change-history">
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={'/enterprise/sales/opportunities/' + item.id}>{item.name}</Link>
                  <strong>
                    {item.stage.label} · Revision {item.revision}
                  </strong>
                  <span>
                    {[item.source.name, item.community?.name, item.lot?.name, item.owner?.name]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span>
                    {item.daysInStage} {item.daysInStage === 1 ? 'day' : 'days'} in stage
                  </span>
                  {item.approvedValue && (
                    <span>
                      Approved value{' '}
                      {formatMinorUnits(
                        BigInt(item.approvedValue.amountMinor),
                        item.approvedValue.currency,
                        session.me.user.locale,
                      )}
                    </span>
                  )}
                  {item.probabilityBasisPoints !== null && (
                    <span>
                      Probability{' '}
                      {(item.probabilityBasisPoints / 10_000).toLocaleString(
                        session.me.user.locale,
                        { style: 'percent', maximumFractionDigits: 2 },
                      )}
                    </span>
                  )}
                  {item.lastActivityAt && (
                    <span>
                      Last activity{' '}
                      <time dateTime={item.lastActivityAt}>
                        {new Date(item.lastActivityAt).toLocaleString()}
                      </time>
                    </span>
                  )}
                  {item.nextActivityAt && (
                    <span>
                      Next activity{' '}
                      <time dateTime={item.nextActivityAt}>
                        {new Date(item.nextActivityAt).toLocaleString()}
                      </time>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {query.hasNextPage && (
              <button
                type="button"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                Load more opportunities
              </button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
