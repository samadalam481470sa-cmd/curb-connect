'use client';

// Critical-path panel (blueprint gap 1): CPM float + critical path for the
// selected job's schedule, a simulate-move flow (downstream impact before
// committing), dependency links, and schedule baselines with variance.
// Computed dates are estimates derived from the entered task dates — labeled
// as such; nothing here writes task dates except the explicit dependency and
// baseline actions.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const Dep = z.object({
  id: z.string(),
  jobId: z.string(),
  predecessorTaskId: z.string(),
  successorTaskId: z.string(),
  lagDays: z.number(),
  createdAt: z.string(),
});
const CpmTask = z.object({
  id: z.string(),
  title: z.string(),
  durationDays: z.number(),
  enteredStartsOn: z.string(),
  enteredEndsOn: z.string(),
  earliestStart: z.string(),
  earliestFinish: z.string(),
  latestStart: z.string(),
  latestFinish: z.string(),
  floatDays: z.number(),
  critical: z.boolean(),
});
const CriticalPath = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    projectStart: z.string(),
    projectEnd: z.string(),
    projectDurationDays: z.number(),
    tasks: z.array(CpmTask),
    criticalPath: z.array(z.string()),
    dependencies: z.array(Dep),
  }),
  z.object({ ok: z.literal(false), reason: z.literal('cycle'), cycleTaskIds: z.array(z.string()) }),
  z.object({ ok: z.literal(false), reason: z.literal('empty') }),
]);
const SimChange = z.object({
  id: z.string(),
  title: z.string(),
  beforeStartsOn: z.string(),
  beforeEndsOn: z.string(),
  afterStartsOn: z.string(),
  afterEndsOn: z.string(),
  shiftDays: z.number(),
});
const Simulate = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    changes: z.array(SimChange),
    projectEndBefore: z.string(),
    projectEndAfter: z.string(),
    projectEndShiftDays: z.number(),
    criticalPathAfter: z.array(z.string()),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
const Baseline = z.object({
  id: z.string(),
  jobId: z.string(),
  name: z.string(),
  note: z.string().nullable(),
  capturedAt: z.string(),
  taskCount: z.number(),
});
const Compare = z.object({
  baseline: Baseline,
  rows: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      baselineStartsOn: z.string().nullable(),
      baselineEndsOn: z.string().nullable(),
      currentStartsOn: z.string().nullable(),
      currentEndsOn: z.string().nullable(),
      startVarianceDays: z.number().nullable(),
      finishVarianceDays: z.number().nullable(),
      state: z.string(),
    }),
  ),
});

