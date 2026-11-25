'use client';

import {
  EnterpriseSchedulePreview,
  EnterpriseScheduleSnapshot,
  EnterpriseScheduleTaskInput,
  type EnterpriseScheduleTask,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { EnterpriseScheduleTemplates } from './EnterpriseScheduleTemplates';

const savedItem = z.object({ id: z.uuid() });

function taskInput(form: HTMLFormElement) {
  const data = new FormData(form);
  return EnterpriseScheduleTaskInput.parse({
    title: data.get('title'),
    phase: data.get('phase'),
    startsOn: data.get('startsOn'),
    endsOn: data.get('endsOn'),
    predecessorId: data.get('predecessorId') || null,
    lagDays: Number(data.get('lagDays')),
    progressPercent: Number(data.get('progressPercent')),
  });
}

function message(error: unknown) {
  if (isApiError(error)) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Check the task fields.';
  return errorHint(error);
}

export function EnterpriseSchedule({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const [baselineId, setBaselineId] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const key = [...orgKey(session.orgId, 'enterprise'), 'schedule', projectId];
  const path = '/v1/enterprise/projects/' + encodeURIComponent(projectId) + '/schedule';
  const schedule = useQuery({
    queryKey: [...key, baselineId],
    queryFn: () =>
      api.get(path + (baselineId ? '?baselineId=' + encodeURIComponent(baselineId) : ''), {
        schema: EnterpriseScheduleSnapshot,
      }),
  });
  const baselineRequest = useRef<{ label: string; id: string } | null>(null);
  const baseline = useMutation({
    mutationFn: (body: { label: string; clientRequestId: string }) =>
      api.post(path + '/baselines', body, { schema: savedItem }),
    onSuccess: async (result) => {
      baselineRequest.current = null;
      setBaselineId(result.id);
      await client.invalidateQueries({ queryKey: key });
    },
  });

  async function saveBaseline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const label = String(new FormData(form).get('label') ?? '').trim();
    if (baselineRequest.current?.label !== label)
      baselineRequest.current = { label, id: crypto.randomUUID() };
    try {
      await baseline.mutateAsync({ label, clientRequestId: baselineRequest.current.id });
      form.reset();
    } catch {
      // Preserve the label and request ID for retry.
    }
  }

  const data = schedule.data;
  const selected = data?.items.find((task) => task.id === editId);
  const canEdit = session.can('job:write');
  const invalidate = () => client.invalidateQueries({ queryKey: key });

  return (
    <section className="enterprise-panel">
      <header className="enterprise-control-head">
        <div>
          <h2>Construction schedule</h2>
          <p>
            Tasks use calendar days. A successor can start the day after its predecessor finishes,
            plus any lag.
          </p>
        </div>
        {canEdit && data && !createOpen && (
          <button
            type="button"
            onClick={() => {
              setEditId(null);
              setCreateOpen(true);
            }}
          >
            Add task
          </button>
        )}
      </header>
      {schedule.isPending && <p role="status">Loading schedule…</p>}
      {schedule.isError && (
        <p role="alert" className="enterprise-error">
          {message(schedule.error)}
        </p>
      )}
      {data && (
        <>
          {data.items.length === 0 && (
            <p className="enterprise-empty">This project has no scheduled tasks.</p>
          )}
          {createOpen && (
            <ScheduleTaskForm
              key="new"
              path={path}
              items={data.items}
              onSaved={async () => {
                setCreateOpen(false);
                await invalidate();
              }}
              onCancel={() => setCreateOpen(false)}
            />
          )}
          {selected && (
            <ScheduleTaskForm
              key={selected.id + ':' + selected.revision}
              path={path}
              items={data.items}
              task={selected}
              onSaved={async () => {
                setEditId(null);
                await invalidate();
              }}
              onCancel={() => setEditId(null)}
            />
          )}
          <EnterpriseScheduleTemplates
            path={path}
            taskCount={data.items.length}
            onApplied={invalidate}
          />
          {data.items.length > 0 && (
            <>
              <div className="enterprise-schedule-baseline">
                {session.can('org:settings_update') && (
                  <form className="enterprise-form" onSubmit={(event) => void saveBaseline(event)}>
                    <label>
                      Baseline name <input name="label" required minLength={2} maxLength={160} />
                    </label>
                    <button type="submit" disabled={baseline.isPending}>
                      {baseline.isPending ? 'Saving…' : 'Save current forecast as baseline'}
                    </button>
                  </form>
                )}
                <label className="enterprise-response">
                  Compare baseline
                  <select
                    value={baselineId}
                    onChange={(event) => setBaselineId(event.target.value)}
                  >
                    <option value="">Most recent baseline</option>
                    {data.baselines.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label} · {item.createdAt.slice(0, 10)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {baseline.isError && (
                <p role="alert" className="enterprise-error">
                  {message(baseline.error)}
                </p>
              )}
              {baseline.isSuccess && (
                <p role="status" className="enterprise-success">
                  Baseline saved.
                </p>
              )}
              <div className="enterprise-schedule-extent">
                <span>Forecast starts {data.chartStart}</span>
                <span>Forecast finishes {data.chartEnd}</span>
              </div>
              <ul className="enterprise-schedule-list">
                {data.items.map((task) => (
                  <li key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <p>
                        {task.phase} · {task.progressPercent}% complete
                      </p>
                      {task.predecessorId && (
                        <p>
                          After {data.items.find((item) => item.id === task.predecessorId)?.title}
                          {task.lagDays > 0 && ` + ${task.lagDays} days`}
                        </p>
                      )}
                    </div>
                    <div>
                      <p>
                        Planned {task.startsOn} to {task.endsOn}
                      </p>
                      <p>
                        Forecast {task.forecastStartOn} to {task.forecastEndOn}
                      </p>
                      <div className="enterprise-schedule-track" aria-hidden="true">
                        <span
                          style={{ left: task.leftPercent + '%', width: task.widthPercent + '%' }}
                        />
                      </div>
                      {task.varianceDays !== null && (
                        <p>
                          Baseline finish {task.baselineEndOn} ·{' '}
                          {task.varianceDays === 0
                            ? 'on baseline'
                            : `${Math.abs(task.varianceDays)} days ${task.varianceDays > 0 ? 'later' : 'earlier'}`}
                        </p>
                      )}
                      {task.actualStartOn && (
                        <p>
                          Actual start {task.actualStartOn}
                          {task.actualFinishOn && ' · finish ' + task.actualFinishOn}
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={'Edit ' + task.title}
                        onClick={() => {
                          setCreateOpen(false);
                          setEditId(task.id);
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function ScheduleTaskForm({
  path,
  task,
  items,
  onSaved,
  onCancel,
}: {
  path: string;
  task?: EnterpriseScheduleTask;
  items: EnterpriseScheduleTask[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const { api } = useApi();
  const [impact, setImpact] = useState<{
    plan: EnterpriseSchedulePreview;
    draft: EnterpriseScheduleTaskInput;
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      const draft = taskInput(form);
      if (!task) {
        const signature = JSON.stringify(draft);
        if (request.current?.signature !== signature)
          request.current = { signature, id: crypto.randomUUID() };
        await api.post(path + '/tasks', { ...draft, clientRequestId: request.current.id });
        await onSaved();
        return;
      }
      const route = path + '/tasks/' + task.id;
      if (!impact || JSON.stringify(draft) !== JSON.stringify(impact.draft)) {
        const plan = await api.post(route + '/preview', draft, {
          ifMatch: task.revision,
          schema: EnterpriseSchedulePreview,
        });
        setImpact({ plan, draft });
        return;
      }
      const reason = String(new FormData(form).get('reason') ?? '').trim();
      await api.patch(
        route,
        { task: impact.draft, previewToken: impact.plan.token, reason },
        { ifMatch: task.revision },
      );
      await onSaved();
    } catch (cause) {
      setError(message(cause));
      if (isApiError(cause) && (cause.status === 409 || cause.status === 412)) setImpact(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="enterprise-form enterprise-task-form"
      onChange={(event) => {
        if (!(event.target instanceof HTMLInputElement && event.target.name === 'reason'))
          setImpact(null);
      }}
      onSubmit={(event) => void submit(event)}
    >
      <h3>{task ? 'Edit ' + task.title : 'New task'}</h3>
      <label>
        Task name{' '}
        <input name="title" required minLength={2} maxLength={180} defaultValue={task?.title} />
      </label>
      <label>
        Phase <input name="phase" required maxLength={80} defaultValue={task?.phase} />
      </label>
      <label>
        Planned start <input name="startsOn" type="date" required defaultValue={task?.startsOn} />
      </label>
      <label>
        Planned finish <input name="endsOn" type="date" required defaultValue={task?.endsOn} />
      </label>
      <label>
        Predecessor
        <select name="predecessorId" defaultValue={task?.predecessorId ?? ''}>
          <option value="">None</option>
          {items
            .filter((item) => item.id !== task?.id)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
        </select>
      </label>
      <label>
        Lag in days{' '}
        <input
          name="lagDays"
          type="number"
          min={0}
          max={365}
          required
          defaultValue={task?.lagDays ?? 0}
        />
      </label>
      <label>
        Progress (%){' '}
        <input
          name="progressPercent"
          type="number"
          min={0}
          max={100}
          required
          defaultValue={task?.progressPercent ?? 0}
        />
      </label>
      {impact && (
        <div className="enterprise-schedule-impact" role="status">
          <h4>Schedule impact</h4>
          {impact.plan.affected.length ? (
            <ul>
              {impact.plan.affected.map((item) => (
                <li key={item.id}>
                  {item.title}: {item.beforeStartOn}–{item.beforeEndOn} → {item.afterStartOn}–
                  {item.afterEndOn}
                </li>
              ))}
            </ul>
          ) : (
            <p>Forecast dates stay the same.</p>
          )}
          <label>
            Change reason <input name="reason" required minLength={3} maxLength={500} />
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      <div className="enterprise-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Working…' : task ? (impact ? 'Apply changes' : 'Preview impact') : 'Save task'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
