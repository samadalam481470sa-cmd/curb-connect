'use client';

import {
  DecideEnterprisePurchaseAmendment,
  EnterprisePurchaseCommitmentHistory,
  EnterprisePurchaseCommitmentRevision,
  ProposeEnterprisePurchaseAmendment,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { formatMinorUnits, minorToEditableText, parseMoneyInput } from '@fieldline/ui';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type History = z.infer<typeof EnterprisePurchaseCommitmentHistory>;
type Entry = z.infer<typeof EnterprisePurchaseCommitmentRevision>;
type Change = { key: number; id: string; value: string };

const states = {
  pending: 'Awaiting approval',
  stale: 'Based on an earlier commitment',
  approved: 'Approved',
  rejected: 'Rejected',
};

function issue(error: unknown) {
  if (isApiError(error)) return error.problem.detail ?? errorHint(error);
  return error instanceof Error ? error.message : 'Check the commitment fields and try again.';
}

export function EnterprisePurchaseCommitments({
  projectId,
  orderId,
  onChange,
}: {
  projectId: string;
  orderId: string;
  onChange: () => void;
}) {
  const { api } = useApi();
  const { orgId, me } = useSession();
  const [open, setOpen] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [review, setReview] = useState('');
  const [notice, setNotice] = useState('');
  const target =
    '/v1/enterprise/projects/' + projectId + '/purchase-orders/' + orderId + '/commitments';
  const history = useInfiniteQuery({
    queryKey: orgKey(orgId, 'enterprise', 'purchase-commitments', target),
    enabled: open,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(target, {
        schema: EnterprisePurchaseCommitmentHistory,
        query: { cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const denied = isApiError(history.error) && [401, 403, 404].includes(history.error.status);
  const page = denied ? undefined : history.data?.pages[0];
  const items = page ? (history.data?.pages.flatMap((part) => part.items) ?? []) : [];
  const money = (amount: number) => formatMinorUnits(BigInt(amount), 'USD', me.user.locale);

  function refresh() {
    void history.refetch();
    onChange();
  }

  function after(entry: Entry) {
    setProposing(false);
    setReview('');
    setNotice(
      entry.decision
        ? 'Amendment ' + entry.decision.outcome + '.'
        : 'Amendment submitted for review.',
    );
    refresh();
  }

  return (
    <section aria-label="Purchase order commitment history">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide commitment history' : 'View commitment history'}
      </button>
      {open && (
        <>
          {history.isPending && <p role="status">Loading commitment history…</p>}
          {history.isError && (
            <div role="alert">
              <p>{denied ? 'This commitment is unavailable.' : issue(history.error)}</p>
              {!denied && (
                <button type="button" onClick={refresh}>
                  Retry commitment history
                </button>
              )}
            </div>
          )}
          {notice && !denied && <p role="status">{notice}</p>}
          {page && (
            <>
              <p>
                Current commitment <strong>{money(page.active.totalMinor)}</strong> · Version{' '}
                {page.active.decision?.activatedVersion}
              </p>
              {page.canPropose &&
                (proposing ? (
                  <AmendmentForm
                    target={target}
                    history={page}
                    onSave={after}
                    onRefresh={refresh}
                    onCancel={() => setProposing(false)}
                  />
                ) : (
                  <button type="button" onClick={() => setProposing(true)}>
                    Propose purchase order amendment
                  </button>
                ))}
              <ol className="enterprise-change-history">
                {items.map((item) => (
                  <li key={item.id}>
                    <strong>
                      {item.kind === 'issuance' ? 'Original issue' : 'Amendment'} ·{' '}
                      {states[item.state]}
                    </strong>
                    <p>{item.reason}</p>
                    <span>Total {money(item.totalMinor)}</span>
                    <details open={review === item.id || undefined}>
                      <summary>Cost-code amounts and changes</summary>
                      <ul className="enterprise-change-history">
                        {item.allocations.map((line) => (
                          <li key={line.costCode.id}>
                            <strong>
                              {line.costCode.code} · {line.costCode.label}
                            </strong>
                            <span>
                              Prior {money(line.priorMinor)} · Change {money(line.deltaMinor)} ·
                              Revised {money(line.revisedMinor)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                    {item.decision && <p>{item.decision.reason}</p>}
                    {item.canDecide &&
                      (review === item.id ? (
                        <AmendmentDecision
                          target={target}
                          item={item}
                          onSave={after}
                          onRefresh={refresh}
                          onCancel={() => setReview('')}
                        />
                      ) : (
                        <button type="button" onClick={() => setReview(item.id)}>
                          Review amendment
                        </button>
                      ))}
                  </li>
                ))}
              </ol>
              {history.hasNextPage && (
                <button
                  type="button"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  Load more commitments
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

type EditorActions = {
  target: string;
  onSave: (entry: Entry) => void;
  onRefresh: () => void;
  onCancel: () => void;
};

function useAmendmentCommand<T extends object>(
  target: string,
  version: number,
  actions: EditorActions,
) {
  const { api } = useApi();
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  return useMutation({
    mutationFn: (input: T) => {
      const signature = JSON.stringify({ input, version });
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      return api.post(
        target,
        { ...input, clientRequestId: receipt.current.id },
        {
          ifMatch: version,
          schema: EnterprisePurchaseCommitmentRevision,
        },
      );
    },
    onSuccess: actions.onSave,
    onError: (error) => {
      if (isApiError(error) && (error.status === 409 || error.status === 412)) actions.onRefresh();
    },
  });
}

const amendmentFields = ProposeEnterprisePurchaseAmendment.omit({ clientRequestId: true });
const decisionFields = DecideEnterprisePurchaseAmendment.omit({ clientRequestId: true });

function AmendmentForm({ history, ...actions }: EditorActions & { history: History }) {
  const { me } = useSession();
  const locale = me.user.locale;
  const currentVersion = history.active.decision?.activatedVersion ?? 0;
  const [version, setVersion] = useState(currentVersion);
  const [error, setError] = useState('');
  const [lines, setLines] = useState<Change[]>(() =>
    history.active.allocations
      .filter(({ revisedMinor }) => revisedMinor > 0)
      .map(({ costCode, revisedMinor }, key) => ({
        key,
        id: costCode.id,
        value: minorToEditableText(BigInt(revisedMinor), 'USD', locale),
      })),
  );
  const nextId = useRef(lines.length);
  const save = useAmendmentCommand<z.infer<typeof amendmentFields>>(
    actions.target,
    version,
    actions,
  );
  const stale = version !== currentVersion;
  const preview = lines.map((line) => {
    const parsed = parseMoneyInput(line.value, 'USD', locale);
    return { ...line, cents: parsed.ok ? parsed.minor : null };
  });
  const total = preview.reduce((sum, line) => sum + (line.cents ?? 0n), 0n);

  function update(key: number, patch: Partial<Change>) {
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stale || save.isPending) return;
    setError('');
    const { reason } = Object.fromEntries(new FormData(event.currentTarget));
    const body = amendmentFields.safeParse({
      reason,
      allocations: preview.map(({ id, cents }) => ({
        costCodeId: id,
        amountMinor: cents === null ? null : Number(cents),
      })),
    });
    if (!body.success) {
      setError('Choose different project cost codes and enter a positive revised amount for each.');
      return;
    }
    save.mutate(body.data);
  }

  return (
    <form
      className="enterprise-form"
      aria-label="Propose purchase order amendment"
      onSubmit={submit}
    >
      {lines.map((line, index) => (
        <fieldset className="enterprise-budget-adjustment" key={line.key} disabled={save.isPending}>
          <legend>Allocation {index + 1}</legend>
          <label>
            Purchase cost code
            <select
              value={line.id}
              required
              onChange={(event) => update(line.key, { id: event.currentTarget.value })}
            >
              <option value="">Choose a purchase cost code</option>
              {history.costCodes.map((code) => (
                <option key={code.id} value={code.id}>
                  {code.code} · {code.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Revised amount (USD)
            <input
              required
              inputMode="decimal"
              value={line.value}
              onChange={(event) => update(line.key, { value: event.currentTarget.value })}
            />
          </label>
          {lines.length > 1 && (
            <button
              type="button"
              onClick={() => setLines(lines.filter(({ key }) => key !== line.key))}
            >
              Remove allocation {index + 1}
            </button>
          )}
        </fieldset>
      ))}
      {lines.length < Math.min(history.costCodes.length, 100) && (
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            const key = nextId.current++;
            setLines([...lines, { key, id: '', value: '' }]);
          }}
        >
          Add allocation
        </button>
      )}
      <p>Proposed commitment {formatMinorUnits(total, 'USD', locale)}</p>
      <label>
        Amendment reason
        <textarea name="reason" required minLength={3} maxLength={1000} />
      </label>
      {stale && (
        <div role="status" className="enterprise-budget-adjustment">
          <p>
            Commitment version {currentVersion} replaced version {version}. Review your new
            allocations.
          </p>
          <button
            type="button"
            onClick={() => {
              setVersion(currentVersion);
              save.reset();
            }}
          >
            Use commitment version {currentVersion}
          </button>
        </div>
      )}
      {(error || save.isError) && (
        <p className="enterprise-budget-adjustment" role="alert">
          {error || issue(save.error)}
        </p>
      )}
      <button type="submit" disabled={stale || save.isPending}>
        {save.isPending ? 'Submitting…' : 'Submit amendment for review'}
      </button>
      <button type="button" disabled={save.isPending} onClick={actions.onCancel}>
        Cancel
      </button>
    </form>
  );
}

function AmendmentDecision({ item, ...actions }: EditorActions & { item: Entry }) {
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState('');
  const save = useAmendmentCommand<z.infer<typeof decisionFields>>(
    actions.target + '/' + item.id + '/decision',
    item.baseVersion,
    actions,
  );
  const allowed = !!outcome && !(outcome === 'approved' && item.state === 'stale');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed || save.isPending) return;
    setError('');
    const body = decisionFields.safeParse({
      outcome,
      reason: new FormData(event.currentTarget).get('reason'),
    });
    if (!body.success) {
      setError('Enter a reason for the decision.');
      return;
    }
    save.mutate(body.data);
  }

  return (
    <form
      aria-label="Decide purchase order amendment"
      className="enterprise-form"
      onSubmit={submit}
    >
      <label>
        Decision
        <select
          required
          value={outcome}
          onChange={(event) => setOutcome(event.currentTarget.value)}
        >
          <option value="">Choose a decision</option>
          <option value="approved" disabled={item.state === 'stale'}>
            Approve revised amounts
          </option>
          <option value="rejected">Reject amendment</option>
        </select>
      </label>
      <label>
        Decision reason
        <textarea name="reason" required minLength={3} maxLength={1000} />
      </label>
      {(error || save.isError) && (
        <p className="enterprise-budget-adjustment" role="alert">
          {error || issue(save.error)}
        </p>
      )}
      <button type="submit" disabled={!allowed || save.isPending}>
        {save.isPending ? 'Saving…' : 'Save amendment decision'}
      </button>
      <button type="button" disabled={save.isPending} onClick={actions.onCancel}>
        Cancel
      </button>
    </form>
  );
}
