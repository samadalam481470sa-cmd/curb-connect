'use client';

// The customer's job-status page, opened from the link a contractor shared. No account: the token
// in the URL fragment (#t=...) is the credential and never reaches server logs. Refreshes itself
// every minute so the customer sees new updates without reloading.
import { BRAND } from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isApiError } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { useApi } from '../../lib/session';
import { JobProgress } from '../jobs/JobProgress';
import { WarrantySection } from './WarrantySection';
import { PublicJobStatusSchema, tokenFromHash } from '../jobs/customerStatus';
import { WAKING_MESSAGE, useSlowNotice } from '../jobs/useSlowNotice';

export function JobStatusView() {
  const { api } = useApi();
  // undefined = not read yet (first render), null = no usable token in the link.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setToken(tokenFromHash(window.location.hash));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const status = useQuery({
    queryKey: ['portal', 'job-status', token],
    queryFn: () => api.post('/v1/portal/job-status', { token }, { schema: PublicJobStatusSchema }),
    enabled: Boolean(token),
    retry: (count, error) => count < 2 && !(isApiError(error) && error.status < 500),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const loading = token === undefined || Boolean(token && status.isPending);
  const slow = useSlowNotice(loading);

  let body;
  if (loading) {
    body = (
      <div className="js-public__state" role="status">
        <span className="js-spinner" aria-hidden="true" />
        <p>Loading your job status…</p>
        {slow && <p className="web-muted web-small">{WAKING_MESSAGE}</p>}
      </div>
    );
  } else if (
    token === null ||
    (status.error && isApiError(status.error) && status.error.status === 404)
  ) {
    body = (
      <div className="js-public__state" role="alert">
        <h1>This link isn&apos;t working</h1>
        <p>
          It may have expired or been turned off. Ask your contractor to send you a new job-status
          link.
        </p>
      </div>
    );
  } else if (status.error) {
    body = (
      <div className="js-public__state" role="alert">
        <h1>We couldn&apos;t load your job right now</h1>
        <p>Check your connection and try again.</p>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          onClick={() => void status.refetch()}
        >
          Try again
        </button>
      </div>
    );
  } else if (status.data) {
    const { company, job, updates, recipientName, expiresAt } = status.data;
    body = (
      <>
        <header className="js-public__hero">
          <p className="js-eyebrow">{company.name}</p>
          <h1>{job.title}</h1>
          <p className="web-muted">
            {recipientName ? `Hi ${recipientName}, here` : 'Here'}&apos;s the latest on your job ·{' '}
            {job.number}
          </p>
          <div className={`js-public__now${job.completed ? ' js-public__now--done' : ''}`}>
            <span className="js-public__now-label">Current status</span>
            <strong>{job.stageLabel}</strong>
            <span className="web-muted web-small">
              since {formatDate(job.stageEnteredAt, 'en-US')}
            </span>
          </div>
        </header>
        <JobProgress stage={job.stage} />
        <section className="js-public__updates" aria-labelledby="js-updates-title">
          <h2 id="js-updates-title">Updates from {company.name}</h2>
          {updates.length === 0 ? (
            <p className="web-muted">
              No updates yet. Check back soon; this page refreshes on its own.
            </p>
          ) : (
            <ol className="js-timeline">
              {updates.map((u) => (
                <li key={u.id}>
                  <span className="js-badge">{u.stageLabel}</span>
                  <p>{u.message}</p>
                  <time className="web-muted web-small" dateTime={u.createdAt}>
                    {formatDateTime(u.createdAt, 'en-US')}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>
        {token && <WarrantySection token={token} companyName={company.name} />}
        <p className="web-muted web-small js-public__foot">
          This private link works until {formatDate(expiresAt, 'en-US')}. Please don&apos;t share it
          publicly. {status.isFetching ? 'Refreshing…' : 'Updates appear here automatically.'}
        </p>
      </>
    );
  }

  return (
    <main id="fl-main" className="js-public" tabIndex={-1}>
      <div className="js-public__card">{body}</div>
      <p className="js-public__brand web-small">
        Powered by <strong>{BRAND.name}</strong>
      </p>
    </main>
  );
}
