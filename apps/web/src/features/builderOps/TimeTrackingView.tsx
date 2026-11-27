'use client';

// Time tracking (builder operations): crew hours against jobs and cost codes, with the
// labor-cost rollup. Hours and rates are entered by the crew/company — labor cost is
// computed only from the entered rate, never estimated. Labels switch between English
// and Spanish for field crews; stored values never change.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { submitOrQueue } from '../../lib/offline/fieldWrites';
import { orgKey, useApi, useSession } from '../../lib/session';
import { FIELD_LABELS, money, parseDollarsToMinor, type UiLang } from './shared';

const TimeEntry = z.object({
  id: z.string(),
  membershipId: z.string().nullable(),
  workerName: z.string(),
  jobId: z.string().nullable(),
  costCode: z.string().nullable(),
  workDate: z.string(),
  hours: z.number(),
  rateMinorPerHour: z.number().nullable(),
  laborCostMinor: z.number().nullable(),
  currency: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const TimeEntryList = z.object({ items: z.array(TimeEntry) });
const Rollup = z.object({
  jobId: z.string().nullable(),
  totalHours: z.number(),
  totalLaborCostMinor: z.number().nullable(),
  entryCount: z.number(),
  byCostCode: z.array(
    z.object({
      costCode: z.string().nullable(),
      hours: z.number(),
      laborCostMinor: z.number().nullable(),
    }),
  ),
});
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const JobsList = z.object({ items: z.array(Job) });

export function TimeTrackingView() {
  return (
    <RouteGate routeId="timeTracking">
      <TimeTrackingContent />
    </RouteGate>
  );
}

function TimeTrackingContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.check('time_entry:write');
  const [lang, setLang] = useState<UiLang>('en');
  const L = FIELD_LABELS[lang];
  const [jobFilter, setJobFilter] = useState('');
  const [error, setError] = useState('');

  const entries = useQuery({
    queryKey: orgKey(session.orgId, 'time-tracking', 'entries', jobFilter),
    queryFn: () =>
      api.get(`/v1/field-ops/time-entries${jobFilter ? `?jobId=${jobFilter}` : ''}`, { schema: TimeEntryList }),
  });
  const rollup = useQuery({
    queryKey: orgKey(session.orgId, 'time-tracking', 'rollup', jobFilter),
    queryFn: () =>
      api.get(`/v1/field-ops/time-rollup${jobFilter ? `?jobId=${jobFilter}` : ''}`, { schema: Rollup }),
  });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'time-tracking', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });

  const [workerName, setWorkerName] = useState('');
  const [jobId, setJobId] = useState('');
  const [costCode, setCostCode] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [queuedNote, setQueuedNote] = useState('');
  const create = useMutation({
    mutationFn: () => {
      const body = {
        workerName: workerName.trim(),
        jobId: jobId || null,
        costCode: costCode.trim() || null,
        workDate,
        hours: Number(hours),
        rateMinorPerHour: parseDollarsToMinor(rate),
        note: note.trim() || null,
      };
      return submitOrQueue({
        scope: { userId: session.me.user.id, orgId: session.orgId },
        kind: 'time_entry_create',
        label: `Time entry for ${body.workerName} (${body.workDate})`,
        method: 'POST',
        path: '/v1/field-ops/time-entries',
        body,
        send: (idempotencyKey) =>
          api.post('/v1/field-ops/time-entries', body, { schema: TimeEntry, idempotencyKey }),
      });
    },
    onSuccess: (result) => {
      setWorkerName('');
      setCostCode('');
      setHours('');
      setRate('');
      setNote('');
      setError('');
      setQueuedNote(
        result.queued
          ? lang === 'es'
            ? 'Sin conexión: el registro se guardó en este dispositivo y se enviará al reconectar.'
            : 'Offline: the entry is saved on this device and will be sent when you reconnect.'
          : '',
      );
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'time-tracking') });
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!workerName.trim() || !hours || Number.isNaN(Number(hours)) || Number(hours) <= 0) {
      setError(lang === 'es' ? 'Ingrese el nombre del trabajador y las horas.' : 'Enter the worker name and hours.');
      return;
    }
    setError('');
    create.mutate();
  };

  const jobLabel = (id: string | null) => {
    if (!id) return '—';
    const j = jobs.data?.items.find((x) => x.id === id);
    return j ? `${j.number} — ${j.title}` : id.slice(0, 8);
  };

  return (
    <main className="cc-work-board">
      <PageHeader
        title={L.timeTracking}
        description={
          lang === 'es'
            ? 'Horas de la cuadrilla por trabajo y código de costo, con el costo de mano de obra calculado solo con la tarifa que usted ingresa.'
            : 'Crew hours against jobs and cost codes, with labor cost computed only from the rate you enter.'
        }
        actions={
          <label>
            {L.language}
            <select value={lang} onChange={(e) => setLang(e.target.value as UiLang)}>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
        }
      />
      {error && <p className="web-error" role="alert">{error}</p>}
      {queuedNote && <p className="web-muted" role="status">{queuedNote}</p>}

      {canWrite && (
        <section className="web-card" aria-labelledby="time-create-title">
          <h2 id="time-create-title">{L.recordTime}</h2>
          <form className="cc-work-board__form" onSubmit={submit}>
            <label>{L.workerName}<input value={workerName} onChange={(e) => setWorkerName(e.target.value)} /></label>
            <label>
              {L.job}
              <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">—</option>
                {(jobs.data?.items ?? []).map((j) => (
                  <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
                ))}
              </select>
            </label>
            <label>{L.costCode}<input value={costCode} onChange={(e) => setCostCode(e.target.value)} /></label>
            <label>{L.workDate}<input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></label>
            <label>{L.hours}<input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
            <label>{L.ratePerHour}<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
            <label>{L.note}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={create.isPending}>
              {create.isPending ? L.saving : L.save}
            </button>
          </form>
        </section>
      )}

      <section className="web-card" aria-labelledby="time-entries-title">
        <h2 id="time-entries-title">{L.entries}</h2>
        <label>
          {L.job}
          <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
            <option value="">{lang === 'es' ? 'Todos' : 'All'}</option>
            {(jobs.data?.items ?? []).map((j) => (
              <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
            ))}
          </select>
        </label>
        {entries.isError && <ErrorNotice error={entries.error} title="Could not load time entries" />}
        {entries.data && entries.data.items.length === 0 && <p className="web-muted">{L.noEntries}</p>}
        {entries.data && entries.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead><tr><th>{L.workerName}</th><th>{L.job}</th><th>{L.costCode}</th><th>{L.workDate}</th><th>{L.hours}</th><th>{L.laborCost}</th></tr></thead>
              <tbody>
                {entries.data.items.map((e) => (
                  <tr key={e.id}>
                    <td>{e.workerName}</td>
                    <td>{jobLabel(e.jobId)}</td>
                    <td>{e.costCode ?? '—'}</td>
                    <td>{e.workDate}</td>
                    <td>{e.hours}</td>
                    <td>{money(e.laborCostMinor, e.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="web-card" aria-labelledby="time-rollup-title">
        <h2 id="time-rollup-title">{L.rollup}</h2>
        {rollup.data && (
          <>
            <div className="cc-table-wrap">
              <table>
                <thead><tr><th>{L.costCode}</th><th>{L.totalHours}</th><th>{L.totalLaborCost}</th></tr></thead>
                <tbody>
                  {rollup.data.byCostCode.map((l, i) => (
                    <tr key={i}>
                      <td>{l.costCode ?? '—'}</td>
                      <td>{l.hours}</td>
                      <td>{money(l.laborCostMinor, entries.data?.items[0]?.currency ?? 'USD')}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>{lang === 'es' ? 'Total' : 'Total'}</strong></td>
                    <td><strong>{rollup.data.totalHours}</strong></td>
                    <td><strong>{money(rollup.data.totalLaborCostMinor, entries.data?.items[0]?.currency ?? 'USD')}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
