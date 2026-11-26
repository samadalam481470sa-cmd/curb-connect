'use client';

import {
  EnterpriseCostScenario,
  EnterpriseCostScenarioPage,
  RunEnterpriseCostScenario,
  type EnterpriseCostForecast,
  type ForecastCostInput,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { formatMinorUnits, parseMoneyInput } from '@fieldline/ui';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Forecast = z.infer<typeof EnterpriseCostForecast>;
type Override = z.infer<typeof ForecastCostInput>;
type Draft = { key: number; costCodeId: string; method: Override['method']; value: string };

function issue(error: unknown) {
  if (isApiError(error)) return error.problem.detail ?? errorHint(error);
  return error instanceof Error ? error.message : 'Try saving the scenario again.';
}

export function EnterpriseCostScenarios({ forecast }: { forecast: Forecast }) {
  const { api } = useApi();
  const session = useSession();
  const path = '/v1/enterprise/projects/' + forecast.projectId + '/cost-scenarios';
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const history = useInfiniteQuery({
    queryKey: orgKey(
      session.orgId,
      'enterprise',
      'cost-scenarios',
      forecast.projectId,
      forecast.id,
    ),
    enabled: open,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, {
        schema: EnterpriseCostScenarioPage,
        query: { forecastId: forecast.id, cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const denied = isApiError(history.error) && [401, 403, 404].includes(history.error.status);
  const items = denied ? [] : (history.data?.pages.flatMap((page) => page.items) ?? []);
  const money = (minor: string | null) =>
    minor === null
      ? 'Awaiting inputs'
      : formatMinorUnits(BigInt(minor), forecast.currency, session.me.user.locale);

  return (
    <section aria-label="Cost scenarios">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide scenarios' : 'View scenarios'}
      </button>
      {open && (
        <>
          {notice && <p role="status">{notice}</p>}
          {history.isPending && <p role="status">Loading scenarios…</p>}
          {history.isError && !history.isFetchNextPageError && (
            <div role="alert">
              <p>{denied ? 'Scenarios are unavailable.' : issue(history.error)}</p>
              <button type="button" onClick={() => void history.refetch()}>
                Retry scenarios
              </button>
            </div>
          )}
          {history.isSuccess && items.length === 0 && (
            <p>No scenarios have been saved for this forecast.</p>
          )}
          {history.isSuccess &&
            session.can('enterprise_budget:run_scenario') &&
            (editing ? (
              <ScenarioForm
                path={path}
                forecast={forecast}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  setNotice('Cost scenario saved.');
                  void history.refetch();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  setNotice('');
                }}
              >
                Run cost scenario
              </button>
            ))}
          {items.length > 0 && (
            <ul className="enterprise-change-history">
              {items.map((item) => (
                <li key={item.id}>
                  <strong>{item.scenarioName}</strong>
                  <p>{item.status === 'complete' ? 'Complete scenario' : 'Incomplete scenario'}</p>
                  <dl>
                    <dt>Recorded bill actuals</dt>
                    <dd>{money(item.actualMinor)}</dd>
                    <dt>Source estimate at completion</dt>
                    <dd>{money(item.priorEacMinor)}</dd>
                    <dt>Scenario estimate at completion</dt>
                    <dd>{money(item.eacMinor)}</dd>
                    <dt>Difference</dt>
                    <dd>{money(item.eacDifferenceMinor)}</dd>
                    <dt>Scenario margin</dt>
                    <dd>{money(item.marginMinor)}</dd>
                  </dl>
                  <details>
                    <summary>Scenario cost codes</summary>
                    <ul className="enterprise-change-history">
                      {item.lines.map((line) => (
                        <li key={line.costCode.id}>
                          <strong>
                            {line.costCode.code} · {line.costCode.label}
                          </strong>
                          <span>Remaining {money(line.remainingMinor)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
          {history.hasNextPage && (
            <button
              type="button"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchNextPageError ? 'Retry more scenarios' : 'Load more scenarios'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ScenarioForm({
  path,
  forecast,
  onCancel,
  onSaved,
}: {
  path: string;
  forecast: Forecast;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { api } = useApi();
  const { me } = useSession();
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const nextKey = useRef(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const save = useMutation({
    mutationFn: (data: FormData) => {
      const overrides = drafts.map(({ costCodeId, method, value }): Override => {
        if (method === 'percent_complete') {
          const percent = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value);
          if (!percent) throw new Error('Enter a valid percent complete.');
          return {
            method,
            costCodeId,
            percentCompleteBps:
              Number(percent[1]) * 100 + Number((percent[2] ?? '').padEnd(2, '0')),
          };
        }
        const amount = parseMoneyInput(value, forecast.currency, me.user.locale);
        if (!amount.ok || amount.minor === null) throw new Error('Enter a valid remaining cost.');
        return { method, costCodeId, remainingMinor: Number(amount.minor) };
      });
      const input = { forecastId: forecast.id, scenarioName: data.get('scenarioName'), overrides };
      const signature = JSON.stringify(input);
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      const body = RunEnterpriseCostScenario.safeParse({
        ...input,
        clientRequestId: receipt.current.id,
      });
      if (!body.success)
        throw new Error(body.error.issues[0]?.message ?? 'Check the scenario fields.');
      return api.post(path, body.data, {
        ifMatch: forecast.budgetVersion,
        schema: EnterpriseCostScenario,
      });
    },
    onSuccess: onSaved,
  });

  function patch(key: number, change: Partial<Draft>) {
    setDrafts((items) => items.map((line) => (line.key === key ? { ...line, ...change } : line)));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!save.isPending) save.mutate(new FormData(event.currentTarget));
  }

  return (
    <form className="enterprise-form" aria-label="Run cost scenario" onSubmit={submit}>
      <label>
        Scenario name
        <input
          name="scenarioName"
          minLength={2}
          maxLength={140}
          disabled={save.isPending}
          required
        />
      </label>
      {drafts.map((draft, index) => {
        const source = forecast.lines.find((line) => line.costCode.id === draft.costCodeId);
        return (
          <fieldset
            className="enterprise-budget-adjustment"
            disabled={save.isPending}
            key={draft.key}
          >
            <legend>Override {index + 1}</legend>
            <label>
              Cost code
              <select
                required
                value={draft.costCodeId}
                onChange={(event) =>
                  patch(draft.key, {
                    costCodeId: event.currentTarget.value,
                    method: 'remaining_cost',
                    value: '',
                  })
                }
              >
                <option value="">Choose a forecast cost code</option>
                {forecast.lines.map(({ costCode }) => (
                  <option key={costCode.id} value={costCode.id}>
                    {costCode.code} · {costCode.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estimate method
              <select
                value={draft.method}
                onChange={(event) =>
                  patch(draft.key, {
                    method: event.currentTarget.value as Override['method'],
                    value: '',
                  })
                }
              >
                <option value="remaining_cost">Remaining cost</option>
                <option
                  value="percent_complete"
                  disabled={!source || BigInt(source.approvedBudgetMinor) === 0n}
                >
                  Percent complete
                </option>
              </select>
            </label>
            {draft.method === 'remaining_cost' ? (
              <label>
                Scenario remaining cost ({forecast.currency})
                <input
                  value={draft.value}
                  onChange={(event) => patch(draft.key, { value: event.currentTarget.value })}
                  required
                  inputMode="decimal"
                />
              </label>
            ) : (
              <label>
                Scenario percent complete
                <input
                  value={draft.value}
                  onChange={(event) => patch(draft.key, { value: event.currentTarget.value })}
                  required
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                />
              </label>
            )}
            <button
              type="button"
              onClick={() => setDrafts((items) => items.filter((line) => line.key !== draft.key))}
            >
              Remove override {index + 1}
            </button>
          </fieldset>
        );
      })}
      {drafts.length < forecast.lines.length && (
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            const key = nextKey.current++;
            setDrafts((items) => [
              ...items,
              { key, costCodeId: '', method: 'remaining_cost', value: '' },
            ]);
          }}
        >
          Add override
        </button>
      )}
      {save.isError && (
        <p className="enterprise-budget-adjustment" role="alert">
          {issue(save.error)}
        </p>
      )}
      <button type="submit" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save cost scenario'}
      </button>
      <button type="button" onClick={onCancel} disabled={save.isPending}>
        Cancel
      </button>
    </form>
  );
}
