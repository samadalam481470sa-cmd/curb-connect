'use client';

import { ApproveSalesEstimateTemplate, SalesEstimateTemplateControls } from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

const path = '/v1/enterprise/sales/estimate-templates';
type Controls = z.infer<typeof SalesEstimateTemplateControls>;

export function EnterpriseSalesEstimateTemplates() {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const permitted = session.can('estimate:approve');
  const key = orgKey(session.orgId, 'enterprise', 'sales-leads');
  const view = useQuery({
    queryKey: [...key, 'estimate-templates'],
    queryFn: () => api.get(path, { schema: SalesEstimateTemplateControls }),
    enabled: permitted,
    refetchOnMount: 'always',
  });
  const denied =
    !permitted || (isApiError(view.error) && [401, 403, 404].includes(view.error.status));
  const pending = view.isPending || (view.isFetching && !view.isFetchedAfterMount);
  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href="/enterprise/sales/pipeline" className="enterprise-back">
          ← Sales pipeline
        </Link>
        <h1>Sales estimate templates</h1>
      </header>
      {denied && <p role="alert">Sales estimate templates are unavailable.</p>}
      {!denied && pending && <Skeleton variant="card" label="Loading estimate templates" />}
      {!denied && view.isError && (
        <SalesLeadFailure error={view.error} retry={() => void view.refetch()} />
      )}
      {!denied && !pending && view.data && (
        <TemplateForm
          data={view.data}
          refresh={() => void client.invalidateQueries({ queryKey: key })}
        />
      )}
    </main>
  );
}

function TemplateForm({ data, refresh }: { data: Controls; refresh: () => void }) {
  const { api } = useApi();
  const [sourceId, setSource] = useState('');
  const [reviewed, setReviewed] = useState(0);
  const [labor, setLabor] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const current = (id: string) =>
    data.approved
      .filter(({ sourceTemplateId }) => sourceTemplateId === id)
      .reduce((high, item) => Math.max(high, item.revision), 0);
  const detected = current(sourceId);
  const stale = detected > reviewed;
  const save = useMutation({
    mutationFn: () => {
      const input = { sourceTemplateId: sourceId, laborAssumptions: labor, reason };
      const signature = JSON.stringify([input, reviewed]);
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      const body = ApproveSalesEstimateTemplate.parse({
        ...input,
        clientRequestId: receipt.current.id,
      });
      return api.post(path + '/approval', body, {
        ifMatch: reviewed,
        schema: SalesEstimateTemplateControls.shape.approved.element,
      });
    },
    onSuccess: (result) => {
      setReviewed(result.revision);
      setLabor('');
      setReason('');
      setNotice('Approved ' + result.name + ' revision ' + result.revision + '.');
      refresh();
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 412) refresh();
    },
  });

  return (
    <div className="enterprise-stack">
      <section className="enterprise-panel" aria-label="Approve an estimate template">
        <h2>Approve an estimate template</h2>
        {notice && <p role="status">{notice}</p>}
        {data.sources.length ? (
          <form
            className="enterprise-form"
            aria-label="Approve sales template revision"
            onSubmit={(event) => {
              event.preventDefault();
              if (sourceId && !stale && !save.isPending) save.mutate();
            }}
          >
            <label>
              Source template
              <select
                value={sourceId}
                required
                disabled={save.isPending}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setSource(next);
                  setReviewed(current(next));
                  setNotice('');
                }}
              >
                <option value="">Choose an active template</option>
                {data.sources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Default labor assumptions
              <textarea
                value={labor}
                required
                minLength={3}
                maxLength={4000}
                disabled={save.isPending}
                onChange={(event) => setLabor(event.currentTarget.value)}
              />
            </label>
            <label>
              Approval reason
              <textarea
                value={reason}
                required
                minLength={3}
                maxLength={1000}
                disabled={save.isPending}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </label>
            {stale && (
              <div role="status" className="enterprise-budget-adjustment">
                <p>
                  Approval revision {detected} replaced revision {reviewed}. Review the current
                  approval list.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setReviewed(detected);
                    save.reset();
                  }}
                >
                  Use current template revision
                </button>
              </div>
            )}
            {save.isError && <SalesLeadFailure error={save.error} />}
            <div className="enterprise-forecast-form-actions">
              <button
                type="submit"
                disabled={
                  !sourceId ||
                  stale ||
                  save.isPending ||
                  labor.trim().length < 3 ||
                  reason.trim().length < 3
                }
              >
                Approve template revision
              </button>
            </div>
          </form>
        ) : (
          <p>Save an active estimate template before approving it for Sales.</p>
        )}
      </section>
      <section className="enterprise-panel" aria-label="Approved sales template revisions">
        <h2>Approved revisions</h2>
        {!data.approved.length && <p>No revisions have been approved for Sales.</p>}
        <ul className="enterprise-change-history">
          {data.approved.map((item) => (
            <li key={item.id}>
              {item.name} · Revision {item.revision}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
