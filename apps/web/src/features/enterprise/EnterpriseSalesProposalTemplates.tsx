'use client';

import {
  ApproveSalesProposalTemplate,
  SalesProposalTemplate,
  SalesProposalTemplateList,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

const target = '/v1/enterprise/sales/proposal-templates';
type Template = z.infer<typeof SalesProposalTemplate>;
const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function EnterpriseSalesProposalTemplates() {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const permitted = session.can('estimate:approve');
  const key = orgKey(session.orgId, 'enterprise', 'sales-leads');
  const view = useQuery({
    queryKey: [...key, 'proposal-templates'],
    queryFn: () => api.get(target, { schema: SalesProposalTemplateList }),
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
        <h1>Sales proposal templates</h1>
      </header>
      {denied && <p role="alert">These proposal templates are unavailable.</p>}
      {!denied && pending && <Skeleton variant="card" label="Loading proposal templates" />}
      {!denied && view.isError && (
        <SalesLeadFailure error={view.error} retry={() => void view.refetch()} />
      )}
      {!denied && !pending && view.data && (
        <TemplateForm
          items={view.data.items}
          refresh={() => void client.invalidateQueries({ queryKey: key })}
        />
      )}
    </main>
  );
}

function TemplateForm({ items, refresh }: { items: Template[]; refresh: () => void }) {
  const { api } = useApi();
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');
  const [version, setVersion] = useState(0);
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  function latest(value: string) {
    return items
      .filter((item) => item.name.toLowerCase() === value.trim().toLowerCase())
      .reduce((prior, item) => Math.max(prior, item.revision), 0);
  }
  const current = latest(name);
  const stale = current > version;
  const save = useMutation({
    mutationFn: (data: z.infer<typeof ApproveSalesProposalTemplate>) =>
      api.post(target + '/approval', data, { ifMatch: version, schema: SalesProposalTemplate }),
    onSuccess: (template) => {
      setNotice('Approved ' + template.name + ' revision ' + template.revision + '.');
      setVersion(template.revision);
      refresh();
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 412) refresh();
    },
  });
  return (
    <div className="enterprise-stack">
      <section className="enterprise-panel" aria-label="Approve a sales proposal template">
        <h2>Approve proposal terms</h2>
        {notice && <p role="status">{notice}</p>}
        <form
          className="enterprise-form"
          aria-label="Approve proposal template"
          onSubmit={(event) => {
            event.preventDefault();
            if (save.isPending || stale) return;
            const form = new FormData(event.currentTarget);
            const field = (key: string) => String(form.get(key) ?? '').trim();
            const input = {
              name,
              terms: lines(field('terms')),
              paymentTerms: lines(field('paymentTerms')),
              taxTreatment: field('taxTreatment'),
              reason: field('reason'),
            };
            const signature = JSON.stringify([input, version]);
            if (receipt.current?.signature !== signature)
              receipt.current = { signature, id: crypto.randomUUID() };
            const parsed = ApproveSalesProposalTemplate.safeParse({
              ...input,
              clientRequestId: receipt.current.id,
            });
            if (!parsed.success) {
              setValidation(parsed.error.issues[0]?.message ?? 'Review proposed template terms.');
              return;
            }
            setValidation('');
            save.mutate(parsed.data);
          }}
        >
          <label>
            Template name
            <input
              value={name}
              minLength={3}
              maxLength={200}
              required
              disabled={save.isPending}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setName(value);
                setVersion(latest(value));
                setNotice('');
              }}
            />
          </label>
          <label>
            Proposal terms, one item per line
            <textarea name="terms" required disabled={save.isPending} />
          </label>
          <label>
            Payment terms, one item per line
            <textarea name="paymentTerms" required disabled={save.isPending} />
          </label>
          <label>
            Tax treatment
            <input name="taxTreatment" required maxLength={500} disabled={save.isPending} />
          </label>
          <label>
            Approval reason
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={1000}
              disabled={save.isPending}
            />
          </label>
          {stale && (
            <div role="status" className="enterprise-budget-adjustment">
              <p>Review the current template revision {current} before approving.</p>
              <button
                type="button"
                onClick={() => {
                  setVersion(current);
                  save.reset();
                }}
              >
                Use current template revision
              </button>
            </div>
          )}
          {validation && <p role="alert">{validation}</p>}
          {save.isError && <SalesLeadFailure error={save.error} />}
          <div className="enterprise-forecast-form-actions">
            <button type="submit" disabled={save.isPending || stale}>
              Approve proposal template
            </button>
          </div>
        </form>
      </section>
      <section className="enterprise-panel" aria-label="Approved proposal template revisions">
        <h2>Approved revisions</h2>
        {!items.length && <p>No proposal terms have been approved.</p>}
        <ul className="enterprise-change-history">
          {items.map((item) => (
            <li key={item.id}>
              <strong>
                {item.name} · Revision {item.revision}
              </strong>
              <span>{item.reason}</span>
              <ul>
                {item.terms.map((term, index) => (
                  <li key={index}>{term}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
