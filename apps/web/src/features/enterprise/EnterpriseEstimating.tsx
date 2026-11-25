'use client';

import {
  ApproveEnterpriseEstimate,
  CreateEnterpriseEstimate,
  CreateEnterpriseEstimateLine,
  EditEnterpriseEstimateLine,
  EnterpriseEstimateDetail,
  EnterpriseEstimateLineEditResult,
  EnterpriseEstimatePage,
  EnterpriseEstimateRevision,
  EnterpriseEstimateUnit,
  ReviseEnterpriseEstimate,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { EstimateTakeoffImport } from './EstimateTakeoffImport';
import { EstimateRevisionComparison } from './EstimateRevisionComparison';
import {
  estimatePrice,
  estimatePriceInput,
  estimateUnitLabel,
  parseEstimatePrice,
} from './estimateDisplay';

type Draft = z.infer<typeof EnterpriseEstimateDetail>;
type DraftInput = z.infer<typeof CreateEnterpriseEstimate>;
type LineInput = z.infer<typeof CreateEnterpriseEstimateLine>;
type LineEdit = z.infer<typeof EditEnterpriseEstimateLine>;
type Line = Draft['lines'][number];
type RevisionInput = z.infer<typeof ReviseEnterpriseEstimate>;
type Request = { input: string; id: string };

function requestId(retry: { current: Request | null }, fields: object) {
  const input = JSON.stringify(fields);
  if (retry.current?.input !== input) retry.current = { input, id: crypto.randomUUID() };
  return retry.current.id;
}

function message(cause: unknown) {
  if (cause instanceof z.ZodError) return cause.issues[0]?.message ?? 'Check the entered fields.';
  if (cause instanceof RangeError) return cause.message;
  return isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause);
}

function lineFields(fields: FormData, currency: string) {
  return {
    description: String(fields.get('description')).trim(),
    unit: EnterpriseEstimateUnit.parse(fields.get('unit')),
    quantity: String(fields.get('quantity')).trim() || null,
    unitPriceMinor: parseEstimatePrice(String(fields.get('price')), currency),
  };
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
        <EstimateDetail
          key={activeId}
          projectId={projectId}
          path={root + '/' + activeId}
          selectionKey={key}
          onRevised={setSelected}
        />
      )}
    </section>
  );
}

