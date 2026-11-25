'use client';

import {
  DecideEnterpriseTakeoffReview,
  EnterpriseTakeoffReview,
  EnterpriseTakeoffReviewHistory,
  SubmitEnterpriseTakeoffReview,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Review = z.infer<typeof EnterpriseTakeoffReview>;
type Decision = z.infer<typeof DecideEnterpriseTakeoffReview>;
const reviewLabels = {
  review_required: 'Ready for review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
};

function message(cause: unknown) {
  if (cause instanceof z.ZodError) return 'Enter a review note between 3 and 1,000 characters.';
  return isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause);
}

export function TakeoffMeasurementReview({
  path,
  sheetId,
  label,
}: {
  path: string;
  sheetId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={'Review ' + label}>Review measurement</summary>
      {open && <ReviewPanel path={path} sheetId={sheetId} />}
    </details>
  );
}

function ReviewPanel({ path, sheetId }: { path: string; sheetId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'takeoff-reviews', sheetId, path];
  const history = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { query: { cursor: pageParam }, schema: EnterpriseTakeoffReviewHistory }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const current = history.data?.pages[0];
  const records = history.data?.pages.flatMap((page) => page.reviews) ?? [];
  const active = records.find(
    (row) =>
      row.measurementRevision === current?.measurementRevision &&
      row.status !== 'changes_requested',
  );
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const submitRetry = useRef<{ note: string; revision: number; id: string } | null>(null);
  const submit = useMutation({
    mutationFn: ({ note, revision }: { note: FormDataEntryValue | null; revision: number }) => {
      const text = z.string().trim().parse(note);
      if (submitRetry.current?.note !== text || submitRetry.current.revision !== revision) {
        submitRetry.current = { note: text, revision, id: crypto.randomUUID() };
      }
      const data = SubmitEnterpriseTakeoffReview.parse({
        note: text,
        clientRequestId: submitRetry.current.id,
      });
      return api.post(path, data, { ifMatch: revision, schema: EnterpriseTakeoffReview });
    },
  });
  const decide = useMutation({
    mutationFn: ({ review, data }: { review: Review; data: Decision }) =>
      api.post(path + '/' + review.id + '/decide', data, {
        ifMatch: review.revision,
        schema: EnterpriseTakeoffReview,
      }),
  });
  const pending = submit.isPending || decide.isPending;

  async function save(event: FormEvent<HTMLFormElement>, review?: Review) {
    event.preventDefault();
    if (!current || pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaved('');
    setError('');
    try {
      const result = review
        ? await decide.mutateAsync({
            review,
            data: DecideEnterpriseTakeoffReview.parse({
              decision: data.get('decision'),
              note: data.get('note'),
            }),
          })
        : await submit.mutateAsync({
            note: data.get('note'),
            revision: current.measurementRevision,
          });
      submitRetry.current = null;
      form.reset();
      setSaved(reviewLabels[result.status]);
      await client.invalidateQueries({ queryKey: key });
    } catch (cause) {
      setError(message(cause));
      if (isApiError(cause) && (cause.status === 409 || cause.status === 412))
        void history.refetch();
    }
  }

  return (
    <div>
      {history.isPending && <p role="status">Loading review history…</p>}
      {history.isError && (
        <div>
          <p role="alert" className="enterprise-error">
            {message(history.error)}
          </p>
          <button type="button" onClick={() => void history.refetch()}>
            Retry loading reviews
          </button>
        </div>
      )}
      {current?.approvalBlock === 'stale_calibration' && (
        <p>The sheet scale changed. Measure again with the current scale to approve a quantity.</p>
      )}
      {current?.approvalBlock === 'incorrect_scale' && (
        <p>
          The calibration check found an incorrect scale. Verify and correct it before approval.
        </p>
      )}
      {current && !active && session.can('estimate:write') && !current.approvalBlock && (
        <form className="enterprise-form" onSubmit={(event) => void save(event)}>
          <label>
            Reason for review <textarea name="note" required minLength={3} maxLength={1000} />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? 'Submitting…' : 'Submit for review'}
          </button>
        </form>
      )}
      {active?.status === 'review_required' && session.can('review_task:decide') && (
        <form
          key={active.id}
          className="enterprise-form"
          onSubmit={(event) => void save(event, active)}
        >
          <label>
            Review decision
            <select name="decision" defaultValue="" required>
              <option value="">Choose a decision</option>
              <option value="approved" disabled={!!current?.approvalBlock}>
                Approve measured quantity
              </option>
              <option value="changes_requested">Request changes</option>
            </select>
          </label>
          <label>
            Decision reason <textarea name="note" required minLength={3} maxLength={1000} />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Record decision'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      {saved && <p role="status">{saved}</p>}
      {!!records.length && (
        <ul aria-label="Review history" className="enterprise-change-history">
          {records.map((row) => (
            <li key={row.id}>
              <strong>{reviewLabels[row.status]}</strong>
              {(row.measurementRevision !== current?.measurementRevision ||
                current.approvalBlock === 'stale_calibration') && (
                <span>Earlier measurement or scale revision</span>
              )}
              <span>{row.submitNote}</span>
              {row.reviewNote && <span>{row.reviewNote}</span>}
              <time dateTime={row.reviewedAt ?? row.createdAt}>
                {(row.reviewedAt ?? row.createdAt).slice(0, 10)}
              </time>
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
          Load earlier reviews
        </button>
      )}
      {current && records.length === 0 && !session.can('estimate:write') && (
        <p>No review requests yet.</p>
      )}
    </div>
  );
}
