'use client';

// Payables (builder operations): the AP workflow — capture an invoice, route it for
// approval, approve/reject/dispute, and record payment. Recording payment books the actual
// into job cost when the invoice carries a job + cost code. Actually moving money stays
// gated on a payments provider (see Integrations); this screen records what you did.
// Lien releases track the waiver paperwork tied to payments (Texas statutory kinds) —
// document tracking, not legal advice.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { dateOnly, money, parseDollarsToMinor, prettyStatus } from './shared';

const ApInvoice = z.object({
  id: z.string(),
  vendorName: z.string(),
  invoiceNumber: z.string().nullable(),
  jobId: z.string().nullable(),
  costCode: z.string().nullable(),
  amountMinor: z.number(),
  currency: z.string(),
  dueOn: z.string().nullable(),
  status: z.string(),
  source: z.string(),
  sourceId: z.string().nullable(),
  approvalNote: z.string().nullable(),
  approvedByUserId: z.string().nullable(),
  approvedAt: z.string().nullable(),
  paymentRecordedAt: z.string().nullable(),
  lienReleaseId: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ApList = z.object({ items: z.array(ApInvoice) });
const LienRelease = z.object({
  id: z.string(),
  jobId: z.string().nullable(),
  apInvoiceId: z.string().nullable(),
  claimantName: z.string(),
  kind: z.string(),
  status: z.string(),
  amountMinor: z.number().nullable(),
  currency: z.string(),
  throughOn: z.string().nullable(),
  receivedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const LienList = z.object({ items: z.array(LienRelease) });
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const JobsList = z.object({ items: z.array(Job) });

const AP_STATUSES = ['captured', 'pending_approval', 'approved', 'payment_recorded', 'rejected', 'disputed'];
const LIEN_KINDS: Record<string, string> = {
  conditional_progress: 'Conditional waiver — progress payment',
  unconditional_progress: 'Unconditional waiver — progress payment',
  conditional_final: 'Conditional waiver — final payment',
  unconditional_final: 'Unconditional waiver — final payment',
};
const LIEN_STATUSES = ['draft', 'requested', 'received', 'verified', 'void'];

export function PayablesView() {
  return (
    <RouteGate routeId="payables">
      <PayablesContent />
    </RouteGate>
  );
}

function PayablesContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.check('ap:write');
  const canApprove = session.check('ap:approve');
  const canLienWrite = session.check('lien_release:write');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');

  const list = useQuery({
    queryKey: orgKey(session.orgId, 'payables', 'ap', statusFilter),
    queryFn: () =>
      api.get(`/v1/job-cost/ap-invoices${statusFilter ? `?status=${statusFilter}` : ''}`, { schema: ApList }),
  });
  const liens = useQuery({
    queryKey: orgKey(session.orgId, 'payables', 'liens'),
    queryFn: () => api.get('/v1/job-cost/lien-releases', { schema: LienList }),
  });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'payables', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'payables') });

  const [vendor, setVendor] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [jobId, setJobId] = useState('');
  const [costCode, setCostCode] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/job-cost/ap-invoices',
        {
          vendorName: vendor.trim(),
          invoiceNumber: invoiceNumber.trim() || null,
          amountMinor: parseDollarsToMinor(amount) ?? 0,
          dueOn: dueOn || null,
          jobId: jobId || null,
          costCode: costCode.trim() || null,
          source: 'manual',
        },
        { schema: ApInvoice },
      ),
    onSuccess: () => {
      setVendor('');
      setInvoiceNumber('');
      setAmount('');
      setDueOn('');
      setCostCode('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: string }) =>
      api.post(`/v1/job-cost/ap-invoices/${input.id}/decide`, { decision: input.decision }, { schema: ApInvoice }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const [claimant, setClaimant] = useState('');
  const [kind, setKind] = useState('conditional_progress');
  const [lienAmt, setLienAmt] = useState('');
  const [throughOn, setThroughOn] = useState('');
  const [lienJobId, setLienJobId] = useState('');
  const createLien = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/job-cost/lien-releases',
        {
          claimantName: claimant.trim(),
          kind,
          amountMinor: parseDollarsToMinor(lienAmt),
          throughOn: throughOn || null,
          jobId: lienJobId || null,
        },
        { schema: LienRelease },
      ),
    onSuccess: () => {
      setClaimant('');
      setLienAmt('');
      setThroughOn('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateLien = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      api.patch(`/v1/job-cost/lien-releases/${input.id}`, { status: input.status }, { schema: LienRelease }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!vendor.trim() || parseDollarsToMinor(amount) === null) {
      setError('Enter the vendor and the invoice amount.');
      return;
    }
    setError('');
    create.mutate();
  };

  const decisionsFor = (status: string): { value: string; label: string; needsApprove?: boolean }[] => {
    switch (status) {
      case 'captured':
        return [
          { value: 'submit_for_approval', label: 'Submit for approval' },
          { value: 'dispute', label: 'Dispute' },
        ];
      case 'pending_approval':
        return [
          { value: 'approve', label: 'Approve', needsApprove: true },
          { value: 'reject', label: 'Reject' },
          { value: 'dispute', label: 'Dispute' },
        ];
      case 'approved':
        return [{ value: 'record_payment', label: 'Record payment', needsApprove: true }];
      default:
        return [];
    }
  };

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Payables"
        description="Accounts payable: capture invoices, route them for approval, and record payment. Recording payment against a job and cost code also books the cost into Job Cost. Moving money through a payments provider is set up under Integrations — until then, record payments you made outside Field Pro."
      />
      {error && <p className="web-error" role="alert">{error}</p>}

      {canWrite && (
        <section className="web-card" aria-labelledby="ap-create-title">
          <h2 id="ap-create-title">Capture an AP invoice</h2>
          <form className="cc-work-board__form" onSubmit={submit}>
            <label>Vendor<input value={vendor} onChange={(e) => setVendor(e.target.value)} /></label>
            <label>Invoice number<input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></label>
            <label>Amount ($)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            <label>Due date<input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
            <label>
              Job (optional)
              <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">No job</option>
                {(jobs.data?.items ?? []).map((j) => (
                  <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
                ))}
              </select>
            </label>
            <label>Cost code (optional)<input value={costCode} onChange={(e) => setCostCode(e.target.value)} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={create.isPending}>Capture invoice</button>
          </form>
        </section>
      )}

      <section className="web-card" aria-labelledby="ap-list-title">
        <h2 id="ap-list-title">AP invoices</h2>
        <label>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {AP_STATUSES.map((s) => (
              <option key={s} value={s}>{prettyStatus(s)}</option>
            ))}
          </select>
        </label>
        {list.isError && <ErrorNotice error={list.error} title="Could not load AP invoices" />}
        {list.isPending && <p className="web-muted">Loading…</p>}
        {list.data && list.data.items.length === 0 && <p className="web-muted">No AP invoices yet.</p>}
        {list.data && list.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead>
                <tr><th>Vendor</th><th>Invoice #</th><th>Amount</th><th>Due</th><th>Status</th><th>Source</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {list.data.items.map((a) => (
                  <tr key={a.id}>
                    <td>{a.vendorName}</td>
                    <td>{a.invoiceNumber ?? '—'}</td>
                    <td>{money(a.amountMinor, a.currency)}</td>
                    <td>{a.dueOn ?? '—'}</td>
                    <td>{prettyStatus(a.status)}</td>
                    <td>{prettyStatus(a.source)}</td>
                    <td>
                      {canWrite &&
                        decisionsFor(a.status)
                          .filter((d) => !d.needsApprove || canApprove)
                          .map((d) => (
                            <button
                              key={d.value}
                              type="button"
                              className="cc-btn"
                              onClick={() => decide.mutate({ id: a.id, decision: d.value })}
                            >
                              {d.label}
                            </button>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="web-card" aria-labelledby="lien-title">
        <h2 id="lien-title">Lien releases</h2>
        <p className="web-muted">
          Track lien waiver paperwork tied to payments. Texas has statutory waiver forms — this
          tracks the documents; it is not legal advice. Have your attorney review waiver language.
        </p>
        {canLienWrite && (
          <form
            className="cc-work-board__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!claimant.trim()) {
                setError('Enter the claimant name.');
                return;
              }
              setError('');
              createLien.mutate();
            }}
          >
            <label>Claimant<input value={claimant} onChange={(e) => setClaimant(e.target.value)} /></label>
            <label>
              Waiver kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(LIEN_KINDS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </label>
            <label>Amount covered ($, optional)<input inputMode="decimal" value={lienAmt} onChange={(e) => setLienAmt(e.target.value)} /></label>
            <label>Through date<input type="date" value={throughOn} onChange={(e) => setThroughOn(e.target.value)} /></label>
            <label>
              Job (optional)
              <select value={lienJobId} onChange={(e) => setLienJobId(e.target.value)}>
                <option value="">No job</option>
                {(jobs.data?.items ?? []).map((j) => (
                  <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={createLien.isPending}>Track waiver</button>
          </form>
        )}
        {liens.isError && <ErrorNotice error={liens.error} title="Could not load lien releases" />}
        {liens.data && liens.data.items.length === 0 && <p className="web-muted">No lien releases tracked yet.</p>}
        {liens.data && liens.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead><tr><th>Claimant</th><th>Kind</th><th>Amount</th><th>Through</th><th>Status</th><th>Received</th>{canLienWrite && <th>Move to</th>}</tr></thead>
              <tbody>
                {liens.data.items.map((l) => (
                  <tr key={l.id}>
                    <td>{l.claimantName}</td>
                    <td>{LIEN_KINDS[l.kind] ?? l.kind}</td>
                    <td>{money(l.amountMinor, l.currency)}</td>
                    <td>{l.throughOn ?? '—'}</td>
                    <td>{prettyStatus(l.status)}</td>
                    <td>{dateOnly(l.receivedAt)}</td>
                    {canLienWrite && (
                      <td>
                        <select
                          aria-label={`Status for ${l.claimantName}`}
                          value={l.status}
                          onChange={(e) => updateLien.mutate({ id: l.id, status: e.target.value })}
                        >
                          {LIEN_STATUSES.map((s) => (
                            <option key={s} value={s}>{prettyStatus(s)}</option>
                          ))}
                        </select>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