function EstimateDetail({
  projectId,
  path,
  selectionKey,
  onRevised,
}: {
  projectId: string;
  path: string;
  selectionKey: readonly unknown[];
  onRevised: (id: string) => void;
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
  const revisionRetry = useRef<Request | null>(null);
  const editRetry = useRef<Request | null>(null);
  const [editId, setEditId] = useState('');
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
  const revise = useMutation({
    mutationFn: ({ input, revision }: { input: RevisionInput; revision: number }) =>
      api.post(path + '/revise', input, { ifMatch: revision, schema: EnterpriseEstimateDetail }),
  });
  const edit = useMutation({
    mutationFn: ({
      lineId,
      input,
      revision,
    }: {
      lineId: string;
      input: LineEdit;
      revision: number;
    }) =>
      api.patch(path + '/lines/' + lineId, input, {
        ifMatch: revision,
        schema: EnterpriseEstimateLineEditResult,
      }),
  });
  const busy = add.isPending || approve.isPending || revise.isPending || edit.isPending;

  async function saveLineEdit(event: FormEvent<HTMLFormElement>, line: Line) {
    event.preventDefault();
    const draft = get.data;
    if (!draft || busy) return;
    const fields = new FormData(event.currentTarget);
    setError('');
    setNotice('');
    try {
      const data = lineFields(fields, draft.currency);
      const editableData = {
        ...data,
        quantity:
          data.quantity === line.quantity && data.unit === line.unit ? undefined : data.quantity,
        reason: String(fields.get('reason')).trim(),
      };
      const input = EditEnterpriseEstimateLine.parse({
        ...editableData,
        clientRequestId: requestId(editRetry, {
          ...editableData,
          lineId: line.id,
          revision: draft.revision,
        }),
      });
      const result = await edit.mutateAsync({ lineId: line.id, input, revision: draft.revision });
      client.setQueryData<Draft>(key, {
        ...draft,
        revision: result.revision,
        lines: draft.lines.map((entry) => (entry.id === line.id ? result.line : entry)),
      });
      editRetry.current = null;
      setEditId('');
      setNotice('Estimate line changes saved');
      await client.invalidateQueries({ queryKey: selectionKey });
    } catch (cause) {
      setError(message(cause));
      if (isApiError(cause) && cause.status === 412) void get.refetch();
    }
  }

  async function createRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const source = get.data;
    if (!source || busy) return;
    const fields = new FormData(event.currentTarget);
    setError('');
    try {
      const reason = String(fields.get('reason')).trim();
      const clientRequestId = requestId(revisionRetry, { reason, revision: source.revision });
      const input = ReviseEnterpriseEstimate.parse({ reason, clientRequestId });
      const result = await revise.mutateAsync({ input, revision: source.revision });
      revisionRetry.current = null;
      await client.invalidateQueries({ queryKey: selectionKey });
      onRevised(result.id);
    } catch (cause) {
      setError(message(cause));
      if (isApiError(cause) && cause.status === 412) void get.refetch();
    }
  }

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
        const data = lineFields(fields, draft.currency);
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
  const canEdit = editable && session.can('estimate:write');
  const editedLine = canEdit ? draft.lines.find((line) => line.id === editId) : undefined;
  const status = {
    draft: 'Draft',
    approved: 'Approved quantity revision',
    superseded: 'Superseded draft',
  }[draft.status];
  const quantitiesReady =
    draft.lines.length > 0 && draft.lines.every((line) => line.quantity !== null);
  return (
    <section aria-label="Estimate detail" className="enterprise-stack">
      <h3>{draft.title}</h3>
      <p>
        {status} · Revision {draft.revisionNumber} · {draft.currency} · {draft.quantityPrecision}{' '}
        quantity decimal places
      </p>
      {draft.approvalReason && <p>Approval reason · {draft.approvalReason}</p>}
      {draft.revisionReason && <p>Revision reason · {draft.revisionReason}</p>}
      {draft.lines.length > 0 && (
        <div className="enterprise-scroll">
          <table>
            <caption>Estimate lines</caption>
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col">Quantity</th>
                <th scope="col">Unit</th>
                <th scope="col">Unit price</th>
                <th scope="col">Extended cost</th>
                <th scope="col">Quantity source</th>
                {canEdit && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.description}</td>
                  <td>{line.quantity ?? 'Awaiting quantity'}</td>
                  <td>{estimateUnitLabel(line.unit)}</td>
                  <td>
                    {line.unitPriceMinor === null
                      ? 'Unpriced'
                      : estimatePrice(line.unitPriceMinor, draft.currency)}
                  </td>
                  <td>
                    {line.extendedPriceMinor === null
                      ? '—'
                      : estimatePrice(line.extendedPriceMinor, draft.currency)}
                  </td>
                  <td>
                    {line.sourceReviewId ? (
                      <span title={'Measurement review ' + line.sourceReviewId}>
                        Reviewed takeoff
                      </span>
                    ) : line.quantity === null ? (
                      '—'
                    ) : (
                      'Manual'
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        aria-label={'Edit ' + line.description}
                        disabled={busy}
                        onClick={() => {
                          setEditId(line.id);
                          setError('');
                        }}
                      >
                        Edit line
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editedLine && (
        <form
          key={editedLine.id}
          aria-label="Edit estimate line"
          className="enterprise-form"
          onSubmit={(event) => void saveLineEdit(event, editedLine)}
        >
          <EstimateLineFields currency={draft.currency} line={editedLine} />
          {editedLine.sourceReviewId && (
            <p>
              Changing the quantity or unit replaces the Takeoff quantity with a manual value. The
              previous source stays in the line history.
            </p>
          )}
          <label>
            Reason for the line changes{' '}
            <textarea name="reason" required minLength={3} maxLength={1000} />
          </label>
          <button type="submit" disabled={busy}>
            {edit.isPending ? 'Saving changes…' : 'Save line changes'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditId('');
              setError('');
            }}
          >
            Cancel edit
          </button>
        </form>
      )}
      {canEdit && (
        <form
          className="enterprise-form"
          aria-label="Add estimate line"
          onSubmit={(event) => void save(event, 'line')}
        >
          <EstimateLineFields currency={draft.currency} />
          <button type="submit" disabled={busy}>
            {add.isPending ? 'Adding line…' : 'Add estimate line'}
          </button>
        </form>
      )}
      {canEdit && draft.lines.length > 0 && (
        <EstimateTakeoffImport projectId={projectId} estimateRevisionId={draft.id} />
      )}
      {draft.sourceRevisionId && (
        <EstimateRevisionComparison path={path} selectionKey={selectionKey} />
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
      {session.can('estimate:write') && (
        <details>
          <summary>Revise estimate</summary>
          <form className="enterprise-form" onSubmit={(event) => void createRevision(event)}>
            <label>
              Reason for the new revision{' '}
              <textarea name="reason" minLength={3} maxLength={1000} required />
            </label>
            <button type="submit" disabled={busy}>
              {revise.isPending ? 'Creating revision…' : 'Create draft revision'}
            </button>
          </form>
        </details>
      )}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
    </section>
  );
}

function EstimateLineFields({ currency, line }: { currency: string; line?: Line }) {
  return (
    <>
      <label>
        Line description{' '}
        <input
          name="description"
          defaultValue={line?.description}
          required
          minLength={2}
          maxLength={300}
        />
      </label>
      <label>
        Measurement unit
        <select name="unit" defaultValue={line?.unit ?? 'ea'}>
          {EnterpriseEstimateUnit.options.map((unit) => (
            <option key={unit} value={unit}>
              {estimateUnitLabel(unit)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Manual quantity (optional){' '}
        <input
          name="quantity"
          defaultValue={line?.quantity ?? ''}
          inputMode="decimal"
          maxLength={25}
        />
      </label>
      <label>
        Unit price ({currency}, optional){' '}
        <input
          name="price"
          defaultValue={estimatePriceInput(line?.unitPriceMinor ?? null, currency)}
          inputMode="decimal"
          maxLength={25}
        />
      </label>
    </>
  );
}
