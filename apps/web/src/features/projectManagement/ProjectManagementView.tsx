'use client';

// Project Management (Phase E, items 20-27): job-linked RFIs, submittals, Gantt schedule,
// daily logs, drawings with versions/markup, punch lists, checklists, crew scheduling,
// fleet registry and change orders. Honesty notes shown in the UI: weather is manual-entry
// only, fleet locations are manual check-ins only, checklist starters make no compliance
// claim, and change-order signing is a typed-name attestation (no e-sign provider).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { barStyle, progressLabel, statusLabel } from './gantt';

const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const JobsList = z.object({ items: z.array(Job) });
const Ref = z.object({ label: z.string(), reference: z.string() });
const Rfi = z.object({
  id: z.string(), number: z.number(), subject: z.string(), question: z.string(),
  status: z.string(), assignedTo: z.string().nullable(), dueOn: z.string().nullable(),
  officialResponse: z.string().nullable(), revision: z.number(), overdue: z.boolean(),
});
const Submittal = z.object({
  id: z.string(), number: z.string(), title: z.string(), status: z.string(),
  reviewer: z.string().nullable(), dueOn: z.string().nullable(),
  documentReference: z.string().nullable(), currentRevision: z.number(),
  revision: z.number(), overdue: z.boolean(),
});
const Task = z.object({
  id: z.string(), title: z.string(), startsOn: z.string(), endsOn: z.string(),
  progressPercent: z.number(), status: z.string(), revision: z.number(), overdue: z.boolean(),
});
const Bar = z.object({
  id: z.string(), title: z.string(), startsOn: z.string(), endsOn: z.string(),
  progressPercent: z.number(), leftPercent: z.number(), widthPercent: z.number(),
  dependencyConflict: z.boolean(),
});
const Schedule = z.object({
  items: z.array(Task),
  gantt: z.object({ chartStart: z.string().nullable(), chartEnd: z.string().nullable(), totalDays: z.number(), bars: z.array(Bar) }),
});
const DailyLog = z.object({
  id: z.string(), logDate: z.string(), crewCount: z.number().nullable(),
  workDone: z.string(), weatherNotes: z.string().nullable(), photoRefs: z.array(Ref),
});
const DrawingVersion = z.object({
  id: z.string(), versionNumber: z.number(), fileReference: z.string(),
  fileName: z.string().nullable(), notes: z.string().nullable(), isCurrent: z.boolean(),
});
const Drawing = z.object({
  id: z.string(), title: z.string(), discipline: z.string().nullable(),
  sheetNumber: z.string().nullable(), versions: z.array(DrawingVersion),
});
const Punch = z.object({
  id: z.string(), title: z.string(), status: z.string(), assigneeName: z.string().nullable(),
  dueOn: z.string().nullable(), location: z.string().nullable(), revision: z.number(), overdue: z.boolean(),
});
const ChecklistRun = z.object({
  id: z.string(), title: z.string(), kind: z.string(), status: z.string(),
  signedByName: z.string().nullable(), revision: z.number(),
  answers: z.array(z.object({ label: z.string(), required: z.boolean(), done: z.boolean(), note: z.string().optional() })),
  completion: z.object({ total: z.number(), done: z.number(), requiredTotal: z.number(), requiredDone: z.number(), complete: z.boolean() }),
});
const Crew = z.object({
  id: z.string(), name: z.string(), trade: z.string(), capacityPerDay: z.number(),
  members: z.array(z.object({ id: z.string(), displayName: z.string() })),
});
const Booking = z.object({
  id: z.string(), jobId: z.string(), crewId: z.string().nullable(), status: z.string(),
  startsAt: z.string(), endsAt: z.string(),
});
const FleetAsset = z.object({
  id: z.string(), name: z.string(), kind: z.string(), identifier: z.string().nullable(),
  status: z.string(), maintenanceDueOn: z.string().nullable(), maintenanceDue: z.boolean(),
  revision: z.number(),
  lastCheckIn: z.object({ locationText: z.string(), checkedInAt: z.string() }).nullable(),
});
const ChangeOrder = z.object({
  id: z.string(), number: z.string(), title: z.string(), status: z.string(),
  amountDeltaMinor: z.number(), currency: z.string(), scheduleImpactDays: z.number(), revision: z.number(),
});

