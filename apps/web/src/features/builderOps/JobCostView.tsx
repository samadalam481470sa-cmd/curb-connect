'use client';

// Job cost + draw billing (builder operations): budget-to-actual per cost code against a
// job, and progress-billing draw requests. Every number is builder-entered or recorded
// from an existing record (PO / AP invoice / manual entry) — actuals sum recorded entries
// only, and a cost code with no budget line shows no invented budget.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { dateOnly, money, parseDollarsToMinor, prettyStatus } from './shared';

const SummaryLine = z.object({
  costCode: z.string(),
  label: z.string().nullable(),
  budgetMinor: z.number().nullable(),
  actualMinor: z.number(),
  remainingMinor: z.number().nullable(),
  entryCount: z.number(),
});
const Summary = z.object({
  jobId: z.string(),
  lines: z.array(SummaryLine),
  totalBudgetMinor: z.number().nullable(),
  totalActualMinor: z.number(),
  currency: z.string(),
});
const BudgetLine = z.object({ id: z.string(), costCode: z.string(), budgetMinor: z.number() });
const Entry = z.object({
  id: z.string(),
  jobId: z.string(),
  costCode: z.string(),
  description: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  source: z.string(),
  sourceId: z.string().nullable(),
  incurredOn: z.string(),
  createdAt: z.string(),
});
const EntryList = z.object({ items: z.array(Entry) });
const Draw = z.object({
  id: z.string(),
  jobId: z.string(),
  number: z.number(),
  status: z.string(),
  contractMinor: z.number(),
  requestedMinor: z.number(),
  previouslyPaidMinor: z.number(),
  retainagePct: z.number(),
  currency: z.string(),
  note: z.string().nullable(),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
});
const DrawList = z.object({ items: z.array(Draw) });
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const JobsList = z.object({ items: z.array(Job) });

const DRAW_STATUSES = ['draft', 'submitted', 'approved', 'paid', 'rejected'];

export function JobCostView() {
  return (
    <RouteGate routeId="jobCost">
      <JobCostContent />
    </RouteGate>
  );
}

function JobCostContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.check('job_cost:write');
  const canDrawWrite = session.check('draw:write');
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');

  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'job-cost', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });
  const summary = useQuery({
    queryKey: orgKey(session.orgId, 'job-cost', 'summary', jobId),
    queryFn: () => api.get(`/v1/job-cost/jobs/${jobId}/summary`, { schema: Summary }),
    enabled: Boolean(jobId),
  });
  const entries = useQuery({
    queryKey: orgKey(session.orgId, 'job-cost', 'entries', jobId),
    queryFn: () => api.get(`/v1/job-cost/jobs/${jobId}/entries`, { schema: EntryList }),
    enabled: Boolean(jobId),
  });
  const draws = useQuery({
    queryKey: orgKey(session.orgId, 'job-cost', 'draws', jobId),
    queryFn: () => api.get(`/v1/job-cost/draws${jobId ? `?jobId=${jobId}` : ''}`, { schema: DrawList }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'job-cost') });

  const [budgetCode, setBudgetCode] = useState('');
  const [budgetLabel, setBudgetLabel] = useState('');
  const [budgetAmt, setBudgetAmt] = useState('');
  const setBudget = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/job-cost/jobs/${jobId}/budgets`,
        { costCode: budgetCode.trim(), label: budgetLabel.trim(), budgetMinor: parseDollarsToMinor(budgetAmt) ?? 0 },
        { schema: BudgetLine },
      ),
    onSuccess: () => {
      setBudgetCode('');
      setBudgetLabel('');
      setBudgetAmt('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const [entryCode, setEntryCode] = useState('');
  const [entryDesc, setEntryDesc] = useState('');
  const [entryAmt, setEntryAmt] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const addEntry = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/job-cost/jobs/${jobId}/entries`,
        {
          costCode: entryCode.trim(),
          description: entryDesc.trim(),
          amountMinor: parseDollarsToMinor(entryAmt) ?? 0,
          source: 'manual',
          incurredOn: entryDate,
        },
        { schema: Entry },
      ),
    onSuccess: () => {
      setEntryCode('');
      setEntryDesc('');
      setEntryAmt('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const [contractAmt, setContractAmt] = useState('');
  const [requestedAmt, setRequestedAmt] = useState('');
  const [retainage, setRetainage] = useState('0');
  const [drawNote, setDrawNote] = useState('');
  const createDraw = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/job-cost/draws',
        {
          jobId,
          contractMinor: parseDollarsToMinor(contractAmt) ?? 0,
          requestedMinor: parseDollarsToMinor(requestedAmt) ?? 0,
          retainagePct: Number(retainage) || 0,
          note: drawNote.trim() || null,
        },
        { schema: Draw },
      ),
    onSuccess: () => {
      setRequestedAmt('');
      setDrawNote('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateDraw = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      api.patch(`/v1/job-cost/draws/${input.id}`, { status: input.status }, { schema: Draw }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const submitBudget = (event: FormEvent) => {
    event.preventDefault();
    if (!jobId || !budgetCode.trim() || !budgetLabel.trim() || parseDollarsToMinor(budgetAmt) === null) {
      setError('Pick a job, then enter a cost code, label, and budget amount.');
      return;
    }
    setError('');
    setBudget.mutate();
  };
  const submitEntry = (event: FormEvent) => {
    event.preventDefault();
    if (!jobId || !entryCode.trim() || !entryDesc.trim() || parseDollarsToMinor(entryAmt) === null) {
      setError('Pick a job, then enter a cost code, description, and amount.');
      return;
    }
    setError('');
    addEntry.mutate();
  };
  const submitDraw = (event: FormEvent) => {
    event.preventDefault();
    if (!jobId || parseDollarsToMinor(contractAmt) === null || parseDollarsToMinor(requestedAmt) === null) {
      setError('Pick a job, then enter the contract amount and the amount requested.');
      return;
    }
    setError('');
    createDraw.mutate();
  };

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Job Cost"
        description="Budget vs actual per cost code, plus draw (progress billing) requests. Budgets and actuals are what you enter or record from purchase orders and AP invoices — nothing is estimated for you."
      />
      {error && <p className="web-error" role="alert">{error}</p>}

      <section className="web-card" aria-labelledby="jobcost-job-title">
        <h2 id="jobcost-job-title">Job</h2>
        <label>
          Choose a job
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Choose a job…</option>
            {(jobs.data?.items ?? []).map((j) => (
              <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
            ))}
          </select>
        </label>
      </section>

      {jobId && (
        <section className="web-card" aria-labelledby="jobcost-summary-title">
          <h2 id="jobcost-summary-title">Budget vs actual</h2>
          {summary.isError && <ErrorNotice error={summary.error} title="Could not load job cost" />}
          {summary.isPending && <p className="web-muted">Loading…</p>}
          {summary.data && (
            <>
              <div className="cc-table-wrap">
                <table>
                  <thead>
                    <tr><th>Cost code</th><th>Label</th><th>Budget</th><th>Actual</th><th>Remaining</th><th>Entries</th></tr>
                  </thead>
                  <tbody>
                    {summary.data.lines.map((l) => (
                      <tr key={l.costCode}>
                        <td>{l.costCode}</td>
                        <td>{l.label ?? '—'}</td>
                        <td>{money(l.budgetMinor, summary.data.currency)}</td>
                        <td>{money(l.actualMinor, summary.data.currency)}</td>
                        <td>{money(l.remainingMinor, summary.data.currency)}</td>
                        <td>{l.entryCount}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2}><strong>Total</strong></td>
                      <td><strong>{money(summary.data.totalBudgetMinor, summary.data.currency)}</strong></td>
                      <td><strong>{money(summary.data.totalActualMinor, summary.data.currency)}</strong></td>
                      <td></td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {summary.data.lines.length === 0 && (
                <p className="web-muted">No budget lines or cost entries yet for this job.</p>
              )}
            </>
          )}

          {canWrite && (
            <div className="cc-two-col">
              <form className="cc-work-board__form" onSubmit={submitBudget}>
                <h3>Set a budget line</h3>
                <label>Cost code<input value={budgetCode} onChange={(e) => setBudgetCode(e.target.value)} placeholder="e.g. 03-300" /></label>
                <label>Label<input value={budgetLabel} onChange={(e) => setBudgetLabel(e.target.value)} placeholder="e.g. Concrete" /></label>
                <label>Budget ($)<input inputMode="decimal" value={budgetAmt} onChange={(e) => setBudgetAmt(e.target.value)} /></label>
                <button type="submit" className="cc-btn cc-btn--primary" disabled={setBudget.isPending}>Save budget line</button>
              </form>
              <form className="cc-work-board__form" onSubmit={submitEntry}>
                <h3>Record an actual cost</h3>
                <label>Cost code<input value={entryCode} onChange={(e) => setEntryCode(e.target.value)} /></label>
                <label>Description<input value={entryDesc} onChange={(e) => setEntryDesc(e.target.value)} /></label>
                <label>Amount ($)<input inputMode="decimal" value={entryAmt} onChange={(e) => setEntryAmt(e.target.value)} /></label>
                <label>Date<input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></label>
                <button type="submit" className="cc-btn cc-btn--primary" disabled={addEntry.isPending}>Record cost</button>
              </form>
            </div>
          )}

          <h3>Cost entries</h3>
          {entries.data && entries.data.items.length === 0 && <p className="web-muted">No entries yet.</p>}
          {entries.data && entries.data.items.length > 0 && (
            <div className="cc-table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Cost code</th><th>Description</th><th>Source</th><th>Amount</th></tr></thead>
                <tbody>
                  {entries.data.items.map((e) => (
                    <tr key={e.id}>
                      <td>{e.incurredOn}</td>
                      <td>{e.costCode}</td>
                      <td>{e.description}</td>
                      <td>{prettyStatus(e.source)}</td>
                      <td>{money(e.amountMinor, e.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="web-card" aria-labelledby="jobcost-draws-title">
        <h2 id="jobcost-draws-title">Draws (progress billing)</h2>
        {canDrawWrite && jobId && (
          <form className="cc-work-board__form" onSubmit={submitDraw}>
            <label>Contract amount ($)<input inputMode="decimal" value={contractAmt} onChange={(e) => setContractAmt(e.target.value)} /></label>
            <label>Amount requested ($)<input inputMode="decimal" value={requestedAmt} onChange={(e) => setRequestedAmt(e.target.value)} /></label>
            <label>Retainage (%)<input inputMode="decimal" value={retainage} onChange={(e) => setRetainage(e.target.value)} /></label>
            <label>Note<input value={drawNote} onChange={(e) => setDrawNote(e.target.value)} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={createDraw.isPending}>Create draw</button>
          </form>
        )}
        {draws.isError && <ErrorNotice error={draws.error} title="Could not load draws" />}
        {draws.data && draws.data.items.length === 0 && <p className="web-muted">No draws yet.</p>}
        {draws.data && draws.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Status</th><th>Contract</th><th>Requested</th><th>Previously paid</th><th>Retainage</th><th>Created</th>{canDrawWrite && <th>Move to</th>}</tr>
              </thead>
              <tbody>
                {draws.data.items.map((d) => (
                  <tr key={d.id}>
                    <td>{d.number}</td>
                    <td>{prettyStatus(d.status)}</td>
                    <td>{money(d.contractMinor, d.currency)}</td>
                    <td>{money(d.requestedMinor, d.currency)}</td>
                    <td>{money(d.previouslyPaidMinor, d.currency)}</td>
                    <td>{d.retainagePct}%</td>
                    <td>{dateOnly(d.createdAt)}</td>
                    {canDrawWrite && (
                      <td>
                        <select
                          aria-label={`Status for draw ${d.number}`}
                          value={d.status}
                          onChange={(e) => updateDraw.mutate({ id: d.id, status: e.target.value })}
                        >
                          {DRAW_STATUSES.map((s) => (
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
