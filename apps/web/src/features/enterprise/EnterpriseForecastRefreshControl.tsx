'use client';

import {
  EnterpriseForecastRefreshSettings,
  SetEnterpriseForecastRefresh,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

export function EnterpriseForecastRefreshControl({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise', 'forecast-refresh', projectId);
  const target = '/v1/enterprise/projects/' + projectId + '/forecasts/settings/refresh';
  const view = useQuery({
    queryKey: key,
    refetchOnMount: 'always',
    queryFn: () => api.get(target, { schema: EnterpriseForecastRefreshSettings }),
  });
  const [draft, setDraft] = useState<{ enabled: boolean; revision: number } | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const save = useMutation({
    mutationFn: async (selection: NonNullable<typeof draft>) => {
      const signature = JSON.stringify([selection.enabled, selection.revision, reason]);
      if (requestRef.current?.signature !== signature)
        requestRef.current = { signature, id: crypto.randomUUID() };
      const input = SetEnterpriseForecastRefresh.parse({
        enabled: selection.enabled,
        reason,
        clientRequestId: requestRef.current.id,
      });
      return api.put(target, input, {
        ifMatch: selection.revision,
        schema: EnterpriseForecastRefreshSettings,
      });
    },
    onSuccess: (saved) => {
      client.setQueryData(key, saved);
      setStatus('Forecast refresh setting saved.');
      setDraft(null);
      setReason('');
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 412) void view.refetch();
    },
  });

  if (view.isPending) return <p role="status">Loading forecast refresh.</p>;
  if (view.isError)
    return (
      <div role="alert">
        <p>{errorHint(view.error)}</p>
        <button type="button" onClick={() => void view.refetch()}>
          Retry forecast refresh
        </button>
      </div>
    );
  const current = view.data;
  const changed = draft && draft.revision !== current.revision;
  const mayWrite = session.can('enterprise_budget:approve');
  return (
    <section aria-label="Automatic forecast refresh">
      <h3>Automatic forecast refresh</h3>
      <p>
        {current.enabled ? 'On after approved costs and changes' : 'Off'} ·{' '}
        {current.revision ? 'Version ' + current.revision : 'Project default'}
      </p>
      {current.enabled && !current.ready && (
        <p>Save a forecast with approved assumptions to start automatic refreshes.</p>
      )}
      {status && <p role="status">{status}</p>}
      {mayWrite && !view.isRefetching && (
        <form
          className="enterprise-form"
          aria-label="Save forecast refresh setting"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft && !changed && !save.isPending) save.mutate(draft);
          }}
        >
          <label>
            Forecast refresh
            <select
              value={(draft?.enabled ?? current.enabled) ? 'on' : 'off'}
              disabled={save.isPending}
              onChange={(event) => {
                setStatus('');
                setDraft({ enabled: event.target.value === 'on', revision: current.revision });
              }}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          {draft && (
            <>
              <label>
                Reason
                <textarea
                  value={reason}
                  minLength={3}
                  maxLength={1000}
                  required
                  disabled={save.isPending}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              {changed && (
                <div role="alert">
                  <p>
                    Version {current.revision} is active. Review that setting before applying your
                    change.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({ ...draft, revision: current.revision });
                      save.reset();
                    }}
                  >
                    Review current revision
                  </button>
                </div>
              )}
              {save.isError && <p role="alert">{errorHint(save.error)}</p>}
              <button
                type="submit"
                disabled={save.isPending || Boolean(changed) || reason.trim().length < 3}
              >
                Save forecast refresh
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => {
                  setDraft(null);
                  setReason('');
                  save.reset();
                }}
              >
                Cancel
              </button>
            </>
          )}
        </form>
      )}
      {current.history.length > 0 && (
        <details>
          <summary>Forecast refresh history</summary>
          <ol className="enterprise-change-history">
            {current.history.map((item) => (
              <li key={item.id}>
                <strong>
                  Version {item.revision} · {item.enabled ? 'On' : 'Off'}
                </strong>
                <p>{item.reason}</p>
                <time dateTime={item.recordedAt}>{new Date(item.recordedAt).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
