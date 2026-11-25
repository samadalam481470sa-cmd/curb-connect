'use client';

import {
  canEditChangePricing,
  ChangePricingHistory,
  ChangePricingInput,
  ChangePricingRevision,
  EnterpriseDocumentDetail,
  EnterpriseDocumentPage,
  priceChangeLines,
} from '@fieldline/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import type { ChangeOrderRecord } from './schemas';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (minor: number) => currency.format(minor / 100);

function displayError(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Check the pricing fields.';
  if (isApiError(error) || error instanceof Error) return error.message;
  return errorHint(error);
}

export function EnterpriseChangePricing({ order }: { order: ChangeOrderRecord }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise');
  const path = '/v1/enterprise/change-orders/' + order.id + '/pricing';
  const projectPath = '/v1/enterprise/projects/' + order.projectId;
  const history = useQuery({
    queryKey: [...key, 'change-pricing', order.id],
    queryFn: () => api.get(path, { schema: ChangePricingHistory }),
  });
  const [editing, setEditing] = useState(false);
  const current = history.data?.items[0];

  return (
    <section className="enterprise-panel">
      <header className="enterprise-control-head">
        <h2>Scope and line pricing</h2>
        {session.can('job:write') &&
          canEditChangePricing(order.status) &&
          history.isSuccess &&
          !editing && (
            <button type="button" onClick={() => setEditing(true)}>
              {current ? 'Revise pricing' : 'Add line pricing'}
            </button>
          )}
      </header>
      {history.isPending && <p role="status">Loading pricing revisions…</p>}
      {history.isError && (
        <p role="alert" className="enterprise-error">
          {displayError(history.error)}
        </p>
      )}
      {history.isSuccess && !current && (
        <p>This order carries a single amount of {money(order.amountDeltaMinor)}.</p>
      )}
      {editing && (
        <PricingForm
          key={order.revision}
          order={order}
          current={current}
          path={path}
          projectPath={projectPath}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await client.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      {current && <PricingRevision item={current} projectPath={projectPath} />}
      {history.data && history.data.items.length > 1 && (
        <details>
          <summary>Earlier pricing revisions</summary>
          {history.data.items.slice(1).map((item) => (
            <PricingRevision key={item.id} item={item} projectPath={projectPath} />
          ))}
        </details>
      )}
    </section>
  );
}

function PricingRevision({
  item,
  projectPath,
}: {
  item: ChangePricingRevision;
  projectPath: string;
}) {
  return (
    <section className="enterprise-price-revision">
      <h3>
        Revision {item.orderRevision} · {money(item.totalMinor)}
      </h3>
      <p>{item.revisionNote}</p>
      <p>{item.scope}</p>
      <p>Schedule impact {item.scheduleImpactDays} days</p>
      {!!item.evidenceVersionId && (
        <a
          className="enterprise-back"
          href={projectPath + '/document-versions/' + item.evidenceVersionId + '/download'}
          download
        >
          Download attached document version
        </a>
      )}
      <ul className="enterprise-change-history">
        {item.lines.map((line, index) => (
          <li key={index}>
            <strong>
              {line.description} · {money(line.totalMinor)}
            </strong>
            <span>
              {line.quantityMilli / 1000} {line.unit} × {money(line.unitCostMinor)} ·{' '}
              {line.direction === 'add' ? 'Addition' : 'Deduction'}
            </span>
            <span>
              Cost {money(line.costMinor)} · Markup {money(line.markupMinor)} · Tax{' '}
              {money(line.taxMinor)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type LineDraft = {
  id: string;
  description: string;
  unit: string;
  direction: 'add' | 'deduct';
  quantity: string;
  unitCost: string;
  markup: string;
  tax: string;
};

function newLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    description: '',
    unit: 'each',
    direction: 'add',
    quantity: '1',
    unitCost: '0',
    markup: '0',
    tax: '0',
  };
}

function fixed(raw: string, digits: number) {
  const text = raw.trim();
  if (!new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`).test(text))
    throw new Error(`Enter a nonnegative amount with up to ${digits} decimal places.`);
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0'));
}

function encodeLines(lines: LineDraft[]) {
  return lines.map((line) => ({
    description: line.description,
    unit: line.unit,
    direction: line.direction,
    quantityMilli: fixed(line.quantity, 3),
    unitCostMinor: fixed(line.unitCost, 2),
    markupBps: fixed(line.markup, 2),
    taxBps: fixed(line.tax, 2),
  }));
}

function projectedTotal(lines: LineDraft[]): number | null {
  try {
    const safe = ChangePricingInput.shape.lines.parse(encodeLines(lines));
    return priceChangeLines(safe).reduce((total, line) => total + line.totalMinor, 0);
  } catch {
    return null;
  }
}

function PricingForm({
  order,
  current,
  path,
  projectPath,
  onCancel,
  onSaved,
}: {
  order: ChangeOrderRecord;
  current?: ChangePricingRevision;
  path: string;
  projectPath: string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api } = useApi();
  const session = useSession();
  const [lines, setLines] = useState<LineDraft[]>(() =>
    current
      ? current.lines.map((line) => ({
          id: crypto.randomUUID(),
          description: line.description,
          unit: line.unit,
          direction: line.direction,
          quantity: String(line.quantityMilli / 1000),
          unitCost: String(line.unitCostMinor / 100),
          markup: String(line.markupBps / 100),
          tax: String(line.taxBps / 100),
        }))
      : [newLine()],
  );
  const [documentSetId, setDocumentSetId] = useState(current?.evidenceVersionId ? 'keep' : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<{ id: string; signature: string } | null>(null);
  const key = [...orgKey(session.orgId, 'enterprise'), 'documents', order.projectId];
  const documents = useInfiniteQuery({
    queryKey: [...key, 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(projectPath + '/documents', {
        query: { cursor: pageParam },
        schema: EnterpriseDocumentPage,
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const versions = useQuery({
    queryKey: [...key, 'detail', documentSetId],
    queryFn: () =>
      api.get(projectPath + '/documents/' + documentSetId, { schema: EnterpriseDocumentDetail }),
    enabled: documentSetId !== '' && documentSetId !== 'keep',
  });

  function update(id: string, next: Partial<LineDraft>) {
    setLines((rows) => rows.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      const selectedVersion = data.get('evidenceVersionId');
      if (documentSetId && documentSetId !== 'keep' && !selectedVersion)
        throw new Error('Choose a version of the evidence document.');
      const values = {
        scope: data.get('scope'),
        scheduleImpactDays: Number(data.get('scheduleImpactDays')),
        revisionNote: data.get('revisionNote'),
        evidenceVersionId:
          documentSetId === 'keep' ? (current?.evidenceVersionId ?? null) : selectedVersion || null,
        lines: encodeLines(lines),
      };
      const signature = JSON.stringify(values);
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      const body = ChangePricingInput.parse({ ...values, clientRequestId: request.current.id });
      await api.post(path, body, { schema: ChangePricingRevision, ifMatch: order.revision });
      await onSaved();
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setBusy(false);
    }
  }

  const quoteTotal = projectedTotal(lines);
  return (
    <form className="enterprise-form enterprise-task-form" onSubmit={(event) => void submit(event)}>
      <label>
        Change scope{' '}
        <textarea
          name="scope"
          required
          minLength={3}
          maxLength={10000}
          defaultValue={order.description}
        />
      </label>
      <label>
        Schedule impact in days{' '}
        <input
          name="scheduleImpactDays"
          type="number"
          required
          min={-3650}
          max={3650}
          defaultValue={order.scheduleImpactDays}
        />
      </label>
      <label>
        Pricing revision note <input name="revisionNote" required minLength={3} maxLength={1000} />
      </label>
      <label>
        Evidence document
        <select value={documentSetId} onChange={(event) => setDocumentSetId(event.target.value)}>
          <option value="">None</option>
          {current?.evidenceVersionId && (
            <option value="keep">Keep existing document version</option>
          )}
          {documents.data?.pages
            .flatMap((page) => page.items)
            .map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
        </select>
      </label>
      {documents.hasNextPage && (
        <button
          type="button"
          disabled={documents.isFetchingNextPage}
          onClick={() => void documents.fetchNextPage()}
        >
          Show more documents
        </button>
      )}
      {documentSetId && documentSetId !== 'keep' && (
        <label>
          Evidence file version
          <select name="evidenceVersionId" required key={documentSetId} defaultValue="">
            <option value="">Select version</option>
            {versions.data?.versions.map((version) => (
              <option key={version.id} value={version.id}>
                Version {version.version} · {version.filename}
              </option>
            ))}
          </select>
        </label>
      )}
      {documents.isError && (
        <p role="alert" className="enterprise-error">
          {displayError(documents.error)}
        </p>
      )}
      {versions.isError && (
        <p role="alert" className="enterprise-error">
          {displayError(versions.error)}
        </p>
      )}
      <div className="enterprise-pricing-lines">
        {lines.map((line, index) => (
          <fieldset key={line.id}>
            <legend>Line {index + 1}</legend>
            <label>
              Description{' '}
              <input
                required
                minLength={2}
                maxLength={180}
                value={line.description}
                onChange={(event) => update(line.id, { description: event.target.value })}
              />
            </label>
            <label>
              Scope effect
              <select
                value={line.direction}
                onChange={(event) =>
                  update(line.id, { direction: event.target.value === 'deduct' ? 'deduct' : 'add' })
                }
              >
                <option value="add">Addition</option>
                <option value="deduct">Deduction</option>
              </select>
            </label>
            <label>
              Unit{' '}
              <input
                required
                maxLength={24}
                value={line.unit}
                onChange={(event) => update(line.id, { unit: event.target.value })}
              />
            </label>
            <label>
              Quantity{' '}
              <input
                inputMode="decimal"
                required
                value={line.quantity}
                onChange={(event) => update(line.id, { quantity: event.target.value })}
              />
            </label>
            <label>
              Unit cost (USD){' '}
              <input
                inputMode="decimal"
                required
                value={line.unitCost}
                onChange={(event) => update(line.id, { unitCost: event.target.value })}
              />
            </label>
            <label>
              Markup (%){' '}
              <input
                inputMode="decimal"
                required
                value={line.markup}
                onChange={(event) => update(line.id, { markup: event.target.value })}
              />
            </label>
            <label>
              Tax (%){' '}
              <input
                inputMode="decimal"
                required
                value={line.tax}
                onChange={(event) => update(line.id, { tax: event.target.value })}
              />
            </label>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines((rows) => rows.filter((item) => item.id !== line.id))}
              >
                Remove line {index + 1}
              </button>
            )}
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        disabled={lines.length >= 50}
        onClick={() => setLines((rows) => [...rows, newLine()])}
      >
        Add price line
      </button>
      {quoteTotal !== null && <p role="status">Estimated change total {money(quoteTotal)}</p>}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      <div className="enterprise-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save pricing revision'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
