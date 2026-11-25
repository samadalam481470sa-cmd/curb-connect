'use client';

import {
  EnterpriseScheduleSnapshot,
  type JobsiteMediaEvidenceType,
  JobsiteMediaTaskLinkList,
  JobsiteMediaTaskLinkResult,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

export function JobsiteMediaTaskLinks({
  projectId,
  assetId,
  canLink,
}: {
  projectId: string;
  assetId: string;
  canLink: boolean;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [evidence, setEvidence] = useState(false);
  const [notice, setNotice] = useState('');
  const request = useRef<{ signature: string; id: string } | null>(null);
  const project = '/v1/enterprise/projects/' + projectId;
  const path = project + '/media/' + assetId + '/task-links';
  const key = orgKey(session.orgId, 'enterprise', 'media-task-links', projectId, assetId);
  const links = useQuery({
    queryKey: key,
    queryFn: () => api.get(path, { schema: JobsiteMediaTaskLinkList }),
    enabled: open,
  });
  const tasks = useQuery({
    queryKey: orgKey(session.orgId, 'enterprise', 'media-link-schedule', projectId),
    queryFn: () => api.get(project + '/schedule', { schema: EnterpriseScheduleSnapshot }),
    enabled: open && canLink,
  });

  const add = useMutation({
    mutationFn: ({
      revision,
      selectedTask,
      evidenceType,
    }: {
      revision: number;
      selectedTask: string;
      evidenceType: JobsiteMediaEvidenceType;
    }) => {
      const signature = JSON.stringify({ selectedTask, evidenceType, revision });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      return api.post(
        path,
        { taskId: selectedTask, evidenceType, clientRequestId: request.current.id },
        { ifMatch: revision, schema: JobsiteMediaTaskLinkResult },
      );
    },
    onSuccess: ({ link, revision }) => {
      client.setQueryData(key, (previous: typeof links.data) => ({
        revision,
        items: [...(previous?.items ?? []).filter((item) => item.id !== link.id), link].sort(
          (left, right) => left.revision - right.revision,
        ),
      }));
      setNotice('Linked to ' + link.taskTitle + '.');
      setTaskId('');
      setEvidence(false);
      request.current = null;
      void client.invalidateQueries({ queryKey: key, exact: true });
    },
    onError: (error) => {
      if (isApiError(error) && error.is('precondition_failed')) void links.refetch();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskId || !links.data || add.isPending) return;
    setNotice('');
    add.mutate({
      revision: links.data.revision,
      selectedTask: taskId,
      evidenceType: evidence ? 'completion_evidence' : 'reference',
    });
  }

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Linked tasks</summary>
      {open && (
        <>
          {links.isPending && <p role="status">Loading linked tasks…</p>}
          {links.isError && (
            <div role="alert">
              <p>{errorHint(links.error)}</p>
              <button type="button" onClick={() => void links.refetch()}>
                Retry linked tasks
              </button>
            </div>
          )}
          {links.data?.items.length === 0 && <p>This media has no linked tasks.</p>}
          {!!links.data?.items.length && (
            <ul aria-label="Linked schedule tasks" className="enterprise-change-history">
              {links.data.items.map((link) => (
                <li key={link.id}>
                  <strong>{link.taskTitle}</strong>
                  <span>
                    {link.evidenceType === 'completion_evidence'
                      ? 'Completion evidence'
                      : 'Reference'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canLink && tasks.isPending && <p role="status">Loading project schedule…</p>}
          {canLink && tasks.isError && (
            <div role="alert">
              <p>{errorHint(tasks.error)}</p>
              <button type="button" onClick={() => void tasks.refetch()}>
                Retry project schedule
              </button>
            </div>
          )}
          {canLink && tasks.data?.items.length === 0 && (
            <p>Add a task to the project schedule to link it here.</p>
          )}
          {canLink && !!tasks.data?.items.length && (
            <form aria-label="Link media to task" className="enterprise-form" onSubmit={submit}>
              <label>
                Schedule task
                <select
                  required
                  value={taskId}
                  disabled={add.isPending}
                  onChange={(event) => setTaskId(event.target.value)}
                >
                  <option value="">Choose a project task</option>
                  {tasks.data.items.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={evidence}
                  disabled={add.isPending}
                  onChange={(event) => setEvidence(event.target.checked)}
                />
                Use as completion evidence
              </label>
              {add.isError && <p role="alert">{errorHint(add.error)}</p>}
              <button type="submit" disabled={!taskId || !links.data || add.isPending}>
                {add.isPending ? 'Linking task…' : 'Link task'}
              </button>
            </form>
          )}
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </details>
  );
}
