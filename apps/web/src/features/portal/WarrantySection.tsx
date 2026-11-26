'use client';

// Warranty section on the customer's job-status page. The homeowner files warranty
// requests and exchanges messages with the builder through the same private link — no
// account needed. The link token is the credential; everything is scoped to this job.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { errorHint } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useApi } from '../../lib/session';

const PortalTicket = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  coverageNote: z.string().nullable(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  messages: z.array(
    z.object({
      id: z.string(),
      ticketId: z.string(),
      authorKind: z.string(),
      body: z.string(),
      createdAt: z.string(),
    }),
  ),
});
const PortalWarrantyList = z.object({ items: z.array(PortalTicket) });
const PortalMessage = z.object({
  id: z.string(),
  ticketId: z.string(),
  authorKind: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

function prettyStatus(status: string): string {
  return status.replaceAll('_', ' ');
}

export function WarrantySection({ token, companyName }: { token: string; companyName: string }) {
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const warranty = useQuery({
    queryKey: ['portal', 'warranty', token],
    queryFn: () => api.post('/v1/portal/warranty/tickets', { token }, { schema: PortalWarrantyList }),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/portal/warranty/tickets/create',
        { token, title: title.trim(), description: description.trim() },
        { schema: PortalTicket },
      ),
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['portal', 'warranty', token] });
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const postReply = useMutation({
    mutationFn: (ticketId: string) =>
      api.post(
        `/v1/portal/warranty/tickets/${ticketId}/messages`,
        { token, body: (reply[ticketId] ?? '').trim() },
        { schema: PortalMessage },
      ),
    onSuccess: (_data, ticketId) => {
      setReply((prev) => ({ ...prev, [ticketId]: '' }));
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['portal', 'warranty', token] });
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError('Add a short title and describe the problem.');
      return;
    }
    setError('');
    create.mutate();
  };

  return (
    <section className="js-public__updates" aria-labelledby="js-warranty-title">
      <h2 id="js-warranty-title">Warranty & service</h2>
      <p className="web-muted">
        Something need attention after the job? File a warranty request here and {companyName} will
        see it in their Field Pro workspace.
      </p>
      {error && <p className="web-error" role="alert">{error}</p>}
      <form onSubmit={submit} className="cc-work-board__form">
        <label>
          What&apos;s the issue?
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kitchen faucet leaks" />
        </label>
        <label>
          Details
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
        <button type="submit" className="cc-btn cc-btn--primary" disabled={create.isPending}>
          {create.isPending ? 'Sending…' : 'File warranty request'}
        </button>
      </form>
      {warranty.isPending && <p className="web-muted">Loading your warranty requests…</p>}
      {warranty.data && warranty.data.items.length === 0 && (
        <p className="web-muted">No warranty requests yet.</p>
      )}
      {warranty.data?.items.map((t) => (
        <article key={t.id} className="js-warranty-ticket">
          <h3>
            {t.title} <span className="js-badge">{prettyStatus(t.status)}</span>
          </h3>
          <p>{t.description}</p>
          <p className="web-muted web-small">
            Opened {formatDate(t.openedAt, 'en-US')}
            {t.closedAt ? ` · Closed ${formatDate(t.closedAt, 'en-US')}` : ''}
          </p>
          {t.coverageNote && <p>Coverage note: {t.coverageNote}</p>}
          {t.messages.map((m) => (
            <p key={m.id}>
              <strong>{m.authorKind === 'homeowner' ? 'You' : companyName}</strong>{' '}
              <span className="web-muted web-small">{formatDate(m.createdAt, 'en-US')}</span>
              <br />
              {m.body}
            </p>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!(reply[t.id] ?? '').trim()) return;
              postReply.mutate(t.id);
            }}
            className="cc-work-board__form"
          >
            <label>
              Reply
              <textarea
                value={reply[t.id] ?? ''}
                onChange={(e) => setReply((prev) => ({ ...prev, [t.id]: e.target.value }))}
                rows={2}
              />
            </label>
            <button type="submit" className="cc-btn" disabled={postReply.isPending}>
              Send reply
            </button>
          </form>
        </article>
      ))}
    </section>
  );
}
