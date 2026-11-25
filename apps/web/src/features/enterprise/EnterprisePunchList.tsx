'use client';

import {
  ENTERPRISE_PUNCH_TRANSITIONS,
  EnterprisePunchItem,
  EnterprisePunchPage,
  EnterprisePunchStatus,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const labels = {
  open: 'Open',
  in_progress: 'In progress',
  ready_for_review: 'Ready for review',
  closed: 'Closed',
} satisfies Record<EnterprisePunchStatus, string>;

type PunchItem = ReturnType<typeof EnterprisePunchItem.parse>;

export function EnterprisePunchList({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const [status, setStatus] = useState<EnterprisePunchStatus | ''>('');
  const createRequest = useRef<{ signature: string; id: string } | null>(null);
  const key = [...orgKey(session.orgId, 'enterprise'), 'punch-items', projectId];
  const path = '/v1/enterprise/projects/' + encodeURIComponent(projectId) + '/punch-items';
  const list = useInfiniteQuery({
    queryKey: [...key, status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams();
      if (status) query.set('status', status);
      if (pageParam) query.set('cursor', pageParam);
      return api.get(path + '?' + query.toString(), { schema: EnterprisePunchPage });
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const create = useMutation({
    mutationFn: (body: {
      title: string;
      description: string;
      location: string;
      dueDate?: string;
      clientRequestId: string;
    }) => api.post(path, body, { schema: EnterprisePunchItem }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const dueDate = String(data.get('dueDate') ?? '');
    const body = {
      title: String(data.get('title') ?? '').trim(),
      description: String(data.get('description') ?? '').trim(),
      location: String(data.get('location') ?? '').trim(),
      dueDate: dueDate || undefined,
    };
    const signature = JSON.stringify(body);
    if (createRequest.current?.signature !== signature) {
      createRequest.current = { signature, id: crypto.randomUUID() };
    }
    try {
      await create.mutateAsync({ ...body, clientRequestId: createRequest.current.id });
      createRequest.current = null;
      form.reset();
    } catch {
      // The mutation shows the error. The form and request key stay available for a retry.
    }
  }

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="enterprise-panel">
      <h2>Project punch list</h2>
      {session.can('job:write') && (
        <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
          <label>
            Issue <input name="title" required minLength={2} maxLength={255} />
          </label>
          <label>
            Location <input name="location" required maxLength={255} />
          </label>
          <label>
            Due date <input name="dueDate" type="date" />
          </label>
          <label>
            Work required <textarea name="description" required minLength={3} maxLength={4000} />
          </label>
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add punch item'}
          </button>
        </form>
      )}
      {create.isError && (
        <p role="alert" className="enterprise-error">
          {errorHint(create.error)}
        </p>
      )}
      {create.isSuccess && (
        <p role="status" className="enterprise-success">
          Punch item added.
        </p>
      )}
      <label className="enterprise-response">
        Filter by status
        <select
          value={status}
          onChange={(event) =>
            setStatus(EnterprisePunchStatus.safeParse(event.target.value).data ?? '')
          }
        >
          <option value="">All statuses</option>
          {EnterprisePunchStatus.options.map((value) => (
            <option key={value} value={value}>
              {labels[value]}
            </option>
          ))}
        </select>
      </label>
      {list.isPending && <p role="status">Loading punch items…</p>}
      {list.isError && (
        <p role="alert" className="enterprise-error">
          {errorHint(list.error)}
        </p>
      )}
      {list.isSuccess && items.length === 0 && (
        <p className="enterprise-empty">No punch items for this view.</p>
      )}
      <div className="enterprise-records">
        {items.map((item) => (
          <PunchItemRow
            key={item.id + ':' + item.revision}
            item={item}
            onChanged={() => client.invalidateQueries({ queryKey: key })}
          />
        ))}
      </div>
      {list.hasNextPage && (
        <button
          type="button"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Loading…' : 'Load more punch items'}
        </button>
      )}
    </section>
  );
}

function PunchItemRow({ item, onChanged }: { item: PunchItem; onChanged: () => Promise<void> }) {
  const { api } = useApi();
  const session = useSession();
  const [reviewNote, setReviewNote] = useState('');
  const reviewing = item.status === 'ready_for_review';
  const canAct = session.can(reviewing ? 'review_task:decide' : 'job:write');
  const possible: readonly EnterprisePunchStatus[] = ENTERPRISE_PUNCH_TRANSITIONS[item.status];
  const update = useMutation({
    mutationFn: (status: EnterprisePunchStatus) =>
      api.patch(
        '/v1/enterprise/punch-items/' + item.id + '/status',
        {
          status,
          reviewNote: reviewing ? reviewNote.trim() : undefined,
        },
        { ifMatch: item.revision, schema: EnterprisePunchItem },
      ),
    onSuccess: onChanged,
  });
  return (
    <article className="enterprise-co-record">
      <div>
        <h3>{item.title}</h3>
        <p>{item.description}</p>
        <p className="enterprise-control-meta">
          <span>{item.location}</span>
          <span>{labels[item.status]}</span>
          {item.dueDate && (
            <span>
              Due <time dateTime={item.dueDate}>{item.dueDate}</time>
            </span>
          )}
        </p>
        {item.reviewNote && <p>Last review: {item.reviewNote}</p>}
        {update.isError && (
          <p role="alert" className="enterprise-error">
            {errorHint(update.error)}
          </p>
        )}
      </div>
      {canAct && possible.length > 0 && (
        <div className="enterprise-actions">
          {reviewing && (
            <label className="enterprise-response">
              Review note
              <textarea
                value={reviewNote}
                maxLength={1000}
                onChange={(event) => setReviewNote(event.target.value)}
              />
            </label>
          )}
          {possible.map((next) => (
            <button
              key={next}
              type="button"
              disabled={update.isPending || (reviewing && reviewNote.trim().length < 3)}
              onClick={() => update.mutate(next)}
            >
              {next === 'closed'
                ? 'Verify and close'
                : reviewing
                  ? 'Return to work'
                  : next === 'in_progress'
                    ? 'Start work'
                    : 'Send for review'}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
