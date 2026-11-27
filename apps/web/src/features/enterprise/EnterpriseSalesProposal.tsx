'use client';

import {
  GenerateSalesProposal,
  SalesProposalOptions,
  SalesProposalReceipt,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinorUnits, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

type Options = z.infer<typeof SalesProposalOptions>;
type Receipt = z.infer<typeof SalesProposalReceipt>;

export function EnterpriseSalesProposal({ opportunityId }: { opportunityId: string }) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const permitted = session.can('enterprise_sales:intake');
  const key = orgKey(session.orgId, 'enterprise', 'sales-leads');
  const source = '/enterprise/sales/opportunities/' + opportunityId;
  const target = '/v1' + source + '/proposals';
  const query = useQuery({
    queryKey: [...key, 'proposal', opportunityId],
    queryFn: () => api.get(target, { schema: SalesProposalOptions }),
    enabled: permitted,
    refetchOnMount: 'always',
  });
  const denied =
    !permitted || (isApiError(query.error) && [401, 403, 404].includes(query.error.status));
  const pending = query.isPending || (query.isFetching && !query.isFetchedAfterMount);
  const view = !denied && !pending ? query.data : undefined;
  const [receipt, setReceipt] = useState<Receipt>();
  const saved = view?.existing ?? receipt;
  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href={source} className="enterprise-back">
          ← Sales opportunity
        </Link>
        <h1>Sales proposal</h1>
        {view && <p>{view.opportunityName}</p>}
      </header>
      {denied && <p role="alert">This sales proposal is unavailable.</p>}
      {!denied && pending && <Skeleton variant="card" label="Loading sales proposal" />}
      {!denied && query.isError && (
        <SalesLeadFailure error={query.error} retry={() => void query.refetch()} />
      )}
      {view && (
        <section className="enterprise-panel" aria-label="Approved sales proposal">
          {saved ? (
            <>
              <h2>{saved.proposalNumber}</h2>
              <dl>
                <dt>Approved proposal total</dt>
                <dd>
                  {formatMinorUnits(
                    BigInt(saved.totalMinor),
                    saved.currency,
                    session.me.user.locale,
                  )}
                </dd>
                <dt>Valid through</dt>
                <dd>{saved.validUntil}</dd>
              </dl>
              <a href={target + '/pdf'} download>
                Download proposal PDF
              </a>
              <p>Prepared for review. Delivery is a separate action.</p>
            </>
          ) : (
            <>
              <h2>Generate approved proposal</h2>
              <nav className="enterprise-media-toolbar" aria-label="Proposal sources">
                <Link href={source + '/estimate/pricing'}>Review approved pricing</Link>
                {session.can('estimate:approve') && (
                  <Link href="/enterprise/sales/proposal-templates">
                    Approve proposal templates
                  </Link>
                )}
              </nav>
              {!view.approvedEstimateId && <p>Approve the opportunity estimate pricing first.</p>}
              {view.approvedEstimateId && view.approvedTotalMinor !== null && view.currency && (
                <p>
                  Approved sell total{' '}
                  {formatMinorUnits(
                    BigInt(view.approvedTotalMinor),
                    view.currency,
                    session.me.user.locale,
                  )}
                </p>
              )}
              {view.approvedEstimateId && !view.eligibleContacts.length && (
                <p>
                  Record an active CRM contact matching this buyer before generating a proposal.
                </p>
              )}
              {view.approvedEstimateId && !view.templates.length && (
                <p>Approve a proposal template before generating the document.</p>
              )}
              {view.canGenerate && (
                <ProposalForm
                  view={view}
                  target={target}
                  refresh={() => void query.refetch()}
                  onSaved={(data) => {
                    setReceipt(data);
                    void client.invalidateQueries({ queryKey: key });
                  }}
                />
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}

function ProposalForm({
  view,
  target,
  refresh,
  onSaved,
}: {
  view: Options;
  target: string;
  refresh: () => void;
  onSaved: (receipt: Receipt) => void;
}) {
  const { api } = useApi();
  const current = useRef<{ signature: string; id: string } | null>(null);
  const [version, setVersion] = useState(view.revision);
  const stale = version < view.revision;
  const save = useMutation({
    mutationFn: (input: z.infer<typeof GenerateSalesProposal>) =>
      api.post(target, input, { ifMatch: version, schema: SalesProposalReceipt }),
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && [409, 412].includes(error.status)) refresh();
    },
  });
  return (
    <form
      className="enterprise-form"
      aria-label="Generate sales proposal"
      onSubmit={(event) => {
        event.preventDefault();
        if (stale || save.isPending) return;
        const form = new FormData(event.currentTarget);
        const input = {
          estimateRevisionId: view.approvedEstimateId,
          templateRevisionId: form.get('templateRevisionId'),
          contactId: form.get('contactId'),
          validUntil: form.get('validUntil'),
        };
        const signature = JSON.stringify([input, version]);
        if (current.current?.signature !== signature)
          current.current = { signature, id: crypto.randomUUID() };
        save.mutate(GenerateSalesProposal.parse({ ...input, clientRequestId: current.current.id }));
      }}
    >
      <label>
        Buyer contact
        <select name="contactId" required disabled={save.isPending}>
          <option value="">Choose a matching contact</option>
          {view.eligibleContacts.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name} · {person.customerName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Approved proposal template
        <select name="templateRevisionId" required disabled={save.isPending}>
          <option value="">Choose a template</option>
          {view.templates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · Revision {item.revision}
            </option>
          ))}
        </select>
      </label>
      <label>
        Valid through
        <input
          name="validUntil"
          type="date"
          min={view.earliestExpiration}
          required
          disabled={save.isPending}
        />
      </label>
      {stale && (
        <div className="enterprise-budget-adjustment" role="status">
          <p>Review current opportunity revision {view.revision} before continuing.</p>
          <button
            type="button"
            onClick={() => {
              setVersion(view.revision);
              save.reset();
            }}
          >
            Use current opportunity revision
          </button>
        </div>
      )}
      {save.isError && <SalesLeadFailure error={save.error} />}
      <div className="enterprise-forecast-form-actions">
        <button type="submit" disabled={stale || save.isPending}>
          {save.isPending ? 'Preparing…' : 'Generate proposal PDF'}
        </button>
      </div>
    </form>
  );
}
