'use client';

import {
  computeTakeoffLength,
  EnterpriseTakeoffCalibrationState,
  EnterpriseTakeoffCategory,
  EnterpriseTakeoffCategoryInput,
  EnterpriseTakeoffLength,
  EnterpriseTakeoffLengthInput,
  EnterpriseTakeoffLengthPage,
  MAX_TAKEOFF_LENGTH_VERTICES,
  type EnterpriseTakeoffCalibration,
  type EnterpriseTakeoffSheet,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { parseCalibrationPoint, type CoordinateDraft } from './TakeoffCalibrationControls';

type Sheet = z.infer<typeof EnterpriseTakeoffSheet>;
type LengthInput = z.infer<typeof EnterpriseTakeoffLengthInput>;
const quantity = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 });

export type TakeoffLengthDraft = {
  calibration: EnterpriseTakeoffCalibration;
  vertices: CoordinateDraft[];
  finished: boolean;
};

export function TakeoffLengthControls({
  path,
  categoryPath,
  calibrationPath,
  sheet,
  draft,
  canDraw,
  constrain,
  onConstrain,
  onDraft,
  onFocusDrawing,
}: {
  path: string;
  categoryPath: string;
  calibrationPath: string;
  sheet: Sheet;
  draft: TakeoffLengthDraft | null;
  canDraw: boolean;
  constrain: boolean;
  onConstrain: (value: boolean) => void;
  onDraft: (draft: TakeoffLengthDraft | null) => void;
  onFocusDrawing: () => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'takeoff-lengths', sheet.id];
  const measurementList = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { query: { cursor: pageParam }, schema: EnterpriseTakeoffLengthPage }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const calibration = useQuery({
    queryKey: [...orgKey(session.orgId, 'enterprise'), 'takeoff-calibration', sheet.id],
    queryFn: () => api.get(calibrationPath, { schema: EnterpriseTakeoffCalibrationState }),
  });
  const current = calibration.data?.calibration ?? null;
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState('');
  const request = useRef<{ key: string; id: string } | null>(null);
  const list = measurementList.data?.pages.flatMap((page) => page.items) ?? [];
  const categories = measurementList.data?.pages[0]?.categories ?? [];
  const stale = draft !== null && current?.id !== draft.calibration.id;
  const canWrite = session.can('estimate:write');
  const save = useMutation({
    mutationFn: (body: LengthInput) => api.post(path, body, { schema: EnterpriseTakeoffLength }),
    onSuccess: async () => {
      onDraft(null);
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const vertices =
    draft?.vertices.map(parseCalibrationPoint).flatMap((vertex) => (vertex ? [vertex] : [])) ?? [];
  let preview: ReturnType<typeof computeTakeoffLength> | null = null;
  let previewError = '';
  if (draft && vertices.length >= 2 && vertices.length === draft.vertices.length) {
    try {
      preview = computeTakeoffLength(vertices, draft.calibration.scale, sheet);
    } catch (cause) {
      if (cause instanceof RangeError) previewError = cause.message;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft?.finished || !preview || stale || save.isPending) return;
    setError('');
    try {
      const values = { categoryId, calibrationId: draft.calibration.id, vertices };
      const signature = JSON.stringify(values);
      if (request.current?.key !== signature)
        request.current = { key: signature, id: crypto.randomUUID() };
      await save.mutateAsync(
        EnterpriseTakeoffLengthInput.parse({
          ...values,
          clientRequestId: request.current.id,
        }),
      );
      request.current = null;
    } catch (cause) {
      setError(isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause));
      void calibration.refetch();
    }
  }

  return (
    <section aria-label="Sheet length measurements" className="enterprise-takeoff-calibration">
      <h4>Length measurements</h4>
      {measurementList.isPending && <p role="status">Loading measurements…</p>}
      {measurementList.isError && (
        <p role="alert" className="enterprise-error">
          {errorHint(measurementList.error)}
        </p>
      )}
      {calibration.isSuccess && !current && <p>Save a sheet scale before measuring length.</p>}
      {canWrite && canDraw && current && !draft && (
        <button
          type="button"
          onClick={() => {
            setError('');
            onDraft({ calibration: current, vertices: [], finished: false });
            onFocusDrawing();
          }}
        >
          Start length measurement
        </button>
      )}
      {draft && canWrite && (
        <>
          <TakeoffCategoryForm path={categoryPath} onSaved={setCategoryId} />
          <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
            {!draft.finished && (
              <p>
                Click the drawing to add vertices. Double-click or choose Finish polyline to stop
                drawing.
              </p>
            )}
            <label>
              <input
                type="checkbox"
                checked={constrain}
                onChange={(event) => onConstrain(event.target.checked)}
              />
              Constrain segments to 45° increments
            </label>
            <label>
              Measurement category
              <select
                required
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">Choose a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            {draft.vertices.map((vertex, index) => (
              <fieldset key={index} disabled={save.isPending}>
                <legend>Vertex {index + 1}</legend>
                <div className="enterprise-calibration-coordinates">
                  {(['x', 'y'] as const).map((axis) => (
                    <label key={axis}>
                      Vertex {index + 1} {axis.toUpperCase()} (pt)
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max={axis === 'x' ? sheet.widthPoints : sheet.heightPoints}
                        value={vertex[axis]}
                        required
                        onChange={(event) => {
                          const updated = [...draft.vertices];
                          updated[index] = { ...vertex, [axis]: event.target.value };
                          onDraft({ ...draft, vertices: updated });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="enterprise-actions">
              <button
                type="button"
                disabled={draft.vertices.length >= MAX_TAKEOFF_LENGTH_VERTICES || save.isPending}
                onClick={() =>
                  onDraft({
                    ...draft,
                    vertices: [...draft.vertices, { x: '', y: '' }],
                    finished: false,
                  })
                }
              >
                Add vertex coordinates
              </button>
              <button
                type="button"
                disabled={!draft.vertices.length || save.isPending}
                onClick={() =>
                  onDraft({ ...draft, vertices: draft.vertices.slice(0, -1), finished: false })
                }
              >
                Undo last vertex
              </button>
              <button
                type="button"
                disabled={(!draft.finished && !preview) || save.isPending}
                onClick={() => onDraft({ ...draft, finished: !draft.finished })}
              >
                {draft.finished ? 'Continue drawing' : 'Finish polyline'}
              </button>
            </div>
            {previewError && (
              <p role="alert" className="enterprise-error">
                {previewError}
              </p>
            )}
            {preview && (
              <p role="status">
                Length · {quantity.format(preview.length)} {draft.calibration.unit}
              </p>
            )}
            {stale && (
              <div>
                <p role="alert" className="enterprise-error">
                  The saved sheet scale changed during this measurement.
                </p>
                {current && (
                  <button type="button" onClick={() => onDraft({ ...draft, calibration: current })}>
                    Use current scale
                  </button>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="enterprise-error">
                {error}
              </p>
            )}
            <div className="enterprise-actions">
              <button
                type="submit"
                disabled={save.isPending || stale || !draft.finished || !preview || !categoryId}
              >
                {save.isPending ? 'Saving length…' : 'Save length measurement'}
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => {
                  request.current = null;
                  onDraft(null);
                }}
              >
                Cancel measurement
              </button>
            </div>
          </form>
        </>
      )}
      {measurementList.isSuccess && list.length === 0 && (
        <p>This sheet has no length measurements.</p>
      )}
      {!!list.length && (
        <ul className="enterprise-change-history">
          {list.map((measurement) => (
            <li key={measurement.id}>
              <strong>
                {categories.find(({ id }) => id === measurement.categoryId)?.name} ·{' '}
                {quantity.format(measurement.length)} {measurement.unit}
              </strong>
              {measurement.requiresReview && (
                <span>Review required · Saved with an earlier scale</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {measurementList.hasNextPage && (
        <button
          type="button"
          disabled={measurementList.isFetchingNextPage}
          onClick={() => void measurementList.fetchNextPage()}
        >
          Load more length measurements
        </button>
      )}
    </section>
  );
}

export function TakeoffCategoryForm({
  path,
  onSaved,
}: {
  path: string;
  onSaved: (id: string) => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise');
  const [error, setError] = useState('');
  const add = useMutation({
    mutationFn: (body: z.infer<typeof EnterpriseTakeoffCategoryInput>) =>
      api.post(path, body, { schema: EnterpriseTakeoffCategory }),
    onSuccess: async (row) => {
      onSaved(row.id);
      await Promise.all([
        client.invalidateQueries({ queryKey: [...key, 'takeoff-lengths'] }),
        client.invalidateQueries({ queryKey: [...key, 'takeoff-counts'] }),
      ]);
    },
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError('');
    try {
      const body = EnterpriseTakeoffCategoryInput.parse({ name: new FormData(form).get('name') });
      await add.mutateAsync(body);
      form.reset();
    } catch (cause) {
      setError(isApiError(cause) ? cause.message : errorHint(cause));
    }
  }
  return (
    <details>
      <summary>Add a measurement category</summary>
      <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
        <label>
          Category name <input name="name" minLength={2} maxLength={100} required />
        </label>
        <button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add category'}
        </button>
        {error && (
          <p className="enterprise-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
