'use client';

import {
  AssignEnterpriseSalesLead,
  SalesLeadAssignment,
  SalesLeadAssignmentOptions,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

type Options = z.infer<typeof SalesLeadAssignmentOptions>;

export function EnterpriseSalesAssignments({ leadId }: { leadId: string }) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise', 'sales-leads');
  const permitted = session.can('enterprise_sales:manage');
  const target = '/v1/enterprise/sales/leads/' + leadId + '/assignments';
  const view = useQuery({
    queryKey: [...key, 'assignment', leadId],
    queryFn: () => api.get(target, { schema: SalesLeadAssignmentOptions }),
    enabled: permitted,
    refetchOnMount: 'always',
  });
  const pending = view.isPending || (view.isFetching && !view.isFetchedAfterMount);
  const denied =
    !permitted || (isApiError(view.error) && [401, 403, 404].includes(view.error.status));

  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href="/enterprise/sales/leads" className="enterprise-back">
          ← Sales leads
        </Link>
        <h1>Lead assignment</h1>
        {!denied && !pending && view.data && <p>{view.data.name}</p>}
      </header>
      {denied && <p role="alert">This lead assignment is unavailable.</p>}
      {!denied && pending && <Skeleton variant="card" label="Loading lead assignment" />}
      {!denied && view.isError && (
        <SalesLeadFailure error={view.error} retry={() => void view.refetch()} />
      )}
      {!denied && !pending && view.data && (
        <AssignmentForm
          target={target}
          view={view.data}
          refresh={() => void client.invalidateQueries({ queryKey: key })}
        />
      )}
    </main>
  );
}

function AssignmentForm({
  target,
  view,
  refresh,
}: {
  target: string;
  view: Options;
  refresh: () => void;
}) {
  const { api } = useApi();
  const [reviewed, setReviewed] = useState({
    revision: view.revision,
    name: view.owner?.name ?? 'Unassigned',
  });
  const [mode, setMode] = useState<'direct' | 'round_robin'>('direct');
  const [candidate, setCandidate] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const stale = reviewed.revision < view.revision;
  const eligible =
    mode === 'direct'
      ? view.candidates.some(({ id }) => id === candidate)
      : view.roundRobinEnabled && view.candidates.length > 0;
  const save = useMutation({
    mutationFn: () => {
      const input =
        mode === 'direct' ? { mode, ownerMembershipId: candidate, reason } : { mode, reason };
      const signature = JSON.stringify([input, reviewed.revision]);
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      const body = AssignEnterpriseSalesLead.parse({
        ...input,
        clientRequestId: receipt.current.id,
      });
      return api.post(target, body, { ifMatch: reviewed.revision, schema: SalesLeadAssignment });
    },
    onSuccess: (result) => {
      setReviewed({ revision: result.revision, name: result.owner.name });
      setNotice('Assigned to ' + result.owner.name + '.');
      setCandidate('');
      setReason('');
      refresh();
    },
    onError: (error) => {
      if (isApiError(error) && [409, 412].includes(error.status)) refresh();
    },
  });

  return (
    <div className="enterprise-stack">
      <section className="enterprise-panel" aria-label="Lead owner">
        <h2>Lead owner</h2>
        <p>
          {view.owner?.name ?? 'Unassigned'} · Revision {view.revision}
        </p>
        {notice && <p role="status">{notice}</p>}
        <Link href="/enterprise/sales/assignment-settings">
          Manage sales territories and round robin
        </Link>
        {view.candidates.length === 0 && (
          <p>No active salesperson has capacity in the lead’s territory.</p>
        )}
        <form
          className="enterprise-form"
          aria-label="Assign sales lead"
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending && !stale && eligible) save.mutate();
          }}
        >
          <label>
            Assignment method
            <select
              value={mode}
              disabled={save.isPending}
              onChange={(event) =>
                setMode(event.currentTarget.value === 'round_robin' ? 'round_robin' : 'direct')
              }
            >
              <option value="direct">Select a salesperson</option>
              <option value="round_robin" disabled={!view.roundRobinEnabled}>
                Use round robin
              </option>
            </select>
          </label>
          {mode === 'direct' ? (
            <label>
              Salesperson
              <select
                value={candidate}
                disabled={save.isPending}
                onChange={(event) => setCandidate(event.currentTarget.value)}
              >
                <option value="">Choose an eligible salesperson</option>
                {view.candidates.map(({ id, name, activeLeads, capacity }) => (
                  <option key={id} value={id}>
                    {name} · {activeLeads} of {capacity} leads
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>
              {view.candidates[0]
                ? 'Next eligible salesperson ' + view.candidates[0].name
                : 'No salesperson is eligible.'}
            </p>
          )}
          <label>
            Assignment reason
            <textarea
              required
              minLength={3}
              maxLength={1000}
              value={reason}
              disabled={save.isPending}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </label>
          {stale && (
            <div role="status" className="enterprise-budget-adjustment">
              <p>
                {reviewed.name} at revision {reviewed.revision} changed to{' '}
                {view.owner?.name ?? 'Unassigned'} at revision {view.revision}.
              </p>
              <button
                type="button"
                onClick={() => {
                  setReviewed({ revision: view.revision, name: view.owner?.name ?? 'Unassigned' });
                  save.reset();
                }}
              >
                Use current assignment revision
              </button>
            </div>
          )}
          {save.isError && <SalesLeadFailure error={save.error} />}
          <div className="enterprise-forecast-form-actions">
            <button
              disabled={save.isPending || stale || !eligible || reason.trim().length < 3}
              type="submit"
            >
              {save.isPending ? 'Assigning…' : 'Assign lead'}
            </button>
            <Link href="/enterprise/sales/leads">Cancel assignment</Link>
          </div>
        </form>
      </section>
      <section className="enterprise-panel" aria-label="Assignment history">
        <h2>Assignment history</h2>
        {view.history.length === 0 && <p>No assignments have been recorded.</p>}
        <ol className="enterprise-change-history">
          {view.history.map((record) => (
            <li key={record.id}>
              <strong>
                {record.owner.name} · Revision {record.revision}
              </strong>
              <span>{record.mode === 'round_robin' ? 'Round robin' : 'Manager selection'}</span>
              <p>{record.reason}</p>
              <time dateTime={record.assignedAt}>
                {new Date(record.assignedAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
