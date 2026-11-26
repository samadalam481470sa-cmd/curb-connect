'use client';

import {
  DecideEnterpriseBudgetRevision,
  EnterpriseBudgetRevision,
  EnterpriseBudgetRevisionQueue,
  type EnterpriseBudgetSummary,
  MemberListSchema,
  ProposeEnterpriseBudgetRevision,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { formatMinorUnits, parseMoneyInput, Skeleton } from '@fieldline/ui';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type BudgetSummary = z.infer<typeof EnterpriseBudgetSummary>;
type Allocation = NonNullable<BudgetSummary['allocation']>;
type CostCodes = BudgetSummary['availableCostCodes'];
type Revision = z.infer<typeof EnterpriseBudgetRevision>;
type Adjustment = { key: number; costCodeId: string; amount: string };
type FormatMoney = (minor: bigint | string | number) => string;
type Receipt = { signature: string; id: string } | null;

const revisionKinds = {
  allocation_change: 'Allocation change',
  transfer: 'Transfer',
};
const revisionStates = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  stale: 'Based on an earlier allocation',
};

function requestId(receipt: { current: Receipt }, input: object) {
  const signature = JSON.stringify(input);
  if (receipt.current?.signature !== signature)
    receipt.current = { signature, id: crypto.randomUUID() };
  return receipt.current.id;
}

function revisionError(error: unknown) {
  if (isApiError(error)) return error.problem.detail ?? errorHint(error);
  return error instanceof Error ? error.message : 'Check your changes and try again.';
}

