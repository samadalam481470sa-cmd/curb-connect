'use client';

import {
  SalesDuplicatePolicy,
  SalesDuplicatePolicyHistory,
  type UpdateSalesDuplicatePolicy,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

const path = '/v1/enterprise/sales/duplicate-policy';
type Policy = z.infer<typeof SalesDuplicatePolicy>;

export function SalesDuplicateSettings() {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise', 'sales-duplicate-policy');
  const allowed = session.can('enterprise_sales:manage');
  const query = useQuery({
    queryKey: key,
    enabled: allowed,
    refetchOnMount: 'always',
    queryFn: () => api.get(path, { schema: SalesDuplicatePolicyHistory }),
  });
  const denied =
    !allowed || (isApiError(query.error) && [401, 403, 404].includes(query.error.status));
  const [change, setChange] = useState<{ revision: number; enabled: boolean; id: string }>();
  const mutation = useMutation({
    mutationFn: ({
      revision,
      ...body
    }: z.infer<typeof UpdateSalesDuplicatePolicy> & { revision: number }) =>
      api.put(path, body, { ifMatch: revision, schema: SalesDuplicatePolicy }),
    onSuccess: (saved) => {
      client.setQueryData<z.infer<typeof SalesDuplicatePolicyHistory>>(key, (prior) =>
        prior
          ? {
              current: saved,
              recent: [
                saved,
                ...prior.recent.filter((row) => row.revision !== saved.revision),
              ].slice(0, 10),
            }
          : undefined,
      );
      setChange(undefined);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 412) void query.refetch();
    },
  });
  const data = !denied && query.isFetchedAfterMount ? query.data : undefined;
  function edit(policy: Policy) {
    mutation.reset();
    setChange({ revision: policy.revision, enabled: !policy.enabled, id: crypto.randomUUID() });
  }
  const stale = data && change && data.current.revision !== change.revision;
  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href="/enterprise/sales/leads" className="enterprise-back">
          ← Sales leads
        </Link>
        <h1>Duplicate warning</h1>
      </header>
      {denied && <p role="alert">Sales duplicate settings are unavailable.</p>}
      {!denied && query.isPending && <Skeleton variant="card" label="Loading duplicate warning" />}
      {!denied && query.isError && (
        <SalesLeadFailure error={query.error} retry={() => void query.refetch()} />
      )}
      {data && (
        <div className="enterprise-stack">
          <section className="enterprise-panel" aria-label="Company duplicate warning">
            <h2>Company duplicate warning</h2>
            <p role="status">
              {data.current.enabled ? 'On' : 'Off'} ·{' '}
              {data.current.revision ? 'Revision ' + data.current.revision : 'Default'}
            </p>
            <p>
              When enabled, lead intake compares normalized email and phone with leads you can
              access. The warning leaves recorded consent and intake retry protection in effect.
            </p>
            {!change && (
              <button type="button" onClick={() => edit(data.current)}>
                {data.current.enabled ? 'Review turning off' : 'Review turning on'}
              </button>
            )}
            {change && (
              <form
                className="enterprise-form"
                aria-label="Change duplicate warning"
                onChange={() => {
                  if (mutation.isError && !stale) {
                    mutation.reset();
                    setChange({ ...change, id: crypto.randomUUID() });
                  }
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (mutation.isPending || stale || query.isFetching) return;
                  const reason = String(
                    new FormData(event.currentTarget).get('reason') ?? '',
                  ).trim();
                  mutation.mutate({
                    revision: change.revision,
                    enabled: change.enabled,
                    reason,
                    clientRequestId: change.id,
                  });
                }}
              >
                <p>
                  {change.enabled
                    ? 'New intake will show matching existing leads.'
                    : 'New intake will omit duplicate warnings and comparisons.'}
                </p>
                {stale && (
                  <p role="alert">
                    This setting changed while you were reviewing it. The last saved revision is{' '}
                    {data.current.revision}.
                  </p>
                )}
                {stale && (
                  <button type="button" onClick={() => edit(data.current)}>
                    Review current revision
                  </button>
                )}
                <label>
                  Reason
                  <textarea
                    name="reason"
                    minLength={3}
                    maxLength={1000}
                    required
                    disabled={mutation.isPending}
                  />
                </label>
                <button
                  type="submit"
                  disabled={mutation.isPending || Boolean(stale) || query.isFetching}
                >
                  {mutation.isPending ? 'Saving…' : 'Save duplicate warning'}
                </button>
                <button
                  type="button"
                  onClick={() => setChange(undefined)}
                  disabled={mutation.isPending}
                >
                  Cancel
                </button>
                {mutation.error && <SalesLeadFailure error={mutation.error} />}
              </form>
            )}
          </section>
          <section className="enterprise-panel" aria-label="Duplicate warning history">
            <h2>Change history</h2>
            {!data.recent.length && <p>No changes recorded.</p>}
            <ol className="enterprise-change-history">
              {data.recent.map((row) => (
                <li key={row.revision}>
                  <strong>
                    {row.enabled ? 'On' : 'Off'} · Revision {row.revision}
                  </strong>
                  <span>
                    {row.updatedBy}
                    {row.updatedAt && ' · ' + new Date(row.updatedAt).toLocaleString()}
                  </span>
                  <p>{row.reason}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </main>
  );
}
