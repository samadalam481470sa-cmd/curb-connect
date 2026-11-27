'use client';

// Progress Billing (blueprint gap 2): schedules of values per job, periodic
// applications (percent complete + stored materials per line), approval with
// frozen totals, draft invoice generation, a generic progress-billing PDF
// (not an AIA form), and AR aging from issued invoices. Retainage percent and
// percents complete are contractor-entered; computed totals come from the API.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { money, prettyStatus } from '../builderOps/shared';

const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const JobsList = z.object({ items: z.array(Job) });
const SovLine = z.object({
  id: z.string(),
  itemNumber: z.string(),
  description: z.string(),
  costCode: z.string().nullable(),
  scheduledValueMinor: z.number(),
  sortOrder: z.number(),
});
const Sov = z.object({
  id: z.string(),
  jobId: z.string(),
  name: z.string(),
  contractMinor: z.number(),
  linesTotalMinor: z.number(),
  retainagePct: z.number(),
  currency: z.string(),
  status: z.string(),
  lines: z.array(SovLine),
  revision: z.number(),
});
const AppLine = z.object({
  sovLineId: z.string(),
  itemNumber: z.string(),
  description: z.string(),
  scheduledValueMinor: z.number(),
  percentComplete: z.number(),
  completedToDateMinor: z.number(),
  storedMaterialsMinor: z.number(),
  completedStoredToDateMinor: z.number(),
  previousCompletedStoredMinor: z.number(),
  thisPeriodMinor: z.number(),
  balanceToFinishMinor: z.number(),
  overbilled: z.boolean(),
});
const Application = z.object({
  id: z.string(),
  sovId: z.string(),
  jobId: z.string(),
  number: z.number(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.string(),
  invoiceId: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  note: z.string().nullable(),
  currency: z.string(),
  lines: z.array(AppLine),
  totals: z.object({
    scheduledTotalMinor: z.number(),
    completedStoredTotalMinor: z.number(),
    previousCompletedStoredMinor: z.number(),
    thisPeriodGrossMinor: z.number(),
    retainageToDateMinor: z.number(),
    retainageThisPeriodMinor: z.number(),
    currentDueMinor: z.number(),
    balanceToFinishMinor: z.number(),
    overbilled: z.boolean(),
  }),
  revision: z.number(),
});
type ApplicationT = z.infer<typeof Application>;
const PdfResponse = z.object({
  filename: z.string(),
  contentBase64: z.string(),
  sha256Hex: z.string(),
  pages: z.number(),
});
const Aging = z.object({
  currency: z.string(),
  asOf: z.string(),
  buckets: z.array(z.object({ bucket: z.string(), invoiceCount: z.number(), outstandingMinor: z.number() })),
  totalOutstandingMinor: z.number(),
  invoices: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      customerName: z.string().nullable(),
      status: z.string(),
      dueOn: z.string().nullable(),
      totalMinor: z.number(),
      amountPaidMinor: z.number(),
      outstandingMinor: z.number(),
      daysOverdue: z.number().nullable(),
    }),
  ),
});

const BUCKET_LABELS: Record<string, string> = {
  current: 'Current',
  days_1_30: '1–30 days overdue',
  days_31_60: '31–60 days overdue',
  days_61_90: '61–90 days overdue',
  days_90_plus: '90+ days overdue',
  no_due_date: 'No due date',
};

