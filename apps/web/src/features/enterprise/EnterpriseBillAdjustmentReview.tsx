'use client';

import {
  DecideEnterpriseBillAdjustment,
  EnterpriseBillAdjustment,
  EnterpriseBillAdjustmentPage,
  type EnterpriseBudgetSummary,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { formatMinorUnits } from '@fieldline/ui';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { useApi, useSession } from '../../lib/session';

type Adjustment = z.infer<typeof EnterpriseBillAdjustment>;
type Codes = z.infer<typeof EnterpriseBudgetSummary>['availableCostCodes'];

export function EnterpriseBillAdjustmentReview({
  target,
  queryKey,
  costCodes,
  onUpdated,
}: {
  target: string;
  queryKey: readonly unknown[];
  costCodes: Codes;
  onUpdated: () => void;
}) {
  const { api } = useApi();
  const { me } = useSession();
  const [selected, select] = useState<string | null>(null);
  const records = useInfiniteQuery({
    queryKey: [...queryKey, 'adjustments'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(target, { schema: EnterpriseBillAdjustmentPage, query: { cursor: pageParam } }),
    getNextPageParam: (page) => page.nextCursor,
    refetchOnMount: 'always',
  });
  const items = records.isSuccess ? records.data.pages.flatMap((page) => page.items) : [];
  const labels = new Map(costCodes.map((code) => [code.id, code.code + ' · ' + code.label]));
  return (
    <section aria-label="Closed-period bill adjustments">
      <h3>Closed-period bill adjustments</h3>
      {records.isPending && <p role="status">Loading adjustment requests…</p>}
      {records.isError && (
        <div role="alert">
          <p>{errorHint(records.error)}</p>
          <button type="button" onClick={() => void records.refetch()}>
            Retry adjustments
          </button>
        </div>
      )}
      {records.isSuccess && items.length === 0 && <p>No bill adjustments have been requested.</p>}
      <ul className="enterprise-change-history">
        {items.map((item) => {
          const bill = item.bill;
          const money = (minor: number) =>
            formatMinorUnits(BigInt(minor), bill.currency, me.user.locale);
          return (
            <li key={item.id}>
              <strong>
                {bill.billNumber} · {bill.issuerName}
              </strong>
              <span>
                {money(bill.totalMinor)} · {item.input.postingDate}
              </span>
              <span>
                {item.decision?.outcome === 'approved'
                  ? 'Adjustment posted'
                  : item.decision?.outcome === 'rejected'
                    ? 'Adjustment rejected'
                    : 'Awaiting a separate controller'}
              </span>
              <details>
                <summary>Adjustment source and allocations</summary>
                <p>{item.input.reason}</p>
                <dl>
                  <dt>Source bill</dt>
                  <dd>{item.input.sourceId}</dd>
                  <dt>Bill approval</dt>
                  <dd>{item.input.sourceRevisionId}</dd>
                  <dt>Closed period revision</dt>
                  <dd>{item.periodRevision}</dd>
                  {item.decision?.posting && (
                    <>
                      <dt>Ledger posting</dt>
                      <dd>{item.decision.posting.id}</dd>
                    </>
                  )}
                </dl>
                <ul>
                  {item.input.allocations.map((line) => (
                    <li key={line.costCodeId}>
                      {labels.get(line.costCodeId) ?? line.costCodeId} · {money(line.amountMinor)}
                    </li>
                  ))}
                </ul>
                {item.decision && <p>{item.decision.reason}</p>}
              </details>
              {item.canDecide &&
                (selected === item.id ? (
                  <AdjustmentDecision
                    target={target}
                    item={item}
                    onCancel={() => select(null)}
                    onSaved={() => {
                      select(null);
                      onUpdated();
                    }}
                    onConflict={() => void records.refetch()}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={records.isRefetching}
                    onClick={() => select(item.id)}
                  >
                    Review adjustment
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
      {records.hasNextPage && (
        <button
          type="button"
          disabled={records.isFetchingNextPage}
          onClick={() => void records.fetchNextPage()}
        >
          Load more adjustments
        </button>
      )}
    </section>
  );
}

function AdjustmentDecision({
  target,
  item,
  onSaved,
  onCancel,
  onConflict,
}: {
  target: string;
  item: Adjustment;
  onSaved: () => void;
  onCancel: () => void;
  onConflict: () => void;
}) {
  const { api } = useApi();
  const [outcome, setOutcome] = useState<'approved' | 'rejected'>('approved');
  const [reason, setReason] = useState('');
  const request = useRef<{ signature: string; id: string } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const signature = JSON.stringify([outcome, reason, item.periodRevision]);
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      const body = DecideEnterpriseBillAdjustment.parse({
        outcome,
        reason,
        clientRequestId: request.current.id,
      });
      return api.post(target + '/' + item.id + '/decision', body, {
        ifMatch: item.periodRevision,
        schema: EnterpriseBillAdjustment,
      });
    },
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && [409, 412].includes(error.status)) onConflict();
    },
  });
  return (
    <form
      className="enterprise-form"
      aria-label="Decide closed-period adjustment"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <label>
        Adjustment decision
        <select
          value={outcome}
          disabled={save.isPending}
          onChange={(event) =>
            setOutcome(event.target.value === 'rejected' ? 'rejected' : 'approved')
          }
        >
          <option value="approved">Approve and post</option>
          <option value="rejected">Reject</option>
        </select>
      </label>
      <label>
        Decision reason
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1000}
          minLength={3}
          disabled={save.isPending}
          required
        />
      </label>
      {save.isError && <p role="alert">{errorHint(save.error)}</p>}
      <button type="submit" disabled={save.isPending || reason.trim().length < 3}>
        Save adjustment decision
      </button>
      <button type="button" disabled={save.isPending} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
