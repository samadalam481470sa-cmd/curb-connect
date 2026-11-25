'use client';

import {
  EnterpriseScheduleTemplatePlacement,
  EnterpriseScheduleTemplatePreview,
  EnterpriseScheduleTemplates as TemplatesPage,
} from '@fieldline/contracts';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

function message(error: unknown) {
  if (isApiError(error)) return error.message;
  if (error instanceof z.ZodError)
    return error.issues[0]?.message ?? 'Check the template and start date.';
  return errorHint(error);
}

export function EnterpriseScheduleTemplates({
  path,
  taskCount,
  onApplied,
}: {
  path: string;
  taskCount: number;
  onApplied: () => Promise<void>;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'schedule-templates'];
  const [busy, setBusy] = useState<'save' | 'apply' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{
    data: EnterpriseScheduleTemplatePreview;
    templateId: string;
    startsOn: string;
    clientRequestId: string;
  } | null>(null);
  const saveRequest = useRef<{ id: string; label: string } | null>(null);
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get('/v1/enterprise/schedule/templates', {
        query: { cursor: pageParam },
        schema: TemplatesPage,
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const templates = list.data?.pages.flatMap((page) => page.items) ?? [];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy('save');
    setNotice('');
    setError('');
    try {
      const label = String(new FormData(form).get('label') ?? '').trim();
      if (saveRequest.current?.label !== label)
        saveRequest.current = { label, id: crypto.randomUUID() };
      await api.post(path + '/templates', { label, clientRequestId: saveRequest.current.id });
      form.reset();
      saveRequest.current = null;
      await client.invalidateQueries({ queryKey: key });
      setNotice('Template saved for this company.');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('apply');
    setNotice('');
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      const placement = EnterpriseScheduleTemplatePlacement.parse({
        templateId: form.get('templateId'),
        startsOn: form.get('startsOn'),
      });
      if (
        !preview ||
        preview.templateId !== placement.templateId ||
        preview.startsOn !== placement.startsOn
      ) {
        const data = await api.post(path + '/templates/preview', placement, {
          schema: EnterpriseScheduleTemplatePreview,
        });
        setPreview({ ...placement, data, clientRequestId: crypto.randomUUID() });
        return;
      }
      const result = await api.post(
        path + '/templates/apply',
        {
          ...placement,
          clientRequestId: preview.clientRequestId,
          previewToken: preview.data.token,
        },
        { schema: z.object({ id: z.uuid(), taskCount: z.number().int() }) },
      );
      setPreview(null);
      await onApplied();
      setNotice(`${result.taskCount} tasks added to this schedule.`);
    } catch (cause) {
      setError(message(cause));
      if (isApiError(cause) && cause.status === 409) setPreview(null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="enterprise-template-panel">
      <summary>Schedule templates</summary>
      {taskCount > 0 && session.can('org:settings_update') && (
        <form className="enterprise-form" onSubmit={(event) => void save(event)}>
          <label>
            New template name <input name="label" required minLength={2} maxLength={160} />
          </label>
          <button type="submit" disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save these tasks as a template'}
          </button>
        </form>
      )}
      {list.isPending && <p role="status">Loading templates…</p>}
      {list.isError && (
        <p role="alert" className="enterprise-error">
          {message(list.error)}
        </p>
      )}
      {list.isSuccess && !templates.length && <p>No schedule templates have been saved.</p>}
      {!!templates.length && session.can('job:write') && (
        <form
          className="enterprise-form"
          onChange={() => setPreview(null)}
          onSubmit={(event) => void apply(event)}
        >
          <label>
            Company template
            <select name="templateId" defaultValue="" required>
              <option value="">Select a template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label} · {template.taskCount} tasks
                </option>
              ))}
            </select>
          </label>
          <label>
            Template start date <input name="startsOn" type="date" required />
          </label>
          {list.hasNextPage && (
            <button
              type="button"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Load more templates
            </button>
          )}
          {preview && (
            <div className="enterprise-schedule-impact" role="status">
              <p>{preview.data.items.length} new tasks. Their progress starts at zero.</p>
              <ul>
                {preview.data.items.map((task) => (
                  <li key={task.key}>
                    {task.title} · {task.startOn} to {task.endOn}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="submit" disabled={busy !== null}>
            {busy === 'apply'
              ? 'Working…'
              : preview
                ? 'Add template tasks'
                : 'Preview template dates'}
          </button>
        </form>
      )}
      {notice && (
        <p role="status" className="enterprise-success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
    </details>
  );
}
