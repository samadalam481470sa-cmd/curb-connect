'use client';

import {
  ApproveEnterpriseBudgetBaseline,
  CreateEnterpriseBudgetBaseline,
  EnterpriseBudgetApproved,
  EnterpriseBudgetCreated,
  EnterpriseBudgetLineReceipt,
  type EnterpriseBudgetSummary,
  EnterprisePurchaseCostCode,
  RecordEnterpriseBudgetDraftLine,
} from '@fieldline/contracts';
import { useMutation } from '@tanstack/react-query';
import { parseMoneyInput } from '@fieldline/ui';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { useApi, useSession } from '../../lib/session';

export type BudgetFormMode = 'create' | 'costCode' | 'line' | 'approve';

const saveLabels: Record<BudgetFormMode, string> = {
  create: 'Create draft baseline',
  costCode: 'Save cost code',
  line: 'Save budget line',
  approve: 'Approve baseline',
};

const units: Record<z.infer<typeof RecordEnterpriseBudgetDraftLine>['unit'], string> = {
  allowance: 'Allowance',
  lump_sum: 'Lump sum',
  each: 'Each',
  linear_ft: 'Linear feet',
  square_ft: 'Square feet',
  cubic_yd: 'Cubic yards',
  hour: 'Hours',
};

export function EnterpriseBudgetForm({
  mode,
  path,
  summary,
  onComplete,
  onCancel,
  onStale,
}: {
  mode: BudgetFormMode;
  path: string;
  summary: z.infer<typeof EnterpriseBudgetSummary>;
  onComplete: () => void;
  onCancel: () => void;
  onStale: () => void;
}) {
  const { api } = useApi();
  const { me } = useSession();
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const baseline = summary.baseline;
  const [expected, setExpected] = useState(baseline?.revision ?? 0);
  const stale = (mode === 'line' || mode === 'approve') && baseline?.revision !== expected;
  const save = useMutation({
    mutationFn: async (data: FormData) => {
      const inputs = Object.fromEntries(data);
      if (mode === 'costCode') {
        return api.post(
          path.replace(/\/budget$/, '/purchase-cost-codes'),
          EnterprisePurchaseCostCode.parse(inputs),
          { schema: EnterprisePurchaseCostCode },
        );
      }
      const signature = JSON.stringify({ mode, inputs, revision: expected });
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      const clientRequestId = receipt.current.id;
      if (mode === 'create') {
        const body = CreateEnterpriseBudgetBaseline.parse({
          ...inputs,
          currency: String(inputs.currency).toUpperCase(),
          clientRequestId,
        });
        return api.post(path, body, { ifMatch: 0, schema: EnterpriseBudgetCreated });
      }
      if (!baseline) throw new Error('Open a current budget before saving.');
      const target = path + '/' + baseline.id;
      if (mode === 'approve') {
        const body = ApproveEnterpriseBudgetBaseline.parse({ ...inputs, clientRequestId });
        return api.post(target + '/approval', body, {
          ifMatch: expected,
          schema: EnterpriseBudgetApproved,
        });
      }
      const { amount, ...fields } = inputs;
      const parsed = parseMoneyInput(String(amount), baseline.currency, me.user.locale, {
        allowNegative: false,
      });
      if (!parsed.ok || parsed.minor === null || parsed.minor > 1_000_000_000_000n)
        throw new Error('Enter a valid budget amount within the supported range.');
      const body = RecordEnterpriseBudgetDraftLine.parse({
        ...fields,
        amountMinor: Number(parsed.minor),
        currency: baseline.currency,
        clientRequestId,
      });
      return api.post(target + '/lines', body, {
        ifMatch: expected,
        schema: EnterpriseBudgetLineReceipt,
      });
    },
    onSuccess: onComplete,
    onError: (error) => {
      if (isApiError(error) && error.is('precondition_failed')) onStale();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!save.isPending && !stale) save.mutate(new FormData(event.currentTarget));
  }

  return (
    <form className="enterprise-form" aria-label={saveLabels[mode]} onSubmit={submit}>
      {mode === 'create' && (
        <>
          <label>
            Currency
            <input
              name="currency"
              defaultValue={summary.companyCurrency}
              required
              minLength={3}
              maxLength={3}
              pattern="[A-Za-z]{3}"
            />
          </label>
          <label>
            Effective date
            <input name="effectiveOn" type="date" defaultValue={summary.asOf} required />
          </label>
        </>
      )}
      {mode === 'costCode' && (
        <>
          <label>
            Cost code
            <input name="code" required maxLength={24} />
          </label>
          <label>
            Cost code label
            <input name="label" required minLength={2} maxLength={160} />
          </label>
        </>
      )}
      {mode === 'line' && baseline && (
        <>
          <label>
            Cost code
            <select name="costCodeId" defaultValue="" required>
              <option value="">Choose a project cost code</option>
              {summary.availableCostCodes.map((costCode) => (
                <option key={costCode.id} value={costCode.id}>
                  {costCode.code} · {costCode.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <input name="description" required minLength={2} maxLength={200} />
          </label>
          <label>
            Amount ({baseline.currency})
            <input name="amount" required inputMode="decimal" />
          </label>
          <label>
            Unit
            <select name="unit" defaultValue="lump_sum">
              {Object.entries(units).map(([unit, label]) => (
                <option key={unit} value={unit}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project phase
            <input name="phase" required minLength={2} maxLength={80} />
          </label>
          <label>
            Funding source
            <input name="fundingSource" required minLength={2} maxLength={120} />
          </label>
        </>
      )}
      {mode === 'approve' && (
        <>
          <p>Approval freezes these budget lines as the project baseline.</p>
          <label>
            Approval reason
            <textarea name="reason" required minLength={3} maxLength={500} />
          </label>
        </>
      )}
      {save.isError && (
        <p role="alert">
          {isApiError(save.error)
            ? (save.error.problem.detail ?? errorHint(save.error))
            : save.error instanceof Error
              ? save.error.message
              : 'Check the budget fields and try again.'}
        </p>
      )}
      {stale && baseline && (
        <div role="status">
          <p>
            Budget revision {baseline.revision} replaced revision {expected}.
          </p>
          {baseline.status === 'draft' && (
            <button
              type="button"
              onClick={() => {
                setExpected(baseline.revision);
                save.reset();
              }}
            >
              Use revision {baseline.revision}
            </button>
          )}
        </div>
      )}
      <button type="submit" disabled={save.isPending || stale}>
        {save.isPending ? 'Saving…' : saveLabels[mode]}
      </button>
      <button type="button" disabled={save.isPending} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
