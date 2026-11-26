'use client';

import { JobsiteMediaReviewQueue } from '@fieldline/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useState } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const outcomeLabels = {
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
};

export function EnterpriseMediaReviewQueue() {
  const { api } = useApi();
  const { me, orgId } = useSession();
  const companyName = me.memberships.find(
    (membership) => membership.orgId === orgId,
  )?.orgDisplayName;
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const queue = useInfiniteQuery({
    queryKey: orgKey(orgId, 'enterprise', 'media-review-queue', status),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get('/v1/enterprise/media/review', {
        schema: JobsiteMediaReviewQueue,
        query: { status, cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const denied = isApiError(queue.error) && [401, 403, 404].includes(queue.error.status);
  const items = denied ? [] : (queue.data?.pages.flatMap((page) => page.items) ?? []);

  return (
    <main className="enterprise-suite">
      <div className="enterprise-hero">
        <nav aria-label="Media review breadcrumb">
          <Link className="enterprise-back" href="/enterprise/field">
            ← Field Execution
          </Link>
        </nav>
        <h1>Media review</h1>
        {queue.data && !denied && companyName && <p>{companyName}</p>}
      </div>
      <section className="enterprise-panel" aria-label="Evidence review queue">
        {!denied && (
          <label>
            Review status
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.currentTarget.value === 'all' ? 'all' : 'pending')
              }
            >
              <option value="pending">Awaiting review</option>
              <option value="all">All current reviews</option>
            </select>
          </label>
        )}
        {queue.isPending && <Skeleton variant="card" label="Loading media reviews" />}
        {queue.isError && (
          <div role="alert">
            <p>
              {denied ? 'Media reviews are unavailable for your account.' : errorHint(queue.error)}
            </p>
            {!denied && isApiError(queue.error) && (
              <p>Support reference {queue.error.correlationId}</p>
            )}
            {!denied && (
              <button
                type="button"
                onClick={() =>
                  void (queue.isFetchNextPageError ? queue.fetchNextPage() : queue.refetch())
                }
              >
                Retry media reviews
              </button>
            )}
          </div>
        )}
        {queue.isSuccess && items.length === 0 && (
          <>
            <p>
              {status === 'pending'
                ? 'Nothing is awaiting your review.'
                : 'There are no current reviews in your projects.'}
            </p>
            <Link href="/enterprise/field">Open Field Execution</Link>
          </>
        )}
        {items.length > 0 && (
          <ul className="enterprise-change-history" aria-label="Current evidence reviews">
            {items.map((item) => (
              <li key={item.reviewId}>
                <Link
                  href={
                    '/enterprise/projects/' +
                    item.projectId +
                    '/media?evidenceTask=' +
                    item.taskId +
                    '#jobsite-evidence'
                  }
                >
                  {item.title}
                </Link>
                <span>{item.projectName}</span>
                <span>
                  {outcomeLabels[item.status]} · Evidence revision {item.submissionRevision}
                </span>
                <time dateTime={item.submittedAt}>
                  {new Date(item.submittedAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
        {!denied && queue.hasNextPage && !queue.isFetchNextPageError && (
          <button
            type="button"
            disabled={queue.isFetchingNextPage}
            onClick={() => void queue.fetchNextPage()}
          >
            {queue.isFetchingNextPage ? 'Loading reviews…' : 'Load more reviews'}
          </button>
        )}
      </section>
    </main>
  );
}