type RfiT = z.infer<typeof Rfi>;
type SubmittalT = z.infer<typeof Submittal>;
type TaskT = z.infer<typeof Task>;
type PunchT = z.infer<typeof Punch>;
type ChangeOrderT = z.infer<typeof ChangeOrder>;

const RFI_NEXT_UI: Record<string, string[]> = { draft: ['open'], open: ['answered', 'closed'], answered: ['closed'], closed: [] };
const SUB_NEXT_UI: Record<string, string[]> = {
  required: ['submitted'], submitted: ['under_review'],
  under_review: ['approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected'],
  revise_and_resubmit: ['submitted'], approved: [], approved_as_noted: [], rejected: [],
};
const PUNCH_NEXT_UI: Record<string, string[]> = {
  open: ['in_progress', 'ready_for_review'], in_progress: ['ready_for_review', 'open'],
  ready_for_review: ['verified', 'rejected'], rejected: ['in_progress', 'open'], verified: [],
};
const CO_NEXT_UI: Record<string, string[]> = {
  draft: ['pending_internal_approval', 'withdrawn'],
  pending_internal_approval: ['sent_to_customer', 'withdrawn'],
  sent_to_customer: ['rejected', 'withdrawn'], accepted: [], rejected: [], withdrawn: [],
};

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);

export function ProjectManagementView() {
  return (
    <RouteGate routeId="projectManagement">
      <PmContent />
    </RouteGate>
  );
}

function PmContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');
  const canWrite = session.check('job:write');
  const canSchedule = session.check('schedule:write');
  const canCrew = session.check('crew:manage');

  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'pm', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });
  const key = (name: string) => orgKey(session.orgId, 'pm', jobId || 'none', name);
  const enabled = jobId.length > 0;
  const rfis = useQuery({ queryKey: key('rfis'), enabled, queryFn: () => api.get(`/v1/pm/jobs/${jobId}/rfis`, { schema: z.object({ items: z.array(Rfi) }) }) });
  const submittals = useQuery({ queryKey: key('submittals'), enabled, queryFn: () => api.get(`/v1/pm/jobs/${jobId}/submittals`, { schema: z.object({ items: z.array(Submittal) }) }) });
  const schedule = useQuery({ queryKey: key('schedule'), enabled, queryFn: () => api.get(`/v1/pm/jobs/${jobId}/schedule`, { schema: Schedule }) });
  const logs = useQuery({ queryKey: key('logs'), enabled, queryFn: () => api.get(`/v1/pm/jobs/${jobId}/daily-logs`, { schema: z.object({ items: z.array(DailyLog), weatherSource: z.string() }) }) });
  const drawings = useQuery({ queryKey: key('drawings'), enabled, queryFn: () => api.get(`/v1/pm/jobs/${jobId}/drawings`, { schema: z.object({ items: z.array(Drawing) }) }) });
  const punch = useQuery({ queryKey: key('punch'), enabled, queryFn: () => api.get(`/v1/pm/jobs/${jobId}/punch-items`, { schema: z.object({ items: z.array(Punch) }) }) });
  const runs = useQuery({ queryKey: key('runs'), enabled, queryFn: () => api.get(`/v1/pm/jobs/${jobId}/checklist-runs`, { schema: z.object({ items: z.array(ChecklistRun) }) }) });
  const changeOrders = useQuery({ queryKey: key('change-orders'), enabled, queryFn: () => api.get(`/v1/jobs/${jobId}/change-orders`, { schema: z.object({ items: z.array(ChangeOrder) }) }) });
  const crews = useQuery({ queryKey: orgKey(session.orgId, 'pm', 'crews'), queryFn: () => api.get('/v1/pm/crews', { schema: z.object({ items: z.array(Crew) }) }) });
  const bookings = useQuery({ queryKey: orgKey(session.orgId, 'pm', 'bookings'), queryFn: () => api.get('/v1/pm/crew-schedule', { schema: z.object({ items: z.array(Booking) }) }) });
  const fleet = useQuery({ queryKey: orgKey(session.orgId, 'pm', 'fleet'), queryFn: () => api.get('/v1/pm/fleet', { schema: z.object({ items: z.array(FleetAsset), locationSource: z.string() }) }) });

  const refresh = (name: string) => void queryClient.invalidateQueries({ queryKey: key(name) });
  const onError = (cause: unknown) => setError(errorHint(cause));

  // --- form state
  const [rfiSubject, setRfiSubject] = useState('');
  const [rfiQuestion, setRfiQuestion] = useState('');
  const [rfiResponse, setRfiResponse] = useState('');
  const [subNumber, setSubNumber] = useState('');
  const [subTitle, setSubTitle] = useState('');
  const [subDoc, setSubDoc] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskStart, setTaskStart] = useState('');
  const [taskEnd, setTaskEnd] = useState('');
  const [logDate, setLogDate] = useState('');
  const [logWork, setLogWork] = useState('');
  const [logWeather, setLogWeather] = useState('');
  const [drawingTitle, setDrawingTitle] = useState('');
  const [drawingRef, setDrawingRef] = useState('');
  const [punchTitle, setPunchTitle] = useState('');
  const [crewName, setCrewName] = useState('');
  const [bookingCrew, setBookingCrew] = useState('');
  const [bookingStart, setBookingStart] = useState('');
  const [bookingEnd, setBookingEnd] = useState('');
  const [fleetName, setFleetName] = useState('');
  const [checkInText, setCheckInText] = useState('');
  const [coNumber, setCoNumber] = useState('');
  const [coTitle, setCoTitle] = useState('');
  const [coReason, setCoReason] = useState('');
  const [coAmount, setCoAmount] = useState('');
  const [signerName, setSignerName] = useState('');
  const [typedSignature, setTypedSignature] = useState('');

  const createRfi = useMutation({
    mutationFn: () => api.post(`/v1/pm/jobs/${jobId}/rfis`, { subject: rfiSubject.trim(), question: rfiQuestion.trim() }, { schema: Rfi }),
    onSuccess: () => { setRfiSubject(''); setRfiQuestion(''); setError(''); refresh('rfis'); }, onError,
  });
  const setRfiStatus = useMutation({
    mutationFn: (v: { row: RfiT; status: string }) => api.patch(`/v1/pm/rfis/${v.row.id}/status`,
      { status: v.status, officialResponse: v.status === 'answered' ? rfiResponse.trim() : undefined },
      { schema: Rfi, ifMatch: v.row.revision }),
    onSuccess: () => { setRfiResponse(''); setError(''); refresh('rfis'); }, onError,
  });
  const createSubmittal = useMutation({
    mutationFn: () => api.post(`/v1/pm/jobs/${jobId}/submittals`,
      { number: subNumber.trim(), title: subTitle.trim(), documentReference: subDoc.trim() || null }, { schema: Submittal }),
    onSuccess: () => { setSubNumber(''); setSubTitle(''); setSubDoc(''); setError(''); refresh('submittals'); }, onError,
  });
  const setSubStatus = useMutation({
    mutationFn: (v: { row: SubmittalT; status: string }) => api.patch(`/v1/pm/submittals/${v.row.id}/status`,
      { status: v.status }, { schema: Submittal, ifMatch: v.row.revision }),
    onSuccess: () => { setError(''); refresh('submittals'); }, onError,
  });
  const createTask = useMutation({
    mutationFn: () => api.post(`/v1/pm/jobs/${jobId}/schedule/tasks`,
      { title: taskTitle.trim(), startsOn: taskStart, endsOn: taskEnd }, { schema: Task }),
    onSuccess: () => { setTaskTitle(''); setError(''); refresh('schedule'); }, onError,
  });
  const setTaskProgress = useMutation({
    mutationFn: (v: { row: TaskT; progressPercent: number }) => api.patch(`/v1/pm/schedule/tasks/${v.row.id}`,
      { progressPercent: v.progressPercent }, { schema: Task, ifMatch: v.row.revision }),
    onSuccess: () => { setError(''); refresh('schedule'); }, onError,
  });
  const createLog = useMutation({
    mutationFn: () => api.post(`/v1/pm/jobs/${jobId}/daily-logs`,
      { logDate, workDone: logWork.trim(), weatherNotes: logWeather.trim() || null }, { schema: DailyLog }),
    onSuccess: () => { setLogWork(''); setLogWeather(''); setError(''); refresh('logs'); }, onError,
  });
  const createDrawing = useMutation({
    mutationFn: () => api.post(`/v1/pm/jobs/${jobId}/drawings`,
      { title: drawingTitle.trim(), fileReference: drawingRef.trim() }, { schema: Drawing }),
    onSuccess: () => { setDrawingTitle(''); setDrawingRef(''); setError(''); refresh('drawings'); }, onError,
  });
  const createPunch = useMutation({
    mutationFn: () => api.post(`/v1/pm/jobs/${jobId}/punch-items`, { title: punchTitle.trim() }, { schema: Punch }),
    onSuccess: () => { setPunchTitle(''); setError(''); refresh('punch'); }, onError,
  });
  const setPunchStatus = useMutation({
    mutationFn: (v: { row: PunchT; status: string }) => api.patch(`/v1/pm/punch-items/${v.row.id}/status`,
      { status: v.status }, { schema: Punch, ifMatch: v.row.revision }),
    onSuccess: () => { setError(''); refresh('punch'); }, onError,
  });
  const startRun = useMutation({
    mutationFn: (starterKey: 'safety' | 'quality') => api.post(`/v1/pm/jobs/${jobId}/checklist-runs`, { starterKey }, { schema: ChecklistRun }),
    onSuccess: () => { setError(''); refresh('runs'); }, onError,
  });
  const toggleAnswer = useMutation({
    mutationFn: (v: { run: z.infer<typeof ChecklistRun>; index: number }) => {
      const answers = v.run.answers.map((a, i) => (i === v.index ? { ...a, done: !a.done } : a));
      return api.patch(`/v1/pm/checklist-runs/${v.run.id}`, { answers }, { schema: ChecklistRun, ifMatch: v.run.revision });
    },
    onSuccess: () => { setError(''); refresh('runs'); }, onError,
  });
  const createCrew = useMutation({
    mutationFn: () => api.post('/v1/pm/crews', { name: crewName.trim(), trade: 'general' }, { schema: z.object({ id: z.string() }) }),
    onSuccess: () => { setCrewName(''); setError(''); void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'pm', 'crews') }); }, onError,
  });
  const createBooking = useMutation({
    mutationFn: () => api.post('/v1/pm/crew-schedule',
      { jobId, crewId: bookingCrew, startsAt: new Date(bookingStart).toISOString(), endsAt: new Date(bookingEnd).toISOString() },
      { schema: Booking }),
    onSuccess: () => { setError(''); void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'pm', 'bookings') }); }, onError,
  });
  const createFleet = useMutation({
    mutationFn: () => api.post('/v1/pm/fleet', { name: fleetName.trim(), kind: 'vehicle' }, { schema: FleetAsset }),
    onSuccess: () => { setFleetName(''); setError(''); void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'pm', 'fleet') }); }, onError,
  });
  const checkIn = useMutation({
    mutationFn: (assetId: string) => api.post(`/v1/pm/fleet/${assetId}/check-ins`, { locationText: checkInText.trim(), jobId: jobId || null }, { schema: z.object({ id: z.string() }) }),
    onSuccess: () => { setCheckInText(''); setError(''); void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'pm', 'fleet') }); }, onError,
  });
  const createCo = useMutation({
    mutationFn: () => api.post(`/v1/jobs/${jobId}/change-orders`, {
      number: coNumber.trim(), title: coTitle.trim(), reason: coReason.trim(),
      amountDeltaMinor: Math.round(Number(coAmount || '0') * 100),
    }, { schema: ChangeOrder }),
    onSuccess: () => { setCoNumber(''); setCoTitle(''); setCoReason(''); setCoAmount(''); setError(''); refresh('change-orders'); }, onError,
  });
  const setCoStatus = useMutation({
    mutationFn: (v: { row: ChangeOrderT; status: string }) => api.patch(`/v1/change-orders/${v.row.id}/status`,
      { status: v.status, signerName: v.status === 'sent_to_customer' ? signerName.trim() : undefined },
      { schema: ChangeOrder, ifMatch: v.row.revision }),
    onSuccess: () => { setError(''); refresh('change-orders'); }, onError,
  });
  const signCo = useMutation({
    mutationFn: (row: ChangeOrderT) => api.post(`/v1/change-orders/${row.id}/sign`,
      { signerName: signerName.trim(), typedSignature: typedSignature.trim(), consent: true },
      { schema: ChangeOrder, ifMatch: row.revision }),
    onSuccess: () => { setTypedSignature(''); setError(''); refresh('change-orders'); }, onError,
  });

  const jobOptions = jobs.data?.items ?? [];
  const crewOptions = crews.data?.items ?? [];

  return (
    <div className="cc-stack" style={{ gap: '1rem' }}>
      <PageHeader title="Project Management" />
      <p className="web-muted web-small">
        RFIs, submittals, schedule, daily logs, drawings, punch lists, checklists, crews,
        fleet and change orders for one job. Weather notes and fleet locations are typed in
        by your team — no weather or GPS feed is connected.
      </p>
      {error ? <ErrorNotice error={error} /> : null}
      <label className="cc-field">
        <span>Job</span>
        <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">Choose a job…</option>
          {jobOptions.map((j) => <option key={j.id} value={j.id}>{j.number} — {j.title}</option>)}
        </select>
      </label>

      {enabled ? (
        <>
          <section className="cc-panel">
            <h3>RFIs</h3>
            <ul>
              {(rfis.data?.items ?? []).map((r) => (
                <li key={r.id}>
                  #{r.number} {r.subject} — {statusLabel(r.status)}{r.overdue ? ' (overdue)' : ''}
                  {r.officialResponse ? <> · Answer: {r.officialResponse}</> : null}
                  {canWrite ? (RFI_NEXT_UI[r.status] ?? []).map((s) => (
                    <button key={s} type="button" className="cc-btn cc-btn--sm" onClick={() => setRfiStatus.mutate({ row: r, status: s })}>{statusLabel(s)}</button>
                  )) : null}
                </li>
              ))}
            </ul>
            {canWrite ? (
              <div className="cc-grid">
                <input placeholder="RFI subject" value={rfiSubject} onChange={(e) => setRfiSubject(e.target.value)} />
                <input placeholder="Question" value={rfiQuestion} onChange={(e) => setRfiQuestion(e.target.value)} />
                <input placeholder="Official response (to answer)" value={rfiResponse} onChange={(e) => setRfiResponse(e.target.value)} />
                <button type="button" className="cc-btn" disabled={!rfiSubject.trim() || !rfiQuestion.trim()} onClick={() => createRfi.mutate()}>Add RFI</button>
              </div>
            ) : null}
          </section>

          <section className="cc-panel">
            <h3>Submittals</h3>
            <ul>
              {(submittals.data?.items ?? []).map((s) => (
                <li key={s.id}>
                  {s.number} {s.title} — {statusLabel(s.status)} (rev {s.currentRevision}){s.overdue ? ' (overdue)' : ''}
                  {canWrite ? (SUB_NEXT_UI[s.status] ?? []).map((n) => (
                    <button key={n} type="button" className="cc-btn cc-btn--sm" onClick={() => setSubStatus.mutate({ row: s, status: n })}>{statusLabel(n)}</button>
                  )) : null}
                </li>
              ))}
            </ul>
            {canWrite ? (
              <div className="cc-grid">
                <input placeholder="Number (e.g. 03 30 00-1)" value={subNumber} onChange={(e) => setSubNumber(e.target.value)} />
                <input placeholder="Title" value={subTitle} onChange={(e) => setSubTitle(e.target.value)} />
                <input placeholder="Document reference" value={subDoc} onChange={(e) => setSubDoc(e.target.value)} />
                <button type="button" className="cc-btn" disabled={!subNumber.trim() || !subTitle.trim()} onClick={() => createSubmittal.mutate()}>Add submittal</button>
              </div>
            ) : null}
          </section>

          <section className="cc-panel">
            <h3>Schedule (Gantt)</h3>
            <div role="img" aria-label="Gantt chart">
              {(schedule.data?.gantt.bars ?? []).map((b) => (
                <div key={b.id} style={{ position: 'relative', height: 22, marginBottom: 4 }} title={progressLabel(b)}>
                  <div style={{ position: 'absolute', ...barStyle(b), height: 16, background: b.dependencyConflict ? '#c0392b' : '#2f6fed', borderRadius: 3 }}>
                    <div style={{ width: `${Math.min(100, Math.max(0, b.progressPercent))}%`, height: '100%', background: 'rgba(255,255,255,0.45)', borderRadius: 3 }} />
                  </div>
                  <span style={{ position: 'relative', fontSize: 12 }}>{b.title} ({b.progressPercent}%)</span>
                </div>
              ))}
            </div>
            <ul>
              {(schedule.data?.items ?? []).map((t) => (
                <li key={t.id}>
                  {t.title} {t.startsOn} → {t.endsOn} — {statusLabel(t.status)}{t.overdue ? ' (overdue)' : ''}
                  {canSchedule ? (
                    <button type="button" className="cc-btn cc-btn--sm" onClick={() => setTaskProgress.mutate({ row: t, progressPercent: 100 })}>Mark complete</button>
                  ) : null}
                </li>
              ))}
            </ul>
            {canSchedule ? (
              <div className="cc-grid">
                <input placeholder="Task title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                <input type="date" value={taskStart} onChange={(e) => setTaskStart(e.target.value)} />
                <input type="date" value={taskEnd} onChange={(e) => setTaskEnd(e.target.value)} />
                <button type="button" className="cc-btn" disabled={!taskTitle.trim() || !taskStart || !taskEnd} onClick={() => createTask.mutate()}>Add task</button>
              </div>
            ) : null}
          </section>

          <section className="cc-panel">
            <h3>Daily logs</h3>
            <p className="web-muted web-small">{logs.data?.weatherSource ?? 'Weather is manual entry only.'}</p>
            <ul>
              {(logs.data?.items ?? []).map((l) => (
                <li key={l.id}>{l.logDate}: {l.workDone}{l.weatherNotes ? ` · Weather (manual): ${l.weatherNotes}` : ''}</li>
              ))}
            </ul>
            {canWrite ? (
              <div className="cc-grid">
                <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
                <input placeholder="Work done" value={logWork} onChange={(e) => setLogWork(e.target.value)} />
                <input placeholder="Weather (type what you saw)" value={logWeather} onChange={(e) => setLogWeather(e.target.value)} />
                <button type="button" className="cc-btn" disabled={!logDate || !logWork.trim()} onClick={() => createLog.mutate()}>Add log</button>
              </div>
            ) : null}
          </section>

          <section className="cc-panel">
            <h3>Drawings</h3>
            <ul>
              {(drawings.data?.items ?? []).map((d) => (
                <li key={d.id}>
                  {d.sheetNumber ? `${d.sheetNumber} ` : ''}{d.title} — versions:{' '}
                  {d.versions.map((v) => `v${v.versionNumber}${v.isCurrent ? ' (current)' : ''}`).join(', ')}
                </li>
              ))}
            </ul>
            {canWrite ? (
              <div className="cc-grid">
                <input placeholder="Sheet title" value={drawingTitle} onChange={(e) => setDrawingTitle(e.target.value)} />
                <input placeholder="File reference (upload key or doc ref)" value={drawingRef} onChange={(e) => setDrawingRef(e.target.value)} />
                <button type="button" className="cc-btn" disabled={!drawingTitle.trim() || !drawingRef.trim()} onClick={() => createDrawing.mutate()}>Add drawing</button>
              </div>
            ) : null}
          </section>

          <section className="cc-panel">
            <h3>Punch list</h3>
            <ul>
              {(punch.data?.items ?? []).map((p) => (
                <li key={p.id}>
                  {p.title} — {statusLabel(p.status)}{p.overdue ? ' (overdue)' : ''}
                  {canWrite ? (PUNCH_NEXT_UI[p.status] ?? []).map((n) => (
                    <button key={n} type="button" className="cc-btn cc-btn--sm" onClick={() => setPunchStatus.mutate({ row: p, status: n })}>{statusLabel(n)}</button>
                  )) : null}
                </li>
              ))}
            </ul>
            {canWrite ? (
              <div className="cc-grid">
                <input placeholder="Punch item" value={punchTitle} onChange={(e) => setPunchTitle(e.target.value)} />
                <button type="button" className="cc-btn" disabled={!punchTitle.trim()} onClick={() => createPunch.mutate()}>Add punch item</button>
              </div>
            ) : null}
          </section>

          <section className="cc-panel">
            <h3>Safety &amp; quality checklists</h3>
            <p className="web-muted web-small">Starter checklists are editable starting points only — they make no compliance claim.</p>
            {(runs.data?.items ?? []).map((run) => (
              <div key={run.id}>
                <strong>{run.title}</strong> — {statusLabel(run.status)} ({run.completion.done}/{run.completion.total} done)
                {run.signedByName ? ` · Signed by ${run.signedByName}` : ''}
                <ul>
                  {run.answers.map((a, i) => (
                    <li key={`${run.id}-${i}`}>
                      <label>
                        <input type="checkbox" checked={a.done} disabled={!canWrite || run.status === 'signed'}
                          onChange={() => toggleAnswer.mutate({ run, index: i })} /> {a.label}{a.required ? ' (required)' : ''}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {canWrite ? (
              <div>
                <button type="button" className="cc-btn" onClick={() => startRun.mutate('safety')}>Start safety starter</button>{' '}
                <button type="button" className="cc-btn" onClick={() => startRun.mutate('quality')}>Start quality starter</button>
              </div>
            ) : null}
          </section>

          <section className="cc-panel">
            <h3>Change orders</h3>
            <p className="web-muted web-small">
              Signing is a typed-name attestation recorded with a document hash. No e-sign
              provider is connected.
            </p>
            <ul>
              {(changeOrders.data?.items ?? []).map((co) => (
                <li key={co.id}>
                  {co.number} {co.title} — {money(co.amountDeltaMinor, co.currency)} — {statusLabel(co.status)}
                  {canWrite ? (CO_NEXT_UI[co.status] ?? []).map((n) => (
                    <button key={n} type="button" className="cc-btn cc-btn--sm" onClick={() => setCoStatus.mutate({ row: co, status: n })}>{statusLabel(n)}</button>
                  )) : null}
                  {canWrite && co.status === 'sent_to_customer' ? (
                    <button type="button" className="cc-btn cc-btn--sm" disabled={!typedSignature.trim()} onClick={() => signCo.mutate(co)}>Sign (typed name)</button>
                  ) : null}
                </li>
              ))}
            </ul>
            {canWrite ? (
              <div className="cc-grid">
                <input placeholder="CO number" value={coNumber} onChange={(e) => setCoNumber(e.target.value)} />
                <input placeholder="Title" value={coTitle} onChange={(e) => setCoTitle(e.target.value)} />
                <input placeholder="Reason" value={coReason} onChange={(e) => setCoReason(e.target.value)} />
                <input placeholder="Amount change (USD)" inputMode="decimal" value={coAmount} onChange={(e) => setCoAmount(e.target.value)} />
                <input placeholder="Customer signer name" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
                <input placeholder="Type the signer name to sign" value={typedSignature} onChange={(e) => setTypedSignature(e.target.value)} />
                <button type="button" className="cc-btn" disabled={!coNumber.trim() || !coTitle.trim() || !coReason.trim()} onClick={() => createCo.mutate()}>Add change order</button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      <section className="cc-panel">
        <h3>Crews &amp; bookings</h3>
        <ul>
          {crewOptions.map((c) => <li key={c.id}>{c.name} ({c.trade}) — {c.members.length} member(s)</li>)}
        </ul>
        <ul>
          {(bookings.data?.items ?? []).map((b) => (
            <li key={b.id}>{new Date(b.startsAt).toLocaleString()} → {new Date(b.endsAt).toLocaleString()} — {statusLabel(b.status)}</li>
          ))}
        </ul>
        {canCrew ? (
          <div className="cc-grid">
            <input placeholder="New crew name" value={crewName} onChange={(e) => setCrewName(e.target.value)} />
            <button type="button" className="cc-btn" disabled={!crewName.trim()} onClick={() => createCrew.mutate()}>Add crew</button>
          </div>
        ) : null}
        {canSchedule && enabled ? (
          <div className="cc-grid">
            <select value={bookingCrew} onChange={(e) => setBookingCrew(e.target.value)}>
              <option value="">Choose crew…</option>
              {crewOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="datetime-local" value={bookingStart} onChange={(e) => setBookingStart(e.target.value)} />
            <input type="datetime-local" value={bookingEnd} onChange={(e) => setBookingEnd(e.target.value)} />
            <button type="button" className="cc-btn" disabled={!bookingCrew || !bookingStart || !bookingEnd} onClick={() => createBooking.mutate()}>Book crew on this job</button>
          </div>
        ) : null}
      </section>

      <section className="cc-panel">
        <h3>Fleet (manual check-ins only)</h3>
        <p className="web-muted web-small">{fleet.data?.locationSource ?? 'Locations are manual check-ins only.'}</p>
        <ul>
          {(fleet.data?.items ?? []).map((a) => (
            <li key={a.id}>
              {a.name} ({a.kind}) — {statusLabel(a.status)}
              {a.maintenanceDue ? ' · maintenance due' : ''}
              {a.lastCheckIn ? ` · Last check-in: ${a.lastCheckIn.locationText} (${new Date(a.lastCheckIn.checkedInAt).toLocaleString()})` : ' · No check-in yet'}
              {canCrew ? <button type="button" className="cc-btn cc-btn--sm" disabled={!checkInText.trim()} onClick={() => checkIn.mutate(a.id)}>Check in here</button> : null}
            </li>
          ))}
        </ul>
        {canCrew ? (
          <div className="cc-grid">
            <input placeholder="Vehicle / equipment name" value={fleetName} onChange={(e) => setFleetName(e.target.value)} />
            <button type="button" className="cc-btn" disabled={!fleetName.trim()} onClick={() => createFleet.mutate()}>Add asset</button>
            <input placeholder="Check-in location (type it)" value={checkInText} onChange={(e) => setCheckInText(e.target.value)} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
