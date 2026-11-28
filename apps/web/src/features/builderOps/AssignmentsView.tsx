'use client';

// Assignments (builder operations): assign jobs, POs, tasks, or bids to a contracting
// company in the Network. The contractor sees it in Field Pro immediately (in-app
// notification) and accepts or declines here. The email notice goes out when email is
// connected — until then this screen says so honestly and never claims an email was sent.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { dateOnly, emailStateLabel, prettyStatus } from './shared';

const AssignmentPayload = z.object({
  plan: z
    .object({
      studioHouseId: z.string().nullable(),
      name: z.string().nullable(),
      bedrooms: z.number().nullable(),
      bathrooms: z.number().nullable(),
      stories: z.number().nullable(),
      garage: z.string().nullable(),
      lengthFt: z.number().nullable(),
      widthFt: z.number().nullable(),
      roofPitch: z.number().nullable(),
    })
    .nullable()
    .optional(),
  budgetTotalMinor: z.number().nullable().optional(),
  budgetSource: z.enum(['job_cost_budget', 'studio_estimate', 'bid_amount', 'none']).optional(),
  scheduleWindow: z
    .object({ startsOn: z.string().nullable(), endsOn: z.string().nullable() })
    .nullable()
    .optional(),
  communityName: z.string().nullable().optional(),
  phaseName: z.string().nullable().optional(),
  lotNumber: z.string().nullable().optional(),
  addressLine: z.string().nullable().optional(),
  lotCount: z.number().nullable().optional(),
  houseCount: z.number().nullable().optional(),
  bidAmountMinor: z.number().nullable().optional(),
  snapshotAt: z.string().optional(),
});
const Assignment = z.object({
  id: z.string(),
  assignmentKey: z.string(),
  side: z.enum(['assigner', 'assignee']),
  partnerOrgId: z.string(),
  partnerDisplayName: z.string(),
  kind: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  status: z.string(),
  dueOn: z.string().nullable(),
  emailState: z.string(),
  emailSentAt: z.string().nullable(),
  emailNote: z.string().nullable(),
  respondedAt: z.string().nullable(),
  /** Snapshot of plan/budget/schedule taken at assignment time (build assignments). */
  payload: AssignmentPayload.optional(),
  /** The mirrored job created in the assignee company when a build assignment is accepted. */
  mirroredJobId: z.string().nullable().optional(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const AssignmentList = z.object({ items: z.array(Assignment) });
const EmailStatus = z.object({ emailConnected: z.boolean(), message: z.string() });
const Connection = z.object({
  partnerOrgId: z.string(),
  partnerDisplayName: z.string(),
  status: z.string(),
});
const ConnectionList = z.object({ items: z.array(Connection) }).passthrough();
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const JobsList = z.object({ items: z.array(Job) });

/** Kinds this form can create. Whole-build kinds (house_build, development_phase) are
 * created from Land Management's "Assign build" actions, not here. */
const KINDS: Record<string, string> = {
  job: 'Job',
  purchase_order: 'Purchase order',
  task: 'Task',
  bid_invitation: 'Bid invitation',
};
/** Display labels for every assignment kind, including the build kinds. */
const KIND_LABELS: Record<string, string> = {
  ...KINDS,
  house_build: 'House build',
  development_phase: 'Development phase',
};

const moneyText = (minor: number | null | undefined) =>
  minor === null || minor === undefined
    ? null
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);

/** One-line summary of an assignment's snapshot payload, labeled as a snapshot. */
function payloadSummary(a: z.infer<typeof Assignment>): string | null {
  const p = a.payload;
  if (!p) return null;
  const parts: string[] = [];
  if (p.communityName) parts.push(p.communityName);
  if (p.phaseName) parts.push(p.phaseName);
  if (p.lotNumber) parts.push(`Lot ${p.lotNumber}`);
  if (p.lotCount !== null && p.lotCount !== undefined) parts.push(`${p.lotCount} lots`);
  if (p.houseCount !== null && p.houseCount !== undefined) parts.push(`${p.houseCount} houses`);
  if (p.plan?.name) parts.push(`Plan: ${p.plan.name}`);
  const budget = moneyText(p.budgetTotalMinor);
  if (budget) {
    parts.push(
      `Budget ${budget}${p.budgetSource === 'studio_estimate' ? ' (studio estimate)' : p.budgetSource === 'bid_amount' ? ' (winning bid)' : ''}`,
    );
  }
  if (p.scheduleWindow?.startsOn && p.scheduleWindow?.endsOn) {
    parts.push(`Schedule ${p.scheduleWindow.startsOn} to ${p.scheduleWindow.endsOn}`);
  }
  if (parts.length === 0) return null;
  return `Snapshot at assignment time: ${parts.join(' · ')}`;
}

export function AssignmentsView() {
  return (
    <RouteGate routeId="assignments">
      <AssignmentsContent />
    </RouteGate>
  );
}

function AssignmentsContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.check('assignment:write');
  const [side, setSide] = useState<'all' | 'assigner' | 'assignee'>('all');
  const [error, setError] = useState('');

  const emailStatus = useQuery({
    queryKey: orgKey(session.orgId, 'assignments', 'email-status'),
    queryFn: () => api.get('/v1/assignments/email-status', { schema: EmailStatus }),
  });
  const list = useQuery({
    queryKey: orgKey(session.orgId, 'assignments', 'list', side),
    queryFn: () =>
      api.get(`/v1/assignments${side === 'all' ? '' : `?side=${side}`}`, { schema: AssignmentList }),
  });
  const connections = useQuery({
    queryKey: orgKey(session.orgId, 'assignments', 'connections'),
    queryFn: () => api.get('/v1/network/connections', { schema: ConnectionList }),
  });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'assignments', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'assignments') });

  const [partnerOrgId, setPartnerOrgId] = useState('');
  const [kind, setKind] = useState('job');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [jobId, setJobId] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/assignments',
        {
          partnerOrgId,
          kind,
          title: title.trim(),
          description: description.trim() || null,
          dueOn: dueOn || null,
          subjectType: kind === 'job' && jobId ? 'job' : null,
          subjectId: kind === 'job' && jobId ? jobId : null,
        },
        { schema: Assignment },
      ),
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setDueOn('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: string }) =>
      api.post(`/v1/assignments/${input.id}/decide`, { decision: input.decision }, { schema: Assignment }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const resendEmail = useMutation({
    mutationFn: (id: string) => api.post(`/v1/assignments/${id}/resend-email`, {}, { schema: Assignment }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!partnerOrgId || !title.trim()) {
      setError('Pick a connected company and enter a title.');
      return;
    }
    setError('');
    create.mutate();
  };

  const activeConnections = (connections.data?.items ?? []).filter((c) => c.status === 'active');

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Assignments"
        description="Assign jobs, purchase orders, tasks, and bids to contracting companies in your Network. They see it in Field Pro right away and accept or decline here. Whole house and development-phase builds are assigned from Land Management (Assign build) and show up here too."
      />
      {emailStatus.data && !emailStatus.data.emailConnected && (
        <p className="web-card" role="status">
          Email is not connected yet, so assignment emails can't go out. Assignments still appear
          in the contractor's Field Pro account (in-app notification). {emailStatus.data.message}
        </p>
      )}
      {error && <p className="web-error" role="alert">{error}</p>}

      {canWrite && (
        <section className="web-card" aria-labelledby="assignment-create-title">
          <h2 id="assignment-create-title">Assign work</h2>
          <form className="cc-work-board__form" onSubmit={submit}>
            <label>
              Company
              <select value={partnerOrgId} onChange={(e) => setPartnerOrgId(e.target.value)}>
                <option value="">Choose a connected company…</option>
                {activeConnections.map((c) => (
                  <option key={c.partnerOrgId} value={c.partnerOrgId}>{c.partnerDisplayName}</option>
                ))}
              </select>
            </label>
            {activeConnections.length === 0 && (
              <p className="web-muted">No connected companies yet — connect in the Network first.</p>
            )}
            <label>
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KINDS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </label>
            {kind === 'job' && (
              <label>
                Job (optional)
                <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
                  <option value="">No job linked</option>
                  {(jobs.data?.items ?? []).map((j) => (
                    <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
                  ))}
                </select>
              </label>
            )}
            <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></label>
            <label>Due date<input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={create.isPending}>Assign</button>
          </form>
        </section>
      )}

      <section className="web-card" aria-labelledby="assignment-list-title">
        <h2 id="assignment-list-title">Assignments</h2>
        <div role="group" aria-label="Direction">
          <button type="button" className="cc-btn" aria-pressed={side === 'all'} onClick={() => setSide('all')}>All</button>
          <button type="button" className="cc-btn" aria-pressed={side === 'assigner'} onClick={() => setSide('assigner')}>Sent by us</button>
          <button type="button" className="cc-btn" aria-pressed={side === 'assignee'} onClick={() => setSide('assignee')}>Received</button>
        </div>
        {list.isError && <ErrorNotice error={list.error} title="Could not load assignments" />}
        {list.data && list.data.items.length === 0 && <p className="web-muted">No assignments yet.</p>}
        {list.data?.items.map((a) => (
          <div key={a.id} className="cc-detail-row">
            <div>
              <strong>{a.title}</strong> — {KIND_LABELS[a.kind] ?? a.kind} ·{' '}
              {a.side === 'assigner' ? 'Sent to' : 'From'} {a.partnerDisplayName}
              {a.description && <p>{a.description}</p>}
              {payloadSummary(a) && <p className="web-muted">{payloadSummary(a)}</p>}
              {a.mirroredJobId && (
                <p className="web-muted">
                  {a.side === 'assignee'
                    ? 'A job for this build was created in your Jobs list when this was accepted.'
                    : 'The contractor has a job for this build in their account.'}
                </p>
              )}
              <p className="web-muted">
                {prettyStatus(a.status)}
                {a.dueOn ? ` · Due ${a.dueOn}` : ''} · {dateOnly(a.createdAt)} · {emailStateLabel(a.emailState)}
                {a.emailNote ? ` — ${a.emailNote}` : ''}
              </p>
            </div>
            {canWrite && (
              <div>
                {a.side === 'assignee' && a.status === 'sent' && (
                  <>
                    <button type="button" className="cc-btn cc-btn--primary" onClick={() => decide.mutate({ id: a.id, decision: 'accept' })}>Accept</button>{' '}
                    <button type="button" className="cc-btn" onClick={() => decide.mutate({ id: a.id, decision: 'decline' })}>Decline</button>
                  </>
                )}
                {a.side === 'assignee' && a.status === 'accepted' && (
                  <>
                    <button type="button" className="cc-btn" onClick={() => decide.mutate({ id: a.id, decision: 'start' })}>Start</button>{' '}
                    <button type="button" className="cc-btn cc-btn--primary" onClick={() => decide.mutate({ id: a.id, decision: 'complete' })}>Mark complete</button>
                  </>
                )}
                {a.side === 'assignee' && a.status === 'in_progress' && (
                  <button type="button" className="cc-btn cc-btn--primary" onClick={() => decide.mutate({ id: a.id, decision: 'complete' })}>Mark complete</button>
                )}
                {a.side === 'assigner' && (a.status === 'sent' || a.status === 'accepted') && (
                  <button type="button" className="cc-btn" onClick={() => decide.mutate({ id: a.id, decision: 'cancel' })}>Cancel</button>
                )}
                {a.side === 'assigner' && (
                  <button type="button" className="cc-btn" onClick={() => resendEmail.mutate(a.id)}>Resend email</button>
                )}
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
