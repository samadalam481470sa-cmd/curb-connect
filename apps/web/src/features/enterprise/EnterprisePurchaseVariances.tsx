'use client';

import {
  DecideEnterprisePurchaseVariance,
  EnterprisePurchaseVariance,
  EnterprisePurchaseVarianceView,
  RequestEnterprisePurchaseVariance,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatMinorUnits, minorToEditableText, parseMoneyInput } from '@fieldline/ui';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Variance = z.infer<typeof EnterprisePurchaseVariance>;
type Basis = NonNullable<z.infer<typeof EnterprisePurchaseVarianceView>['current']>;
type Receipt = { signature: string; id: string } | null;

const reviewLabels = {
  awaiting_review: 'Awaiting owner review',
  approved: 'Waiver approved',
  rejected: 'Rejected',
  superseded: 'Superseded',
};

function formError(error: unknown) {
  if (isApiError(error)) return error.problem.detail ?? errorHint(error);
  return error instanceof Error ? error.message : 'Try the overrun review again.';
}

export function EnterprisePurchaseVariances({
  projectId,
  orderId,
  defaultOpen = false,
}: {
  projectId: string;
  orderId: string;
  defaultOpen?: boolean;
}) {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [requesting, setRequesting] = useState<Basis | null>(null);
  const [reviewId, setReviewId] = useState('');
  const [notice, setNotice] = useState('');
  const path =
    '/v1/enterprise/projects/' + projectId + '/purchase-orders/' + orderId + '/variances';
  const key = orgKey(session.orgId, 'enterprise', 'purchase-variances', projectId, orderId);
  const allowed = session.can('enterprise_budget:read');
  const review = useInfiniteQuery({
    queryKey: key,
    enabled: open && allowed,
    refetchOnMount: 'always',
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, {
        schema: EnterprisePurchaseVarianceView,
        query: { cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const denied = isApiError(review.error) && [401, 403, 404].includes(review.error.status);
  const page = denied ? undefined : review.data?.pages[0];
  const history = page ? (review.data?.pages.flatMap((part) => part.items) ?? []) : [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: key });
  }

  function saved(variance: Variance) {
    setRequesting(null);
    setReviewId('');
    const state = variance.decision?.outcome;
    setNotice(
      state === 'approved'
        ? 'Owner waiver saved.'
        : state === 'rejected'
          ? 'The owner rejected this overrun.'
          : 'Overrun submitted for owner review.',
    );
    refresh();
  }

  if (!allowed) return defaultOpen ? <p role="alert">Overrun review is unavailable.</p> : null;
  return (
    <section aria-label="Purchase overrun review">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide overrun review' : 'View overrun review'}
      </button>
      {open && (
        <>
          {notice && !denied && <p role="status">{notice}</p>}
          {review.isPending && <p role="status">Loading overrun review…</p>}
          {review.isError && !review.isFetchNextPageError && (
            <div role="alert">
              <p>{denied ? 'Overrun review is unavailable.' : formError(review.error)}</p>
              {!denied && (
                <button type="button" onClick={refresh}>
                  Retry overrun review
                </button>
              )}
            </div>
          )}
          {page?.gate === 'review_required' && (
            <p>Issuance requires a waiver for the current overrun.</p>
          )}
          {page?.gate === 'approved' && <p>The owner waiver covers the current overrun.</p>}
          {page?.current && <VarianceAmounts basis={page.current} />}
          {page && !page.current && !history.length && (
            <p>There is no recorded purchase overrun for this order.</p>
          )}
          {page && requesting && (
            <VarianceForm
              path={path}
              basis={page.current ?? requesting}
              available={page.canRequest}
              onSaved={saved}
              onRefresh={refresh}
              onCancel={() => setRequesting(null)}
            />
          )}
          {page?.canRequest && page.current && !requesting && (
            <button
              type="button"
              onClick={() => {
                setRequesting(page.current);
                setNotice('');
              }}
            >
              Request owner review
            </button>
          )}
          {history.length > 0 && (
            <ul className="enterprise-change-history">
              {history.map((variance) => (
                <li key={variance.id}>
                  <strong>{reviewLabels[variance.status]}</strong>
                  <p>{variance.reason}</p>
                  <details open={reviewId === variance.id || undefined}>
                    <summary>Reviewed amounts</summary>
                    <VarianceAmounts basis={variance} />
                  </details>
                  {variance.decision && <p>{variance.decision.reason}</p>}
                  {reviewId === variance.id ? (
                    <VarianceForm
                      path={path}
                      basis={variance}
                      variance={variance}
                      available={variance.canDecide}
                      onSaved={saved}
                      onRefresh={refresh}
                      onCancel={() => setReviewId('')}
                    />
                  ) : (
                    variance.canDecide && (
                      <button
                        type="button"
                        onClick={() => {
                          setReviewId(variance.id);
                          setNotice('');
                        }}
                      >
                        Decide purchase overrun
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
          {review.hasNextPage && (
            <button
              type="button"
              disabled={review.isFetchingNextPage}
              onClick={() => void review.fetchNextPage()}
            >
              {review.isFetchNextPageError ? 'Retry more reviews' : 'Load more reviews'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function VarianceAmounts({ basis }: { basis: Basis }) {
  const { me } = useSession();
  const money = (minor: string) => formatMinorUnits(BigInt(minor), 'USD', me.user.locale);
  return (
    <dl>
      <dt>Approved allocation</dt>
      <dd>{money(basis.allocationMinor)}</dd>
      <dt>Already committed</dt>
      <dd>{money(basis.committedMinor)}</dd>
      <dt>Proposed order</dt>
      <dd>{money(basis.orderMinor)}</dd>
      <dt>Overrun to review</dt>
      <dd>{money(basis.overrunMinor)}</dd>
      <dt>Allocation version</dt>
      <dd>{basis.budgetVersion}</dd>
    </dl>
  );
}

function VarianceForm({
  path,
  basis,
  variance,
  available,
  onSaved,
  onRefresh,
  onCancel,
}: {
  path: string;
  basis: Basis;
  variance?: Variance;
  available: boolean;
  onSaved: (variance: Variance) => void;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const { api } = useApi();
  const { me } = useSession();
  const [decision, setDecision] = useState('');
  const [expected] = useState(basis.orderRevision);
  const [reviewed] = useState({
    budgetVersion: basis.budgetVersion,
    amount: basis.overrunMinor,
    committed: basis.committedMinor,
  });
  const stale =
    reviewed.budgetVersion !== basis.budgetVersion ||
    reviewed.amount !== basis.overrunMinor ||
    reviewed.committed !== basis.committedMinor ||
    expected !== basis.orderRevision;
  const receipt = useRef<Receipt>(null);

  function idFor(input: object) {
    const signature = JSON.stringify({ input, expected });
    if (receipt.current?.signature !== signature)
      receipt.current = { signature, id: crypto.randomUUID() };
    return receipt.current.id;
  }

  const save = useMutation({
    mutationFn: (fields: FormData) => {
      const reason = fields.get('reason');
      if (!variance) {
        const input = {
          reason,
          reviewedBudgetVersion: reviewed.budgetVersion,
          reviewedCommittedMinor: reviewed.committed,
        };
        const data = RequestEnterprisePurchaseVariance.parse({
          ...input,
          clientRequestId: idFor(input),
        });
        return api.post(path, data, { ifMatch: expected, schema: EnterprisePurchaseVariance });
      }
      const authorized =
        decision === 'approved'
          ? parseMoneyInput(String(fields.get('authorized')), 'USD', me.user.locale)
          : { ok: true as const, minor: 0n };
      if (!authorized.ok || authorized.minor === null)
        throw new Error('Enter a valid waiver amount.');
      const input = { decision, reason, authorizedDeltaMinor: Number(authorized.minor) };
      const data = DecideEnterprisePurchaseVariance.safeParse({
        ...input,
        clientRequestId: idFor(input),
      });
      if (!data.success)
        throw new Error(data.error.issues[0]?.message ?? 'Check the decision fields.');
      return api.post(path + '/' + variance.id + '/decision', data.data, {
        ifMatch: expected,
        schema: EnterprisePurchaseVariance,
      });
    },
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && [409, 412].includes(error.status)) onRefresh();
    },
  });
  const title = variance ? 'Decide purchase overrun' : 'Request owner review';
  const enabled = available && !stale && !save.isPending && (!variance || Boolean(decision));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enabled) save.mutate(new FormData(event.currentTarget));
  }

  return (
    <form className="enterprise-form" aria-label={title} onSubmit={submit}>
      {variance && (
        <label>
          Decision
          <select
            value={decision}
            disabled={save.isPending}
            required
            onChange={(event) => setDecision(event.currentTarget.value)}
          >
            <option value="">Choose a decision</option>
            <option value="approved">Approve waiver</option>
            <option value="rejected">Reject overrun</option>
          </select>
        </label>
      )}
      {decision === 'approved' && (
        <label>
          Authorized overrun (USD)
          <input
            name="authorized"
            required
            inputMode="decimal"
            disabled={save.isPending}
            defaultValue={minorToEditableText(BigInt(basis.overrunMinor), 'USD', me.user.locale)}
          />
        </label>
      )}
      <label>
        Reason
        <textarea name="reason" minLength={3} maxLength={1000} disabled={save.isPending} required />
      </label>
      {(stale || !available) && (
        <p role="status" className="enterprise-budget-adjustment">
          The order or budget changed. Review the updated amounts before opening a new review.
        </p>
      )}
      {save.isError && (
        <p role="alert" className="enterprise-budget-adjustment">
          {formError(save.error)}
        </p>
      )}
      <button type="submit" disabled={!enabled}>
        {save.isPending
          ? 'Saving…'
          : variance
            ? 'Save owner decision'
            : 'Submit overrun for review'}
      </button>
      <button type="button" disabled={save.isPending} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
