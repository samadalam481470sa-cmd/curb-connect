'use client';

// Work assigned to this company, as phone cards: accept / decline a new assignment,
// start it, complete it. Decisions go through the offline outbox so a tap in a dead
// spot still lands when the connection returns.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { errorHint } from '../../lib/api';
import { submitOrQueue } from '../../lib/offline/fieldWrites';
import { orgKey, useApi, useSession } from '../../lib/session';
import { FIELD_LABELS, prettyStatus, type UiLang } from '../builderOps/shared';

const Assignment = z.object({
  id: z.string(),
  side: z.enum(['assigner', 'assignee']),
  partnerDisplayName: z.string(),
  kind: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  dueOn: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const AssignmentList = z.object({ items: z.array(Assignment) });

const NEXT: Record<
  string,
  { decision: string; labelKey: 'accept' | 'decline' | 'startWork' | 'completeWork' }[]
> = {
  sent: [
    { decision: 'accept', labelKey: 'accept' },
    { decision: 'decline', labelKey: 'decline' },
  ],
  accepted: [{ decision: 'start', labelKey: 'startWork' }],
  in_progress: [{ decision: 'complete', labelKey: 'completeWork' }],
};

export function AssignmentCards({ lang }: { lang: UiLang }) {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const L = FIELD_LABELS[lang];
  const scope = { userId: session.me.user.id, orgId: session.orgId };
  const canWrite = session.can('assignment:write');
  const [queuedNote, setQueuedNote] = useState('');

  const list = useQuery({
    queryKey: orgKey(session.orgId, 'field', 'assignments'),
    queryFn: () => api.get('/v1/assignments?side=assignee', { schema: AssignmentList }),
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: string }) => {
      const path = `/v1/assignments/${input.id}/decide`;
      const body = { decision: input.decision };
      return submitOrQueue({
        scope,
        kind: 'assignment_decide',
        label: input.decision,
        method: 'POST',
        path,
        body,
        send: (idempotencyKey) => api.post(path, body, { idempotencyKey }),
      });
    },
    onSuccess: (r) => {
      setQueuedNote(r.queued ? L.queuedNote : '');
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'field') });
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'assignments') });
    },
  });

  const open = (list.data?.items ?? []).filter((a) =>
    ['sent', 'accepted', 'in_progress'].includes(a.status),
  );

  return (
    <section className="web-card" aria-label={L.assignmentsToAnswer}>
      <h2>{L.assignmentsToAnswer}</h2>
      {list.error ? <ErrorNotice error={list.error} /> : null}
      {open.length === 0 && !list.isLoading ? <p className="web-muted">{L.noAssignments}</p> : null}
      <div style={{ display: 'grid', gap: 12 }}>
        {open.map((a) => (
          <article key={a.id} className="web-card" style={{ padding: 12 }}>
            <p style={{ margin: '0 0 4px' }}>
              <strong>{a.title}</strong>
            </p>
            <p className="web-muted" style={{ margin: '0 0 8px' }}>
              {a.partnerDisplayName} · {prettyStatus(a.status)}
              {a.dueOn ? ` · ${a.dueOn}` : ''}
            </p>
            {a.description ? <p style={{ margin: '0 0 8px' }}>{a.description}</p> : null}
            {canWrite ? (
              <div style={{ display: 'flex', gap: 8 }}>
                {(NEXT[a.status] ?? []).map((step) => (
                  <button
                    key={step.decision}
                    type="button"
                    className={step.decision === 'decline' ? 'cc-btn' : 'cc-btn cc-btn--primary'}
                    style={{ minHeight: 48, flex: 1 }}
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: a.id, decision: step.decision })}
                  >
                    {L[step.labelKey]}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {queuedNote ? (
        <p className="web-muted" role="status">
          {queuedNote}
        </p>
      ) : null}
      {decide.error ? (
        <p className="web-error" role="alert">
          {errorHint(decide.error)}
        </p>
      ) : null}
    </section>
  );
}
