'use client';

// PLT-016 A universal search. Queries run against the tenant-scoped search API only; results are
// never cached by the service worker and are keyed by org so a workspace switch drops them.
import { EmptyState, Skeleton } from '@fieldline/ui';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { SearchBox } from '../../components/shell/SearchBox';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const TYPE_LABELS: Record<string, string> = {
  customer: 'Customer',
  contact: 'Contact',
  lead: 'Lead',
  job: 'Job',
  property: 'Property',
  roof_order: 'Roof order',
  curb_project: 'Curb project',
  proposal: 'Proposal',
  invoice: 'Invoice',
};

export function SearchView() {
  return (
    <RouteGate routeId="search">
      <SearchContent />
    </RouteGate>
  );
}

function SearchContent() {
  const params = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const { endpoints } = useApi();
  const session = useSession();
  const org = session.me.memberships.find((m) => m.orgId === session.orgId);
  const results = useQuery({
    queryKey: orgKey(session.orgId, 'search', q),
    queryFn: ({ signal }) => endpoints.search(q, signal),
    enabled: q.length >= 2,
    retry: false,
  });

  return (
    <>
      <PageHeader
        title="Search"
        description={`Searches addresses, customers, report ids, invoices and jobs in ${org?.orgDisplayName ?? 'this company'} only.`}
      />
      <SearchBox />
      <div className="web-section" aria-live="polite">
        {q.length < 2 ? (
          <p className="web-muted">Type at least two characters.</p>
        ) : results.isPending ? (
          <Skeleton label="Searching" />
        ) : results.error ? (
          isApiError(results.error) && results.error.is('not_found') ? (
            <EmptyState
              title="Search is not available yet"
              description="Records become searchable as each area ships. Nothing is hidden from you here; there is simply nothing indexed yet."
            />
          ) : (
            <ErrorNotice
              error={results.error}
              title="Search failed"
              onRetry={() => void results.refetch()}
            />
          )
        ) : results.data.results.length === 0 ? (
          <EmptyState
            title={`No results for “${q}”`}
            description="Try an address, a customer name or a document number."
          />
        ) : (
          <ul className="web-list" aria-label={`Results for ${q}`}>
            {results.data.results.map((r) => (
              <li key={`${r.type}-${r.id}`}>
                <a href={r.href}>{r.title}</a>{' '}
                <span className="web-muted web-small">
                  {TYPE_LABELS[r.type] ?? r.type}
                  {r.subtitle ? ` · ${r.subtitle}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
