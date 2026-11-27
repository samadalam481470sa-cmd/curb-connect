'use client';

import {
  FinanceVariancePolicyPreview,
  FinanceVariancePolicyView,
  FinanceVarianceRule,
  FinanceVarianceRuleRevision,
  SetFinanceVarianceRule,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinorUnits, minorToEditableText, parseMoneyInput, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import type { z } from 'zod';

type View = z.infer<typeof FinanceVariancePolicyView>;
type Rule = z.infer<typeof FinanceVarianceRule>;
const path = '/v1/enterprise/finance/variance-policy';
const money = (value: string, locale: string) => formatMinorUnits(BigInt(value), 'USD', locale);

function describe(rule: Rule, locale: string) {
  switch (rule.kind) {
    case 'off':
      return 'Off';
    case 'amount':
      return money(String(rule.amountMinor), locale);
    case 'percent':
      return rule.percentBps / 100 + '%';
  }
}

export function EnterpriseFinanceVariancePolicy({
  order,
}: {
  order?: { projectId: string; orderId: string };
}) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const allowed = session.can('bill:approve');
  const key = orgKey(session.orgId, 'enterprise', 'finance-variance-policy');
  const policy = useQuery({
    queryKey: key,
    enabled: allowed,
    refetchOnMount: 'always',
    queryFn: () => api.get(path, { schema: FinanceVariancePolicyView }),
  });
  const denied =
    !allowed || (isApiError(policy.error) && [401, 403, 404].includes(policy.error.status));
  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link
          href={'/enterprise/finance/compliance' + (order ? '?projectId=' + order.projectId : '')}
        >
          ← Finance compliance
        </Link>
        <h1>Variance alert settings</h1>
      </header>
      {denied && <p role="alert">These finance settings are unavailable.</p>}
      {!denied && policy.isPending && <Skeleton variant="card" label="Loading variance settings" />}
      {!denied && policy.isError && (
        <section className="enterprise-panel" role="alert">
          <p>{errorHint(policy.error)}</p>
          {isApiError(policy.error) && <p>Support reference {policy.error.correlationId}</p>}
          <button type="button" onClick={() => void policy.refetch()}>
            Retry settings
          </button>
        </section>
      )}
      {!denied && policy.data && (
        <RuleForm
          view={policy.data}
          order={order}
          onChanged={() => void client.invalidateQueries({ queryKey: key })}
        />
      )}
    </main>
  );
}

