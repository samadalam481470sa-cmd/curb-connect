'use client';

import {
  EnterpriseDailyLog,
  EnterpriseDailyLogInput,
  EnterpriseDailyLogPage,
  EnterpriseDailyLogStatus,
  EnterpriseScheduleSnapshot,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Status = z.infer<typeof EnterpriseDailyLogStatus>;
const labels: Record<Status, string> = {
  draft: 'Draft',
  submitted: 'Submitted for review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
};

function editAllowed(log: EnterpriseDailyLog) {
  return log.status === 'draft' || log.status === 'changes_requested';
}

function message(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Check the report fields.';
  return errorHint(error);
}

export function EnterpriseDailyLogs({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const prefix = orgKey(session.orgId, 'enterprise');
  const key = [...prefix, 'daily-logs', projectId];
  const projectPath = '/v1/enterprise/projects/' + encodeURIComponent(projectId);
  const path = projectPath + '/daily-logs';
  const [status, setStatus] = useState<Status | ''>('');
  const [date, setDate] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const canWrite = session.can('job:write');
  const canReview = session.can('review_task:decide');
  const reports = useInfiniteQuery({
    queryKey: [...key, status, date],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, {
        query: { cursor: pageParam, status: status || undefined, workDate: date || undefined },
        schema: EnterpriseDailyLogPage,
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const items = reports.data?.pages.flatMap((page) => page.items) ?? [];
  const current = items.find((row) => row.id === editing);
  const schedule = useQuery({
    queryKey: [...prefix, 'schedule', projectId, ''],
    queryFn: () => api.get(projectPath + '/schedule', { schema: EnterpriseScheduleSnapshot }),
    enabled: editing !== null || items.some((row) => row.scheduleTaskId),
  });
  const tasks = schedule.data?.items ?? [];
  const invalidate = () => client.invalidateQueries({ queryKey: key });

  return (
    <section className="enterprise-panel">
      <header className="enterprise-control-head">
        <div>
          <h2>Daily site reports</h2>
          <p>Track crew hours, work performed, safety notes, and delays by project work date.</p>
        </div>
        {canWrite && editing !== 'new' && (
          <button type="button" onClick={() => setEditing('new')}>
            New daily report
          </button>
        )}
      </header>
      {(editing === 'new' || current) && (
        <ReportForm
          key={current?.id + ':' + current?.revision}
          path={path}
          taskOptions={tasks}
          log={current}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await invalidate();
          }}
        />
      )}
      <div className="enterprise-schedule-baseline">
        <label className="enterprise-response">
          Report date
          <input
            type="date"
            value={date}
            onChange={(event) => {
              setEditing(null);
              setDate(event.target.value);
            }}
          />
        </label>
        <label className="enterprise-response">
          Report status
          <select
            value={status}
            onChange={(event) => {
              setEditing(null);
              setStatus(EnterpriseDailyLogStatus.safeParse(event.target.value).data ?? '');
            }}
          >
            <option value="">All statuses</option>
            {EnterpriseDailyLogStatus.options.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {reports.isPending && <p role="status">Loading daily site reports…</p>}
      {reports.isError && (
        <p role="alert" className="enterprise-error">
          {message(reports.error)}
        </p>
      )}
      {reports.isSuccess && !items.length && (
        <p className="enterprise-empty">No reports match this view.</p>
      )}
      <ul className="enterprise-change-history">
        {items.map((log) => (
          <li key={log.id}>
            <strong>
              <time dateTime={log.workDate}>{log.workDate}</time> · {labels[log.status]} · Revision{' '}
              {log.revision}
            </strong>
            <span>
              {log.crewCount} crew · {Number((log.laborMinutes / 60).toFixed(2))} labor hours
              {log.weather && ' · ' + log.weather}
            </span>
            {log.scheduleTaskId && (
              <span>
                Schedule task:{' '}
                {tasks.find((task) => task.id === log.scheduleTaskId)?.title ?? log.scheduleTaskId}
              </span>
            )}
            <p>{log.workPerformed}</p>
            {log.safetyAndDelays && <p>Safety and delays: {log.safetyAndDelays}</p>}
            {log.reviewNote && <p>Last review: {log.reviewNote}</p>}
            <ReportActions
              log={log}
              path={path + '/' + log.id}
              write={canWrite}
              review={canReview}
              onChanged={invalidate}
              onEdit={() => setEditing(log.id)}
            />
          </li>
        ))}
      </ul>
      {reports.hasNextPage && (
        <button
          type="button"
          disabled={reports.isFetchingNextPage}
          onClick={() => void reports.fetchNextPage()}
        >
          Load more reports
        </button>
      )}
    </section>
  );
}

function ReportForm({
  path,
  taskOptions,
  log,
  onCancel,
  onSaved,
}: {
  path: string;
  taskOptions: { id: string; title: string }[];
  log?: EnterpriseDailyLog;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api } = useApi();
  const request = useRef<{ signature: string; id: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      const body = EnterpriseDailyLogInput.parse({
        workDate: data.get('workDate'),
        weather: data.get('weather'),
        crewCount: Number(data.get('crewCount')),
        laborMinutes: Math.round(Number(data.get('laborHours')) * 60),
        workPerformed: data.get('workPerformed'),
        safetyAndDelays: data.get('safetyAndDelays'),
        scheduleTaskId: data.get('scheduleTaskId') || null,
      });
      if (log) {
        await api.put(path + '/' + log.id, body, {
          ifMatch: log.revision,
          schema: EnterpriseDailyLog,
        });
      } else {
        const signature = JSON.stringify(body);
        if (request.current?.signature !== signature)
          request.current = { id: crypto.randomUUID(), signature };
        await api.post(
          path,
          { ...body, clientRequestId: request.current.id },
          { schema: EnterpriseDailyLog },
        );
      }
      await onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="enterprise-form enterprise-task-form" onSubmit={(event) => void submit(event)}>
      <h3>{log ? 'Edit daily report' : 'New daily report'}</h3>
      <label>
        Work date{' '}
        <input type="date" name="workDate" required readOnly={!!log} defaultValue={log?.workDate} />
      </label>
      <label>
        Weather <input name="weather" maxLength={250} defaultValue={log?.weather} />
      </label>
      <label>
        Crew size{' '}
        <input
          type="number"
          name="crewCount"
          min={0}
          max={1000}
          required
          defaultValue={log?.crewCount ?? 0}
        />
      </label>
      <label>
        Total labor hours{' '}
        <input
          type="number"
          name="laborHours"
          min={0}
          max={24000}
          step="any"
          required
          defaultValue={log ? Number((log.laborMinutes / 60).toFixed(4)) : 0}
        />
      </label>
      <label>
        Related schedule task
        <select name="scheduleTaskId" defaultValue={log?.scheduleTaskId ?? ''}>
          <option value="">None</option>
          {log?.scheduleTaskId && !taskOptions.some((task) => task.id === log.scheduleTaskId) && (
            <option value={log.scheduleTaskId}>Current linked task</option>
          )}
          {taskOptions.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Work performed{' '}
        <textarea
          name="workPerformed"
          required
          minLength={3}
          maxLength={6000}
          defaultValue={log?.workPerformed}
        />
      </label>
      <label>
        Safety and delays{' '}
        <textarea name="safetyAndDelays" maxLength={6000} defaultValue={log?.safetyAndDelays} />
      </label>
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      <div className="enterprise-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ReportActions({
  log,
  path,
  write,
  review,
  onChanged,
  onEdit,
}: {
  log: EnterpriseDailyLog;
  path: string;
  write: boolean;
  review: boolean;
  onChanged: () => Promise<void>;
  onEdit: () => void;
}) {
  const { api } = useApi();
  const decide = useMutation({
    mutationFn: (
      data: { action: 'submit' } | { action: 'review'; decision: string; note: string },
    ) => {
      const { action, ...body } = data;
      return api.post(path + '/' + action, body, {
        ifMatch: log.revision,
        schema: EnterpriseDailyLog,
      });
    },
    onSuccess: onChanged,
  });
  return (
    <>
      {write && editAllowed(log) && (
        <div className="enterprise-actions">
          <button type="button" disabled={decide.isPending} onClick={onEdit}>
            Edit report
          </button>
          <button
            type="button"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ action: 'submit' })}
          >
            Submit report
          </button>
        </div>
      )}
      {review && log.status === 'submitted' && (
        <form
          className="enterprise-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            decide.mutate({
              action: 'review',
              decision: String(data.get('decision')),
              note: String(data.get('note')),
            });
          }}
        >
          <label>
            Report decision
            <select name="decision">
              <option value="approved">Approve</option>
              <option value="changes_requested">Request changes</option>
            </select>
          </label>
          <label>
            Report review note <input name="note" required minLength={3} maxLength={1000} />
          </label>
          <button type="submit" disabled={decide.isPending}>
            Record report decision
          </button>
        </form>
      )}
      {decide.isError && (
        <p role="alert" className="enterprise-error">
          {message(decide.error)}
        </p>
      )}
    </>
  );
}
