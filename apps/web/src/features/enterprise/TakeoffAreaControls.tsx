'use client';

import {
  EnterpriseTakeoffArea,
  EnterpriseTakeoffAreaInput,
  EnterpriseTakeoffAreaPage,
  EnterpriseTakeoffCalibrationState,
  MAX_TAKEOFF_AREA_HOLES,
  MAX_TAKEOFF_AREA_POINTS,
  MAX_TAKEOFF_AREA_RING_VERTICES,
  type EnterpriseTakeoffCalibration,
  type EnterpriseTakeoffSheet,
} from '@fieldline/contracts';
import { computeTakeoffArea } from '@fieldline/geometry';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { parseCalibrationPoint, type CoordinateDraft } from './TakeoffCalibrationControls';

type Sheet = z.infer<typeof EnterpriseTakeoffSheet>;
type AreaInput = z.infer<typeof EnterpriseTakeoffAreaInput>;
const quantity = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 });

export type TakeoffAreaDraft = {
  calibration: EnterpriseTakeoffCalibration;
  exterior: CoordinateDraft[];
  holes: CoordinateDraft[][];
  activeRing: number | null;
};

export function areaRings(draft: TakeoffAreaDraft) {
  return [draft.exterior, ...draft.holes];
}

export function replaceAreaRing(
  draft: TakeoffAreaDraft,
  index: number,
  points: CoordinateDraft[],
): TakeoffAreaDraft {
  if (index === 0) return { ...draft, exterior: points };
  return { ...draft, holes: draft.holes.map((ring, hole) => (hole === index - 1 ? points : ring)) };
}

