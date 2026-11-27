'use client';

import {
  type SalesPipelineFilters,
  SalesOpportunityProbability,
  SalesRevenuePipeline,
  SalesRevenuePreference,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { formatMinorUnits } from '@fieldline/ui';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

const revenue = '/v1/enterprise/sales/pipeline/revenue';
type Filters = z.infer<typeof SalesPipelineFilters>;

export function SalesRevenueControl({ filters }: { filters: Filters }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise', 'sales-revenue');
  const queryKey = [...key, filters];
  const query = useQuery({
    queryKey,
    queryFn: () => api.get(revenue, { query: filters, schema: SalesRevenuePipeline }),
    refetchOnMount: 'always',
  });
  const save = useMutation({
    mutationFn: (input: { enabled: boolean; revision: number }) =>
      api.put(
        revenue,
        { enabled: input.enabled },
        { ifMatch: input.revision, schema: SalesRevenuePreference },
      ),
    onSuccess: (preference) => {
      client.setQueryData<z.infer<typeof SalesRevenuePipeline>>(queryKey, (current) => {
        if (!current) return;
        return { preference, forecast: preference.enabled ? current.forecast : null };
      });
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 412) void query.refetch();
    },
  });
  const denied = isApiError(query.error) && [401, 403, 404].includes(query.error.status);
  const data = query.isFetchedAfterMount && !denied ? query.data : undefined;
  if (!data && !query.isError) return null;
  return (
    <section className="enterprise-panel" aria-label="Projected sales revenue">
      <h2>Projected revenue</h2>
      {query.isError && <SalesLeadFailure error={query.error} retry={() => void query.refetch()} />}
      {data && (
        <>
          <label>
            <input
              type="checkbox"
              checked={data.preference.enabled}
              disabled={save.isPending || query.isFetching}
              onChange={(event) =>
                save.mutate({ enabled: event.target.checked, revision: data.preference.revision })
              }
            />
            Show projected revenue
          </label>
          {save.isPending && <p role="status">Saving revenue preference…</p>}
          {save.error && <SalesLeadFailure error={save.error} />}
          {data.preference.enabled && data.forecast && (
            <>
              <p>
                Forecast from approved prices and recorded probabilities for the selected open
                opportunities.
              </p>
              <dl>
                {data.forecast.totals.map((total) => (
                  <div key={total.currency}>
                    <dt>{total.currency}</dt>
                    <dd>
                      {formatMinorUnits(
                        BigInt(total.projectedMinor),
                        total.currency,
                        session.me.user.locale,
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {!data.forecast.includedCount && (
                <p>
                  No opportunities in this view have both approved pricing and a recorded
                  probability.
                </p>
              )}
              {data.forecast.missingInputsCount > 0 && (
                <p>{data.forecast.missingInputsCount} missing approved pricing or probability.</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function SalesOpportunityProbabilityControl({ opportunityId }: { opportunityId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const target = '/v1/enterprise/sales/opportunities/' + opportunityId + '/probability';
  const key = orgKey(session.orgId, 'enterprise', 'sales-probability', opportunityId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get(target, { schema: SalesOpportunityProbability }),
    refetchOnMount: 'always',
  });
  const save = useMutation({
    mutationFn: (input: {
      probability: string;
      reason: string;
      revision: number;
      clientRequestId: string;
    }) =>
      api.put(
        target,
        {
          basisPoints: Math.round(Number(input.probability) * 100),
          reason: input.reason,
          clientRequestId: input.clientRequestId,
        },
        { ifMatch: input.revision, schema: SalesOpportunityProbability },
      ),
    onSuccess: (saved) => {
      client.setQueryData(key, saved);
      void client.invalidateQueries({
        queryKey: orgKey(session.orgId, 'enterprise', 'sales-revenue'),
      });
      setEditing(false);
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 412) void query.refetch();
    },
  });
  const denied = isApiError(query.error) && [401, 403, 404].includes(query.error.status);
  const current = query.isFetchedAfterMount && !denied ? query.data : undefined;
  const [requestId, setRequestId] = useState<string>();
  const [baseRevision, setBaseRevision] = useState(0);
  const stale = current && current.revision !== baseRevision;
  if (!current && !query.isError) return null;
  const percent =
    current?.basisPoints !== null && current?.basisPoints !== undefined
      ? (current.basisPoints / 100).toLocaleString(session.me.user.locale) + '%'
      : 'Unrecorded';
  return (
    <section className="enterprise-panel" aria-label="Opportunity forecast probability">
      <h2>Forecast probability</h2>
      {query.isError && <SalesLeadFailure error={query.error} retry={() => void query.refetch()} />}
      {current && (
        <>
          <p>
            {percent} · Revision {current.revision}
          </p>
          {current.reason && <p>{current.reason}</p>}
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setErrorText('');
                save.reset();
                setRequestId(crypto.randomUUID());
                setBaseRevision(current.revision);
                setEditing(true);
              }}
            >
              Record forecast probability
            </button>
          )}
          {editing && (
            <form
              className="enterprise-form"
              aria-label="Record forecast probability"
              onChange={() => {
                if (save.isError) {
                  save.reset();
                  setRequestId(crypto.randomUUID());
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                if (!requestId || save.isPending || query.isFetching || stale) return;
                const values = new FormData(event.currentTarget);
                const reason = String(values.get('reason') ?? '').trim();
                if (reason.length < 3) {
                  setErrorText('Enter a reason with at least three characters.');
                  return;
                }
                setErrorText('');
                save.mutate({
                  probability: String(values.get('probability')),
                  reason,
                  revision: current.revision,
                  clientRequestId: requestId,
                });
              }}
            >
              {stale && (
                <div role="status">
                  <p>
                    You opened revision {baseRevision}. The current probability is {percent}.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setBaseRevision(current.revision);
                      setRequestId(crypto.randomUUID());
                      save.reset();
                    }}
                  >
                    Use current revision
                  </button>
                </div>
              )}
              <label>
                Probability (%)
                <input
                  required
                  name="probability"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  defaultValue={current.basisPoints === null ? '' : current.basisPoints / 100}
                  disabled={save.isPending}
                />
              </label>
              <label>
                Reason
                <textarea
                  name="reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  disabled={save.isPending}
                />
              </label>
              <button type="submit" disabled={save.isPending || query.isFetching || Boolean(stale)}>
                {save.isPending ? 'Saving…' : 'Save probability'}
              </button>
              <button type="button" disabled={save.isPending} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          )}
          {errorText && <p role="alert">{errorText}</p>}
          {editing && save.error && <SalesLeadFailure error={save.error} />}
        </>
      )}
    </section>
  );
}
