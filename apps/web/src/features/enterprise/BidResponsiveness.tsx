'use client';

import {
  EnterpriseBidReview,
  EnterpriseBidReviewInput,
  enterpriseBidReviewCriteria,
} from '@fieldline/contracts';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint } from '../../lib/api';
import { useApi } from '../../lib/session';

const criterionLabels = {
  scope: 'Scope coverage',
  schedule: 'Schedule requirements',
  qualifications: 'Qualifications',
};

export function BidResponsiveness({
  path,
  revision,
  review,
  canReview,
  onSaved,
}: {
  path: string;
  revision: number;
  review?: EnterpriseBidReview;
  canReview: boolean;
  onSaved: () => Promise<void>;
}) {
  const { api } = useApi();
  const [editRevision, setEditRevision] = useState<number | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<{ key: string; id: string } | null>(null);
  const mutation = useMutation({
    mutationFn: ({
      input,
      baseline,
    }: {
      input: z.infer<typeof EnterpriseBidReviewInput>;
      baseline: number;
    }) => api.post(path, input, { ifMatch: baseline, schema: EnterpriseBidReview }),
    onSuccess: async () => {
      pending.current = null;
      await onSaved();
      setEditRevision(null);
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editRevision === null || mutation.isPending) return;
    const data = new FormData(event.currentTarget);
    const fields = {
      outcome: data.get('outcome'),
      checklist: enterpriseBidReviewCriteria.map((criterion) => ({
        criterion,
        result: data.get(criterion),
        evidence: data.get(criterion + 'Evidence'),
      })),
      rationale: data.get('rationale'),
      exceptionNote: String(data.get('exceptionNote') ?? '').trim() || null,
    };
    setError('');
    try {
      const key = JSON.stringify({ fields, revision: editRevision });
      if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
      const input = EnterpriseBidReviewInput.parse({
        ...fields,
        clientRequestId: pending.current.id,
      });
      await mutation.mutateAsync({ input, baseline: editRevision });
    } catch (cause) {
      setError(
        cause instanceof z.ZodError
          ? (cause.issues[0]?.message ?? 'Check the review fields.')
          : errorHint(cause),
      );
    }
  }

  return (
    <>
      {review && (
        <details>
          <summary>
            {review.outcome === 'responsive' ? 'Responsive' : 'Nonresponsive'}
            {review.exceptionNote && ' with exception'} · Review at revision{' '}
            {review.packageRevision}
          </summary>
          <ul>
            {review.checklist.map((item) => (
              <li key={item.criterion}>
                <strong>
                  {criterionLabels[item.criterion]} ·{' '}
                  {item.result === 'meets' ? 'Meets requirements' : 'Unmet'}
                </strong>
                <p>{item.evidence}</p>
              </li>
            ))}
          </ul>
          <p>{review.rationale}</p>
          {review.exceptionNote && <p>Documented exception · {review.exceptionNote}</p>}
        </details>
      )}
      {canReview && editRevision === null && (
        <button
          type="button"
          onClick={() => {
            setError('');
            setEditRevision(revision);
          }}
        >
          {review ? 'Record new responsiveness review' : 'Review responsiveness'}
        </button>
      )}
      {canReview && editRevision !== null && (
        <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
          {enterpriseBidReviewCriteria.map((criterion) => (
            <fieldset key={criterion}>
              <legend>{criterionLabels[criterion]}</legend>
              <label>
                {criterionLabels[criterion]} outcome
                <select name={criterion} required defaultValue="">
                  <option value="">Choose an outcome</option>
                  <option value="meets">Meets requirements</option>
                  <option value="does_not_meet">Unmet requirement</option>
                </select>
              </label>
              <label>
                {criterionLabels[criterion]} evidence
                <textarea name={criterion + 'Evidence'} required minLength={3} maxLength={500} />
              </label>
            </fieldset>
          ))}
          <label>
            Responsiveness decision
            <select name="outcome" required defaultValue="">
              <option value="">Choose a decision</option>
              <option value="responsive">Responsive</option>
              <option value="nonresponsive">Nonresponsive</option>
            </select>
          </label>
          <label>
            Review rationale
            <textarea name="rationale" required minLength={3} maxLength={1000} />
          </label>
          <label>
            Exception justification
            <textarea name="exceptionNote" maxLength={1000} />
          </label>
          <p>Document an exception to mark a quote responsive when a requirement is unmet.</p>
          {error && (
            <p className="enterprise-error" role="alert">
              {error}
            </p>
          )}
          <div className="enterprise-actions">
            <button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving review…' : 'Save responsiveness review'}
            </button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                pending.current = null;
                setEditRevision(null);
                void onSaved();
              }}
            >
              Cancel review
            </button>
          </div>
        </form>
      )}
    </>
  );
}
