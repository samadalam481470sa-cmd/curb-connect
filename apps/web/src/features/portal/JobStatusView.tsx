'use client';

// The customer's job-status page, opened from the link a contractor shared. No account: the token
// in the URL fragment (#t=...) is the credential and never reaches server logs. Refreshes itself
// every minute so the customer sees new updates without reloading.
import { BRAND } from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { useApi } from '../../lib/session';
import { money, prettyStatus } from '../builderOps/shared';
import { JobProgress } from '../jobs/JobProgress';
import { WarrantySection } from './WarrantySection';
import {
  PortalSelectionsResponseSchema,
  PublicJobStatusSchema,
  tokenFromHash,
  type PublicDesign,
} from '../jobs/customerStatus';
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
    const { company, job, updates, milestones, design, recipientName, expiresAt } = status.data;
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
        {milestones.length > 0 ? (
          <section className="js-public__updates" aria-labelledby="js-milestones-title">
            <h2 id="js-milestones-title">Schedule milestones</h2>
            <ol className="js-timeline">
              {milestones.map((m) => (
                <li key={m.id}>
                  <span className="js-badge">{prettyStatus(m.status)}</span>
                  <p>
                    <strong>{m.title}</strong> — {formatDate(m.startsOn, 'en-US')} to{' '}
                    {formatDate(m.endsOn, 'en-US')} · {m.progressPercent}% complete
                  </p>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={m.progressPercent}
                    aria-label={`${m.title} progress`}
                    style={{ height: 8, background: 'var(--fl-border, #ddd)', borderRadius: 4 }}
                  >
                    <div
                      style={{
                        height: 8,
                        width: `${m.progressPercent}%`,
                        background: 'var(--fl-accent, #2563eb)',
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {token && design.contract ? (
          <DesignSection token={token} design={design} companyName={company.name} />
        ) : null}
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

/**
 * Buyer self-serve design selections. Prices are the builder's catalog prices; picking an
 * option records it at today's price. Unpriced options show no price — the builder quotes those.
 */
function DesignSection({
  token,
  design,
  companyName,
}: {
  token: string;
  design: PublicDesign;
  companyName: string;
}) {
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const pickedIds = new Set(design.selections.map((s) => s.optionId));

  const toggle = useMutation({
    mutationFn: (input: { optionId: string; action: 'add' | 'remove' }) =>
      api.post('/v1/portal/selections', { token, ...input }, { schema: PortalSelectionsResponseSchema }),
    onSuccess: () => {
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['portal', 'job-status', token] });
    },
    onError: (e) => setError(errorHint(e)),
  });

  return (
    <section className="js-public__updates" aria-labelledby="js-design-title">
      <h2 id="js-design-title">Your design selections</h2>
      {design.contract?.planName ? (
        <p className="web-muted">
          Plan: {design.contract.planName}
          {design.contract.basePriceMinor !== null
            ? ` · base ${money(design.contract.basePriceMinor)}`
            : ''}
        </p>
      ) : null}
      {error ? (
        <p className="web-error" role="alert">
          {error}
        </p>
      ) : null}
      {design.selections.length === 0 ? (
        <p className="web-muted">You haven&apos;t picked any options yet.</p>
      ) : (
        <ul className="js-timeline">
          {design.selections.map((s) => (
            <li key={s.optionId}>
              <span className="js-badge">{prettyStatus(s.category)}</span>
              <p>
                <strong>{s.name}</strong>
                {s.priceMinor !== null ? ` — ${money(s.priceMinor)}` : ' — price on request'}
              </p>
              <button
                type="button"
                className="cc-btn"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ optionId: s.optionId, action: 'remove' })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p>
        <strong>Selections total: {money(design.selectionsTotalMinor)}</strong>
      </p>
      {design.availableOptions.length > 0 ? (
        <>
          <h3>Options from {companyName}</h3>
          <ul className="js-timeline">
            {design.availableOptions
              .filter((o) => !pickedIds.has(o.id))
              .map((o) => (
                <li key={o.id}>
                  <span className="js-badge">{prettyStatus(o.category)}</span>
                  <p>
                    <strong>{o.name}</strong>
                    {o.priceMinor !== null ? ` — ${money(o.priceMinor)}` : ' — price on request'}
                  </p>
                  {o.description ? <p className="web-muted">{o.description}</p> : null}
                  <button
                    type="button"
                    className="cc-btn cc-btn--primary"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ optionId: o.id, action: 'add' })}
                  >
                    Add this option
                  </button>
                </li>
              ))}
          </ul>
        </>
      ) : null}
      <p className="web-muted web-small">
        Selections here are requests to {companyName} — your final contract price is confirmed
        with them.
      </p>
    </section>
  );
}
