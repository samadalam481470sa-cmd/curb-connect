'use client';

import {
  LogEnterpriseSalesInteraction,
  SalesInteractionReceipt,
  SalesInteractionView,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

type View = z.infer<typeof SalesInteractionView>;
const channelNames = { call: 'Call', email: 'Email', meeting: 'Meeting' };
const outcomeNames = {
  attempted: 'Attempted',
  contacted: 'Contacted',
  follow_up_requested: 'Follow-up requested',
  no_further_contact: 'No further contact',
};

function localNow() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function EnterpriseSalesInteractions({ leadId }: { leadId: string }) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const permitted = session.can('enterprise_sales:intake');
  const key = orgKey(session.orgId, 'enterprise', 'sales-leads');
  const target = '/v1/enterprise/sales/leads/' + leadId + '/interactions';
  const query = useInfiniteQuery({
    queryKey: [...key, 'interactions', leadId],
    queryFn: ({ pageParam }) =>
      api.get(target, { schema: SalesInteractionView, query: { cursor: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: ({ nextCursor }) => nextCursor,
    enabled: permitted,
    refetchOnMount: 'always',
  });
  const denied =
    !permitted || (isApiError(query.error) && [401, 403, 404].includes(query.error.status));
  const pending = query.isPending || (query.isFetching && !query.isFetchedAfterMount);
  const view = !denied && !pending ? query.data?.pages[0] : undefined;
  const items = view ? (query.data?.pages.flatMap(({ items }) => items) ?? []) : [];
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');

  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href="/enterprise/sales/leads" className="enterprise-back">
          ← Sales leads
        </Link>
        <h1>Lead interactions</h1>
        {view && (
          <p>
            {view.name} · Revision {view.revision}
          </p>
        )}
      </header>
      {denied && <p role="alert">These lead interactions are unavailable.</p>}
      {!denied && pending && <Skeleton variant="card" label="Loading lead interactions" />}
      {!denied && query.isError && (
        <SalesLeadFailure
          error={query.error}
          retry={() => {
            void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch());
          }}
        />
      )}
      {view && (
        <div className="enterprise-stack">
          <section className="enterprise-panel" aria-label="Interaction actions">
            {notice && <p role="status">{notice}</p>}
            {editing ? (
              <InteractionForm
                view={view}
                target={target}
                onRefresh={() => void query.refetch()}
                onCancel={() => setEditing(false)}
                onSaved={(result) => {
                  setEditing(false);
                  setNotice(
                    result.interaction.followUp
                      ? 'Interaction and follow-up saved.'
                      : 'Interaction saved.',
                  );
                  void client.invalidateQueries({ queryKey: key });
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNotice('');
                  setEditing(true);
                }}
              >
                Log interaction
              </button>
            )}
          </section>
          <section className="enterprise-panel" aria-label="Interaction timeline">
            <h2>Interaction timeline</h2>
            {!items.length && <p>No interactions have been recorded for this lead.</p>}
            <ol className="enterprise-change-history">
              {items.map((item) => (
                <li key={item.id}>
                  <strong>
                    {channelNames[item.channel]} · {outcomeNames[item.outcome]}
                  </strong>
                  <time dateTime={item.occurredAt}>
                    {new Date(item.occurredAt).toLocaleString()}
                  </time>
                  {item.linkedConversation && (
                    <span>Conversation · {item.linkedConversation.title}</span>
                  )}
                  <p>{item.notes}</p>
                  {item.followUp && (
                    <p>
                      Follow-up due{' '}
                      <time dateTime={item.followUp.dueAt}>
                        {new Date(item.followUp.dueAt).toLocaleString()}
                      </time>
                      {item.followUp.reminderScheduled
                        ? ' · In-app reminder requested'
                        : ' · Reminder off'}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            {query.hasNextPage && (
              <button
                type="button"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                Load earlier interactions
              </button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function InteractionForm({
  view,
  target,
  onRefresh,
  onCancel,
  onSaved,
}: {
  view: View;
  target: string;
  onRefresh: () => void;
  onCancel: () => void;
  onSaved: (result: z.infer<typeof SalesInteractionReceipt>) => void;
}) {
  const { api } = useApi();
  const [revision, setRevision] = useState(view.revision);
  const [conversation, setConversation] = useState('');
  const [now] = useState(localNow);
  const [validation, setValidation] = useState('');
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const stale = revision < view.revision;
  const save = useMutation({
    mutationFn: (input: z.infer<typeof LogEnterpriseSalesInteraction>) =>
      api.post(target, input, { ifMatch: revision, schema: SalesInteractionReceipt }),
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && error.status === 412) onRefresh();
    },
  });

  return (
    <form
      className="enterprise-form"
      aria-label="Log sales interaction"
      onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending || stale) return;
        const form = new FormData(event.currentTarget);
        const field = (name: string) => String(form.get(name) ?? '');
        const date = (name: string) => {
          const stamp = Date.parse(field(name));
          return Number.isFinite(stamp) ? new Date(stamp).toISOString() : undefined;
        };
        const input = {
          channel: field('channel'),
          outcome: field('outcome'),
          notes: field('notes'),
          occurredAt: date('occurredAt'),
          nextAt: date('nextAt'),
          conversationId: conversation && conversation !== 'new' ? conversation : undefined,
          newConversationTitle: conversation === 'new' ? field('newConversationTitle') : undefined,
        };
        const signature = JSON.stringify([revision, input]);
        if (receipt.current?.signature !== signature)
          receipt.current = { signature, id: crypto.randomUUID() };
        const result = LogEnterpriseSalesInteraction.safeParse({
          ...input,
          clientRequestId: receipt.current.id,
        });
        if (!result.success) {
          setValidation(result.error.issues[0]?.message ?? 'Review interaction fields.');
          return;
        }
        setValidation('');
        save.mutate(result.data);
      }}
    >
      <label>
        Channel
        <select name="channel" defaultValue="call" disabled={save.isPending}>
          {Object.entries(channelNames).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Occurred at
        <input
          type="datetime-local"
          name="occurredAt"
          required
          defaultValue={now}
          disabled={save.isPending}
        />
      </label>
      <label>
        Outcome
        <select name="outcome" defaultValue="contacted" disabled={save.isPending}>
          {Object.entries(outcomeNames).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Conversation
        <select
          value={conversation}
          disabled={save.isPending}
          onChange={(event) => setConversation(event.currentTarget.value)}
        >
          <option value="">No linked conversation</option>
          <option value="new">Start a conversation</option>
          {view.conversations.map(({ id, title }) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {conversation === 'new' && (
        <label>
          Conversation title
          <input name="newConversationTitle" maxLength={160} required disabled={save.isPending} />
        </label>
      )}
      <label>
        Follow-up due
        <input type="datetime-local" name="nextAt" disabled={save.isPending} />
      </label>
      <label className="enterprise-budget-adjustment">
        Internal interaction notes
        <textarea name="notes" required rows={4} maxLength={4000} disabled={save.isPending} />
      </label>
      {stale && (
        <div role="status" className="enterprise-budget-adjustment">
          <p>
            The lead changed from revision {revision} to {view.revision}. Review the current
            timeline before saving.
          </p>
          <button
            type="button"
            onClick={() => {
              setRevision(view.revision);
              save.reset();
            }}
          >
            Use current lead revision
          </button>
        </div>
      )}
      {validation && <p role="alert">{validation}</p>}
      {save.isError && <SalesLeadFailure error={save.error} />}
      <div className="enterprise-forecast-form-actions">
        <button type="submit" disabled={stale || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save interaction'}
        </button>
        <button type="button" disabled={save.isPending} onClick={onCancel}>
          Cancel interaction
        </button>
      </div>
    </form>
  );
}