export function CriticalPathPanel({ jobId, canSchedule }: { jobId: string; canSchedule: boolean }) {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [simTask, setSimTask] = useState('');
  const [simStart, setSimStart] = useState('');
  const [simEnd, setSimEnd] = useState('');
  const [depPred, setDepPred] = useState('');
  const [depSucc, setDepSucc] = useState('');
  const [depLag, setDepLag] = useState('0');
  const [baselineName, setBaselineName] = useState('');
  const [compareId, setCompareId] = useState('');

  const key = (name: string) => orgKey(session.orgId, 'pm', jobId || 'none', name);
  const enabled = jobId.length > 0;
  const cp = useQuery({
    queryKey: key('critical-path'),
    enabled,
    queryFn: () => api.get(`/v1/pm/jobs/${jobId}/schedule/critical-path`, { schema: CriticalPath }),
  });
  const baselines = useQuery({
    queryKey: key('baselines'),
    enabled,
    queryFn: () => api.get(`/v1/pm/jobs/${jobId}/schedule/baselines`, { schema: z.object({ items: z.array(Baseline) }) }),
  });
  const compare = useQuery({
    queryKey: [...key('baseline-compare'), compareId],
    enabled: enabled && compareId.length > 0,
    queryFn: () => api.get(`/v1/pm/jobs/${jobId}/schedule/baselines/${compareId}/compare`, { schema: Compare }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key('critical-path') });
    void queryClient.invalidateQueries({ queryKey: key('baselines') });
    void queryClient.invalidateQueries({ queryKey: key('baseline-compare') });
  };
  const onError = (cause: unknown) => setError(errorHint(cause));

  const simulate = useMutation({
    mutationFn: () =>
      api.post(`/v1/pm/jobs/${jobId}/schedule/simulate-move`, { taskId: simTask, startsOn: simStart, endsOn: simEnd }, { schema: Simulate }),
    onSuccess: () => setError(''),
    onError,
  });
  const addDep = useMutation({
    mutationFn: () =>
      api.post(`/v1/pm/jobs/${jobId}/schedule/dependencies`, { predecessorTaskId: depPred, successorTaskId: depSucc, lagDays: Number(depLag) || 0 }, { schema: Dep }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });
  const removeDep = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/pm/schedule/dependencies/${id}`, { schema: Dep }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });
  const captureBaseline = useMutation({
    mutationFn: () => api.post(`/v1/pm/jobs/${jobId}/schedule/baselines`, { name: baselineName.trim() }, { schema: Baseline }),
    onSuccess: () => { setBaselineName(''); setError(''); refresh(); },
    onError,
  });

  const data = cp.data;
  const taskOptions = data?.ok ? data.tasks : [];
  const titleById = new Map(taskOptions.map((t) => [t.id, t.title]));

  return (
    <section className="cc-panel">
      <h3>Critical path &amp; baselines</h3>
      <p className="web-muted web-small">
        Computed from the entered task dates and dependency links. Earliest/latest dates and float are
        planning estimates, not commitments. A task with 0 float is critical — slipping it slips the job.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {cp.isLoading ? <p>Loading…</p> : null}
      {data && !data.ok && data.reason === 'empty' ? <p>No schedule tasks yet — add tasks above to compute the critical path.</p> : null}
      {data && !data.ok && data.reason === 'cycle' ? (
        <p role="alert">The schedule has a dependency cycle involving {data.cycleTaskIds.length} task(s). Remove a link to compute the critical path.</p>
      ) : null}
      {data?.ok ? (
        <>
          <p>
            Project window (estimate): <strong>{data.projectStart} → {data.projectEnd}</strong> ({data.projectDurationDays} days).
            Critical path: {data.criticalPath.map((id) => titleById.get(id) ?? id).join(' → ') || '—'}
          </p>
          <ul>
            {data.tasks.map((t) => (
              <li key={t.id}>
                {t.critical ? <strong>[critical] </strong> : null}
                {t.title}: entered {t.enteredStartsOn} → {t.enteredEndsOn}; earliest {t.earliestStart} → {t.earliestFinish};
                float {t.floatDays} day{t.floatDays === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
          <h4>Dependency links</h4>
          <ul>
            {data.dependencies.map((d) => (
              <li key={d.id}>
                {titleById.get(d.predecessorTaskId) ?? d.predecessorTaskId} → {titleById.get(d.successorTaskId) ?? d.successorTaskId}
                {d.lagDays > 0 ? ` (+${d.lagDays}d lag)` : ''}
                {canSchedule ? (
                  <button type="button" className="cc-btn cc-btn--sm" onClick={() => removeDep.mutate(d.id)}>Remove</button>
                ) : null}
              </li>
            ))}
            {data.dependencies.length === 0 ? <li>No extra links — only each task’s single predecessor counts.</li> : null}
          </ul>
          {canSchedule ? (
            <div className="cc-grid">
              <select aria-label="Predecessor task" value={depPred} onChange={(e) => setDepPred(e.target.value)}>
                <option value="">Predecessor…</option>
                {taskOptions.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <select aria-label="Successor task" value={depSucc} onChange={(e) => setDepSucc(e.target.value)}>
                <option value="">Successor…</option>
                {taskOptions.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <input aria-label="Lag days" inputMode="numeric" placeholder="Lag days" value={depLag} onChange={(e) => setDepLag(e.target.value)} />
              <button type="button" className="cc-btn" disabled={!depPred || !depSucc || depPred === depSucc} onClick={() => addDep.mutate()}>Add dependency</button>
            </div>
          ) : null}

          <h4>Simulate a move (nothing is saved)</h4>
          <div className="cc-grid">
            <select aria-label="Task to move" value={simTask} onChange={(e) => setSimTask(e.target.value)}>
              <option value="">Task…</option>
              {taskOptions.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <input type="date" aria-label="New start date" value={simStart} onChange={(e) => setSimStart(e.target.value)} />
            <input type="date" aria-label="New end date" value={simEnd} onChange={(e) => setSimEnd(e.target.value)} />
            <button type="button" className="cc-btn" disabled={!simTask || !simStart || !simEnd} onClick={() => simulate.mutate()}>Simulate</button>
          </div>
          {simulate.data?.ok ? (
            <div>
              <p>
                Project end: {simulate.data.projectEndBefore} → {simulate.data.projectEndAfter}
                {simulate.data.projectEndShiftDays !== 0 ? ` (${simulate.data.projectEndShiftDays > 0 ? '+' : ''}${simulate.data.projectEndShiftDays} days)` : ' (unchanged)'}
              </p>
              <ul>
                {simulate.data.changes.map((c) => (
                  <li key={c.id}>{c.title}: {c.beforeStartsOn} → {c.afterStartsOn} ({c.shiftDays > 0 ? '+' : ''}{c.shiftDays}d)</li>
                ))}
                {simulate.data.changes.length === 0 ? <li>No downstream tasks move.</li> : null}
              </ul>
            </div>
          ) : null}
          {simulate.data && !simulate.data.ok ? <p role="alert">Simulation unavailable: {simulate.data.reason}.</p> : null}
        </>
      ) : null}

      <h4>Baselines</h4>
      <ul>
        {(baselines.data?.items ?? []).map((b) => (
          <li key={b.id}>
            {b.name} — captured {b.capturedAt.slice(0, 10)} ({b.taskCount} tasks)
            <button type="button" className="cc-btn cc-btn--sm" onClick={() => setCompareId(b.id)}>Compare</button>
          </li>
        ))}
        {(baselines.data?.items ?? []).length === 0 ? <li>No baselines yet.</li> : null}
      </ul>
      {canSchedule ? (
        <div className="cc-grid">
          <input aria-label="Baseline name" placeholder="Baseline name (e.g. Contract baseline)" value={baselineName} onChange={(e) => setBaselineName(e.target.value)} />
          <button type="button" className="cc-btn" disabled={!baselineName.trim()} onClick={() => captureBaseline.mutate()}>Capture baseline</button>
        </div>
      ) : null}
      {compare.data ? (
        <ul>
          {compare.data.rows.map((r) => (
            <li key={r.taskId}>
              {r.title}: {r.state}
              {r.finishVarianceDays !== null ? ` — finish ${r.finishVarianceDays > 0 ? '+' : ''}${r.finishVarianceDays}d vs baseline` : ''}
              {r.baselineEndsOn ? ` (baseline ends ${r.baselineEndsOn}` : ''}
              {r.currentEndsOn ? `${r.baselineEndsOn ? ', ' : ' ('}current ends ${r.currentEndsOn})` : r.baselineEndsOn ? ')' : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