export function EnterpriseBudgetRevisions({
  path,
  baseline,
  allocation,
  costCodes,
  costCodeId,
  historical,
  onRefresh,
}: {
  path: string;
  baseline: NonNullable<BudgetSummary['baseline']>;
  allocation: Allocation;
  costCodes: CostCodes;
  costCodeId: string;
  historical: boolean;
  onRefresh: () => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const revisionPath = path + '/' + baseline.id + '/revisions';
  const [proposing, setProposing] = useState(false);
  const [reviewId, setReviewId] = useState('');
  const [notice, setNotice] = useState('');
  const queue = useInfiniteQuery({
    queryKey: orgKey(session.orgId, 'enterprise', 'budget-revisions', revisionPath),
    enabled: !historical,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(revisionPath, {
        schema: EnterpriseBudgetRevisionQueue,
        query: { cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const denied = isApiError(queue.error) && [401, 403, 404].includes(queue.error.status);
  const items = denied ? [] : (queue.data?.pages.flatMap((page) => page.items) ?? []);
  const activeVersion = queue.data?.pages[0]?.activeVersion;
  const current = new Map(
    allocation.byCostCode.map((line) => [line.costCodeId, BigInt(line.amountMinor)]),
  );
  const format: FormatMoney = (minor) =>
    formatMinorUnits(BigInt(minor), baseline.currency, session.me.user.locale);
  const filtered = costCodes.find((code) => code.id === costCodeId);

  function refresh() {
    void queue.refetch();
    onRefresh();
  }

  return (
    <>
      <section className="enterprise-panel" aria-label="Budget allocation">
        <h2>{historical ? 'Budget allocation on selected date' : 'Current budget allocation'}</h2>
        <dl>
          <dt>Allocation version</dt>
          <dd>{allocation.version}</dd>
          <dt>Approved changes</dt>
          <dd>{format(allocation.approvedChangeMinor)}</dd>
          <dt>Approved allocation</dt>
          <dd>{format(allocation.currentMinor)}</dd>
          {filtered && (
            <>
              <dt>
                {filtered.code} · {filtered.label}
              </dt>
              <dd>{format(current.get(filtered.id) ?? 0n)}</dd>
            </>
          )}
        </dl>
      </section>
      {!historical && (
        <section className="enterprise-panel" aria-label="Budget revisions">
          <h2>Budget revisions</h2>
          {notice && <p role="status">{notice}</p>}
          {queue.isPending && <Skeleton variant="card" label="Loading budget revisions" />}
          {queue.isError && (
            <div role="alert">
              <p>{denied ? 'Budget revisions are unavailable.' : revisionError(queue.error)}</p>
              {!denied && (
                <button type="button" onClick={refresh}>
                  Retry budget revisions
                </button>
              )}
            </div>
          )}
          {!denied &&
            activeVersion !== undefined &&
            session.can('enterprise_budget:approve') &&
            (proposing ? (
              <BudgetProposalForm
                path={revisionPath}
                currency={baseline.currency}
                current={current}
                availableVersion={activeVersion}
                amountsVersion={allocation.version}
                costCodes={costCodes}
                format={format}
                onClose={() => setProposing(false)}
                onRefresh={refresh}
                onSaved={() => {
                  setProposing(false);
                  setNotice('Budget revision submitted for review.');
                  refresh();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setProposing(true);
                  setNotice('');
                }}
              >
                Propose budget revision
              </button>
            ))}
          {queue.isSuccess && !items.length && <p>No budget revisions have been proposed.</p>}
          {items.length > 0 && (
            <ul className="enterprise-change-history">
              {items.map((revision) => (
                <li key={revision.id}>
                  <strong>
                    {revisionKinds[revision.kind]} · {revisionStates[revision.state]}
                  </strong>
                  <span>Based on allocation version {revision.baseVersion}</span>
                  <p>{revision.reason}</p>
                  <details open={reviewId === revision.id || undefined}>
                    <summary>Review proposed amounts</summary>
                    <ul className="enterprise-change-history">
                      {revision.deltas.map((delta) => (
                        <li key={delta.costCode.id}>
                          <strong>
                            {delta.costCode.code} · {delta.costCode.label}
                          </strong>
                          <span>Prior {format(delta.priorMinor)}</span>
                          <span>Change {format(delta.deltaMinor)}</span>
                          <span>Proposed {format(delta.proposedMinor)}</span>
                          {revision.state === 'stale' && (
                            <span>Current {format(current.get(delta.costCode.id) ?? 0n)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                  {revision.decision && (
                    <p>
                      {revision.decision.reason}
                      {revision.decision.activatedVersion !== null && (
                        <> · Activated allocation version {revision.decision.activatedVersion}</>
                      )}
                    </p>
                  )}
                  {revision.canDecide &&
                    (reviewId === revision.id ? (
                      <BudgetDecisionForm
                        path={revisionPath}
                        revision={revision}
                        activeVersion={activeVersion}
                        onClose={() => setReviewId('')}
                        onRefresh={refresh}
                        onSaved={(result) => {
                          setReviewId('');
                          setNotice(
                            result.decision?.outcome === 'approved'
                              ? 'Budget revision approved.'
                              : 'Budget revision rejected.',
                          );
                          refresh();
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setReviewId(revision.id);
                          setNotice('');
                        }}
                      >
                        Record revision decision
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          )}
          {queue.hasNextPage && !denied && (
            <button
              type="button"
              disabled={queue.isFetchingNextPage}
              onClick={() => void queue.fetchNextPage()}
            >
              {queue.isFetchingNextPage ? 'Loading…' : 'Load more budget revisions'}
            </button>
          )}
        </section>
      )}
    </>
  );
}

function BudgetProposalForm({
  path,
  currency,
  current,
  availableVersion,
  amountsVersion,
  costCodes,
  format,
  onClose,
  onRefresh,
  onSaved,
}: {
  path: string;
  currency: string;
  current: Map<string, bigint>;
  availableVersion: number;
  amountsVersion: number;
  costCodes: CostCodes;
  format: FormatMoney;
  onClose: () => void;
  onRefresh: () => void;
  onSaved: () => void;
}) {
  const { api } = useApi();
  const { orgId, me } = useSession();
  const receipt = useRef<Receipt>(null);
  const nextKey = useRef(1);
  const [version, setVersion] = useState(availableVersion);
  const [kind, setKind] = useState<keyof typeof revisionKinds>('allocation_change');
  const [adjustments, setAdjustments] = useState<Adjustment[]>([
    { key: 0, costCodeId: '', amount: '' },
  ]);
  const stale = version !== availableVersion;
  const members = useInfiniteQuery({
    queryKey: orgKey(orgId, 'enterprise', 'budget-revision-reviewers'),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get('/v1/team/members', {
        schema: MemberListSchema,
        query: { status: 'active', limit: 100, cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const reviewers =
    members.data?.pages.flatMap((page) =>
      page.items.filter(
        ({ role, status }) => status === 'active' && ['owner', 'admin'].includes(role),
      ),
    ) ?? [];
  const preview = adjustments.map((line) => {
    const parsed = parseMoneyInput(line.amount, currency, me.user.locale, { allowNegative: true });
    const delta = parsed.ok ? parsed.minor : null;
    const prior = current.get(line.costCodeId) ?? 0n;
    return { ...line, prior, delta, proposed: delta === null ? null : prior + delta };
  });
  const total = preview.reduce((sum, line) => sum + (line.delta ?? 0n), 0n);
  const save = useMutation({
    mutationFn: (data: FormData) => {
      const deltas = preview.map(({ costCodeId, delta, proposed }) => {
        if (
          delta === null ||
          delta === 0n ||
          delta < -1_000_000_000_000n ||
          delta > 1_000_000_000_000n
        )
          throw new Error('Enter a valid nonzero amount for each adjustment.');
        if (proposed !== null && proposed < 0n)
          throw new Error('A cost-code allocation cannot fall below zero.');
        return { costCodeId, deltaMinor: Number(delta) };
      });
      if (kind === 'transfer' && total !== 0n)
        throw new Error('A transfer must add and subtract the same amount.');
      const input = {
        kind,
        deltas,
        reason: data.get('reason'),
        reviewerMembershipId: data.get('reviewerMembershipId'),
      };
      const body = ProposeEnterpriseBudgetRevision.safeParse({
        ...input,
        clientRequestId: requestId(receipt, { ...input, version }),
      });
      if (!body.success)
        throw new Error(body.error.issues[0]?.message ?? 'Check the proposal fields.');
      return api.post(path, body.data, { ifMatch: version, schema: EnterpriseBudgetRevision });
    },
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && error.is('precondition_failed')) onRefresh();
    },
  });

  function patch(key: number, change: Partial<Pick<Adjustment, 'costCodeId' | 'amount'>>) {
    setAdjustments((items) =>
      items.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!save.isPending && !stale && version === amountsVersion)
      save.mutate(new FormData(event.currentTarget));
  }

  return (
    <form className="enterprise-form" aria-label="Propose a budget revision" onSubmit={submit}>
      <label>
        Revision type
        <select
          value={kind}
          disabled={save.isPending}
          onChange={(event) =>
            setKind(event.currentTarget.value === 'transfer' ? 'transfer' : 'allocation_change')
          }
        >
          {Object.entries(revisionKinds).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assigned reviewer
        <select name="reviewerMembershipId" defaultValue="" required disabled={save.isPending}>
          <option value="">Choose a project manager</option>
          {reviewers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
      </label>
      {members.isError && (
        <button
          type="button"
          onClick={() =>
            void (members.isFetchNextPageError ? members.fetchNextPage() : members.refetch())
          }
        >
          Retry reviewer list
        </button>
      )}
      {members.hasNextPage && !members.isError && (
        <button
          type="button"
          disabled={members.isFetchingNextPage || save.isPending}
          onClick={() => void members.fetchNextPage()}
        >
          {members.isFetchingNextPage ? 'Loading…' : 'Load more reviewers'}
        </button>
      )}
      {preview.map(({ key, costCodeId, amount, prior, delta, proposed }, index) => (
        <fieldset className="enterprise-budget-adjustment" key={key} disabled={save.isPending}>
          <legend>Adjustment {index + 1}</legend>
          <label>
            Cost code
            <select
              value={costCodeId}
              required
              onChange={(event) => patch(key, { costCodeId: event.currentTarget.value })}
            >
              <option value="">Choose a project cost code</option>
              {costCodes.map((code) => (
                <option
                  key={code.id}
                  value={code.id}
                  disabled={
                    code.id !== costCodeId &&
                    adjustments.some((line) => line.costCodeId === code.id)
                  }
                >
                  {code.code} · {code.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Signed change ({currency})
            <input
              value={amount}
              required
              inputMode="decimal"
              onChange={(event) => patch(key, { amount: event.currentTarget.value })}
            />
          </label>
          {costCodeId &&
            delta !== null &&
            proposed !== null &&
            amountsVersion === availableVersion && (
              <p>
                Current {format(prior)} · Change {format(delta)} · Proposed {format(proposed)}
              </p>
            )}
          {adjustments.length > 1 && (
            <button
              type="button"
              onClick={() => setAdjustments((items) => items.filter((line) => line.key !== key))}
            >
              Remove adjustment {index + 1}
            </button>
          )}
        </fieldset>
      ))}
      {adjustments.length < Math.min(costCodes.length, 200) && (
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            const key = nextKey.current++;
            setAdjustments((items) => [...items, { key, costCodeId: '', amount: '' }]);
          }}
        >
          Add adjustment
        </button>
      )}
      <p>Net change {format(total)}</p>
      <label className="enterprise-budget-adjustment">
        Revision reason
        <textarea name="reason" required minLength={3} maxLength={1000} disabled={save.isPending} />
      </label>
      {stale && (
        <div className="enterprise-budget-adjustment" role="status">
          <p>
            Allocation version {availableVersion} replaced version {version}. Review the current and
            proposed amounts above.
          </p>
          <button
            type="button"
            disabled={amountsVersion !== availableVersion}
            onClick={() => {
              setVersion(availableVersion);
              save.reset();
            }}
          >
            Use allocation version {availableVersion}
          </button>
        </div>
      )}
      {save.isError && (
        <p role="alert" className="enterprise-budget-adjustment">
          {revisionError(save.error)}
        </p>
      )}
      <button
        type="submit"
        disabled={save.isPending || stale || version !== amountsVersion || !reviewers.length}
      >
        {save.isPending ? 'Submitting…' : 'Submit for review'}
      </button>
      <button type="button" disabled={save.isPending} onClick={onClose}>
        Cancel
      </button>
    </form>
  );
}

function BudgetDecisionForm({
  path,
  revision,
  activeVersion,
  onClose,
  onRefresh,
  onSaved,
}: {
  path: string;
  revision: Revision;
  activeVersion: number | undefined;
  onClose: () => void;
  onRefresh: () => void;
  onSaved: (result: Revision) => void;
}) {
  const { api } = useApi();
  const receipt = useRef<Receipt>(null);
  const [outcome, setOutcome] = useState('');
  const stale = revision.state === 'stale' || activeVersion !== revision.baseVersion;
  const save = useMutation({
    mutationFn: (data: FormData) => {
      const input = { outcome, reason: data.get('reason') };
      const body = DecideEnterpriseBudgetRevision.safeParse({
        ...input,
        clientRequestId: requestId(receipt, { ...input, version: revision.baseVersion }),
      });
      if (!body.success)
        throw new Error(body.error.issues[0]?.message ?? 'Check the decision fields.');
      return api.post(path + '/' + revision.id + '/decision', body.data, {
        ifMatch: revision.baseVersion,
        schema: EnterpriseBudgetRevision,
      });
    },
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && (error.status === 409 || error.status === 412)) onRefresh();
    },
  });
  const canSave = !save.isPending && !!outcome && !(stale && outcome === 'approved');

  return (
    <form
      className="enterprise-form"
      aria-label="Decide budget revision"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) save.mutate(new FormData(event.currentTarget));
      }}
    >
      {stale && (
        <p className="enterprise-budget-adjustment" role="status">
          The current allocation is version {activeVersion}. Reject this proposal or submit a new
          revision against the current version.
        </p>
      )}
      <label>
        Decision
        <select
          required
          value={outcome}
          disabled={save.isPending}
          onChange={(event) => setOutcome(event.currentTarget.value)}
        >
          <option value="">Choose a decision</option>
          <option value="approved" disabled={stale}>
            Approve proposed amounts
          </option>
          <option value="rejected">Reject proposal</option>
        </select>
      </label>
      <label>
        Decision reason
        <textarea name="reason" required minLength={3} maxLength={1000} disabled={save.isPending} />
      </label>
      {save.isError && (
        <p role="alert" className="enterprise-budget-adjustment">
          {revisionError(save.error)}
        </p>
      )}
      <button type="submit" disabled={!canSave}>
        {save.isPending ? 'Saving…' : 'Save revision decision'}
      </button>
      <button type="button" disabled={save.isPending} onClick={onClose}>
        Cancel
      </button>
    </form>
  );
}
