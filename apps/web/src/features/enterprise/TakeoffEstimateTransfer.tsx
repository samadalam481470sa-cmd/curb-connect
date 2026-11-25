'use client';

import {
  ConfirmEnterpriseTakeoffTransfer,
  EnterpriseEstimateDetail,
  EnterpriseEstimatePage,
  type EnterpriseTakeoffReview,
  EnterpriseTakeoffTransferPreview,
  EnterpriseTakeoffTransferResult,
  PreviewEnterpriseTakeoffTransfer,
  type EnterpriseEstimateUnit,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Source = Pick<z.infer<typeof EnterpriseTakeoffReview>, 'id' | 'measurementKind'>;
type Input = z.infer<typeof PreviewEnterpriseTakeoffTransfer>;
type Preview = z.infer<typeof EnterpriseTakeoffTransferPreview>;
type Prepared = { data: Preview; input: Input; requestId: string };

function unitsMatch(kind: Source['measurementKind'], unit: EnterpriseEstimateUnit) {
  if (kind === 'count') return unit === 'ea';
  if (kind === 'area') return unit.startsWith('sq_');
  return unit !== 'ea' && !unit.startsWith('sq_');
}

function unitLabel(unit: EnterpriseEstimateUnit) {
  return unit === 'ea' ? 'each' : unit.replace('_', ' ');
}

function message(cause: unknown) {
  if (cause instanceof z.ZodError)
    return cause.issues[0]?.message ?? 'Check the estimate line selection.';
  return isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause);
}

export function TakeoffEstimateTransfer({
  projectId,
  source,
}: {
  projectId: string;
  source: Source;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Push to estimate</summary>
      {open && <EstimateTransferForm projectId={projectId} source={source} />}
    </details>
  );
}

