'use client';

import {
  JobsiteEvidenceAssignment,
  JobsiteEvidenceSubmission,
  JobsiteEvidenceTasks,
  JobsiteTaskEvidence,
  MemberListSchema,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type TaskEvidence = z.infer<typeof JobsiteTaskEvidence>;
type Assignment = z.infer<typeof JobsiteEvidenceAssignment>;
type AssignmentForm = Pick<
  Assignment,
  'contractorMembershipId' | 'reviewerMembershipId' | 'minimumMedia'
>;

function evidenceError(error: unknown) {
  if (isApiError(error) && (error.is('validation_failed') || error.is('conflict')))
    return error.problem.detail || errorHint(error);
  return errorHint(error);
}

export function JobsiteEvidencePanel({ path }: { path: string }) {
  const { api } = useApi();
  const { orgId } = useSession();
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState('');
  const url = path + '/evidence/tasks';
  const tasks = useQuery({
    queryKey: orgKey(orgId, 'enterprise', 'jobsite-evidence-tasks', path),
    queryFn: () => api.get(url, { schema: JobsiteEvidenceTasks }),
    enabled: open,
  });

  return (
    <details className="enterprise-panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Task evidence</summary>
      {open && (
        <div className="enterprise-form">
          {tasks.isPending && <p role="status">Loading evidence tasks…</p>}
          {tasks.isError && (
            <div role="alert">
              <p>{errorHint(tasks.error)}</p>
              <button type="button" onClick={() => void tasks.refetch()}>
                Retry evidence tasks
              </button>
            </div>
          )}
          {tasks.isSuccess && tasks.data.items.length === 0 && (
            <p>No evidence tasks are assigned to you in this project.</p>
          )}
          {tasks.isSuccess && tasks.data.items.length > 0 && (
            <label>
              Evidence task
              <select value={taskId} onChange={(event) => setTaskId(event.currentTarget.value)}>
                <option value="">Choose a task</option>
                {tasks.data.items.map(({ id, title }) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {taskId && (tasks.isSuccess || !open) && (
        <EvidenceTask key={taskId} path={url + '/' + taskId} mediaPath={path} />
      )}
    </details>
  );
}

function EvidenceTask({ path, mediaPath }: { path: string; mediaPath: string }) {
  const { api } = useApi();
  const { orgId } = useSession();
  const client = useQueryClient();
  const key = orgKey(orgId, 'enterprise', 'jobsite-evidence-task', path);
  const current = useQuery({
    queryKey: key,
    queryFn: () => api.get(path, { schema: JobsiteTaskEvidence }),
    refetchInterval: (query) =>
      query.state.data?.canSubmit &&
      query.state.data.candidates.some((item) => item.availability === 'pending')
        ? 4000
        : false,
  });
  const [notice, setNotice] = useState('');

  function assignmentSaved(assignment: Assignment) {
    client.setQueryData(key, (old: TaskEvidence | undefined) =>
      old ? { ...old, assignment } : old,
    );
    setNotice(assignment.active ? 'Evidence assignment saved.' : 'Evidence assignment ended.');
    void client.invalidateQueries({ queryKey: key, exact: true });
  }

  function submissionSaved(submission: z.infer<typeof JobsiteEvidenceSubmission>) {
    client.setQueryData(key, (old: TaskEvidence | undefined) =>
      old ? { ...old, submission, canSubmit: false } : old,
    );
    setNotice('Evidence revision ' + submission.revision + ' submitted for review.');
    void client.invalidateQueries({ queryKey: key, exact: true });
  }

  if (current.isPending) return <p role="status">Loading task evidence…</p>;
  if (current.isError)
    return (
      <div role="alert">
        <p>{errorHint(current.error)}</p>
        <button type="button" onClick={() => void current.refetch()}>
          Retry task evidence
        </button>
      </div>
    );
  const { assignment, canManage, canSubmit, candidates, submission } = current.data;

  return (
    <section aria-label="Selected task evidence">
      {notice && <p role="status">{notice}</p>}
      {canManage && (
        <EvidenceAssignmentEditor
          path={path + '/assignment'}
          current={assignment}
          onSaved={assignmentSaved}
          reload={() => void current.refetch()}
        />
      )}
      {canSubmit && assignment && (
        <EvidenceSubmissionEditor
          path={path + '/submissions'}
          candidates={candidates}
          minimum={assignment.minimumMedia}
          revision={submission?.revision ?? 0}
          onSaved={submissionSaved}
          reload={() => void current.refetch()}
        />
      )}
      {submission && (
        <section className="enterprise-form" aria-label="Submitted evidence">
          <h3>Submitted evidence revision {submission.revision}</h3>
          <p>Awaiting inspector review</p>
          {submission.note && <p>{submission.note}</p>}
          <ul>
            {submission.media.map((entry) => (
              <li key={entry.mediaRevisionId}>
                <strong>{entry.filename}</strong>{' '}
                <time dateTime={entry.capturedAt}>
                  {new Date(entry.capturedAt).toLocaleString()}
                </time>
                {entry.caption && <p>{entry.caption.text}</p>}
                {entry.annotation ? (
                  <a
                    href={
                      mediaPath +
                      '/' +
                      entry.assetId +
                      '/annotations/' +
                      entry.annotation.revision +
                      '/image'
                    }
                  >
                    Open submitted annotation
                  </a>
                ) : (
                  <a href={mediaPath + '/' + entry.assetId + '/original'}>
                    Download submitted original
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function EvidenceAssignmentEditor({
  path,
  current,
  onSaved,
  reload,
}: {
  path: string;
  current: Assignment | null;
  onSaved: (assignment: Assignment) => void;
  reload: () => void;
}) {
  const { api } = useApi();
  const { orgId } = useSession();
  const [draft, setDraft] = useState<AssignmentForm | null>(null);
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const members = useInfiniteQuery({
    queryKey: orgKey(orgId, 'enterprise', 'jobsite-media-members'),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get('/v1/team/members', {
        schema: MemberListSchema,
        query: { status: 'active', limit: 100, cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const roster = members.data?.pages.flatMap((page) => page.items) ?? [];
  const input = draft ??
    current ?? { contractorMembershipId: '', reviewerMembershipId: '', minimumMedia: 1 };
  const save = useMutation({
    mutationFn: ({ active, form }: { active: boolean; form: AssignmentForm }) => {
      const revision = current?.revision ?? 0;
      const signature = JSON.stringify({ active, form, revision });
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      const { contractorMembershipId, reviewerMembershipId, minimumMedia } = form;
      return api.put(
        path,
        {
          active,
          contractorMembershipId,
          reviewerMembershipId,
          minimumMedia,
          clientRequestId: receipt.current.id,
        },
        { ifMatch: revision, schema: JobsiteEvidenceAssignment },
      );
    },
    onSuccess: (assignment) => {
      receipt.current = null;
      setDraft(null);
      onSaved(assignment);
    },
    onError: (error) => {
      if (isApiError(error) && error.is('precondition_failed')) reload();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!save.isPending && input.contractorMembershipId && input.reviewerMembershipId)
      save.mutate({ active: true, form: input });
  }

  return (
    <form className="enterprise-form" aria-label="Evidence assignment" onSubmit={submit}>
      <h3>Evidence assignment</h3>
      <p>Grant project media access to the contractor and inspector before assigning them.</p>
      {current && (
        <p>
          {current.active ? 'Active assignment' : 'Assignment ended'} · Revision {current.revision}
        </p>
      )}
      {members.isPending && <p role="status">Loading team members…</p>}
      {members.isError && <p role="alert">{errorHint(members.error)}</p>}
      <label>
        Contractor
        <select
          value={input.contractorMembershipId}
          required
          disabled={save.isPending}
          onChange={(event) =>
            setDraft({ ...input, contractorMembershipId: event.currentTarget.value })
          }
        >
          <option value="">Choose a contractor</option>
          {roster
            .filter(({ role }) => role === 'crew_manager')
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
        </select>
      </label>
      <label>
        Inspector
        <select
          value={input.reviewerMembershipId}
          required
          disabled={save.isPending}
          onChange={(event) =>
            setDraft({ ...input, reviewerMembershipId: event.currentTarget.value })
          }
        >
          <option value="">Choose an inspector</option>
          {roster
            .filter(({ role }) => role === 'reviewer')
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
        </select>
      </label>
      <label>
        Minimum clean media
        <input
          type="number"
          min={1}
          max={20}
          step={1}
          value={Number.isNaN(input.minimumMedia) ? '' : input.minimumMedia}
          required
          disabled={save.isPending}
          onChange={(event) =>
            setDraft({ ...input, minimumMedia: event.currentTarget.valueAsNumber })
          }
        />
      </label>
      {members.hasNextPage && (
        <button
          type="button"
          disabled={members.isFetchingNextPage}
          onClick={() => void members.fetchNextPage()}
        >
          Load more team members
        </button>
      )}
      {save.isError && <p role="alert">{evidenceError(save.error)}</p>}
      <button
        type="submit"
        disabled={save.isPending || !input.contractorMembershipId || !input.reviewerMembershipId}
      >
        {save.isPending ? 'Saving assignment…' : 'Save evidence assignment'}
      </button>
      {draft && (
        <button type="button" disabled={save.isPending} onClick={() => setDraft(null)}>
          Cancel assignment edit
        </button>
      )}
      {current?.active && (
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ active: false, form: current })}
        >
          End evidence assignment
        </button>
      )}
    </form>
  );
}

function EvidenceSubmissionEditor({
  path,
  candidates,
  minimum,
  revision,
  onSaved,
  reload,
}: {
  path: string;
  candidates: TaskEvidence['candidates'];
  minimum: number;
  revision: number;
  onSaved: (submission: z.infer<typeof JobsiteEvidenceSubmission>) => void;
  reload: () => void;
}) {
  const { api } = useApi();
  const [ids, setIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const selection = candidates.filter((item) => item.ready && ids.includes(item.mediaRevisionId));
  const save = useMutation({
    mutationFn: () => {
      const mediaRevisionIds = selection.map((item) => item.mediaRevisionId);
      const signature = JSON.stringify({ mediaRevisionIds, note, revision });
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      return api.post(
        path,
        { mediaRevisionIds, note, clientRequestId: receipt.current.id },
        { ifMatch: revision, schema: JobsiteEvidenceSubmission },
      );
    },
    onSuccess: onSaved,
    onError: reload,
  });

  return (
    <form
      className="enterprise-form"
      aria-label="Submit task evidence"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending && selection.length >= minimum) save.mutate();
      }}
    >
      <h3>Submit task evidence</h3>
      <p>
        Select at least {minimum} clean media {minimum === 1 ? 'item' : 'items'}.
      </p>
      {candidates.length === 0 && <p>Link uploaded media to this task as completion evidence.</p>}
      {candidates.length > 0 && (
        <fieldset>
          <legend>Linked media</legend>
          {candidates.map((item) => (
            <label key={item.mediaRevisionId}>
              <input
                type="checkbox"
                checked={selection.includes(item)}
                disabled={
                  !item.ready ||
                  save.isPending ||
                  (selection.length >= 20 && !selection.includes(item))
                }
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setIds((previous) =>
                    checked
                      ? [...previous, item.mediaRevisionId]
                      : previous.filter((id) => id !== item.mediaRevisionId),
                  );
                }}
              />
              {item.filename}
              {item.annotationRevision && ' · Annotation ' + item.annotationRevision}
              {item.availability === 'pending' && ' · Awaiting scan or processing'}
              {item.availability === 'unavailable' && ' · Unavailable'}
            </label>
          ))}
        </fieldset>
      )}
      <label>
        Evidence note{' '}
        <textarea
          maxLength={1500}
          value={note}
          disabled={save.isPending}
          onChange={(event) => setNote(event.currentTarget.value)}
        />
      </label>
      <p>
        {selection.length} media selected. Submitting sends this revision to the assigned inspector.
      </p>
      {save.isError && <p role="alert">{evidenceError(save.error)}</p>}
      <button type="submit" disabled={save.isPending || selection.length < minimum}>
        {save.isPending ? 'Submitting evidence…' : 'Submit evidence'}
      </button>
      {(ids.length > 0 || note) && (
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            setIds([]);
            setNote('');
            save.reset();
          }}
        >
          Cancel submission draft
        </button>
      )}
      <button type="button" disabled={save.isPending} onClick={reload}>
        Refresh linked media
      </button>
    </form>
  );
}