function RuleForm({
  view,
  order,
  onChanged,
}: {
  view: View;
  order: { projectId: string; orderId: string } | undefined;
  onChanged: () => void;
}) {
  const { api } = useApi();
  const { me } = useSession();
  const locale = me.user.locale;
  const current = view.current;
  const [revision, setRevision] = useState(current?.revision ?? 0);
  const [kind, setKind] = useState<Rule['kind']>(current?.rule.kind ?? 'off');
  const [amount, setAmount] = useState(
    current?.rule.kind === 'amount'
      ? minorToEditableText(BigInt(current.rule.amountMinor), 'USD', locale)
      : '',
  );
  const [percent, setPercent] = useState(
    current?.rule.kind === 'percent' ? String(current.rule.percentBps / 100) : '10',
  );
  const [owner, setOwner] = useState(current?.ownerMembershipId ?? '');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const receipt = useRef<{ input: string; id: string } | null>(null);

  function inputs(): Rule {
    if (kind === 'off') return { kind };
    if (kind === 'percent') {
      if (!/^\d+(\.\d{1,2})?$/.test(percent.trim()))
        throw new Error('Enter a percent with up to two decimal places.');
      return FinanceVarianceRule.parse({ kind, percentBps: Math.round(Number(percent) * 100) });
    }
    const parsed = parseMoneyInput(amount, 'USD', locale);
    if (!parsed.ok || parsed.minor === null) throw new Error('Enter a valid threshold amount.');
    return FinanceVarianceRule.parse({ kind, amountMinor: Number(parsed.minor) });
  }

  const preview = useMutation({
    mutationFn: (scope: NonNullable<typeof order>) =>
      api.post(
        path + '/preview',
        { ...scope, rule: inputs() },
        { schema: FinanceVariancePolicyPreview },
      ),
  });
  const save = useMutation({
    mutationFn: () => {
      const data = { rule: inputs(), ownerMembershipId: owner || null, reason };
      const input = JSON.stringify({ revision, ...data });
      if (receipt.current?.input !== input) receipt.current = { input, id: crypto.randomUUID() };
      const parsed = SetFinanceVarianceRule.safeParse({
        ...data,
        clientRequestId: receipt.current.id,
      });
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? 'Check the alert settings.');
      return api.put(path, parsed.data, { ifMatch: revision, schema: FinanceVarianceRuleRevision });
    },
    onSuccess: (saved) => {
      setRevision(saved.revision);
      setReason('');
      setNotice('Variance alert settings saved.');
      onChanged();
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 412) onChanged();
    },
  });
  const latestRevision = current?.revision ?? 0;
  const changed = latestRevision > revision;
  const busy = save.isPending || preview.isPending;
  return (
    <div className="enterprise-stack">
      <section className="enterprise-panel" aria-label="Variance alert policy">
        <h2>Company alert rule</h2>
        <p>
          Current rule{' '}
          {current
            ? describe(current.rule, locale) + ' · Version ' + current.revision
            : 'Off until a controller saves a rule.'}
        </p>
        {notice && <p role="status">{notice}</p>}
        {changed && (
          <div role="alert">
            <p>
              Version {latestRevision} is now active. Review its rule and named recipient before
              applying your changes.
            </p>
            <button
              type="button"
              onClick={() => {
                setRevision(latestRevision);
                save.reset();
              }}
            >
              Review changes against version {latestRevision}
            </button>
          </div>
        )}
        <form
          aria-label="Save variance alert rule"
          className="enterprise-form"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice('');
            save.mutate();
          }}
        >
          <label>
            Alert threshold
            <select
              value={kind}
              disabled={busy}
              onChange={(event) => {
                setKind(event.target.value as Rule['kind']);
                preview.reset();
              }}
            >
              <option value="off">Off</option>
              <option value="amount">Amount</option>
              <option value="percent">Percentage</option>
            </select>
          </label>
          {kind === 'amount' && (
            <label>
              Threshold amount (USD)
              <input
                value={amount}
                inputMode="decimal"
                disabled={busy}
                onChange={(event) => {
                  setAmount(event.target.value);
                  preview.reset();
                }}
              />
            </label>
          )}
          {kind === 'percent' && (
            <label>
              Threshold percentage
              <input
                value={percent}
                inputMode="decimal"
                disabled={busy}
                onChange={(event) => {
                  setPercent(event.target.value);
                  preview.reset();
                }}
              />
            </label>
          )}
          <label>
            Named alert recipient
            <select
              value={owner}
              disabled={busy}
              onChange={(event) => setOwner(event.target.value)}
            >
              <option value="">Select a recipient</option>
              {view.recipients.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              disabled={busy}
            />
          </label>
          {order && (
            <button type="button" disabled={busy} onClick={() => preview.mutate(order)}>
              Preview this purchase order
            </button>
          )}
          <button
            type="submit"
            disabled={busy || changed || (kind !== 'off' && !owner) || reason.trim().length < 3}
          >
            Save approved threshold
          </button>
          {save.isError && <p role="alert">{errorHint(save.error)}</p>}
          {preview.isError && <p role="alert">{errorHint(preview.error)}</p>}
        </form>
        {preview.data && (
          <dl aria-label="Purchase impact preview">
            <dt>Reviewed versions</dt>
            <dd>
              Budget {preview.data.budgetVersion} · Order {preview.data.orderRevision}
            </dd>
            <dt>Allocation</dt>
            <dd>{money(preview.data.allocationMinor, locale)}</dd>
            <dt>Committed plus draft</dt>
            <dd>{money(preview.data.proposedMinor, locale)}</dd>
            <dt>Alert impact</dt>
            <dd>
              {preview.data.currentAlert ? 'Current rule alerts' : 'Current rule stays quiet'} ·{' '}
              {preview.data.proposedAlert ? 'Proposed rule alerts' : 'Proposed rule stays quiet'}
            </dd>
          </dl>
        )}
      </section>
      <section className="enterprise-panel" aria-label="Variance alert policy history">
        <h2>Rule history</h2>
        {view.history.length === 0 && <p>No company threshold has been approved.</p>}
        <ol className="enterprise-change-history">
          {view.history.map((item) => (
            <li key={item.id}>
              <strong>
                Version {item.revision} · {describe(item.rule, locale)}
              </strong>
              <span>
                {view.recipients.find(({ id }) => id === item.ownerMembershipId)?.name ??
                  'No active recipient'}
              </span>
              <p>{item.reason}</p>
              <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