export function EstimateTransferForm({
  projectId,
  source,
  fixedTargetId,
}: {
  projectId: string;
  source: Source;
  fixedTargetId?: string;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const root = '/v1/enterprise/projects/' + projectId + '/estimates';
  const key = [...orgKey(session.orgId, 'enterprise'), 'estimates', projectId];
  const [draftId, setDraftId] = useState('');
  const targetId = fixedTargetId ?? draftId;
  const chooseDraft = !fixedTargetId;
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [receipt, setReceipt] = useState<z.infer<typeof EnterpriseTakeoffTransferResult> | null>(
    null,
  );
  const [error, setError] = useState('');
  const revisions = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(root, { query: { cursor: pageParam }, schema: EnterpriseEstimatePage }),
    getNextPageParam: (page) => page.nextCursor,
    enabled: chooseDraft,
  });
  const drafts =
    revisions.data?.pages.flatMap((page) =>
      page.items.filter((entry) => entry.status === 'draft'),
    ) ?? [];
  const targetPath = root + '/' + targetId;
  const detail = useQuery({
    queryKey: [...key, 'revision', targetPath],
    queryFn: () => api.get(targetPath, { schema: EnterpriseEstimateDetail }),
    enabled: !!targetId,
  });
  const compatible =
    detail.data?.lines.filter((line) => unitsMatch(source.measurementKind, line.unit)) ?? [];
  const preview = useMutation({
    mutationFn: ({ input, revision }: { input: Input; revision: number }) =>
      api.post(targetPath + '/takeoff-transfers/preview', input, {
        ifMatch: revision,
        schema: EnterpriseTakeoffTransferPreview,
      }),
  });
  const confirm = useMutation({
    mutationFn: ({ data, input, requestId }: Prepared) =>
      api.post(
        targetPath + '/takeoff-transfers/confirm',
        ConfirmEnterpriseTakeoffTransfer.parse({
          ...input,
          previewDigest: data.previewDigest,
          clientRequestId: requestId,
          confirmed: true,
        }),
        { ifMatch: data.revision, schema: EnterpriseTakeoffTransferResult },
      ),
  });
  const busy = preview.isPending || confirm.isPending;

  function resetPreview() {
    setPrepared(null);
    setReceipt(null);
    setError('');
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail.data || busy) return;
    resetPreview();
    try {
      const input = PreviewEnterpriseTakeoffTransfer.parse({
        takeoffRevisionId: source.id,
        mappings: Object.entries(selection).map(([estimateLineId, reason]) => ({
          estimateLineId,
          replacementReason: reason.trim() || null,
        })),
      });
      const data = await preview.mutateAsync({ input, revision: detail.data.revision });
      setPrepared({ data, input, requestId: crypto.randomUUID() });
    } catch (cause) {
      setError(message(cause));
      if (isApiError(cause) && (cause.status === 409 || cause.status === 412))
        void detail.refetch();
    }
  }

  async function apply() {
    if (!prepared || busy) return;
    setError('');
    try {
      setReceipt(await confirm.mutateAsync(prepared));
      setPrepared(null);
      setSelection({});
      await client.invalidateQueries({ queryKey: key });
    } catch (cause) {
      setError(message(cause));
      if (isApiError(cause) && (cause.status === 409 || cause.status === 412)) {
        setPrepared(null);
        void detail.refetch();
      }
    }
  }

  return (
    <section className="enterprise-stack" aria-label="Transfer takeoff quantity">
      {chooseDraft && revisions.isPending && <p role="status">Loading estimate drafts…</p>}
      {chooseDraft && revisions.isError && (
        <div>
          <p role="alert" className="enterprise-error">
            {message(revisions.error)}
          </p>
          <button type="button" onClick={() => void revisions.refetch()}>
            Retry loading drafts
          </button>
        </div>
      )}
      {chooseDraft && revisions.isSuccess && !drafts.length && (
        <p>
          Create a{' '}
          <Link href={'/enterprise/projects/' + projectId + '/estimate'}>
            project estimate draft
          </Link>{' '}
          to receive this measurement.
        </p>
      )}
      <form className="enterprise-form" onSubmit={(event) => void prepare(event)}>
        {chooseDraft && drafts.length > 0 && (
          <label>
            Target estimate revision
            <select
              required
              value={targetId}
              disabled={busy}
              onChange={(event) => {
                setDraftId(event.target.value);
                setSelection({});
                resetPreview();
              }}
            >
              <option value="">Choose a draft</option>
              {drafts.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title} · Revision {entry.revisionNumber}
                </option>
              ))}
            </select>
          </label>
        )}
        {!!targetId && detail.isPending && <p role="status">Loading estimate lines…</p>}
        {!!targetId && detail.isError && (
          <div>
            <p role="alert" className="enterprise-error">
              {message(detail.error)}
            </p>
            <button type="button" onClick={() => void detail.refetch()}>
              Retry loading lines
            </button>
          </div>
        )}
        {detail.data && detail.data.status !== 'draft' && (
          <p>Choose a draft estimate revision to transfer quantities.</p>
        )}
        {detail.data?.status === 'draft' && compatible.length === 0 && (
          <p>Add a line with a compatible unit in the selected estimate.</p>
        )}
        {detail.data?.status === 'draft' && compatible.length > 0 && (
          <fieldset disabled={busy}>
            <legend>Target estimate lines</legend>
            {compatible.map((line) => {
              const chosen = Object.hasOwn(selection, line.id);
              return (
                <div key={line.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen}
                      onChange={(event) => {
                        const next = { ...selection };
                        if (event.target.checked) next[line.id] = '';
                        else delete next[line.id];
                        setSelection(next);
                        resetPreview();
                      }}
                    />
                    {line.ordinal}. {line.description} · {unitLabel(line.unit)}
                  </label>
                  {chosen && line.quantity !== null && line.sourceReviewId !== source.id && (
                    <label>
                      Reason to replace {line.description} ({line.quantity} {unitLabel(line.unit)})
                      <textarea
                        maxLength={1000}
                        value={selection[line.id]}
                        onChange={(event) => {
                          setSelection({ ...selection, [line.id]: event.target.value });
                          resetPreview();
                        }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </fieldset>
        )}
        {detail.data?.status === 'draft' && compatible.length > 0 && (
          <button type="submit" disabled={busy || !Object.keys(selection).length}>
            {preview.isPending ? 'Loading preview…' : 'Preview quantity transfer'}
          </button>
        )}
      </form>
      {chooseDraft && revisions.hasNextPage && (
        <button
          type="button"
          disabled={revisions.isFetchingNextPage}
          onClick={() => void revisions.fetchNextPage()}
        >
          Load more estimate revisions
        </button>
      )}
      {prepared && (
        <section aria-label="Quantity conversion preview">
          <h5>Quantity conversion preview</h5>
          <ul className="enterprise-change-history">
            {prepared.data.mappings.map((line) => (
              <li key={line.estimateLineId}>
                <strong>{line.description}</strong>
                <span style={{ overflowWrap: 'anywhere' }}>
                  Before rounding · {line.unroundedQuantity} {unitLabel(line.targetUnit)}
                </span>
                <span>
                  Quantity to save · {line.roundedQuantity} {unitLabel(line.targetUnit)}
                </span>
                {line.oldQuantity !== null && (
                  <span>
                    Current estimate quantity · {line.oldQuantity} {unitLabel(line.targetUnit)}
                  </span>
                )}
                {line.disposition === 'requires_replacement' && (
                  <span>Enter a reason to replace the current quantity.</span>
                )}
                {line.disposition === 'already_applied' && (
                  <span>This reviewed quantity is already linked.</span>
                )}
              </li>
            ))}
          </ul>
          <div className="enterprise-toolbar">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={
                busy ||
                prepared.data.mappings.some((line) => line.disposition === 'requires_replacement')
              }
            >
              {confirm.isPending ? 'Recording transfer…' : 'Confirm quantity transfer'}
            </button>
            <button type="button" disabled={busy} onClick={resetPreview}>
              Cancel preview
            </button>
          </div>
        </section>
      )}
      {receipt && (
        <p role="status">
          {receipt.applied
            ? 'Quantity transfer recorded'
            : 'This reviewed quantity was already linked.'}
        </p>
      )}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
    </section>
  );
}
