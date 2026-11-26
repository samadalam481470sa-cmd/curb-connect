'use client';

import {
  EnterpriseApprovedBillSources,
  EnterpriseBillActualPosting,
  EnterpriseBillActuals,
  EnterpriseCostPeriods,
  type EnterpriseBudgetSummary,
  PostEnterpriseBillActual,
  SetEnterpriseCostPeriod,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinorUnits, minorToEditableText, parseMoneyInput } from '@fieldline/ui';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Summary = z.infer<typeof EnterpriseBudgetSummary>;
type CostCodes = Summary['availableCostCodes'];
type BillSource = z.infer<typeof EnterpriseApprovedBillSources>['items'][number];
type SourceLine = { key: number; costCodeId: string; amount: string };
type Receipt = { signature: string; id: string } | null;

function idFor(receipt: { current: Receipt }, input: object) {
  const signature = JSON.stringify(input);
  if (receipt.current?.signature !== signature)
    receipt.current = { signature, id: crypto.randomUUID() };
  return receipt.current.id;
}

function message(error: unknown) {
  if (isApiError(error)) return error.problem.detail ?? errorHint(error);
  return error instanceof Error ? error.message : 'Try the posting again.';
}

export function EnterpriseActualBillCosts({
  projectId,
  summary,
  costCodeId,
  historical,
  onUpdated,
}: {
  projectId: string;
  summary: Summary;
  costCodeId: string;
  historical: boolean;
  onUpdated: () => void;
}) {
  const session = useSession();
  const [manage, setManage] = useState(false);
  const codes = new Map(summary.availableCostCodes.map((code) => [code.id, code.label]));
  const money = (minor: string, currency: string) =>
    formatMinorUnits(BigInt(minor), currency, session.me.user.locale);

  return (
    <section className="enterprise-panel" aria-label="Actual bill costs" id="actual-costs">
      <h2>Actual bill costs</h2>
      {!summary.actualBillCosts.length && <p>No bill costs have been posted through this date.</p>}
      {summary.actualBillCosts.map(({ currency, totalMinor, rows }) => (
        <div key={currency}>
          <dl>
            <dt>Actual cost · {currency}</dt>
            <dd>{money(totalMinor, currency)}</dd>
          </dl>
          <ul className="enterprise-change-history">
            {rows
              .filter((row) => !costCodeId || row.costCodeId === costCodeId)
              .map((line) => (
                <li key={line.costCodeId}>
                  <strong>
                    {line.costCode} · {codes.get(line.costCodeId)}
                  </strong>
                  <span>{money(line.amountMinor, currency)}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}
      {!historical && session.can('bill:approve') && (
        <>
          <button type="button" aria-expanded={manage} onClick={() => setManage(!manage)}>
            {manage ? 'Hide bill posting controls' : 'Manage bill postings'}
          </button>
          {manage && (
            <BillPostingPanel
              projectId={projectId}
              calendarDay={summary.asOf}
              costCodes={summary.availableCostCodes}
              onUpdated={onUpdated}
            />
          )}
        </>
      )}
    </section>
  );
}

function BillPostingPanel({
  projectId,
  calendarDay,
  costCodes,
  onUpdated,
}: {
  projectId: string;
  calendarDay: string;
  costCodes: CostCodes;
  onUpdated: () => void;
}) {
  const { api } = useApi();
  const { orgId, me } = useSession();
  const client = useQueryClient();
  const [date, setDate] = useState(calendarDay);
  const [periodAction, setPeriodAction] = useState<'open' | 'closed' | null>(null);
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState('');
  const root = '/v1/enterprise/projects/' + projectId + '/actual-costs';
  const key = orgKey(orgId, 'enterprise', 'actual-bill-costs', projectId);
  const month = date.slice(0, 7) + '-01';
  const periodPath = root + '/periods/' + month;
  const period = useQuery({
    queryKey: [...key, 'period', month],
    enabled: Boolean(date),
    queryFn: () => api.get(periodPath, { schema: EnterpriseCostPeriods }),
  });
  const entries = useInfiniteQuery({
    queryKey: [...key, 'postings'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(root, {
        schema: EnterpriseBillActuals,
        query: { cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const status = period.isSuccess ? period.data.period : undefined;
  const items = entries.data?.pages.flatMap((page) => page.items) ?? [];
  const money = (minor: number, currency: string) =>
    formatMinorUnits(BigInt(minor), currency, me.user.locale);

  function refresh() {
    void client.invalidateQueries({ queryKey: key });
    onUpdated();
  }

  return (
    <div className="enterprise-stack">
      {notice && <p role="status">{notice}</p>}
      <label className="enterprise-form">
        Posting date
        <input
          type="date"
          value={date}
          disabled={posting || Boolean(periodAction)}
          onChange={(event) => setDate(event.currentTarget.value)}
        />
      </label>
      {date && period.isPending && <p role="status">Loading accounting period…</p>}
      {period.isError && (
        <div role="alert">
          <p>{message(period.error)}</p>
          <button type="button" onClick={() => void period.refetch()}>
            Retry accounting period
          </button>
        </div>
      )}
      {date && period.isSuccess && (
        <p>
          {status
            ? status.state === 'open'
              ? 'Accounting period open'
              : 'Accounting period closed'
            : 'No accounting period has been opened for this month.'}
        </p>
      )}
      {date &&
        status !== undefined &&
        status?.state !== 'closed' &&
        (periodAction ? (
          <AccountingPeriodForm
            key={month + periodAction}
            target={periodPath}
            state={periodAction}
            expected={status?.revision ?? 0}
            onRefresh={refresh}
            onCancel={() => setPeriodAction(null)}
            onSaved={() => {
              setNotice(
                periodAction === 'open' ? 'Accounting period opened.' : 'Accounting period closed.',
              );
              setPeriodAction(null);
              refresh();
            }}
          />
        ) : (
          <button
            type="button"
            disabled={posting}
            onClick={() => {
              setNotice('');
              setPeriodAction(status ? 'closed' : 'open');
            }}
          >
            {status ? 'Close accounting period' : 'Open accounting period'}
          </button>
        ))}
      {posting ? (
        <PostApprovedBillForm
          target={root}
          queryKey={key}
          costCodes={costCodes}
          date={date}
          version={status?.revision ?? 0}
          open={status?.state === 'open'}
          onCancel={() => setPosting(false)}
          onRefresh={refresh}
          onSaved={() => {
            setPosting(false);
            setNotice('Approved bill posted to the job-cost ledger.');
            refresh();
          }}
        />
      ) : (
        status?.state === 'open' &&
        !periodAction && (
          <button
            type="button"
            onClick={() => {
              setNotice('');
              setPosting(true);
            }}
          >
            Post approved bill cost
          </button>
        )
      )}
      {entries.isError && !entries.isFetchNextPageError && (
        <div role="alert">
          <p>{message(entries.error)}</p>
          <button type="button" onClick={() => void entries.refetch()}>
            Retry ledger entries
          </button>
        </div>
      )}
      {items.length > 0 && (
        <ol className="enterprise-change-history" aria-label="Job-cost ledger entries">
          {items.map((item) => (
            <li key={item.id}>
              <strong>
                {item.billNumber} · {item.issuerName}
              </strong>
              <span>
                {money(item.totalMinor, item.currency)} · {item.postingDate}
              </span>
              <details>
                <summary>Source and ledger details</summary>
                <dl>
                  <dt>Job-cost ledger reference</dt>
                  <dd>{item.id}</dd>
                  <dt>Source bill</dt>
                  <dd>{item.sourceId}</dd>
                  <dt>Recorded bill approval</dt>
                  <dd>{item.sourceRevisionId}</dd>
                </dl>
                <ul className="enterprise-change-history">
                  {item.allocations.map((line) => (
                    <li key={line.costCode.id}>
                      <strong>
                        {line.costCode.code} · {line.costCode.label}
                      </strong>
                      <span>{money(line.amountMinor, item.currency)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      )}
      {entries.hasNextPage && (
        <button
          type="button"
          disabled={entries.isFetchingNextPage}
          onClick={() => void entries.fetchNextPage()}
        >
          {entries.isFetchNextPageError ? 'Retry more ledger entries' : 'Load more ledger entries'}
        </button>
      )}
    </div>
  );
}

function AccountingPeriodForm({
  target,
  state,
  expected,
  onCancel,
  onRefresh,
  onSaved,
}: {
  target: string;
  state: 'open' | 'closed';
  expected: number;
  onCancel: () => void;
  onRefresh: () => void;
  onSaved: () => void;
}) {
  const { api } = useApi();
  const receipt = useRef<Receipt>(null);
  const save = useMutation({
    mutationFn: (reason: FormDataEntryValue | null) => {
      const input = { state, reason };
      const body = SetEnterpriseCostPeriod.parse({
        ...input,
        clientRequestId: idFor(receipt, { ...input, expected }),
      });
      return api.put(target, body, { ifMatch: expected, schema: EnterpriseCostPeriods });
    },
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && [409, 412].includes(error.status)) onRefresh();
    },
  });
  const title = state === 'open' ? 'Open accounting period' : 'Close accounting period';
  return (
    <form
      className="enterprise-form"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) save.mutate(new FormData(event.currentTarget).get('reason'));
      }}
    >
      <label>
        Period reason
        <textarea name="reason" minLength={3} maxLength={1000} required />
      </label>
      {save.isError && (
        <p className="enterprise-budget-adjustment" role="alert">
          {message(save.error)}
        </p>
      )}
      <button type="submit" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : title}
      </button>
      <button type="button" onClick={onCancel} disabled={save.isPending}>
        Cancel
      </button>
    </form>
  );
}

function PostApprovedBillForm({
  target,
  queryKey,
  date,
  costCodes,
  version,
  open,
  onCancel,
  onRefresh,
  onSaved,
}: {
  target: string;
  queryKey: readonly unknown[];
  date: string;
  costCodes: CostCodes;
  version: number;
  open: boolean;
  onCancel: () => void;
  onRefresh: () => void;
  onSaved: () => void;
}) {
  const { api } = useApi();
  const { me } = useSession();
  const [bill, setBill] = useState<BillSource | null>(null);
  const [lines, setLines] = useState<SourceLine[]>([]);
  const nextKey = useRef(0);
  const receipt = useRef<Receipt>(null);
  const sources = useInfiniteQuery({
    queryKey: [...queryKey, 'sources'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(target + '/sources', {
        schema: EnterpriseApprovedBillSources,
        query: { cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const options = sources.data?.pages.flatMap((page) => page.items) ?? [];
  const locale = me.user.locale;
  const currency = bill?.currency ?? 'USD';
  const amounts = lines.map((line) => {
    const parsed = parseMoneyInput(line.amount, currency, locale);
    return { ...line, minor: parsed.ok ? parsed.minor : null };
  });
  const total = amounts.reduce((sum, line) => sum + (line.minor ?? 0n), 0n);
  const money = (minor: bigint | number) => formatMinorUnits(BigInt(minor), currency, locale);
  const post = useMutation({
    mutationFn: async () => {
      if (!bill) throw new Error('Choose an approved bill.');
      if (total !== BigInt(bill.totalMinor))
        throw new Error('The cost-code allocations must equal the approved bill amount.');
      const input = {
        sourceId: bill.sourceId,
        sourceRevisionId: bill.sourceRevisionId,
        postingDate: date,
        allocations: amounts.map(({ costCodeId, minor }) => ({
          costCodeId,
          amountMinor: minor === null ? null : Number(minor),
        })),
      };
      const parsed = PostEnterpriseBillActual.safeParse({
        ...input,
        clientRequestId: idFor(receipt, { ...input, version }),
      });
      if (!parsed.success)
        throw new Error(
          'Choose different project cost codes and enter a positive amount for each.',
        );
      return api.post(target, parsed.data, {
        ifMatch: version,
        schema: EnterpriseBillActualPosting,
      });
    },
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && [409, 412].includes(error.status)) onRefresh();
    },
  });

  function selectBill(sourceId: string) {
    const selected = options.find((item) => item.sourceId === sourceId) ?? null;
    setBill(selected);
    setLines(
      selected
        ? [
            {
              key: nextKey.current++,
              costCodeId: '',
              amount: minorToEditableText(BigInt(selected.totalMinor), selected.currency, locale),
            },
          ]
        : [],
    );
    post.reset();
  }

  function changeLine(key: number, change: Partial<SourceLine>) {
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (open && !post.isPending) post.mutate();
  }

  return (
    <form className="enterprise-form" aria-label="Post approved bill cost" onSubmit={submit}>
      <label>
        Approved bill
        <select
          value={bill?.sourceId ?? ''}
          onChange={(event) => selectBill(event.currentTarget.value)}
          required
          disabled={post.isPending}
        >
          <option value="">Choose an approved bill</option>
          {bill && !options.some((item) => item.sourceId === bill.sourceId) && (
            <option value={bill.sourceId}>
              {bill.billNumber} · {bill.issuerName}
            </option>
          )}
          {options.map((item) => (
            <option key={item.sourceId} value={item.sourceId}>
              {item.billNumber} · {item.issuerName}
            </option>
          ))}
        </select>
      </label>
      {sources.isSuccess && !options.length && <p>No unposted approved bills are available.</p>}
      {sources.isError && !sources.isFetchNextPageError && (
        <button type="button" onClick={() => void sources.refetch()}>
          Retry approved bills
        </button>
      )}
      {sources.hasNextPage && (
        <button
          type="button"
          disabled={sources.isFetchingNextPage || post.isPending}
          onClick={() => void sources.fetchNextPage()}
        >
          {sources.isFetchNextPageError ? 'Retry more bills' : 'Load more approved bills'}
        </button>
      )}
      {bill && (
        <p>
          Approved total {money(bill.totalMinor)} · {bill.status === 'paid' ? 'Paid' : 'Approved'}
        </p>
      )}
      {lines.map((line, index) => (
        <fieldset key={line.key} className="enterprise-budget-adjustment" disabled={post.isPending}>
          <legend>Allocation {index + 1}</legend>
          <label>
            Cost code
            <select
              value={line.costCodeId}
              required
              onChange={(event) => changeLine(line.key, { costCodeId: event.currentTarget.value })}
            >
              <option value="">Choose a project cost code</option>
              {costCodes.map((code) => (
                <option key={code.id} value={code.id}>
                  {code.code} · {code.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bill amount ({currency})
            <input
              value={line.amount}
              required
              inputMode="decimal"
              onChange={(event) => changeLine(line.key, { amount: event.currentTarget.value })}
            />
          </label>
          {lines.length > 1 && (
            <button
              type="button"
              onClick={() => setLines((previous) => previous.filter(({ key }) => key !== line.key))}
            >
              Remove allocation {index + 1}
            </button>
          )}
        </fieldset>
      ))}
      {bill && lines.length < Math.min(costCodes.length, 100) && (
        <button
          type="button"
          disabled={post.isPending}
          onClick={() => {
            const key = nextKey.current++;
            setLines((previous) => [...previous, { key, costCodeId: '', amount: '' }]);
          }}
        >
          Add bill allocation
        </button>
      )}
      {bill && <p>Allocated {money(total)}</p>}
      {!open && <p role="status">The accounting period has closed.</p>}
      {post.isError && (
        <p role="alert" className="enterprise-budget-adjustment">
          {message(post.error)}
        </p>
      )}
      <button type="submit" disabled={!bill || !open || !costCodes.length || post.isPending}>
        {post.isPending ? 'Posting…' : 'Post to job-cost ledger'}
      </button>
      <button type="button" onClick={onCancel} disabled={post.isPending}>
        Cancel
      </button>
    </form>
  );
}
