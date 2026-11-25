'use client';

import {
  ApproveEnterpriseEstimate,
  CreateEnterpriseEstimate,
  CreateEnterpriseEstimateLine,
  EnterpriseEstimateDetail,
  EnterpriseEstimatePage,
  EnterpriseEstimateRevision,
  EnterpriseEstimateUnit,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Draft = z.infer<typeof EnterpriseEstimateDetail>;
type DraftInput = z.infer<typeof CreateEnterpriseEstimate>;
type LineInput = z.infer<typeof CreateEnterpriseEstimateLine>;
type Request = { input: string; id: string };

function requestId(retry: { current: Request | null }, fields: object) {
  const input = JSON.stringify(fields);
  if (retry.current?.input !== input) retry.current = { input, id: crypto.randomUUID() };
  return retry.current.id;
}

function message(cause: unknown) {
  if (cause instanceof z.ZodError) return cause.issues[0]?.message ?? 'Check the entered fields.';
  return isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause);
}

function unitLabel(unit: EnterpriseEstimateUnit) {
  return unit === 'ea' ? 'each' : unit.replace('_', ' ');
}

export function EnterpriseEstimating({
  projectId,
  allowProjectLink,
}: {
  projectId: string;
  allowProjectLink: boolean;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const root = '/v1/enterprise/projects/' + projectId + '/estimates';
  const key = [...orgKey(session.orgId, 'enterprise'), 'estimates', projectId];
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const createRetry = useRef<Request | null>(null);
  const revisions = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(root, { schema: EnterpriseEstimatePage, query: { cursor: pageParam } }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const drafts = revisions.data?.pages.flatMap((page) => page.items) ?? [];
  const activeId = selected || drafts[0]?.id;
  const create = useMutation({
    mutationFn: (input: DraftInput) =>
      api.post(root, input, { schema: EnterpriseEstimateRevision }),
  });

  async function startDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setError('');
    try {
      const data = {
        title: String(fields.get('title')).trim(),
        currency: String(fields.get('currency')).trim().toUpperCase(),
        quantityPrecision: Number(fields.get('precision')),
      };
      const created = await create.mutateAsync(
        CreateEnterpriseEstimate.parse({ ...data, clientRequestId: requestId(createRetry, data) }),
      );
      createRetry.current = null;
      form.reset();
      setSelected(created.id);
      await client.invalidateQueries({ queryKey: key });
    } catch (cause) {
      setError(message(cause));
    }
  }

  return (
    <section className="enterprise-panel enterprise-stack" aria-label="Commercial estimates">
      <h2>Commercial estimates</h2>
      {revisions.isPending && <p role="status">Loading estimate revisions…</p>}
      {revisions.isError && (
        <div>
          <p role="alert" className="enterprise-error">
            {message(revisions.error)}
          </p>
          <button type="button" onClick={() => void revisions.refetch()}>
            Retry loading estimates
          </button>
        </div>
      )}
      {allowProjectLink && revisions.isSuccess && (
        <Link href={'/enterprise/projects/' + projectId + '/estimate'}>
          Open project estimate workspace
        </Link>
      )}
      {revisions.isSuccess && session.can('estimate:write') && (
        <form
          className="enterprise-form"
          aria-label="Create estimate draft"
          onSubmit={(event) => void startDraft(event)}
        >
          <label>
            Estimate title <input name="title" required minLength={2} maxLength={180} />
          </label>
          <label>
            Currency code{' '}
            <input
              name="currency"
              defaultValue="USD"
              autoCapitalize="characters"
              minLength={3}
              maxLength={3}
              required
            />
          </label>
          <label>
            Quantity decimal places{' '}
            <input name="precision" type="number" min={0} max={8} required defaultValue={3} />
          </label>
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating draft…' : 'Create blank draft'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      {revisions.isSuccess && drafts.length === 0 && !activeId && (
        <p>No estimates for this project yet.</p>
      )}
      {drafts.length > 0 && (
        <label>
          Estimate revision
          <select value={activeId} onChange={(event) => setSelected(event.target.value)}>
            {drafts.map((draft) => (
              <option key={draft.id} value={draft.id}>
                {draft.title} · {draft.revisionNumber} · {draft.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {revisions.hasNextPage && (
        <button
          type="button"
          disabled={revisions.isFetchingNextPage}
          onClick={() => void revisions.fetchNextPage()}
        >
          Load more estimate revisions
        </button>
      )}
      {activeId && (
        <EstimateDetail key={activeId} path={root + '/' + activeId} selectionKey={key} />
      )}
    </section>
  );
}

function EstimateDetail({
  path,
  selectionKey,
}: {
  path: string;
  selectionKey: readonly unknown[];
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...selectionKey, 'revision', path];
  const get = useQuery({
    queryKey: key,
    queryFn: () => api.get(path, { schema: EnterpriseEstimateDetail }),
  });
  const lineRetry = useRef<Request | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const add = useMutation({
    mutationFn: ({ input, revision }: { input: LineInput; revision: number }) =>
      api.post(path + '/lines', input, { ifMatch: revision, schema: EnterpriseEstimateDetail }),
  });
  const approve = useMutation({
    mutationFn: ({ reason, revision }: { reason: string; revision: number }) =>
      api.post(path + '/approve', ApproveEnterpriseEstimate.parse({ reason }), {
        ifMatch: revision,
        schema: EnterpriseEstimateDetail,
      }),
  });
  const busy = add.isPending || approve.isPending;

  async function save(event: FormEvent<HTMLFormElement>, action: 'line' | 'approve') {
    event.preventDefault();
    const draft = get.data;
    if (!draft || busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setError('');
    setNotice('');
    try {
      let result: Draft;
      if (action === 'line') {
        const data = {
          description: String(fields.get('description')).trim(),
          unit: fields.get('unit'),
          quantity: String(fields.get('quantity')).trim() || null,
        };
        const input = CreateEnterpriseEstimateLine.parse({
          ...data,
          clientRequestId: requestId(lineRetry, { ...data, revision: draft.revision }),
        });
        result = await add.mutateAsync({ input, revision: draft.revision });
        lineRetry.current = null;
      } else {
        result = await approve.mutateAsync({
          reason: String(fields.get('reason')),
          revision: draft.revision,
        });
      }
      form.reset();
      client.setQueryData(key, result);
      setNotice(action === 'line' ? 'Estimate line added' : 'Quantity revision approved');
      await client.invalidateQueries({ queryKey: selectionKey });
    } catch (cause) {
      setError(message(cause));
      if (isApiError(cause) && cause.status === 412) void get.refetch();
    }
  }

  if (get.isPending) return <p role="status">Loading estimate details…</p>;
  if (get.isError)
    return (
      <div>
        <p role="alert" className="enterprise-error">
          {message(get.error)}
        </p>
        <button type="button" onClick={() => void get.refetch()}>
          Retry loading estimate
        </button>
      </div>
    );
  const draft = get.data;
  const editable = draft.status === 'draft';
  const quantitiesReady =
    draft.lines.length > 0 && draft.lines.every((line) => line.quantity !== null);
  return (
    <section aria-label="Estimate detail" className="enterprise-stack">
      <h3>{draft.title}</h3>
      <p>
        {editable ? 'Draft' : 'Approved quantity revision'} · Revision {draft.revisionNumber} ·{' '}
        {draft.currency} · {draft.quantityPrecision} quantity decimal places
      </p>
      {draft.approvalReason && <p>Approval reason · {draft.approvalReason}</p>}
      {draft.lines.length > 0 && (
        <div className="enterprise-scroll">
          <table>
            <caption>Estimate lines</caption>
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col">Quantity</th>
                <th scope="col">Unit</th>
                <th scope="col">Quantity source</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.description}</td>
                  <td>{line.quantity ?? 'Awaiting quantity'}</td>
                  <td>{unitLabel(line.unit)}</td>
                  <td>
                    {line.sourceReviewId ? (
                      <span title={'Measurement review ' + line.sourceReviewId}>Reviewed takeoff</span>
                    ) : line.quantity === null ? '—' : 'Manual'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && session.can('estimate:write') && (
        <form
          className="enterprise-form"
          aria-label="Add estimate line"
          onSubmit={(event) => void save(event, 'line')}
        >
          <label>
            Line description <input name="description" required minLength={2} maxLength={300} />
          </label>
          <label>
            Measurement unit
            <select name="unit" defaultValue="ea">
              {EnterpriseEstimateUnit.options.map((unit) => (
                <option key={unit} value={unit}>
                  {unitLabel(unit)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Manual quantity (optional) <input name="quantity" inputMode="decimal" maxLength={25} />
          </label>
          <button type="submit" disabled={busy}>
            {add.isPending ? 'Adding line…' : 'Add estimate line'}
          </button>
        </form>
      )}
      {editable && quantitiesReady && session.can('review_task:decide') && (
        <form className="enterprise-form" onSubmit={(event) => void save(event, 'approve')}>
          <label>
            Quantity approval reason{' '}
            <textarea name="reason" required minLength={3} maxLength={1000} />
          </label>
          <button type="submit" disabled={busy}>
            {approve.isPending ? 'Approving…' : 'Approve quantity revision'}
          </button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
    </section>
  );
}
