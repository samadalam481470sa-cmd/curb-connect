'use client';

import {
  CompareTakeoffRevisions,
  type EnterpriseTakeoffPlan,
  EnterpriseTakeoffPlanDetail,
  TakeoffComparisonPreview,
} from '@fieldline/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { useApi } from '../../lib/session';
import { TakeoffOverlay } from './TakeoffOverlay';

type Reference = { planId: string; sheetId: string };
type Preview = z.infer<typeof TakeoffComparisonPreview>;
const blankReference: Reference = { planId: '', sheetId: '' };
const issueLabels = {
  different_sheet: 'The drawings use different sheet references.',
  different_size: 'The page size or orientation differs.',
  different_scale: 'The saved calibrations use different scales.',
  unknown_scale: 'At least one drawing has no saved scale.',
};

function errorMessage(cause: unknown) {
  if (cause instanceof z.ZodError) return cause.issues[0]?.message ?? 'Check the alignment fields.';
  return isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause);
}

export function TakeoffPlanComparison({
  path,
  projectPath,
  queryKey,
  plans,
  onClose,
}: {
  path: string;
  projectPath: string;
  queryKey: readonly unknown[];
  plans: EnterpriseTakeoffPlan[];
  onClose: () => void;
}) {
  const { api } = useApi();
  const [earlier, setEarlier] = useState<Reference>(blankReference);
  const [current, setCurrent] = useState<Reference>(blankReference);
  const [result, setResult] = useState<Preview | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const compare = useMutation({
    mutationFn: (body: z.infer<typeof CompareTakeoffRevisions>) =>
      api.post(path + '/compare', body, { schema: TakeoffComparisonPreview }),
  });
  const requiresReview = !!result?.alignmentIssues.length;

  function changeSource(which: 'earlier' | 'current', value: Reference) {
    if (which === 'earlier') setEarlier(value);
    else setCurrent(value);
    setResult(null);
    setReviewed(false);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (compare.isPending) return;
    const fields = new FormData(event.currentTarget);
    setError('');
    setDirty(true);
    try {
      const input = CompareTakeoffRevisions.parse({
        oldRevisionId: earlier.planId,
        oldSheetId: earlier.sheetId,
        newRevisionId: current.planId,
        newSheetId: current.sheetId,
        alignment: {
          offsetX: Number(fields.get('offsetX')),
          offsetY: Number(fields.get('offsetY')),
          scale: Number(fields.get('scale')),
          rotation: Number(fields.get('rotation')),
          reviewed: fields.has('reviewed'),
        },
      });
      setResult(await compare.mutateAsync(input));
      setDirty(false);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <section className="enterprise-panel enterprise-stack" aria-label="Compare plan revisions">
      <div className="enterprise-control-head">
        <h3>Compare plan revisions</h3>
        <button type="button" onClick={onClose}>
          Close comparison
        </button>
      </div>
      <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
        <PlanSheetSelect
          label="Earlier"
          path={path}
          queryKey={queryKey}
          plans={plans}
          value={earlier}
          onChange={(value) => changeSource('earlier', value)}
          busy={compare.isPending}
        />
        <PlanSheetSelect
          label="Current"
          path={path}
          queryKey={queryKey}
          plans={plans}
          value={current}
          onChange={(value) => changeSource('current', value)}
          busy={compare.isPending}
        />
        {earlier.sheetId && current.sheetId && (
          <fieldset
            disabled={compare.isPending}
            onChange={(event) => {
              setDirty(true);
              if (event.target instanceof HTMLInputElement && event.target.name === 'reviewed')
                return;
              setReviewed(false);
            }}
          >
            <legend>Align the current drawing</legend>
            <label>
              Horizontal offset (pt){' '}
              <input
                name="offsetX"
                type="number"
                step="any"
                defaultValue={0}
                min={-100000}
                max={100000}
                required
              />
            </label>
            <label>
              Vertical offset (pt){' '}
              <input
                name="offsetY"
                type="number"
                step="any"
                defaultValue={0}
                min={-100000}
                max={100000}
                required
              />
            </label>
            <label>
              Scale factor{' '}
              <input
                name="scale"
                type="number"
                step="any"
                defaultValue={1}
                min={0.0625}
                max={16}
                required
              />
            </label>
            <label>
              Rotate current drawing
              <select name="rotation" defaultValue={0}>
                {[0, 90, 180, 270].map((turn) => (
                  <option key={turn} value={turn}>
                    {turn}°
                  </option>
                ))}
              </select>
            </label>
            {requiresReview && (
              <label>
                <input
                  type="checkbox"
                  name="reviewed"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />{' '}
                I reviewed the alignment settings for both drawings
              </label>
            )}
          </fieldset>
        )}
        <button type="submit" disabled={compare.isPending || !earlier.sheetId || !current.sheetId}>
          {compare.isPending ? 'Checking drawings…' : 'Preview drawing overlay'}
        </button>
      </form>
      {error && (
        <p className="enterprise-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div>
          <p>
            Earlier drawing · {result.earlier.planTitle} · {result.earlier.revisionLabel} · Sheet{' '}
            {result.earlier.pageLabel}
          </p>
          <p>
            Current drawing · {result.current.planTitle} · {result.current.revisionLabel} · Sheet{' '}
            {result.current.pageLabel}
          </p>
          {requiresReview && (
            <div aria-label="Alignment review">
              <h4>
                {result.status === 'ready' && !dirty
                  ? 'Alignment reviewed'
                  : 'Review alignment before comparing'}
              </h4>
              <ul>
                {result.alignmentIssues.map((issue) => (
                  <li key={issue}>{issueLabels[issue]}</li>
                ))}
              </ul>
            </div>
          )}
          {result.status === 'ready' && !dirty && (
            <TakeoffOverlay projectPath={projectPath} preview={result} />
          )}
        </div>
      )}
    </section>
  );
}

function PlanSheetSelect({
  label,
  path,
  queryKey,
  plans,
  value,
  onChange,
  busy,
}: {
  label: string;
  path: string;
  queryKey: readonly unknown[];
  plans: EnterpriseTakeoffPlan[];
  value: Reference;
  onChange: (value: Reference) => void;
  busy: boolean;
}) {
  const { api } = useApi();
  const detail = useQuery({
    queryKey: [...queryKey, 'plan', value.planId],
    queryFn: () =>
      api.get(path + '/plan-sets/' + value.planId, { schema: EnterpriseTakeoffPlanDetail }),
    enabled: !!value.planId,
  });
  return (
    <fieldset disabled={busy}>
      <legend>{label} revision</legend>
      <label>
        {label} plan set
        <select
          required
          value={value.planId}
          onChange={(event) => onChange({ planId: event.target.value, sheetId: '' })}
        >
          <option value="">Choose a plan set</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.title} · {plan.revisionLabel}
            </option>
          ))}
        </select>
      </label>
      {value.planId && detail.isPending && <p role="status">Loading sheets…</p>}
      {value.planId && detail.isError && (
        <div>
          <p role="alert" className="enterprise-error">
            {errorMessage(detail.error)}
          </p>
          <button type="button" onClick={() => void detail.refetch()}>
            Retry loading sheets
          </button>
        </div>
      )}
      {detail.data && (
        <label>
          {label} sheet
          <select
            required
            value={value.sheetId}
            onChange={(event) => onChange({ ...value, sheetId: event.target.value })}
          >
            <option value="">Choose a sheet</option>
            {detail.data.sheets.map((sheet) => (
              <option key={sheet.id} value={sheet.id}>
                Sheet {sheet.pageLabel} · {sheet.sourceTitle} · Vault version {sheet.sourceRevision}
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  );
}
