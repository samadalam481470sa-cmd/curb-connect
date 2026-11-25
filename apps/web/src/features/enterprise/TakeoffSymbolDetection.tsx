'use client';

import {
  SetTakeoffSymbolDetection,
  TakeoffSymbolDetectionRevision,
  TakeoffSymbolDetectionSetting,
  type EnterpriseTakeoffPoint,
} from '@fieldline/contracts';
import type { TakeoffSquareSuggestion } from '@fieldline/geometry';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const path = '/v1/enterprise/takeoff/symbol-detection';
const coordinate = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function useDetectionSetting(enabled = true) {
  const session = useSession();
  const { api } = useApi();
  return useQuery({
    enabled,
    queryKey: [...orgKey(session.orgId, 'enterprise'), 'takeoff-symbol-detection'],
    queryFn: () => api.get(path, { schema: TakeoffSymbolDetectionSetting }),
  });
}

export function TakeoffSymbolBetaSetting() {
  const session = useSession();
  const authorized = session.can('org:settings_update');
  const setting = useDetectionSetting(authorized);
  if (!authorized) return null;

  return (
    <details className="enterprise-stack">
      <summary>Symbol detection beta</summary>
      {setting.isPending && <p role="status">Loading symbol detection setting…</p>}
      {setting.isError && (
        <div>
          <p className="enterprise-error" role="alert">
            {errorHint(setting.error)}
          </p>
          <button type="button" onClick={() => void setting.refetch()}>
            Retry loading setting
          </button>
        </div>
      )}
      {setting.data && <BetaSettingForm key={setting.data.revision} setting={setting.data} />}
    </details>
  );
}

function BetaSettingForm({ setting }: { setting: z.infer<typeof TakeoffSymbolDetectionSetting> }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const retry = useRef<{ signature: string; id: string } | null>(null);
  const [enabled, setEnabled] = useState(setting.enabled);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (input: z.infer<typeof SetTakeoffSymbolDetection>) =>
      api.put(path, input, { ifMatch: setting.revision, schema: TakeoffSymbolDetectionRevision }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: [...orgKey(session.orgId, 'enterprise'), 'takeoff-symbol-detection'],
      }),
  });

  async function saveSetting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    const form = new FormData(event.currentTarget);
    const fields = { enabled: form.get('enabled') === 'on', reason: form.get('reason') };
    const signature = JSON.stringify(fields);
    if (retry.current?.signature !== signature)
      retry.current = { signature, id: crypto.randomUUID() };
    setError('');
    try {
      await save.mutateAsync(
        SetTakeoffSymbolDetection.parse({
          ...fields,
          clientRequestId: retry.current.id,
        }),
      );
      retry.current = null;
    } catch (cause) {
      setEnabled(setting.enabled);
      setError(isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause));
    }
  }

  return (
    <div>
      <form
        aria-label="Company symbol detection"
        className="enterprise-form"
        onSubmit={(event) => void saveSetting(event)}
      >
        <p role="status">
          {setting.enabled ? 'Symbol detection is on' : 'Symbol detection is off'}
        </p>
        <label>
          <input
            type="checkbox"
            name="enabled"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={save.isPending}
          />
          Enable square symbol suggestions for this company
        </label>
        <label>
          Reason for the symbol detection setting{' '}
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            disabled={save.isPending}
          />
        </label>
        <button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving symbol detection…' : 'Save symbol detection setting'}
        </button>
        {error && (
          <p className="enterprise-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {setting.recentChanges.length > 0 && (
        <ul aria-label="Symbol detection setting history" className="enterprise-change-history">
          {setting.recentChanges.map((entry) => (
            <li key={entry.revision}>
              <strong>{entry.enabled ? 'Enabled' : 'Disabled'}</strong>
              <span>{entry.reason}</span>
              <time dateTime={entry.createdAt}>{entry.createdAt.slice(0, 10)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TakeoffSquareSuggestions({
  scan,
  preview,
  confirm,
  disabled,
}: {
  scan: () => Promise<readonly TakeoffSquareSuggestion[]>;
  preview: (point: EnterpriseTakeoffPoint | null) => void;
  confirm: (point: EnterpriseTakeoffPoint) => void;
  disabled: boolean;
}) {
  const setting = useDetectionSetting();
  if (setting.isError || !setting.data?.enabled) return null;
  return (
    <SquareList
      key={setting.data.revision}
      scan={async () => {
        const current = await setting.refetch();
        if (current.error) throw current.error;
        return current.data?.enabled ? scan() : [];
      }}
      preview={preview}
      confirm={confirm}
      disabled={disabled}
    />
  );
}

function SquareList({
  scan,
  preview,
  confirm,
  disabled,
}: {
  scan: () => Promise<readonly TakeoffSquareSuggestion[]>;
  preview: (point: EnterpriseTakeoffPoint | null) => void;
  confirm: (point: EnterpriseTakeoffPoint) => void;
  disabled: boolean;
}) {
  const [items, setItems] = useState<readonly TakeoffSquareSuggestion[] | null>(null);
  const detection = useMutation({
    mutationFn: scan,
    onSuccess: (suggestions) => {
      setItems(suggestions);
      preview(null);
    },
  });
  useEffect(() => () => preview(null), [preview]);

  function remove(item: TakeoffSquareSuggestion) {
    setItems((current) => current?.filter((candidate) => candidate !== item) ?? []);
    preview(null);
  }

  return (
    <section aria-label="Unverified square symbols" className="enterprise-stack">
      <button
        type="button"
        disabled={disabled || detection.isPending}
        onClick={() => detection.mutate()}
      >
        {detection.isPending ? 'Finding square symbols…' : 'Find square symbols'}
      </button>
      {detection.isError && (
        <p className="enterprise-error" role="alert">
          {errorHint(detection.error)}
        </p>
      )}
      {items?.length === 0 && <p role="status">No square suggestions to review.</p>}
      {!!items?.length && (
        <ul aria-label="Unverified square suggestions" className="enterprise-change-history">
          {items.map((item) => {
            const location =
              coordinate.format(item.point.x) + ', ' + coordinate.format(item.point.y) + ' pt';
            return (
              <li key={item.point.x + ':' + item.point.y}>
                <strong>Unverified square at {location}</strong>
                <button type="button" disabled={disabled} onClick={() => preview(item.point)}>
                  Show on drawing
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    confirm(item.point);
                    remove(item);
                  }}
                >
                  Confirm square
                </button>
                <button type="button" disabled={disabled} onClick={() => remove(item)}>
                  Dismiss square
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
