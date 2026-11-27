'use client';

import { SalesFollowUpPolicy, SetSalesFollowUpPolicy } from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

const path = '/v1/enterprise/sales/assignment-settings/follow-up-reminders';

export function EnterpriseSalesFollowUpSettings() {
  const { api } = useApi();
  const { orgId } = useSession();
  const client = useQueryClient();
  const key = orgKey(orgId, 'enterprise', 'sales-leads', 'follow-up-reminders');
  const policy = useQuery({
    queryKey: key,
    queryFn: () => api.get(path, { schema: SalesFollowUpPolicy }),
    refetchOnMount: 'always',
  });
  const [draft, setDraft] = useState<{ enabled: boolean; revision: number }>();
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const current = policy.isSuccess && policy.isFetchedAfterMount ? policy.data : undefined;
  const stale = Boolean(draft && current && draft.revision !== current.revision);
  const save = useMutation({
    mutationFn: (value: { body: z.infer<typeof SetSalesFollowUpPolicy>; revision: number }) =>
      api.put(path, value.body, { ifMatch: value.revision, schema: SalesFollowUpPolicy }),
    onSuccess: (updated) => {
      client.setQueryData(key, updated);
      setNotice(
        updated.enabled ? 'Follow-up reminders enabled.' : 'Follow-up reminders turned off.',
      );
      setDraft(undefined);
      setReason('');
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 412) void policy.refetch();
    },
  });

  return (
    <section className="enterprise-panel" aria-label="Follow-up reminder policy">
      <h2>Follow-up reminder policy</h2>
      {!current && !policy.isError && (
        <Skeleton variant="card" label="Loading follow-up reminder policy" />
      )}
      {policy.isError && (
        <SalesLeadFailure error={policy.error} retry={() => void policy.refetch()} />
      )}
      {current && (
        <>
          <p>
            {current.enabled ? 'On' : 'Off'} ·{' '}
            {current.revision ? 'Revision ' + current.revision : 'Pipeline default'}
          </p>
          {notice && <p role="status">{notice}</p>}
          <form
            className="enterprise-form"
            aria-label="Save follow-up reminder policy"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft || stale || save.isPending || draft.enabled === current.enabled) return;
              const input = { enabled: draft.enabled, reason };
              const signature = JSON.stringify([input, draft.revision]);
              if (receipt.current?.signature !== signature)
                receipt.current = { signature, id: crypto.randomUUID() };
              const body = SetSalesFollowUpPolicy.parse({
                ...input,
                clientRequestId: receipt.current.id,
              });
              save.mutate({ body, revision: draft.revision });
            }}
          >
            <label className="enterprise-finance-disclosure-choice">
              <input
                type="checkbox"
                checked={draft?.enabled ?? current.enabled}
                disabled={save.isPending}
                onChange={(event) =>
                  setDraft({ enabled: event.currentTarget.checked, revision: current.revision })
                }
              />
              Create internal follow-up reminders
            </label>
            {draft && (
              <>
                <p>
                  {draft.enabled
                    ? 'New follow-ups can send an in-app reminder to the current lead owner.'
                    : 'Pending reminders stop. Follow-up tasks stay on each lead.'}
                </p>
                <label>
                  Reminder policy reason
                  <textarea
                    value={reason}
                    minLength={3}
                    maxLength={1000}
                    required
                    disabled={save.isPending}
                    onChange={(event) => setReason(event.currentTarget.value)}
                  />
                </label>
                {stale && (
                  <div role="status" className="enterprise-budget-adjustment">
                    <p>
                      Revision {current.revision} is {current.enabled ? 'on' : 'off'}. Review the
                      new setting.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft({ ...draft, revision: current.revision });
                        save.reset();
                      }}
                    >
                      Use current reminder policy
                    </button>
                  </div>
                )}
                <div className="enterprise-forecast-form-actions">
                  <button
                    type="submit"
                    disabled={
                      save.isPending ||
                      stale ||
                      draft.enabled === current.enabled ||
                      reason.trim().length < 3
                    }
                  >
                    Save follow-up policy
                  </button>
                  <button
                    type="button"
                    disabled={save.isPending}
                    onClick={() => {
                      setDraft(undefined);
                      setReason('');
                      save.reset();
                    }}
                  >
                    Cancel reminder change
                  </button>
                </div>
              </>
            )}
            {save.isError && <SalesLeadFailure error={save.error} />}
          </form>
          {current.history.length > 0 && (
            <ol
              className="enterprise-change-history"
              aria-label="Follow-up reminder policy history"
            >
              {current.history.map(({ revision, enabled, reason }) => (
                <li key={revision}>
                  <strong>
                    Revision {revision} · {enabled ? 'On' : 'Off'}
                  </strong>
                  <span>{reason}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
