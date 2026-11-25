'use client';

import {
  EnterpriseTakeoffCount,
  EnterpriseTakeoffCountInput,
  EnterpriseTakeoffCountList,
  EnterpriseTakeoffMarkerSymbol,
  MAX_TAKEOFF_COUNT_MARKERS,
  type EnterpriseTakeoffPoint,
  type EnterpriseTakeoffSheet,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { parseCalibrationPoint, type CoordinateDraft } from './TakeoffCalibrationControls';
import { TakeoffCategoryForm } from './TakeoffLengthControls';

type CountInput = z.infer<typeof EnterpriseTakeoffCountInput>;
export type SavedTakeoffCount = z.infer<typeof EnterpriseTakeoffCount>;
export type TakeoffCountDraft = {
  points: CoordinateDraft[];
  pendingNearby: EnterpriseTakeoffPoint | null;
  saving: boolean;
  symbol: EnterpriseTakeoffMarkerSymbol;
};

const labels = { circle: 'Circle', square: 'Square', triangle: 'Triangle', cross: 'Cross' };

export function TakeoffCountControls({
  path,
  categoryPath,
  sheet,
  draft,
  canDraw,
  onDraft,
  onFocusDrawing,
  onShow,
}: {
  path: string;
  categoryPath: string;
  sheet: z.infer<typeof EnterpriseTakeoffSheet>;
  draft: TakeoffCountDraft | null;
  canDraw: boolean;
  onDraft: (draft: TakeoffCountDraft | null) => void;
  onFocusDrawing: () => void;
  onShow: (count: SavedTakeoffCount | null) => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'takeoff-counts', sheet.id];
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { query: { cursor: pageParam }, schema: EnterpriseTakeoffCountList }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const [saveError, setSaveError] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [selected, setSelected] = useState('');
  const request = useRef<{ key: string; id: string } | null>(null);
  const categories = list.data?.pages[0]?.categories ?? [];
  const saved = list.data?.pages.flatMap((page) => page.items) ?? [];
  const points =
    draft?.points.flatMap((point) => {
      const parsed = parseCalibrationPoint(point);
      return parsed ? [parsed] : [];
    }) ?? [];
  const canWrite = session.can('estimate:write');
  const save = useMutation({
    mutationFn: (input: CountInput) => api.post(path, input, { schema: EnterpriseTakeoffCount }),
    onSuccess: async (count) => {
      onDraft(null);
      setSelected(count.id);
      onShow(count);
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({
          queryKey: [...orgKey(session.orgId, 'enterprise'), 'takeoff-conditions', sheet.id],
        }),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: ({ count, marker }: { count: SavedTakeoffCount; marker: string }) =>
      api.post(
        path + '/' + count.id + '/markers/' + marker + '/remove',
        {},
        {
          ifMatch: count.revision,
          schema: EnterpriseTakeoffCount,
        },
      ),
    onSuccess: async (count) => {
      if (selected === count.id) onShow(count);
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({
          queryKey: [...orgKey(session.orgId, 'enterprise'), 'takeoff-conditions', sheet.id],
        }),
        client.invalidateQueries({
          queryKey: [...orgKey(session.orgId, 'enterprise'), 'takeoff-reviews', sheet.id],
        }),
      ]);
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !draft ||
      draft.pendingNearby ||
      !points.length ||
      points.length !== draft.points.length ||
      save.isPending
    )
      return;
    setSaveError('');
    try {
      const values = { categoryId, symbol: draft.symbol, points };
      const signature = JSON.stringify(values);
      if (request.current?.key !== signature)
        request.current = { key: signature, id: crypto.randomUUID() };
      onDraft({ ...draft, saving: true });
      await save.mutateAsync(
        EnterpriseTakeoffCountInput.parse({ ...values, clientRequestId: request.current.id }),
      );
      request.current = null;
    } catch (cause) {
      onDraft({ ...draft, saving: false });
      setSaveError(
        isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause),
      );
    }
  }

  return (
    <section aria-label="Sheet object counts" className="enterprise-takeoff-calibration">
      <h4>Object counts</h4>
      {list.isPending && <p role="status">Loading counts…</p>}
      {list.isError && (
        <p role="alert" className="enterprise-error">
          {errorHint(list.error)}
        </p>
      )}
      {canDraw && canWrite && !draft && (
        <button
          type="button"
          onClick={() => {
            setSelected('');
            setSaveError('');
            setCategoryId('');
            onShow(null);
            onDraft({ points: [], pendingNearby: null, saving: false, symbol: 'circle' });
            void list.refetch();
            onFocusDrawing();
          }}
        >
          Start object count
        </button>
      )}
      {draft && canWrite && (
        <>
          <TakeoffCategoryForm path={categoryPath} onSaved={setCategoryId} />
          <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
            <label>
              Count category
              <select
                required
                value={categoryId}
                disabled={save.isPending}
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
            <label>
              Marker symbol
              <select
                value={draft.symbol}
                disabled={save.isPending}
                onChange={(event) =>
                  onDraft({
                    ...draft,
                    symbol: EnterpriseTakeoffMarkerSymbol.parse(event.target.value),
                  })
                }
              >
                {EnterpriseTakeoffMarkerSymbol.options.map((option) => (
                  <option key={option} value={option}>
                    {labels[option]}
                  </option>
                ))}
              </select>
            </label>
            <p>Click each object on the drawing to place its marker.</p>
            <p role="status">Draft count · {points.length}</p>
            {draft.pendingNearby && (
              <div>
                <p role="alert" className="enterprise-error">
                  A marker is already near this position.
                </p>
                <div className="enterprise-actions">
                  <button
                    type="button"
                    onClick={() => {
                      const point = draft.pendingNearby;
                      if (point)
                        onDraft({
                          ...draft,
                          pendingNearby: null,
                          points: [...draft.points, { x: String(point.x), y: String(point.y) }],
                        });
                    }}
                  >
                    Place nearby marker anyway
                  </button>
                  <button type="button" onClick={() => onDraft({ ...draft, pendingNearby: null })}>
                    Skip nearby marker
                  </button>
                </div>
              </div>
            )}
            <div className="enterprise-actions">
              <button
                type="button"
                disabled={!draft.points.length || save.isPending}
                onClick={() =>
                  onDraft({ ...draft, pendingNearby: null, points: draft.points.slice(0, -1) })
                }
              >
                Undo last marker
              </button>
              <button
                type="button"
                disabled={draft.points.length >= MAX_TAKEOFF_COUNT_MARKERS || save.isPending}
                onClick={() => onDraft({ ...draft, points: [...draft.points, { x: '', y: '' }] })}
              >
                Enter marker coordinates
              </button>
            </div>
            <details>
              <summary>Marker coordinates</summary>
              {draft.points.map((point, index) => (
                <fieldset key={index} disabled={save.isPending}>
                  <legend>Marker {index + 1}</legend>
                  <div className="enterprise-calibration-coordinates">
                    {(['x', 'y'] as const).map((axis) => (
                      <label key={axis}>
                        Marker {index + 1} {axis.toUpperCase()} (pt)
                        <input
                          type="number"
                          min="0"
                          max={axis === 'x' ? sheet.widthPoints : sheet.heightPoints}
                          step="any"
                          required
                          value={point[axis]}
                          onChange={(event) => {
                            const updated = [...draft.points];
                            updated[index] = { ...point, [axis]: event.target.value };
                            onDraft({ ...draft, points: updated });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </details>
            {saveError && (
              <p role="alert" className="enterprise-error">
                {saveError}
              </p>
            )}
            <div className="enterprise-actions">
              <button
                type="submit"
                disabled={
                  !categoryId ||
                  !points.length ||
                  points.length !== draft.points.length ||
                  !!draft.pendingNearby ||
                  save.isPending
                }
              >
                {save.isPending ? 'Saving count…' : 'Save object count'}
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => {
                  request.current = null;
                  onDraft(null);
                }}
              >
                Cancel object count
              </button>
            </div>
          </form>
        </>
      )}
      {list.isSuccess && saved.length === 0 && <p>This sheet has no saved counts.</p>}
      {remove.isError && (
        <p role="alert" className="enterprise-error">
          {isApiError(remove.error) ? remove.error.message : errorHint(remove.error)}
        </p>
      )}
      {!!saved.length && (
        <ul className="enterprise-change-history">
          {saved.map((count) => (
            <li key={count.id}>
              <strong>
                {categories.find(({ id }) => id === count.categoryId)?.name} · {count.total}{' '}
                {count.total === 1 ? 'object' : 'objects'}
              </strong>
              <span>
                {labels[count.symbol]} markers · Revision {count.revision}
              </span>
              {!draft && (
                <button
                  type="button"
                  aria-pressed={selected === count.id}
                  onClick={() => {
                    if (selected === count.id) {
                      setSelected('');
                      onShow(null);
                    } else {
                      setSelected(count.id);
                      onShow(count);
                    }
                  }}
                >
                  {selected === count.id ? 'Hide markers' : 'Show markers'}
                </button>
              )}
              <details>
                <summary>Marker history</summary>
                <ol>
                  {count.markers.map((marker, index) => (
                    <li key={marker.id}>
                      <span>
                        Marker {index + 1}
                        {marker.removedAt ? ' · Removed' : ''}
                      </span>
                      {canWrite && !marker.removedAt && (
                        <button
                          type="button"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ count, marker: marker.id })}
                        >
                          Remove marker {index + 1}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <button
          type="button"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Load more counts
        </button>
      )}
    </section>
  );
}
