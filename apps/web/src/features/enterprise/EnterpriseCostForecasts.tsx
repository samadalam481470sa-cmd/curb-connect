'use client';

import {
  CreateEnterpriseCostForecast,
  EnterpriseCostForecast,
  EnterpriseCostForecastPage,
  type EnterpriseBudgetSummary,
  type ForecastCostInput,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatMinorUnits, parseMoneyInput } from '@fieldline/ui';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Summary = z.infer<typeof EnterpriseBudgetSummary>;
type ApprovedSummary = Summary & {
  baseline: NonNullable<Summary['baseline']>;
  allocation: NonNullable<Summary['allocation']>;
};
type Forecast = z.infer<typeof EnterpriseCostForecast>;
type Estimate = z.infer<typeof ForecastCostInput>;
type Draft = { costCodeId: string; method: Estimate['method'] | ''; value: string };
type Receipt = { signature: string; id: string } | null;

function message(error: unknown) {
  if (isApiError(error)) return error.problem.detail ?? errorHint(error);
  return error instanceof Error ? error.message : 'Try saving the forecast again.';
}

export function EnterpriseCostForecasts({
  projectId,
  summary,
  historical,
  onUpdated,
}: {
  projectId: string;
  summary: Summary;
  historical: boolean;
  onUpdated: () => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise', 'cost-forecasts', projectId);
  const path = '/v1/enterprise/projects/' + projectId + '/forecasts';
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const history = useInfiniteQuery({
    queryKey: [...key, historical ? summary.asOf : null],
    enabled: Boolean(summary.allocation),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, {
        schema: EnterpriseCostForecastPage,
        query: { cursor: pageParam, asOf: historical ? summary.asOf : null },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const canCreate = !historical && session.can('enterprise_budget:approve');
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const { baseline, allocation } = summary;

  function refresh() {
    void client.invalidateQueries({ queryKey: key });
    onUpdated();
  }

  return (
    <section className="enterprise-panel" id="cost-forecasts" aria-label="Cost forecasts">
      <h2>Cost forecasts</h2>
      {!baseline || !allocation ? (
        <p>
          {historical
            ? 'There is no approved budget for this date.'
            : 'Approve a budget baseline to create a forecast.'}
        </p>
      ) : (
        <>
          {notice && !historical && <p role="status">{notice}</p>}
          {canCreate &&
            (creating ? (
              <ForecastForm
                path={path}
                summary={{ ...summary, baseline, allocation }}
                onCancel={() => setCreating(false)}
                onRefresh={refresh}
                onSaved={(saved) => {
                  setNotice(
                    saved.status === 'complete'
                      ? 'Cost forecast saved.'
                      : 'Incomplete cost forecast saved.',
                  );
                  setCreating(false);
                  refresh();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setNotice('');
                }}
              >
                Create cost forecast
              </button>
            ))}
          {history.isPending && <p role="status">Loading cost forecasts…</p>}
          {history.isError && !history.isFetchNextPageError && (
            <div role="alert">
              <p>{message(history.error)}</p>
              <button type="button" onClick={() => void history.refetch()}>
                Retry forecasts
              </button>
            </div>
          )}
          {history.isSuccess && !items.length && <p>No forecasts have been saved for this view.</p>}
          {items.length > 0 && (
            <ol className="enterprise-change-history" aria-label="Saved cost forecasts">
              {items.map((item) => (
                <li key={item.id}>
                  <ForecastDetails item={item} />
                </li>
              ))}
            </ol>
          )}
          {history.hasNextPage && (
            <button
              type="button"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchNextPageError ? 'Retry more forecasts' : 'Load more forecasts'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ForecastDetails({ item }: { item: Forecast }) {
  const { me } = useSession();
  const format = (amount: string) =>
    formatMinorUnits(BigInt(amount), item.currency, me.user.locale);
  return (
    <>
      <strong>
        {item.status === 'complete' ? 'Complete forecast' : 'Incomplete forecast'} · {item.asOf}
      </strong>
      <dl>
        <dt>Posted bill actuals</dt>
        <dd>{format(item.actualMinor)}</dd>
        <dt>Known remaining cost</dt>
        <dd>{format(item.knownRemainingMinor)}</dd>
        <dt>Estimated cost at completion</dt>
        <dd>{item.eacMinor === null ? 'Awaiting required inputs' : format(item.eacMinor)}</dd>
        <dt>Estimated margin</dt>
        <dd>{item.marginMinor === null ? 'Unavailable' : format(item.marginMinor)}</dd>
      </dl>
      {item.unconvertedCurrencies.length > 0 && (
        <p>Bill costs need conversion from {item.unconvertedCurrencies.join(', ')}.</p>
      )}
      <details>
        <summary>Forecast assumptions and cost codes</summary>
        <p>{item.assumptions}</p>
        <p>Approved budget version {item.budgetVersion}</p>
        <ul className="enterprise-change-history">
          {item.lines.map((line) => (
            <li key={line.costCode.id}>
              <strong>
                {line.costCode.code} · {line.costCode.label}
              </strong>
              <span>Approved allocation {format(line.approvedBudgetMinor)}</span>
              <span>Posted bill actuals {format(line.actualMinor)}</span>
              {line.remainingMinor === null ? (
                <span>Remaining estimate missing</span>
              ) : (
                <span>Remaining {format(line.remainingMinor)}</span>
              )}
              {line.percentCompleteBps !== null && (
                <span>{line.percentCompleteBps / 100}% complete</span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

function ForecastForm({
  path,
  summary,
  onCancel,
  onRefresh,
  onSaved,
}: {
  path: string;
  summary: ApprovedSummary;
  onCancel: () => void;
  onRefresh: () => void;
  onSaved: (item: Forecast) => void;
}) {
  const { api } = useApi();
  const { me } = useSession();
  const { baseline, allocation, availableCostCodes } = summary;
  const receipt = useRef<Receipt>(null);
  const [version, setVersion] = useState(allocation.version);
  const [extra, setExtra] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    const used = new Set([
      ...allocation.byCostCode
        .filter((line) => BigInt(line.amountMinor) > 0n)
        .map((line) => line.costCodeId),
      ...(summary.actualBillCosts
        .find(({ currency }) => currency === baseline.currency)
        ?.rows.map(({ costCodeId }) => costCodeId) ?? []),
    ]);
    return availableCostCodes
      .filter(({ id }) => used.has(id))
      .map(({ id }) => ({ costCodeId: id, method: '', value: '' }));
  });
  const stale = version !== allocation.version;
  const approved = new Map(
    allocation.byCostCode.map(({ costCodeId, amountMinor }) => [costCodeId, BigInt(amountMinor)]),
  );
  const codeById = new Map(availableCostCodes.map((code) => [code.id, code]));
  const format = (amount: bigint) => formatMinorUnits(amount, baseline.currency, me.user.locale);
  const save = useMutation({
    mutationFn: (data: FormData) => {
      const remainingCostByCode: Estimate[] = [];
      for (const { costCodeId, method, value } of drafts) {
        if (!method) continue;
        if (method === 'percent_complete') {
          const percent = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value);
          if (!percent)
            throw new Error('Enter a valid percent complete using up to two decimal places.');
          const percentCompleteBps =
            Number(percent[1]) * 100 + Number((percent[2] ?? '').padEnd(2, '0'));
          remainingCostByCode.push({ method, costCodeId, percentCompleteBps });
        } else {
          const parsed = parseMoneyInput(value, baseline.currency, me.user.locale);
          if (!parsed.ok || parsed.minor === null)
            throw new Error('Enter a remaining cost or choose no estimate.');
          remainingCostByCode.push({ method, costCodeId, remainingMinor: Number(parsed.minor) });
        }
      }
      const input = {
        asOf: data.get('asOf'),
        assumptions: data.get('assumptions'),
        assumptionsApproved: data.get('approved') === 'on',
        remainingCostByCode,
      };
      const signature = JSON.stringify({ input, version });
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      const body = CreateEnterpriseCostForecast.safeParse({
        ...input,
        clientRequestId: receipt.current.id,
      });
      if (!body.success)
        throw new Error(body.error.issues[0]?.message ?? 'Check the forecast inputs.');
      return api.post(path, body.data, { ifMatch: version, schema: EnterpriseCostForecast });
    },
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && error.is('precondition_failed')) onRefresh();
    },
  });

  function update(costCodeId: string, patch: Partial<Draft>) {
    setDrafts((previous) =>
      previous.map((line) => (line.costCodeId === costCodeId ? { ...line, ...patch } : line)),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stale && !save.isPending) save.mutate(new FormData(event.currentTarget));
  }

  return (
    <form aria-label="Create cost forecast" className="enterprise-form" onSubmit={submit}>
      <label>
        Forecast date
        <input
          type="date"
          name="asOf"
          required
          defaultValue={summary.asOf}
          min={baseline.effectiveOn}
          disabled={save.isPending}
        />
      </label>
      <p>Approved budget version {version}</p>
      {drafts.map(({ costCodeId, method, value }) => {
        const code = codeById.get(costCodeId);
        const amount = approved.get(costCodeId) ?? 0n;
        return (
          <fieldset
            className="enterprise-budget-adjustment"
            key={costCodeId}
            disabled={save.isPending}
          >
            <legend>
              {code?.code} · {code?.label}
            </legend>
            <p>Current approved allocation {format(amount)}</p>
            <label>
              Estimate method
              <select
                value={method}
                onChange={(event) =>
                  update(costCodeId, {
                    method: event.currentTarget.value as Draft['method'],
                    value: '',
                  })
                }
              >
                <option value="">No estimate</option>
                <option value="remaining_cost">Remaining cost</option>
                <option value="percent_complete" disabled={amount <= 0n}>
                  Percent complete
                </option>
              </select>
            </label>
            {method === 'remaining_cost' && (
              <label>
                Remaining cost ({baseline.currency})
                <input
                  value={value}
                  required
                  inputMode="decimal"
                  onChange={(event) => update(costCodeId, { value: event.currentTarget.value })}
                />
              </label>
            )}
            {method === 'percent_complete' && (
              <>
                <label>
                  Percent complete
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    required
                    value={value}
                    onChange={(event) => update(costCodeId, { value: event.currentTarget.value })}
                  />
                </label>
                <p>Remaining cost uses the approved allocation and the share of work left.</p>
              </>
            )}
          </fieldset>
        );
      })}
      {drafts.length < availableCostCodes.length && (
        <>
          <label>
            Additional cost code
            <select
              value={extra}
              disabled={save.isPending}
              onChange={(event) => setExtra(event.currentTarget.value)}
            >
              <option value="">Choose a project cost code</option>
              {availableCostCodes
                .filter(({ id }) => !drafts.some((line) => line.costCodeId === id))
                .map((code) => (
                  <option key={code.id} value={code.id}>
                    {code.code} · {code.label}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!extra || save.isPending}
            onClick={() => {
              setDrafts((previous) => [...previous, { costCodeId: extra, method: '', value: '' }]);
              setExtra('');
            }}
          >
            Add forecast cost code
          </button>
        </>
      )}
      <label className="enterprise-budget-adjustment">
        Forecast assumptions
        <textarea
          name="assumptions"
          minLength={3}
          maxLength={4000}
          required
          disabled={save.isPending}
        />
      </label>
      <label className="enterprise-budget-adjustment">
        <input type="checkbox" name="approved" required disabled={save.isPending} />I approve these
        assumptions for this forecast.
      </label>
      {stale && (
        <div className="enterprise-budget-adjustment" role="status">
          <p>
            Allocation version {allocation.version} replaced version {version}. Review the current
            amounts above.
          </p>
          <button
            type="button"
            onClick={() => {
              setVersion(allocation.version);
              save.reset();
            }}
          >
            Use allocation version {allocation.version}
          </button>
        </div>
      )}
      {save.isError && (
        <p role="alert" className="enterprise-budget-adjustment">
          {message(save.error)}
        </p>
      )}
      <button type="submit" disabled={stale || save.isPending}>
        {save.isPending ? 'Saving…' : 'Save cost forecast'}
      </button>
      <button type="button" disabled={save.isPending} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
