'use client';

// Contractor panel for one job: post customer-visible updates, share a status link with the
// customer (Copy / Text / Email), and see or turn off links already shared.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorNotice } from '../../components/common';
import { errorHint } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { orgKey, useApi, useSession } from '../../lib/session';
import { JobProgress } from './JobProgress';
import {
  CUSTOMER_STAGES,
  CreateLinkResponseSchema,
  CustomerStatusSchema,
  PostUpdateResponseSchema,
  RevokeLinkResponseSchema,
  mailtoHref,
  shareMessage,
  smsHref,
  type CustomerLink,
} from './customerStatus';

const EXPIRY_OPTIONS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
];

interface Shared {
  url: string;
  recipientName: string;
  recipientEmail: string;
  emailQueued: boolean;
}

export function JobCustomerStatus({
  jobId,
  jobTitle,
  onClose,
  onStageChanged,
}: {
  jobId: string;
  jobTitle: string;
  onClose: () => void;
  onStageChanged: () => void;
}) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'jobs', 'customer-status', jobId);
  const base = `/v1/jobs/${encodeURIComponent(jobId)}`;
  const status = useQuery({
    queryKey: key,
    queryFn: () => api.get(`${base}/customer-status`, { schema: CustomerStatusSchema }),
  });
  const companyName =
    session.me.memberships.find((m) => m.orgId === session.orgId)?.orgDisplayName ?? null;
  const canPost = session.check('job:move_stage');
  const canShare = session.check('job:write');

  const [message, setMessage] = useState('');
  const [stage, setStage] = useState<string>('');
  const [notify, setNotify] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(90);
  const [shared, setShared] = useState<Shared | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const refresh = () => void client.invalidateQueries({ queryKey: key });

  const post = useMutation({
    mutationFn: () =>
      api.post(
        `${base}/customer-updates`,
        {
          message: message.trim(),
          ...(stage && stage !== status.data?.job.stage && { stage }),
          notifyCustomer: notify,
        },
        { schema: PostUpdateResponseSchema },
      ),
    onSuccess: (res) => {
      setMessage('');
      setStage('');
      setError('');
      const emailed =
        res.emailsQueued > 0
          ? ` Email sent to ${res.emailsQueued} customer link${res.emailsQueued === 1 ? '' : 's'}.`
          : '';
      setFeedback(`Update posted. Anyone with the link sees it now.${emailed}`);
      refresh();
      onStageChanged();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const share = useMutation({
    mutationFn: () =>
      api.post(
        `${base}/customer-links`,
        {
          ...(name.trim() && { recipientName: name.trim() }),
          ...(email.trim() && { recipientEmail: email.trim() }),
          expiresInDays: days,
          sendEmail: true,
        },
        { schema: CreateLinkResponseSchema },
      ),
    onSuccess: (res) => {
      setShared({
        url: res.url,
        recipientName: name.trim(),
        recipientEmail: email.trim(),
        emailQueued: res.emailQueued,
      });
      setCopied(false);
      setName('');
      setEmail('');
      setError('');
      setFeedback('');
      refresh();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const revoke = useMutation({
    mutationFn: (linkId: string) =>
      api.post(
        `${base}/customer-links/${encodeURIComponent(linkId)}/revoke`,
        {},
        { schema: RevokeLinkResponseSchema },
      ),
    onSuccess: () => {
      setFeedback('Link turned off. It stops working right away.');
      setError('');
      refresh();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const submitUpdate = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) {
      setError('Write a short note for your customer.');
      return;
    }
    post.mutate();
  };
  const submitShare = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address, or leave it blank.');
      return;
    }
    share.mutate();
  };
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError('Copy did not work here. Press and hold the link to copy it.');
    }
  };

  const data = status.data;
  const activeLinks = data?.links.filter((l) => l.state === 'active') ?? [];
  const shareInput =
    shared && data
      ? {
          url: shared.url,
          jobTitle: data.job.title,
          companyName,
          recipientName: shared.recipientName,
        }
      : null;

  return (
    <section className="web-card js-panel" aria-labelledby={`js-title-${jobId}`}>
      <header className="js-panel__head">
        <div>
          <p className="js-eyebrow">Customer updates</p>
          <h2 id={`js-title-${jobId}`}>{jobTitle}</h2>
          {data && (
            <p className="web-muted web-small">
              {data.job.number} · {data.job.stageLabel}
            </p>
          )}
        </div>
        <button type="button" className="cc-btn cc-btn--sm" onClick={onClose}>
          Close
        </button>
      </header>

      {status.isPending && <p role="status">Loading customer updates…</p>}
      {status.error && (
        <ErrorNotice
          error={status.error}
          title="Could not load customer updates"
          onRetry={() => void status.refetch()}
        />
      )}

      {data && (
        <>
          <JobProgress stage={data.job.stage} />

          <div className="js-panel__grid">
            <form className="js-box" onSubmit={submitUpdate} aria-labelledby={`js-post-${jobId}`}>
              <h3 id={`js-post-${jobId}`}>Post an update</h3>
              <label>
                Stage
                <select
                  value={stage || data.job.stage}
                  onChange={(e) => setStage(e.target.value)}
                  disabled={!canPost.allowed}
                >
                  {CUSTOMER_STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Message to your customer
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Materials arrive Thursday. Crew starts Friday at 8am."
                  disabled={!canPost.allowed}
                />
              </label>
              <label className="js-check">
                <input
                  type="checkbox"
                  checked={notify && data.emailEnabled}
                  disabled={!data.emailEnabled || !canPost.allowed}
                  onChange={(e) => setNotify(e.target.checked)}
                />
                Email customers who have a link
              </label>
              {!data.emailEnabled && (
                <p className="web-muted web-small">
                  Email sending isn&apos;t set up on this server yet. Customers still see the update
                  as soon as they open their link, and you can text it to them below.
                </p>
              )}
              <button
                className="cc-btn cc-btn--primary"
                type="submit"
                disabled={!canPost.allowed || post.isPending}
              >
                {post.isPending ? 'Posting…' : 'Post update'}
              </button>
              {!canPost.allowed && <p className="web-muted web-small">{canPost.reason}</p>}
            </form>

            <form className="js-box" onSubmit={submitShare} aria-labelledby={`js-share-${jobId}`}>
              <h3 id={`js-share-${jobId}`}>Share with your customer</h3>
              <label>
                Customer name (optional)
                <input
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dana Smith"
                  disabled={!canShare.allowed}
                />
              </label>
              <label>
                Customer email (optional)
                <input
                  type="email"
                  value={email}
                  maxLength={254}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dana@example.com"
                  disabled={!canShare.allowed}
                />
              </label>
              <label>
                Link works for
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  disabled={!canShare.allowed}
                >
                  {EXPIRY_OPTIONS.map((o) => (
                    <option key={o.days} value={o.days}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="cc-btn cc-btn--primary"
                type="submit"
                disabled={!canShare.allowed || share.isPending}
              >
                {share.isPending ? 'Creating link…' : 'Create customer link'}
              </button>
              {!canShare.allowed && <p className="web-muted web-small">{canShare.reason}</p>}
            </form>
          </div>

          {shared && shareInput && (
            <div className="js-shared" role="status">
              <p className="js-shared__title">
                Link ready{shared.recipientName ? ` for ${shared.recipientName}` : ''}.
                {shared.emailQueued && ` We emailed it to ${shared.recipientEmail}.`}
              </p>
              <div className="js-shared__row">
                <input
                  className="js-shared__url"
                  readOnly
                  value={shared.url}
                  aria-label="Customer link"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  className="cc-btn cc-btn--primary"
                  onClick={() => void copy(shared.url)}
                >
                  {copied ? 'Copied ✓' : 'Copy link'}
                </button>
              </div>
              <div className="js-shared__actions">
                <a className="cc-btn" href={smsHref(shareMessage(shareInput))}>
                  Text it
                </a>
                <a
                  className="cc-btn"
                  href={mailtoHref({ ...shareInput, email: shared.recipientEmail })}
                >
                  Email it
                </a>
                <a className="cc-btn" href={shared.url} target="_blank" rel="noopener noreferrer">
                  Preview as customer ↗
                </a>
              </div>
              <p className="web-muted web-small">
                Save or send this link now. For security it&apos;s shown only once; you can always
                create a new one.
              </p>
            </div>
          )}

          <div className="js-panel__grid">
            <div className="js-box">
              <h3>Shared links ({activeLinks.length} active)</h3>
              {data.links.length === 0 && (
                <p className="web-muted">No links yet. Create one above to share this job.</p>
              )}
              <ul className="js-links">
                {data.links.map((link) => (
                  <LinkRow
                    key={link.id}
                    link={link}
                    canRevoke={canShare.allowed && !revoke.isPending}
                    onRevoke={() => revoke.mutate(link.id)}
                  />
                ))}
              </ul>
            </div>
            <div className="js-box">
              <h3>What your customer sees</h3>
              {data.updates.length === 0 && <p className="web-muted">No updates posted yet.</p>}
              <ol className="js-timeline">
                {data.updates.map((u) => (
                  <li key={u.id}>
                    <span className="js-badge">{u.stageLabel}</span>
                    <p>{u.message}</p>
                    <time className="web-muted web-small" dateTime={u.createdAt}>
                      {formatDateTime(u.createdAt, 'en-US')}
                    </time>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </>
      )}
      {feedback && (
        <p role="status" className="js-feedback">
          {feedback}
        </p>
      )}
      {error && (
        <p role="alert" className="web-error">
          {error}
        </p>
      )}
    </section>
  );
}

function LinkRow({
  link,
  canRevoke,
  onRevoke,
}: {
  link: CustomerLink;
  canRevoke: boolean;
  onRevoke: () => void;
}) {
  const who = link.recipientName || link.recipientEmail || 'Customer link';
  return (
    <li className="js-link">
      <div>
        <strong>{who}</strong>
        {link.recipientName && link.recipientEmail && (
          <span className="web-muted web-small"> · {link.recipientEmail}</span>
        )}
        <p className="web-muted web-small">
          {link.viewCount === 0
            ? 'Not opened yet'
            : `Opened ${link.viewCount}×, last ${formatDateTime(link.lastViewedAt!, 'en-US')}`}
          {' · '}
          {link.state === 'active'
            ? `works until ${formatDateTime(link.expiresAt, 'en-US')}`
            : link.state === 'revoked'
              ? 'turned off'
              : 'expired'}
        </p>
      </div>
      {link.state === 'active' ? (
        <button
          type="button"
          className="cc-btn cc-btn--sm"
          disabled={!canRevoke}
          onClick={onRevoke}
        >
          Turn off
        </button>
      ) : (
        <span className={`js-badge js-badge--${link.state}`}>
          {link.state === 'revoked' ? 'Off' : 'Expired'}
        </span>
      )}
    </li>
  );
}
