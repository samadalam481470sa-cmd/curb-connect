'use client';

import {
  DecideTakeoffCalibrationChange,
  SetTakeoffCalibrationLock,
  TakeoffCalibrationChange,
  TakeoffCalibrationChangePage,
  TakeoffCalibrationLockRevision,
  type TakeoffCalibrationLock,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { useApi, useSession } from '../../lib/session';
import { takeoffQuantity } from './takeoffDraftPreview';

type Lock = z.infer<typeof TakeoffCalibrationLock>;
type Change = z.infer<typeof TakeoffCalibrationChange>;
const lockLabels: Record<Lock['mode'], string> = {
  after_review: 'Automatic after approval',
  locked: 'Always locked',
  unlocked: 'Unlocked',
};
const changeLabels: Record<Change['status'], string> = {
  pending: 'Pending lead approval',
  approved: 'Approved',
  declined: 'Declined',
};

export function TakeoffCalibrationLeadControls({
  path,
  scope,
  lock,
  refresh,
}: {
  path: string;
  scope: readonly unknown[];
  lock: Lock;
  refresh: () => Promise<void>;
}) {
  const { api } = useApi();
  const session = useSession();
  const canLead = session.can('takeoff:approve_calibration');
  const [opened, setOpened] = useState(false);
  const changes = useInfiniteQuery({
    queryKey: [...scope, 'change-requests'],
    enabled: opened,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path + '/change-requests', {
        query: { cursor: pageParam },
        schema: TakeoffCalibrationChangePage,
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const items = changes.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="enterprise-stack">
      <p>
        {lock.effective
          ? 'Calibration locked · Lead approval required'
          : 'Calibration can be edited'}
      </p>
      {lock.dependentApprovals > 0 && (
        <p>
          {lock.dependentApprovals === 1
            ? 'One approved measurement uses'
            : lock.dependentApprovals + ' approved measurements use'}{' '}
          the current scale.
        </p>
      )}
      <details open={opened} onToggle={(event) => setOpened(event.currentTarget.open)}>
        <summary>Calibration lock and requests</summary>
        {canLead && <LockSetting key={lock.revision} path={path} lock={lock} scope={scope} />}
        {lock.history.length > 0 && (
          <ul aria-label="Calibration lock history" className="enterprise-change-history">
            {lock.history.map((entry) => (
              <li key={entry.revision}>
                <strong>{lockLabels[entry.mode]}</strong>
                <span>{entry.reason}</span>
                <time dateTime={entry.createdAt}>{entry.createdAt.slice(0, 10)}</time>
              </li>
            ))}
          </ul>
        )}
        {opened && (
          <section className="enterprise-stack" aria-label="Calibration change requests">
            {changes.isPending && <p role="status">Loading calibration requests…</p>}
            {changes.isError && (
              <div>
                <p className="enterprise-error" role="alert">
                  {errorHint(changes.error)}
                </p>
                <button type="button" onClick={() => void changes.refetch()}>
                  Retry loading requests
                </button>
              </div>
            )}
            {changes.isSuccess && items.length === 0 && <p>No calibration change requests.</p>}
            {items.length > 0 && (
              <ul aria-label="Calibration request history" className="enterprise-change-history">
                {items.map((change) => (
                  <li key={change.id}>
                    <strong>{changeLabels[change.status]}</strong>
                    <span>{change.reason}</span>
                    <span>
                      Revision {change.baseCalibrationRevision} ·{' '}
                      {takeoffQuantity.format(change.previous.scale)} {change.previous.unit} per
                      drawing point
                    </span>
                    <span>
                      Proposed scale · {takeoffQuantity.format(change.proposed.scale)}{' '}
                      {change.proposed.unit}
                      {' per drawing point'}
                    </span>
                    {change.decisionReason && <span>{change.decisionReason}</span>}
                    {canLead && change.status === 'pending' && (
                      <ChangeDecision path={path} change={change} onDecision={refresh} />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {changes.hasNextPage && (
              <button
                type="button"
                disabled={changes.isFetchingNextPage}
                onClick={() => void changes.fetchNextPage()}
              >
                Load earlier requests
              </button>
            )}
          </section>
        )}
      </details>
    </div>
  );
}

function LockSetting({
  path,
  lock,
  scope,
}: {
  path: string;
  lock: Lock;
  scope: readonly unknown[];
}) {
  const { api } = useApi();
  const client = useQueryClient();
  const retry = useRef<{ key: string; id: string } | null>(null);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (input: z.infer<typeof SetTakeoffCalibrationLock>) =>
      api.put(path + '/lock', input, {
        ifMatch: lock.revision,
        schema: TakeoffCalibrationLockRevision,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [...scope, 'lock'] }),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    const form = new FormData(event.currentTarget);
    const fields = { mode: form.get('mode'), reason: form.get('reason') };
    const signature = JSON.stringify(fields);
    if (retry.current?.key !== signature)
      retry.current = { key: signature, id: crypto.randomUUID() };
    setError('');
    try {
      await save.mutateAsync(
        SetTakeoffCalibrationLock.parse({ ...fields, clientRequestId: retry.current.id }),
      );
      retry.current = null;
    } catch (cause) {
      setError(isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause));
    }
  }

  return (
    <form
      aria-label="Calibration lock setting"
      className="enterprise-form"
      onSubmit={(event) => void submit(event)}
    >
      <label>
        Calibration lock mode
        <select name="mode" defaultValue={lock.mode} disabled={save.isPending}>
          {Object.entries(lockLabels).map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reason for the lock setting{' '}
        <textarea name="reason" required minLength={3} maxLength={1000} disabled={save.isPending} />
      </label>
      <button type="submit" disabled={save.isPending}>
        {save.isPending ? 'Saving lock setting…' : 'Save lock setting'}
      </button>
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
    </form>
  );
}

function ChangeDecision({
  path,
  change,
  onDecision,
}: {
  path: string;
  change: Change;
  onDecision: () => Promise<void>;
}) {
  const { api } = useApi();
  const [error, setError] = useState('');
  const submit = useMutation({
    mutationFn: (input: z.infer<typeof DecideTakeoffCalibrationChange>) =>
      api.post(path + '/change-requests/' + change.id + '/decide', input, {
        ifMatch: change.revision,
        schema: TakeoffCalibrationChange,
      }),
    onSuccess: onDecision,
  });

  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submit.isPending) return;
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      await submit.mutateAsync(
        DecideTakeoffCalibrationChange.parse({
          decision: form.get('decision'),
          reason: form.get('reason'),
        }),
      );
    } catch (cause) {
      setError(isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause));
    }
  }

  return (
    <form
      aria-label="Decide calibration request"
      className="enterprise-form"
      onSubmit={(event) => void decide(event)}
    >
      <label>
        Calibration decision
        <select name="decision" disabled={submit.isPending}>
          <option value="approved">Approve proposed scale</option>
          <option value="declined">Decline proposed scale</option>
        </select>
      </label>
      <label>
        Calibration decision reason{' '}
        <textarea
          name="reason"
          required
          minLength={3}
          maxLength={1000}
          disabled={submit.isPending}
        />
      </label>
      <button type="submit" disabled={submit.isPending}>
        {submit.isPending ? 'Recording calibration decision…' : 'Record calibration decision'}
      </button>
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
    </form>
  );
}
