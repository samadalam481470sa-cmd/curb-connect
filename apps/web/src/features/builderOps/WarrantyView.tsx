'use client';

// Warranty & homeowner service (builder operations): warranty tickets against jobs, service
// work orders, and the staff/homeowner message thread. Homeowners file and reply through
// the job-status link they already have (see the public track page) — no account needed.
// Nothing here decides coverage: staff record the decision on the ticket.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { submitOrQueue } from '../../lib/offline/fieldWrites';
import { orgKey, useApi, useSession } from '../../lib/session';
import { dateOnly, money, parseDollarsToMinor, prettyStatus } from './shared';

const Ticket = z.object({
  id: z.string(),
  jobId: z.string(),
  customerId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  reportedBy: z.string(),
  coverageNote: z.string().nullable(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const WorkOrder = z.object({
  id: z.string(),
  ticketId: z.string(),
  title: z.string(),
  scope: z.string(),
  status: z.string(),
  assigneeMembershipId: z.string().nullable(),
  scheduledOn: z.string().nullable(),
  completedAt: z.string().nullable(),
  costMinor: z.number().nullable(),
  currency: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const Message = z.object({
  id: z.string(),
  ticketId: z.string(),
  authorKind: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
const TicketList = z.object({ items: z.array(Ticket) });
const TicketDetail = z.object({
  ticket: Ticket,
  workOrders: z.array(WorkOrder),
  messages: z.array(Message),
});
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const JobsList = z.object({ items: z.array(Job) });

const STATUSES = ['new', 'under_review', 'approved', 'denied', 'in_progress', 'completed', 'closed'];
const WO_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];

export function WarrantyView() {
  return (
    <RouteGate routeId="warranty">
      <WarrantyContent />
    </RouteGate>
  );
}

function WarrantyContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.check('warranty:write');
  const [statusFilter, setStatusFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const listKey = orgKey(session.orgId, 'warranty', 'tickets', statusFilter);
  const list = useQuery({
    queryKey: listKey,
    queryFn: () =>
      api.get(`/v1/warranty/tickets${statusFilter ? `?status=${statusFilter}` : ''}`, {
        schema: TicketList,
      }),
  });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'warranty', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });
  const detail = useQuery({
    queryKey: orgKey(session.orgId, 'warranty', 'ticket', openId),
    queryFn: () => api.get(`/v1/warranty/tickets/${openId}`, { schema: TicketDetail }),
    enabled: Boolean(openId),
  });

  const [jobId, setJobId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post('/v1/warranty/tickets', { jobId, title: title.trim(), description: description.trim() }, { schema: Ticket }),
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setError('');
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'warranty') });
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateTicket = useMutation({
    mutationFn: (input: { id: string; status?: string; coverageNote?: string | null }) =>
      api.patch(`/v1/warranty/tickets/${input.id}`, { status: input.status, coverageNote: input.coverageNote }, { schema: Ticket }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'warranty') }),
    onError: (cause) => setError(errorHint(cause)),
  });

  const [woTitle, setWoTitle] = useState('');
  const [woScope, setWoScope] = useState('');
  const [woDate, setWoDate] = useState('');
  const [woCost, setWoCost] = useState('');
  const createWo = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/warranty/tickets/${openId}/work-orders`,
        {
          title: woTitle.trim(),
          scope: woScope.trim(),
          scheduledOn: woDate || null,
          costMinor: parseDollarsToMinor(woCost),
        },
        { schema: WorkOrder },
      ),
    onSuccess: () => {
      setWoTitle('');
      setWoScope('');
      setWoDate('');
      setWoCost('');
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'warranty') });
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateWo = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      api.patch(`/v1/warranty/work-orders/${input.id}`, { status: input.status }, { schema: WorkOrder }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'warranty') }),
    onError: (cause) => setError(errorHint(cause)),
  });

  const [messageBody, setMessageBody] = useState('');
  const [queuedNote, setQueuedNote] = useState('');
  const postMessage = useMutation({
    mutationFn: () => {
      const path = `/v1/warranty/tickets/${openId}/messages`;
      const body = { body: messageBody.trim() };
      return submitOrQueue({
        scope: { userId: session.me.user.id, orgId: session.orgId },
        kind: 'warranty_reply',
        label: 'Warranty reply',
        method: 'POST',
        path,
        body,
        send: (idempotencyKey) => api.post(path, body, { schema: Message, idempotencyKey }),
      });
    },
    onSuccess: (result) => {
      setMessageBody('');
      setQueuedNote(
        result.queued
          ? 'Offline: your reply is saved on this device and will be sent when you reconnect.'
          : '',
      );
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'warranty') });
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!jobId || !title.trim() || !description.trim()) {
      setError('Pick a job and enter a title and description.');
      return;
    }
    setError('');
    create.mutate();
  };

  const jobLabel = (id: string) => {
    const j = jobs.data?.items.find((x) => x.id === id);
    return j ? `${j.number} — ${j.title}` : id.slice(0, 8);
  };

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Warranty & Service"
        description="Warranty tickets against completed jobs, the service work orders that fix them, and the message thread with the homeowner. Homeowners can also file and reply from their job-status link."
      />
      {error && <p className="web-error" role="alert">{error}</p>}
      {queuedNote && <p className="web-muted" role="status">{queuedNote}</p>}

      {canWrite && (
        <section className="web-card" aria-labelledby="warranty-create-title">
          <h2 id="warranty-create-title">Open a warranty ticket</h2>
          <form className="cc-work-board__form" onSubmit={submit}>
            <label>
              Job
              <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">Choose a job…</option>
                {(jobs.data?.items ?? []).map((j) => (
                  <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kitchen faucet leak" />
            </label>
            <label>
              Description
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={create.isPending}>
              {create.isPending ? 'Opening…' : 'Open ticket'}
            </button>
          </form>
        </section>
      )}

      <section className="web-card" aria-labelledby="warranty-list-title">
        <h2 id="warranty-list-title">Tickets</h2>
        <label>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{prettyStatus(s)}</option>
            ))}
          </select>
        </label>
        {list.isError && <ErrorNotice error={list.error} title="Could not load tickets" />}
        {list.isPending && <p className="web-muted">Loading…</p>}
        {list.data && list.data.items.length === 0 && <p className="web-muted">No warranty tickets yet.</p>}
        {list.data && list.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead>
                <tr><th>Title</th><th>Job</th><th>Status</th><th>Reported by</th><th>Opened</th><th></th></tr>
              </thead>
              <tbody>
                {list.data.items.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{jobLabel(t.jobId)}</td>
                    <td>{prettyStatus(t.status)}</td>
                    <td>{t.reportedBy}</td>
                    <td>{dateOnly(t.openedAt)}</td>
                    <td>
                      <button type="button" className="cc-btn" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                        {openId === t.id ? 'Close' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openId && detail.data && (
        <section className="web-card" aria-labelledby="warranty-detail-title">
          <h2 id="warranty-detail-title">{detail.data.ticket.title}</h2>
          <p>{detail.data.ticket.description}</p>
          <p className="web-muted">
            Status: {prettyStatus(detail.data.ticket.status)} · Reported by {detail.data.ticket.reportedBy} · Opened{' '}
            {dateOnly(detail.data.ticket.openedAt)}
            {detail.data.ticket.closedAt ? ` · Closed ${dateOnly(detail.data.ticket.closedAt)}` : ''}
          </p>
          {detail.data.ticket.coverageNote && <p>Coverage note: {detail.data.ticket.coverageNote}</p>}

          {canWrite && (
            <div className="cc-work-board__form">
              <label>
                Status
                <select
                  value={detail.data.ticket.status}
                  onChange={(e) => updateTicket.mutate({ id: detail.data.ticket.id, status: e.target.value })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{prettyStatus(s)}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <h3>Service work orders</h3>
          {detail.data.workOrders.length === 0 && <p className="web-muted">No work orders yet.</p>}
          {detail.data.workOrders.map((wo) => (
            <div key={wo.id} className="cc-detail-row">
              <div>
                <strong>{wo.title}</strong> — {prettyStatus(wo.status)}
                <p>{wo.scope}</p>
                <p className="web-muted">
                  {wo.scheduledOn ? `Scheduled ${wo.scheduledOn} · ` : ''}Cost: {money(wo.costMinor, wo.currency)}
                  {wo.completedAt ? ` · Completed ${dateOnly(wo.completedAt)}` : ''}
                </p>
              </div>
              {canWrite && (
                <select
                  aria-label={`Status for ${wo.title}`}
                  value={wo.status}
                  onChange={(e) => updateWo.mutate({ id: wo.id, status: e.target.value })}
                >
                  {WO_STATUSES.map((s) => (
                    <option key={s} value={s}>{prettyStatus(s)}</option>
                  ))}
                </select>
              )}
            </div>
          ))}

          {canWrite && (
            <form
              className="cc-work-board__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!woTitle.trim() || !woScope.trim()) {
                  setError('Enter a work order title and scope.');
                  return;
                }
                setError('');
                createWo.mutate();
              }}
            >
              <label>
                Work order title
                <input value={woTitle} onChange={(e) => setWoTitle(e.target.value)} />
              </label>
              <label>
                Scope
                <textarea value={woScope} onChange={(e) => setWoScope(e.target.value)} rows={2} />
              </label>
              <label>
                Scheduled date
                <input type="date" value={woDate} onChange={(e) => setWoDate(e.target.value)} />
              </label>
              <label>
                Cost ($, optional)
                <input inputMode="decimal" value={woCost} onChange={(e) => setWoCost(e.target.value)} />
              </label>
              <button type="submit" className="cc-btn cc-btn--primary" disabled={createWo.isPending}>
                Add work order
              </button>
            </form>
          )}

          <h3>Messages</h3>
          {detail.data.messages.length === 0 && <p className="web-muted">No messages yet.</p>}
          {detail.data.messages.map((m) => (
            <p key={m.id}>
              <strong>{m.authorKind === 'homeowner' ? 'Homeowner' : 'Staff'}</strong>{' '}
              <span className="web-muted">{dateOnly(m.createdAt)}</span>
              <br />
              {m.body}
            </p>
          ))}
          {canWrite && (
            <form
              className="cc-work-board__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!messageBody.trim()) return;
                postMessage.mutate();
              }}
            >
              <label>
                Reply to homeowner
                <textarea value={messageBody} onChange={(e) => setMessageBody(e.target.value)} rows={2} />
              </label>
              <button type="submit" className="cc-btn cc-btn--primary" disabled={postMessage.isPending}>
                Send message
              </button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
