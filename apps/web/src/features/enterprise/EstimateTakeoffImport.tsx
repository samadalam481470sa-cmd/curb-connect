'use client';

import { EnterpriseApprovedTakeoffSources } from '@fieldline/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { EstimateTransferForm } from './TakeoffEstimateTransfer';

export function EstimateTakeoffImport({
  projectId,
  estimateRevisionId,
}: {
  projectId: string;
  estimateRevisionId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Import takeoff quantities</summary>
      {open && (
        <ApprovedTakeoffPicker projectId={projectId} estimateRevisionId={estimateRevisionId} />
      )}
    </details>
  );
}

function ApprovedTakeoffPicker({
  projectId,
  estimateRevisionId,
}: {
  projectId: string;
  estimateRevisionId: string;
}) {
  const { api } = useApi();
  const session = useSession();
  const [selected, setSelected] = useState('');
  const sources = useInfiniteQuery({
    queryKey: [...orgKey(session.orgId, 'enterprise'), 'approved-takeoff', projectId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get('/v1/enterprise/projects/' + projectId + '/takeoff/approved-measurements', {
        query: { cursor: pageParam },
        schema: EnterpriseApprovedTakeoffSources,
      }),
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
  });
  const items = sources.data?.pages.flatMap((page) => page.items) ?? [];
  const source = items.find(({ id }) => id === selected);
  return (
    <section className="enterprise-stack" aria-label="Import reviewed takeoff quantities">
      {sources.isPending && <p role="status">Loading approved measurements…</p>}
      {sources.isError && (
        <div>
          <p className="enterprise-error" role="alert">
            {errorHint(sources.error)}
          </p>
          <button type="button" onClick={() => void sources.refetch()}>
            Retry loading measurements
          </button>
        </div>
      )}
      {sources.isSuccess && !items.length && (
        <p>
          Approve a current measurement in <Link href="/enterprise/takeoff">Digital Takeoff</Link>{' '}
          to import it.
        </p>
      )}
      {items.length > 0 && (
        <label>
          Approved takeoff measurement
          <select value={source?.id ?? ''} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Choose a measurement</option>
            {items.map((entry) => {
              const unit =
                entry.measurementKind === 'count'
                  ? 'each'
                  : (entry.measurementKind === 'area' ? 'sq ' : '') + entry.unit;
              return (
                <option key={entry.id} value={entry.id}>
                  {entry.planTitle} · {entry.revisionLabel} · {entry.sheetLabel} · {entry.quantity}{' '}
                  {unit}
                </option>
              );
            })}
          </select>
        </label>
      )}
      {sources.hasNextPage && (
        <button
          type="button"
          disabled={sources.isFetchingNextPage}
          onClick={() => void sources.fetchNextPage()}
        >
          Load more approved measurements
        </button>
      )}
      {source && (
        <EstimateTransferForm
          key={source.id}
          projectId={projectId}
          source={source}
          fixedTargetId={estimateRevisionId}
        />
      )}
    </section>
  );
}
