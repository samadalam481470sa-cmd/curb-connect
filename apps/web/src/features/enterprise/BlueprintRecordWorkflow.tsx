'use client';

import { isEnterpriseRecordFinished } from '@fieldline/contracts';
import { useState, type FormEvent } from 'react';
import { errorHint } from '../../lib/api';
import { useApi, useSession } from '../../lib/session';
import type { BlueprintRecordType } from './blueprintSchemas';

export function BlueprintRecordWorkflow({
  record,
  members,
  onSaved,
}: {
  record: BlueprintRecordType;
  members: { userId: string; displayName: string }[];
  onSaved: () => Promise<void>;
}) {
  const { api } = useApi();
  const session = useSession();
  const [ownerUserId, setOwnerUserId] = useState(record.ownerUserId ?? '');
  const [dueOn, setDueOn] = useState(record.dueOn ?? '');
  const [slaHours, setSlaHours] = useState(record.slaHours ? String(record.slaHours) : '');
  const [blockedReason, setBlockedReason] = useState(record.blockedReason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const finished = isEnterpriseRecordFinished(record.status);
  const ownerChoices =
    record.ownerUserId && !members.some((member) => member.userId === record.ownerUserId)
      ? [
          ...members,
          {
            userId: record.ownerUserId,
            displayName: `${record.ownerName ?? 'Former member'} (inactive)`,
          },
        ]
      : members;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const hours = slaHours.trim() === '' ? null : Number(slaHours);
      if (hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > 8760)) {
        throw new Error('SLA hours must be a whole number from 1 to 8,760.');
      }
      await api.patch(
        '/v1/enterprise/blueprint/records/' + record.id,
        {
          ownerUserId: ownerUserId || null,
          dueOn: dueOn || null,
          slaHours: hours,
          blockedReason: finished ? null : blockedReason.trim() || null,
        },
        { ifMatch: record.revision },
      );
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="blueprint-record-admin">
      <summary>
        Workflow · {record.ownerName ?? 'Unassigned'} · Due {record.dueOn ?? '—'} · SLA{' '}
        {record.slaHours ? `${record.slaHours}h` : '—'}
        {record.blockedReason ? ' · Blocked' : ''}
      </summary>
      <form className="blueprint-workflow-form" onSubmit={submit}>
        {error && (
          <p className="enterprise-error" role="alert">
            {error}
          </p>
        )}
        <div className="blueprint-form-fields">
          <label>
            Owner
            <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}>
              <option value="">Unassigned</option>
              {ownerChoices.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due date
            <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          </label>
          <label>
            SLA hours
            <input
              type="number"
              min={1}
              max={8760}
              step={1}
              value={slaHours}
              onChange={(event) => setSlaHours(event.target.value)}
              placeholder="e.g. 48"
            />
          </label>
        </div>
        <label>
          Blocked reason
          <textarea
            value={blockedReason}
            onChange={(event) => setBlockedReason(event.target.value)}
            maxLength={500}
            disabled={finished}
            placeholder="What is preventing this record from moving?"
          />
        </label>
        {finished && (
          <p className="enterprise-muted">
            A finished record cannot be blocked or kept in the queue.
          </p>
        )}
        <div className="blueprint-record-actions">
          <button type="submit" disabled={busy || !session.can('job:write')}>
            {busy ? 'Saving…' : 'Save workflow'}
          </button>
          {record.blockedReason && !finished && (
            <button
              type="button"
              className="enterprise-quiet"
              disabled={busy || !session.can('job:write')}
              onClick={() => setBlockedReason('')}
            >
              Clear block
            </button>
          )}
        </div>
        {!session.can('job:write') && (
          <p className="enterprise-muted">Your role has read-only access.</p>
        )}
      </form>
    </details>
  );
}