export function TakeoffAreaControls({
  path,
  calibrationPath,
  sheet,
  draft,
  canDraw,
  onDraft,
  onFocusDrawing,
}: {
  path: string;
  calibrationPath: string;
  sheet: Sheet;
  draft: TakeoffAreaDraft | null;
  canDraw: boolean;
  onDraft: (draft: TakeoffAreaDraft | null) => void;
  onFocusDrawing: () => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'takeoff-areas', sheet.id];
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { query: { cursor: pageParam }, schema: EnterpriseTakeoffAreaPage }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const calibration = useQuery({
    queryKey: [...orgKey(session.orgId, 'enterprise'), 'takeoff-calibration', sheet.id],
    queryFn: () => api.get(calibrationPath, { schema: EnterpriseTakeoffCalibrationState }),
  });
  const current = calibration.data?.calibration ?? null;
  const [error, setError] = useState('');
  const request = useRef<{ key: string; id: string } | null>(null);
  const stale = draft !== null && current?.id !== draft.calibration.id;
  const canWrite = session.can('estimate:write');
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const save = useMutation({
    mutationFn: (body: AreaInput) => api.post(path, body, { schema: EnterpriseTakeoffArea }),
    onSuccess: async () => {
      onDraft(null);
      await client.invalidateQueries({ queryKey: key });
    },
  });

  const rings = draft ? areaRings(draft) : [];
  const vertexCount = rings.reduce((total, ring) => total + ring.length, 0);
  const [exterior, ...holes] = rings.map((ring) =>
    ring.flatMap((draftPoint) => {
      const point = parseCalibrationPoint(draftPoint);
      return point ? [point] : [];
    }),
  );
  let preview: ReturnType<typeof computeTakeoffArea> | null = null;
  let previewError = '';
  if (
    draft &&
    exterior &&
    [exterior, ...holes].every(
      (points, index) => points.length >= 3 && points.length === rings[index]?.length,
    )
  ) {
    try {
      preview = computeTakeoffArea(exterior, holes, draft.calibration.scale, sheet);
    } catch (cause) {
      if (cause instanceof RangeError) previewError = cause.message;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || draft.activeRing !== null || !exterior || !preview || stale || save.isPending)
      return;
    setError('');
    try {
      const values = { calibrationId: draft.calibration.id, exterior, holes };
      const signature = JSON.stringify(values);
      if (request.current?.key !== signature)
        request.current = { key: signature, id: crypto.randomUUID() };
      await save.mutateAsync(
        EnterpriseTakeoffAreaInput.parse({ ...values, clientRequestId: request.current.id }),
      );
      request.current = null;
    } catch (cause) {
      setError(isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause));
      void calibration.refetch();
    }
  }

  return (
    <section aria-label="Sheet area measurements" className="enterprise-takeoff-calibration">
      <h4>Area measurements</h4>
      {list.isPending && <p role="status">Loading areas…</p>}
      {list.isError && (
        <p role="alert" className="enterprise-error">
          {errorHint(list.error)}
        </p>
      )}
      {calibration.isSuccess && !current && <p>Save a sheet scale before measuring area.</p>}
      {canWrite && canDraw && current && !draft && (
        <button
          type="button"
          onClick={() => {
            setError('');
            onDraft({ calibration: current, exterior: [], holes: [], activeRing: 0 });
            onFocusDrawing();
          }}
        >
          Start area measurement
        </button>
      )}
      {draft && canWrite && (
        <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
          {draft.activeRing !== null && (
            <p>
              Click the drawing to add points, then double-click or close the boundary in the form.
            </p>
          )}
          {rings.map((ring, index) => {
            const name = index === 0 ? 'Exterior' : 'Deduction ' + index;
            const active = draft.activeRing === index;
            return (
              <fieldset key={index} disabled={save.isPending}>
                <legend>{name}</legend>
                {ring.map((vertex, vertexIndex) => (
                  <div className="enterprise-calibration-coordinates" key={vertexIndex}>
                    {(['x', 'y'] as const).map((axis) => (
                      <label key={axis}>
                        {name} vertex {vertexIndex + 1} {axis.toUpperCase()} (pt)
                        <input
                          type="number"
                          min="0"
                          step="any"
                          required
                          max={axis === 'x' ? sheet.widthPoints : sheet.heightPoints}
                          value={vertex[axis]}
                          onChange={(event) => {
                            const points = [...ring];
                            points[vertexIndex] = { ...vertex, [axis]: event.target.value };
                            onDraft(replaceAreaRing(draft, index, points));
                          }}
                        />
                      </label>
                    ))}
                  </div>
                ))}
                <div className="enterprise-actions">
                  {active && (
                    <>
                      <button
                        type="button"
                        disabled={
                          ring.length >= MAX_TAKEOFF_AREA_RING_VERTICES ||
                          vertexCount >= MAX_TAKEOFF_AREA_POINTS
                        }
                        onClick={() =>
                          onDraft(replaceAreaRing(draft, index, [...ring, { x: '', y: '' }]))
                        }
                      >
                        Add {name.toLowerCase()} coordinates
                      </button>
                      <button
                        type="button"
                        disabled={ring.length === 0}
                        onClick={() => onDraft(replaceAreaRing(draft, index, ring.slice(0, -1)))}
                      >
                        Undo last {name.toLowerCase()} point
                      </button>
                      <button
                        type="button"
                        disabled={ring.length < 3}
                        onClick={() => onDraft({ ...draft, activeRing: null })}
                      >
                        Close {name.toLowerCase()} boundary
                      </button>
                    </>
                  )}
                  {!active && draft.activeRing === null && (
                    <button
                      type="button"
                      onClick={() => {
                        onDraft({ ...draft, activeRing: index });
                        onFocusDrawing();
                      }}
                    >
                      Resume drawing {name.toLowerCase()}
                    </button>
                  )}
                  {index > 0 && (active || draft.activeRing === null) && (
                    <button
                      type="button"
                      onClick={() =>
                        onDraft({
                          ...draft,
                          holes: draft.holes.filter((_, hole) => hole !== index - 1),
                          activeRing: null,
                        })
                      }
                    >
                      Remove {name.toLowerCase()}
                    </button>
                  )}
                </div>
              </fieldset>
            );
          })}
          {draft.activeRing === null && draft.holes.length < MAX_TAKEOFF_AREA_HOLES && (
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                onDraft({
                  ...draft,
                  holes: [...draft.holes, []],
                  activeRing: draft.holes.length + 1,
                });
                onFocusDrawing();
              }}
            >
              Add a deduction boundary
            </button>
          )}
          {previewError && (
            <p role="alert" className="enterprise-error">
              {previewError}
            </p>
          )}
          {preview && (
            <p role="status">
              Net area · {quantity.format(preview.netArea)} sq {draft.calibration.unit}. Exterior
              perimeter · {quantity.format(preview.exteriorPerimeter)} {draft.calibration.unit}.{' '}
              Deducted area · {quantity.format(preview.deductedArea)} sq {draft.calibration.unit}.
              {preview.deductionPerimeter > 0 &&
                ' Deduction perimeter · ' +
                  quantity.format(preview.deductionPerimeter) +
                  ' ' +
                  draft.calibration.unit +
                  '.'}
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
              disabled={save.isPending || stale || draft.activeRing !== null || !preview}
            >
              {save.isPending ? 'Saving area…' : 'Save area measurement'}
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                request.current = null;
                onDraft(null);
              }}
            >
              Cancel area measurement
            </button>
          </div>
        </form>
      )}
      {list.isSuccess && items.length === 0 && <p>This sheet has no area measurements.</p>}
      {!!items.length && (
        <ul className="enterprise-change-history">
          {items.map((item) => (
            <li key={item.id}>
              <strong>
                {quantity.format(item.netArea)} sq {item.unit} ·{' '}
                {quantity.format(item.exteriorPerimeter)} {item.unit} exterior perimeter
              </strong>
              {item.deductedArea > 0 && (
                <span>
                  {quantity.format(item.deductedArea)} sq {item.unit} deducted
                </span>
              )}
              {item.requiresReview && <span>Review required · Saved with an earlier scale</span>}
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
          Load more areas
        </button>
      )}
    </section>
  );
}