const toMinor = (dollars: string) => {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function ProgressBillingView() {
  return (
    <RouteGate routeId="progressBilling">
      <Content />
    </RouteGate>
  );
}

function Content() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState('');
  const [sovId, setSovId] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const canWrite = session.check('draw:write').allowed;
  const canApprove = session.check('draw:approve').allowed;
  const canInvoice = session.check('invoice:write').allowed;

  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'progress-billing', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });
  const sovs = useQuery({
    queryKey: orgKey(session.orgId, 'progress-billing', jobId || 'none', 'sov'),
    enabled: jobId.length > 0,
    queryFn: () => api.get(`/v1/progress-billing/jobs/${jobId}/sov`, { schema: z.object({ items: z.array(Sov) }) }),
  });
  const applications = useQuery({
    queryKey: orgKey(session.orgId, 'progress-billing', sovId || 'none', 'applications'),
    enabled: sovId.length > 0,
    queryFn: () => api.get(`/v1/progress-billing/sov/${sovId}/applications`, { schema: z.object({ items: z.array(Application) }) }),
  });
  const aging = useQuery({
    queryKey: orgKey(session.orgId, 'progress-billing', 'ar-aging'),
    queryFn: () => api.get('/v1/progress-billing/ar-aging', { schema: Aging }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'progress-billing') });
  };
  const onError = (cause: unknown) => setError(errorHint(cause));

  // --- SOV form
  const [sovName, setSovName] = useState('');
  const [sovContract, setSovContract] = useState('');
  const [sovRetainage, setSovRetainage] = useState('10');
  const [sovLinesText, setSovLinesText] = useState('');
  const createSov = useMutation({
    mutationFn: () => {
      const lines = sovLinesText
        .split('\n')
        .map((row) => row.trim())
        .filter(Boolean)
        .map((row) => {
          const [itemNumber, description, value] = row.split('|').map((p) => p.trim());
          return {
            itemNumber: itemNumber ?? '',
            description: description ?? '',
            scheduledValueMinor: toMinor(value ?? '0'),
          };
        });
      return api.post(
        `/v1/progress-billing/jobs/${jobId}/sov`,
        {
          name: sovName.trim(),
          contractMinor: toMinor(sovContract),
          retainagePct: Number(sovRetainage) || 0,
          lines,
        },
        { schema: Sov },
      );
    },
    onSuccess: (sov) => {
      setSovName(''); setSovContract(''); setSovLinesText(''); setError(''); setSovId(sov.id); refresh();
    },
    onError,
  });

  // --- Application form
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [lineInputs, setLineInputs] = useState<Record<string, { pct: string; stored: string }>>({});
  const selectedSov = (sovs.data?.items ?? []).find((s) => s.id === sovId);
  const createApplication = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/progress-billing/sov/${sovId}/applications`,
        {
          periodStart,
          periodEnd,
          lines: (selectedSov?.lines ?? []).map((l) => ({
            sovLineId: l.id,
            percentComplete: Number(lineInputs[l.id]?.pct ?? '0') || 0,
            storedMaterialsMinor: toMinor(lineInputs[l.id]?.stored ?? '0'),
          })),
        },
        { schema: Application },
      ),
    onSuccess: () => { setError(''); setLineInputs({}); refresh(); },
    onError,
  });

  const transition = useMutation({
    mutationFn: (v: { app: ApplicationT; action: 'submit' | 'approve' | 'reject' | 'generate-invoice' }) =>
      api.post(`/v1/progress-billing/applications/${v.app.id}/${v.action}`, {}, { schema: Application }),
    onSuccess: (app, v) => {
      setError('');
      if (v.action === 'generate-invoice') {
        setNote(`Draft invoice ${app.invoiceNumber ?? ''} created. Issue it from Invoices when ready — nothing was sent.`);
      }
      refresh();
    },
    onError,
  });

  const downloadPdf = useMutation({
    mutationFn: (app: ApplicationT) => api.post(`/v1/progress-billing/applications/${app.id}/pdf`, {}, { schema: PdfResponse }),
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      setNote(`Progress billing PDF downloaded (${data.pages} page${data.pages === 1 ? '' : 's'}). It is a generic Field Pro document, not an AIA form.`);
    },
    onError,
  });

  return (
    <div>
      <PageHeader title="Progress Billing" description="Schedules of values, applications, retainage, and AR aging." />
      {error ? <ErrorNotice error={error} /> : null}
      {note ? <p role="status">{note}</p> : null}

      <section className="cc-panel">
        <h3>Job</h3>
        <select aria-label="Job" value={jobId} onChange={(e) => { setJobId(e.target.value); setSovId(''); }}>
          <option value="">Select a job…</option>
          {(jobs.data?.items ?? []).map((j) => (
            <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
          ))}
        </select>
      </section>

      {jobId ? (
        <>
          <section className="cc-panel">
            <h3>Schedules of values</h3>
            <ul>
              {(sovs.data?.items ?? []).map((s) => (
                <li key={s.id}>
                  <button type="button" className="cc-btn cc-btn--sm" onClick={() => setSovId(s.id)}>
                    {s.name}
                  </button>{' '}
                  contract {money(s.contractMinor, s.currency)} · lines total {money(s.linesTotalMinor, s.currency)} ·
                  retainage {s.retainagePct}% · {prettyStatus(s.status)}
                  {s.linesTotalMinor !== s.contractMinor ? ' (lines do not add up to the contract sum)' : ''}
                </li>
              ))}
              {(sovs.data?.items ?? []).length === 0 ? <li>No schedule of values for this job yet.</li> : null}
            </ul>
            {canWrite ? (
              <div className="cc-grid">
                <input aria-label="SOV name" placeholder="Name (e.g. Main contract)" value={sovName} onChange={(e) => setSovName(e.target.value)} />
                <input aria-label="Contract sum in dollars" placeholder="Contract sum ($)" inputMode="decimal" value={sovContract} onChange={(e) => setSovContract(e.target.value)} />
                <input aria-label="Retainage percent" placeholder="Retainage %" inputMode="decimal" value={sovRetainage} onChange={(e) => setSovRetainage(e.target.value)} />
                <textarea
                  aria-label="SOV lines, one per row: item | description | value in dollars"
                  placeholder={'One line per row: item | description | value ($)\n01 | Site work | 10000\n02 | Foundation | 25000'}
                  value={sovLinesText}
                  onChange={(e) => setSovLinesText(e.target.value)}
                  rows={5}
                />
                <button type="button" className="cc-btn" disabled={!sovName.trim() || !sovContract || !sovLinesText.trim()} onClick={() => createSov.mutate()}>
                  Create schedule of values
                </button>
              </div>
            ) : null}
          </section>

          {selectedSov ? (
            <section className="cc-panel">
              <h3>Applications — {selectedSov.name}</h3>
              <ul>
                {(applications.data?.items ?? []).map((a) => (
                  <li key={a.id}>
                    <strong>#{a.number}</strong> {a.periodStart} → {a.periodEnd} — {prettyStatus(a.status)} ·
                    due this period {money(a.totals.currentDueMinor, a.currency)} ·
                    balance to finish {money(a.totals.balanceToFinishMinor, a.currency)}
                    {a.totals.overbilled ? ' — OVERBILLED line(s)' : ''}
                    {a.invoiceNumber ? ` · invoice ${a.invoiceNumber}` : ''}
                    <div>
                      {a.lines.map((l) => (
                        <div key={l.sovLineId} className="web-small">
                          {l.itemNumber} {l.description}: {l.percentComplete}% of {money(l.scheduledValueMinor, a.currency)} ·
                          this period {money(l.thisPeriodMinor, a.currency)} · balance {money(l.balanceToFinishMinor, a.currency)}
                          {l.overbilled ? ' (overbilled)' : ''}
                        </div>
                      ))}
                    </div>
                    {canWrite && a.status === 'draft' ? (
                      <button type="button" className="cc-btn cc-btn--sm" onClick={() => transition.mutate({ app: a, action: 'submit' })}>Submit</button>
                    ) : null}
                    {canApprove && a.status === 'submitted' ? (
                      <>
                        <button type="button" className="cc-btn cc-btn--sm" onClick={() => transition.mutate({ app: a, action: 'approve' })}>Approve</button>
                        <button type="button" className="cc-btn cc-btn--sm" onClick={() => transition.mutate({ app: a, action: 'reject' })}>Reject</button>
                      </>
                    ) : null}
                    {canInvoice && a.status === 'approved' ? (
                      <button type="button" className="cc-btn cc-btn--sm" onClick={() => transition.mutate({ app: a, action: 'generate-invoice' })}>Generate draft invoice</button>
                    ) : null}
                    <button type="button" className="cc-btn cc-btn--sm" onClick={() => downloadPdf.mutate(a)}>PDF</button>
                  </li>
                ))}
                {(applications.data?.items ?? []).length === 0 ? <li>No applications yet.</li> : null}
              </ul>

              {canWrite ? (
                <div>
                  <h4>New application</h4>
                  <div className="cc-grid">
                    <input type="date" aria-label="Period start" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                    <input type="date" aria-label="Period end" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                  </div>
                  {selectedSov.lines.map((l) => (
                    <div key={l.id} className="cc-grid">
                      <span>{l.itemNumber} {l.description} ({money(l.scheduledValueMinor, selectedSov.currency)})</span>
                      <input
                        aria-label={`Percent complete for ${l.description}`}
                        placeholder="% complete"
                        inputMode="decimal"
                        value={lineInputs[l.id]?.pct ?? ''}
                        onChange={(e) => setLineInputs((prev) => ({ ...prev, [l.id]: { pct: e.target.value, stored: prev[l.id]?.stored ?? '' } }))}
                      />
                      <input
                        aria-label={`Stored materials dollars for ${l.description}`}
                        placeholder="Stored materials ($)"
                        inputMode="decimal"
                        value={lineInputs[l.id]?.stored ?? ''}
                        onChange={(e) => setLineInputs((prev) => ({ ...prev, [l.id]: { pct: prev[l.id]?.pct ?? '', stored: e.target.value } }))}
                      />
                    </div>
                  ))}
                  <button type="button" className="cc-btn" disabled={!periodStart || !periodEnd} onClick={() => createApplication.mutate()}>
                    Create draft application
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      <section className="cc-panel">
        <h3>AR aging (as of {aging.data?.asOf ?? '—'})</h3>
        {aging.data ? (
          <>
            <ul>
              {aging.data.buckets.map((b) => (
                <li key={b.bucket}>{BUCKET_LABELS[b.bucket] ?? b.bucket}: {b.invoiceCount} invoice(s) · {money(b.outstandingMinor, aging.data.currency)}</li>
              ))}
            </ul>
            <p>Total outstanding: <strong>{money(aging.data.totalOutstandingMinor, aging.data.currency)}</strong></p>
            <ul>
              {aging.data.invoices.map((i) => (
                <li key={i.id}>
                  {i.number} {i.customerName ? `· ${i.customerName}` : ''} — outstanding {money(i.outstandingMinor, aging.data.currency)}
                  {i.dueOn ? ` · due ${i.dueOn}` : ' · no due date'}
                  {i.daysOverdue !== null && i.daysOverdue > 0 ? ` · ${i.daysOverdue}d overdue` : ''}
                </li>
              ))}
              {aging.data.invoices.length === 0 ? <li>No outstanding issued invoices.</li> : null}
            </ul>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </section>
    </div>
  );
}
