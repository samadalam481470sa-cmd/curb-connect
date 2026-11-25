'use client';

import {
  EnterpriseBidCollection,
  EnterpriseBidPackage,
  EnterpriseBidPackageInput,
  EnterpriseBidPackagePage,
  EnterpriseBidQuote,
  EnterpriseBidQuoteInput,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { AwardPurchaseOrder } from './EnterprisePurchasing';

const statuses = {
  collecting: 'Collecting quotes',
  awarded: 'Awarded',
  closed: 'Closed without award',
};
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (minor: number) => usd.format(minor / 100);

function message(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Check the bid fields.';
  if (isApiError(error) || error instanceof Error) return error.message;
  return errorHint(error);
}

function minorUnits(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error('Enter a dollar amount with at most two decimals.');
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function EnterpriseBidding({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'bid-packages', projectId];
  const path = '/v1/enterprise/projects/' + encodeURIComponent(projectId) + '/bid-packages';
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useInfiniteQuery({
    queryKey: [...key, 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { query: { cursor: pageParam }, schema: EnterpriseBidPackagePage }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const detail = useQuery({
    queryKey: [...key, 'detail', selectedId],
    queryFn: () => api.get(path + '/' + selectedId, { schema: EnterpriseBidCollection }),
    enabled: selectedId.length > 0,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const canWrite = session.can('job:write');
  const invalidate = () => client.invalidateQueries({ queryKey: key });

  return (
    <section className="enterprise-panel">
      <header className="enterprise-control-head">
        <div>
          <h2>Vendor bidding</h2>
          <p>Prepare a scope, record received quotes, and document the award decision.</p>
        </div>
        {canWrite && !creating && (
          <button type="button" onClick={() => setCreating(true)}>
            New bid package
          </button>
        )}
      </header>
      {creating && (
        <BidPackageForm
          path={path}
          onCancel={() => setCreating(false)}
          onSaved={async (id) => {
            setSelectedId(id);
            setCreating(false);
            await invalidate();
          }}
        />
      )}
      {list.isPending && <p role="status">Loading bid packages…</p>}
      {list.isError && (
        <p role="alert" className="enterprise-error">
          {message(list.error)}
        </p>
      )}
      {list.isSuccess && !items.length && (
        <p className="enterprise-empty">This project has no bid packages.</p>
      )}
      {!!items.length && (
        <div className="enterprise-vault-layout">
          <div>
            <ul className="enterprise-vault-index">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={item.id === selectedId}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <strong>{item.title}</strong>
                    <span>{statuses[item.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.hasNextPage && (
              <button
                type="button"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                Load more packages
              </button>
            )}
          </div>
          <div>
            {!selectedId && (
              <p className="enterprise-empty">Select a package to view its quotes.</p>
            )}
            {selectedId && detail.isPending && <p role="status">Loading quotes…</p>}
            {detail.isError && (
              <p role="alert" className="enterprise-error">
                {message(detail.error)}
              </p>
            )}
            {detail.data && (
              <>
                <h3>{detail.data.package.title}</h3>
                <p>
                  Quotes due{' '}
                  <time dateTime={detail.data.package.dueOn}>{detail.data.package.dueOn}</time> ·{' '}
                  {statuses[detail.data.package.status]}
                </p>
                <p className="enterprise-bid-scope">{detail.data.package.scope}</p>
                {detail.data.package.decisionNote && (
                  <p>Decision: {detail.data.package.decisionNote}</p>
                )}
                {detail.data.package.status === 'collecting' && canWrite && (
                  <details>
                    <summary>Record a vendor quote</summary>
                    <BidQuoteForm
                      key={selectedId}
                      path={path + '/' + selectedId + '/quotes'}
                      revision={detail.data.package.revision}
                      onSaved={invalidate}
                    />
                  </details>
                )}
                <h4>Quote comparison</h4>
                {!detail.data.quotes.length && (
                  <p className="enterprise-empty">No quotes have been recorded.</p>
                )}
                <ul className="enterprise-change-history">
                  {detail.data.quotes.map((quote) => (
                    <li key={quote.id}>
                      <strong>
                        {quote.vendorName} · {money(quote.amountMinor)}
                        {quote.id === detail.data?.package.awardedQuoteId && ' · Awarded'}
                      </strong>
                      <span>
                        {quote.leadDays} days lead time · Valid through {quote.validThrough}
                      </span>
                      {quote.qualifications && <p>{quote.qualifications}</p>}
                    </li>
                  ))}
                </ul>
                {detail.data.package.status === 'collecting' &&
                  session.can('org:settings_update') && (
                    <BidDecision
                      key={selectedId}
                      path={path + '/' + selectedId + '/decision'}
                      data={detail.data}
                      onSaved={invalidate}
                    />
                  )}
                {detail.data.package.status === 'awarded' && session.can('supplier_order:read') && (
                  <AwardPurchaseOrder
                    key={selectedId}
                    projectId={projectId}
                    packageId={selectedId}
                    awardRevision={detail.data.package.revision}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function BidPackageForm({
  path,
  onCancel,
  onSaved,
}: {
  path: string;
  onCancel: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const { api } = useApi();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const signature = JSON.stringify(values);
    setError('');
    setBusy(true);
    try {
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      const body = EnterpriseBidPackageInput.parse({
        ...values,
        clientRequestId: request.current.id,
      });
      const result = await api.post(path, body, { schema: EnterpriseBidPackage });
      await onSaved(result.id);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
      <label>
        Package name <input name="title" required minLength={2} maxLength={180} />
      </label>
      <label>
        Quotes due date <input name="dueOn" type="date" required />
      </label>
      <label>
        Request scope <textarea name="scope" required minLength={3} maxLength={8000} />
      </label>
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      <div className="enterprise-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save bid package'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function BidQuoteForm({
  path,
  revision,
  onSaved,
}: {
  path: string;
  revision: number;
  onSaved: () => Promise<void>;
}) {
  const { api } = useApi();
  const request = useRef<{ signature: string; id: string; base: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError('');
    setBusy(true);
    try {
      const values = {
        vendorName: data.get('vendorName'),
        amountMinor: minorUnits(String(data.get('amount') ?? '')),
        leadDays: Number(data.get('leadDays')),
        validThrough: data.get('validThrough'),
        qualifications: data.get('qualifications'),
      };
      const signature = JSON.stringify(values);
      if (request.current?.signature !== signature || request.current.base !== revision)
        request.current = { signature, id: crypto.randomUUID(), base: revision };
      const body = EnterpriseBidQuoteInput.parse({
        ...values,
        clientRequestId: request.current.id,
      });
      await api.post(path, body, { ifMatch: revision, schema: EnterpriseBidQuote });
      request.current = null;
      form.reset();
      await onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
      <label>
        Vendor name <input name="vendorName" required minLength={2} maxLength={180} />
      </label>
      <label>
        Bid amount (USD) <input name="amount" inputMode="decimal" required />
      </label>
      <label>
        Lead time in days <input name="leadDays" type="number" min={0} max={3650} required />
      </label>
      <label>
        Valid through <input name="validThrough" type="date" required />
      </label>
      <label>
        Exclusions or qualifications <textarea name="qualifications" maxLength={4000} />
      </label>
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'Recording…' : 'Save vendor quote'}
      </button>
    </form>
  );
}

function BidDecision({
  path,
  data,
  onSaved,
}: {
  path: string;
  data: z.infer<typeof EnterpriseBidCollection>;
  onSaved: () => Promise<void>;
}) {
  const { api } = useApi();
  const decision = useMutation({
    mutationFn: (body: { quoteId: string | null; note: string }) =>
      api.post(path, body, { ifMatch: data.package.revision, schema: EnterpriseBidPackage }),
    onSuccess: onSaved,
  });

  return (
    <form
      className="enterprise-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const id = String(form.get('quote') ?? '');
        decision.mutate({
          quoteId: id === 'close' ? null : id,
          note: String(form.get('note') ?? ''),
        });
      }}
    >
      <label>
        Award decision
        <select name="quote" required defaultValue="">
          <option value="">Select a decision</option>
          {data.quotes.map((quote) => (
            <option key={quote.id} value={quote.id}>
              Award {quote.vendorName} · {money(quote.amountMinor)}
            </option>
          ))}
          <option value="close">Close without award</option>
        </select>
      </label>
      <label>
        Award or close reason <input name="note" required minLength={3} maxLength={1000} />
      </label>
      {decision.isError && (
        <p role="alert" className="enterprise-error">
          {message(decision.error)}
        </p>
      )}
      <button type="submit" disabled={decision.isPending}>
        {decision.isPending ? 'Recording…' : 'Record final decision'}
      </button>
    </form>
  );
}
