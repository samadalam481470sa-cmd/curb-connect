'use client';

import { findWorkPackage, workPackageLabel } from '@fieldline/contracts';
import { useMemo, useState } from 'react';
import { errorHint } from '../../lib/api';
import { useApi, useSession } from '../../lib/session';
import type { BlueprintExceptionType, BlueprintExceptionsType } from './blueprintSchemas';

type QueueKind = 'all' | 'overdue' | 'blocked' | 'sla';

const REASON_LABELS = {
  overdue: 'Overdue',
  blocked: 'Blocked',
  sla_breached: 'SLA breached',
} as const;

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function BlueprintExceptionInbox({
  data,
  isPending,
  error,
  members,
  onOpen,
  onChanged,
}: {
  data: BlueprintExceptionsType | undefined;
  isPending: boolean;
  error: unknown;
  members: { userId: string; displayName: string }[];
  onOpen: (packageCode: string, recordId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const { api } = useApi();
  const session = useSession();
  const [kind, setKind] = useState<QueueKind>('all');
  const [owner, setOwner] = useState('all');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const me = session.me.user.id;

  const items = useMemo(() => {
    return (data?.items ?? []).filter((item) => {
      if (kind === 'overdue' && !item.overdue) return false;
      if (kind === 'blocked' && !item.blocked) return false;
      if (kind === 'sla' && !item.slaBreached) return false;
      if (owner === 'unassigned') return !item.ownerUserId;
      if (owner === 'me') return item.ownerUserId === me;
      if (owner !== 'all') return item.ownerUserId === owner;
      return true;
    });
  }, [data, kind, owner, me]);

  const unblock = async (item: BlueprintExceptionType) => {
    setBusy(item.id);
    setActionError('');
    try {
      await api.patch(
        '/v1/enterprise/blueprint/records/' + item.id,
        { blockedReason: null },
        { ifMatch: item.revision },
      );
      await onChanged();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="enterprise-panel blueprint-inbox" aria-label="Blueprint exception inbox">
      <div className="blueprint-inbox-head">
        <div>
          <span className="enterprise-kicker">DAILY WORK QUEUE</span>
          <h2>Exception inbox</h2>
          <p>
            Overdue, blocked and SLA-breached records across every work package. Work the queue,
            then open a record to change its owner, due date or block.
          </p>
        </div>
        <button type="button" className="enterprise-quiet" onClick={() => void onChanged()}>
          Refresh queue
        </button>
      </div>

      <div className="enterprise-kpis blueprint-kpis blueprint-inbox-kpis">
        <div>
          <span>Total exceptions</span>
          <strong>{data?.counts.total ?? 0}</strong>
        </div>
        <div>
          <span>Overdue</span>
          <strong>{data?.counts.overdue ?? 0}</strong>
        </div>
        <div>
          <span>Blocked</span>
          <strong>{data?.counts.blocked ?? 0}</strong>
        </div>
        <div>
          <span>SLA breached</span>
          <strong>{data?.counts.slaBreached ?? 0}</strong>
        </div>
      </div>

      <div className="blueprint-inbox-filters">
        <label>
          Show
          <select value={kind} onChange={(event) => setKind(event.target.value as QueueKind)}>
            <option value="all">All exceptions</option>
            <option value="overdue">Overdue</option>
            <option value="blocked">Blocked</option>
            <option value="sla">SLA breached</option>
          </select>
        </label>
        <label>
          Owner
          <select value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="all">All owners</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <p className="enterprise-muted" role="status">
          {items.length} record{items.length === 1 ? '' : 's'} shown
          {data ? ` · ${data.counts.unassigned} unassigned in the queue` : ''}
        </p>
      </div>

      {actionError && (
        <p className="enterprise-error" role="alert">
          {actionError}
        </p>
      )}
      {isPending && <p className="enterprise-muted">Loading the exception queue…</p>}
      {!isPending && !!error && (
        <p className="enterprise-error" role="alert">
          The exception queue could not load: {errorHint(error)}
        </p>
      )}
      {!isPending && !error && items.length === 0 && (
        <p className="enterprise-empty">
          No records match this queue. Overdue, blocked and SLA-breached records appear here.
        </p>
      )}

      <div className="blueprint-inbox-list">
        {items.map((item) => {
          const pkg = findWorkPackage(item.packageCode);
          return (
            <article key={item.id} className="blueprint-record blueprint-inbox-item">
              <div className="blueprint-inbox-main">
                <div className="blueprint-inbox-title">
                  <button
                    type="button"
                    className="blueprint-link"
                    onClick={() => onOpen(item.packageCode, item.id)}
                  >
                    {item.packageCode} · {pkg?.title ?? 'Work package'}
                  </button>
                  <span className={`enterprise-status enterprise-status--${item.status}`}>
                    {workPackageLabel(item.status)}
                  </span>
                </div>
                <strong>{item.title}</strong>
                <div className="blueprint-inbox-badges">
                  {item.reasons.map((reason) => (
                    <span
                      key={reason}
                      className={`blueprint-exception-badge blueprint-exception-badge--${reason}`}
                    >
                      {REASON_LABELS[reason]}
                    </span>
                  ))}
                </div>
                <small>
                  Owner {item.ownerName ?? 'Unassigned'} · Updated {formatWhen(item.updatedAt)}
                </small>
                {item.blockedReason && (
                  <p className="blueprint-inbox-blocked">Blocked: {item.blockedReason}</p>
                )}
              </div>
              <dl className="blueprint-inbox-meta">
                <div>
                  <dt>Due</dt>
                  <dd>{item.dueOn ?? '—'}</dd>
                </div>
                <div>
                  <dt>Days overdue</dt>
                  <dd>{item.overdue ? item.daysOverdue : '—'}</dd>
                </div>
                <div>
                  <dt>SLA target</dt>
                  <dd>{item.slaDueAt ? formatWhen(item.slaDueAt) : '—'}</dd>
                </div>
              </dl>
              <div className="blueprint-record-actions">
                <button type="button" onClick={() => onOpen(item.packageCode, item.id)}>
                  Open record
                </button>
                {item.blockedReason && item.status !== 'blocked' && session.can('job:write') && (
                  <button
                    type="button"
                    className="enterprise-quiet"
                    disabled={busy === item.id}
                    onClick={() => void unblock(item)}
                  >
                    {busy === item.id ? 'Clearing…' : 'Unblock'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
