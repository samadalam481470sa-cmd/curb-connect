'use client';

import { AdvanceSalesStage, SalesOpportunity, SalesStageEvent } from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { FinanceActivityPanel } from './FinanceActivityPanel';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

type Opportunity = z.infer<typeof SalesOpportunity>;
type StageEvent = z.infer<typeof SalesStageEvent>;

export function EnterpriseSalesOpportunity({ opportunityId }: { opportunityId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const permitted = session.can('enterprise_sales:intake');
  const key = orgKey(session.orgId, 'enterprise', 'sales-leads');
  const target = '/v1/enterprise/sales/opportunities/' + opportunityId;
  const query = useQuery({
    queryKey: [...key, 'opportunity', opportunityId],
    queryFn: () => api.get(target, { schema: SalesOpportunity }),
    enabled: permitted,
    refetchOnMount: 'always',
  });
  const denied =
    !permitted || (isApiError(query.error) && [401, 403, 404].includes(query.error.status));
  const pending = query.isPending || (query.isFetching && !query.isFetchedAfterMount);
  const view = !denied && !pending ? query.data : undefined;
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const leadPath = '/enterprise/sales/leads/' + opportunityId;

  return (
    <main className="enterprise-suite enterprise-finance-layout enterprise-financials-view">
      <header className="enterprise-hero">
        <Link href="/enterprise/sales/pipeline" className="enterprise-back">
          ← Sales pipeline
        </Link>
        <h1>Sales opportunity</h1>
        {view && <p>{view.name}</p>}
      </header>
      {denied && <p role="alert">This sales opportunity is unavailable.</p>}
      {!denied && pending && <Skeleton variant="card" label="Loading opportunity" />}
      {!denied && query.isError && (
        <SalesLeadFailure error={query.error} retry={() => void query.refetch()} />
      )}
      {view && (
        <>
          <nav className="enterprise-finance-primary-actions" aria-label="Opportunity actions">
            <Link href={leadPath + '/interactions'}>Log interactions</Link>
            {(view.estimateId || ['qualified', 'consultation'].includes(view.stage.key)) && (
              <Link href={'/enterprise/sales/opportunities/' + opportunityId + '/estimate'}>
                {view.estimateId ? 'Open estimate draft' : 'Create sales estimate'}
              </Link>
            )}
            {session.can('enterprise_sales:manage') && (
              <Link href={leadPath + '/assignments'}>Manage lead owner</Link>
            )}
          </nav>
          <section className="enterprise-panel" aria-label="Current opportunity stage">
            <h2>
              {view.stage.label} · Revision {view.revision}
            </h2>
            <dl>
              <dt>Source</dt>
              <dd>{view.source.name}</dd>
              <dt>Community</dt>
              <dd>{view.community?.name ?? 'Unspecified'}</dd>
              <dt>Owner</dt>
              <dd>{view.owner?.name ?? 'Unassigned'}</dd>
              <dt>Entered current stage</dt>
              <dd>
                <time dateTime={view.stageEnteredAt}>
                  {new Date(view.stageEnteredAt).toLocaleString()}
                </time>
              </dd>
              <dt>Next activity</dt>
              <dd>
                {view.nextActivityAt ? (
                  <time dateTime={view.nextActivityAt}>
                    {new Date(view.nextActivityAt).toLocaleString()}
                  </time>
                ) : (
                  'Unscheduled'
                )}
              </dd>
            </dl>
            {notice && <p role="status">{notice}</p>}
            {editing ? (
              <StageForm
                view={view}
                target={target}
                onCancel={() => setEditing(false)}
                refresh={() => void query.refetch()}
                onSaved={(saved) => {
                  setEditing(false);
                  setNotice('Moved to ' + saved.to.label + '.');
                  void client.invalidateQueries({ queryKey: key });
                }}
              />
            ) : (
              view.possibleTransitions.some(({ blockedReason }) => !blockedReason) && (
                <button
                  type="button"
                  onClick={() => {
                    setNotice('');
                    setEditing(true);
                  }}
                >
                  Advance stage
                </button>
              )
            )}
            {view.possibleTransitions.length === 0 && <p>This stage has no further transitions.</p>}
          </section>
          <FinanceActivityPanel>
            <section aria-label="Stage requirements">
              <h3>Stage requirements</h3>
              <ul>
                {view.possibleTransitions
                  .filter(({ blockedReason }) => blockedReason)
                  .map((item) => (
                    <li key={item.stage.id}>
                      <strong>{item.stage.label}</strong>
                      <p>{item.blockedReason}</p>
                    </li>
                  ))}
              </ul>
            </section>
            <section aria-label="Stage history">
              <h3>Stage history</h3>
              {!view.history.length && <p>No stage changes have been recorded.</p>}
              <ol className="enterprise-change-history">
                {view.history.map((event) => (
                  <li key={event.id}>
                    <strong>
                      {event.from.label} to {event.to.label}
                    </strong>
                    <span>
                      Time in {event.from.label} {Math.floor(event.previousStageDurationMs / 1000)}{' '}
                      seconds
                    </span>
                    <span>Revision {event.revision}</span>
                    {event.reason && <p>{event.reason}</p>}
                    <time dateTime={event.recordedAt}>
                      {new Date(event.recordedAt).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          </FinanceActivityPanel>
        </>
      )}
    </main>
  );
}

function StageForm({
  view,
  target,
  refresh,
  onCancel,
  onSaved,
}: {
  view: Opportunity;
  target: string;
  refresh: () => void;
  onCancel: () => void;
  onSaved: (event: StageEvent) => void;
}) {
  const { api } = useApi();
  const [reviewed, setReviewed] = useState({ revision: view.revision, stage: view.stage.label });
  const [targetStageId, setStage] = useState('');
  const [reason, setReason] = useState('');
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const stale = view.revision > reviewed.revision;
  const selected = view.possibleTransitions.find(({ stage }) => stage.id === targetStageId);
  const valid =
    selected && !selected.blockedReason && (!selected.requiresReason || reason.trim().length >= 3);
  const save = useMutation({
    mutationFn: () => {
      const input = { targetStageId, reason: reason.trim() || undefined };
      const signature = JSON.stringify([input, reviewed.revision]);
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      const body = AdvanceSalesStage.parse({ ...input, clientRequestId: receipt.current.id });
      return api.post(target + '/stage', body, {
        ifMatch: reviewed.revision,
        schema: SalesStageEvent,
      });
    },
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && [409, 412].includes(error.status)) refresh();
    },
  });
  return (
    <form
      className="enterprise-form"
      aria-label="Advance opportunity stage"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !stale && !save.isPending) save.mutate();
      }}
    >
      <label>
        Next stage
        <select
          required
          disabled={save.isPending}
          value={targetStageId}
          onChange={(event) => setStage(event.currentTarget.value)}
        >
          <option value="">Choose a stage</option>
          {view.possibleTransitions.map(({ stage, blockedReason }) => (
            <option key={stage.id} value={stage.id} disabled={Boolean(blockedReason)}>
              {stage.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Stage reason
        <textarea
          minLength={3}
          maxLength={1000}
          required={selected?.requiresReason ?? false}
          value={reason}
          disabled={save.isPending}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
      </label>
      {stale && (
        <div role="status" className="enterprise-budget-adjustment">
          <p>
            Revision {reviewed.revision} was {reviewed.stage}. Revision {view.revision} is{' '}
            {view.stage.label}.
          </p>
          <button
            type="button"
            onClick={() => {
              setReviewed({ revision: view.revision, stage: view.stage.label });
              save.reset();
            }}
          >
            Use current stage revision
          </button>
        </div>
      )}
      {save.isError && <SalesLeadFailure error={save.error} />}
      <div className="enterprise-forecast-form-actions">
        <button type="submit" disabled={!valid || stale || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save stage'}
        </button>
        <button type="button" disabled={save.isPending} onClick={onCancel}>
          Cancel stage change
        </button>
      </div>
    </form>
  );
}
