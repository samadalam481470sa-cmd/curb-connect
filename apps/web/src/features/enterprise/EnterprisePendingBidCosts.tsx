'use client';

import { EnterprisePendingProjectBidPage } from '@fieldline/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatMinorUnits, Skeleton } from '@fieldline/ui';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const preferenceEvent = 'fieldpro:pending-bid-view-changed';

function subscribeToPreference(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(preferenceEvent, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(preferenceEvent, onChange);
  };
}

export function EnterprisePendingBidCosts({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const allowed = session.can('job:read') && session.can('enterprise_budget:read');
  if (!allowed) return null;
  const preference = 'fieldpro.finance.pending-bids.' + session.me.user.id + '.' + session.orgId;
  return (
    <PendingBidView key={preference} preference={preference} projectId={projectId} api={api} />
  );
}

function PendingBidView({
  preference,
  projectId,
  api,
}: {
  preference: string;
  projectId: string;
  api: ReturnType<typeof useApi>['api'];
}) {
  const { orgId, me } = useSession();
  const [prefError, setPrefError] = useState('');
  const readPreference = useCallback(() => {
    try {
      return window.localStorage.getItem(preference) === 'true' ? 'on' : 'off';
    } catch {
      return 'unavailable';
    }
  }, [preference]);
  const savedPreference = useSyncExternalStore<string>(
    subscribeToPreference,
    readPreference,
    () => 'loading',
  );
  const active = savedPreference === 'on';

  const query = useInfiniteQuery({
    queryKey: orgKey(orgId, 'enterprise', 'pending-bids', projectId),
    enabled: active,
    initialPageParam: null as string | null,
    refetchOnMount: 'always',
    queryFn: ({ pageParam }) =>
      api.get('/v1/enterprise/projects/' + projectId + '/budget/pending-bids', {
        schema: EnterprisePendingProjectBidPage,
        query: { cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });

  function save(next: boolean) {
    try {
      window.localStorage.setItem(preference, String(next));
      window.dispatchEvent(new Event(preferenceEvent));
      setPrefError('');
    } catch {
      setPrefError('Your view change could not be saved. Try again.');
    }
  }

  const denied = isApiError(query.error) && [401, 403, 404].includes(query.error.status);
  const rows =
    query.isSuccess && !query.isRefetching ? query.data.pages.flatMap(({ items }) => items) : [];
  return (
    <section className="enterprise-panel" aria-label="View pending bid commitments">
      <label className="enterprise-pending-bids-toggle">
        <input
          type="checkbox"
          checked={active}
          disabled={savedPreference === 'loading'}
          onChange={(event) => save(event.target.checked)}
        />
        Include pending commitments
      </label>
      {prefError && <p role="alert">{prefError}</p>}
      {!prefError && savedPreference === 'unavailable' && (
        <p role="alert">Your saved view could not be loaded.</p>
      )}
      {active && (
        <>
          <h3>Pending bids</h3>
          {(query.isPending || query.isRefetching) && (
            <Skeleton variant="card" label="Loading pending bids" />
          )}
          {query.isError && (
            <div role="alert">
              <p>{denied ? 'Pending bids are unavailable.' : errorHint(query.error)}</p>
              {!denied && (
                <button type="button" onClick={() => void query.refetch()}>
                  Retry pending bids
                </button>
              )}
            </div>
          )}
          {query.isSuccess && !query.isRefetching && rows.length === 0 && (
            <p>No current bids are awaiting an award.</p>
          )}
          {rows.length > 0 && (
            <ul className="enterprise-change-history">
              {rows.map((bid) => (
                <li key={bid.id}>
                  <strong>
                    {bid.packageTitle} · {bid.vendorName}
                  </strong>
                  <span>{formatMinorUnits(BigInt(bid.amountMinor), 'USD', me.user.locale)}</span>
                  <time dateTime={bid.validThrough}>Valid through {bid.validThrough}</time>
                </li>
              ))}
            </ul>
          )}
          {query.hasNextPage && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Load more pending bids
            </button>
          )}
        </>
      )}
    </section>
  );
}
