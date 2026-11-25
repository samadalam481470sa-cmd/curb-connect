'use client';

import {
  computeTakeoffCalibration,
  EnterpriseTakeoffCalibration,
  EnterpriseTakeoffCalibrationInput,
  EnterpriseTakeoffCalibrationState,
  EnterpriseTakeoffUnit,
  type EnterpriseTakeoffSheet,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

export const calibrationPointLabels = {
  referenceA: 'Reference point A',
  referenceB: 'Reference point B',
  checkA: 'Check point A',
  checkB: 'Check point B',
};

const unitLabels = {
  ft: 'Feet',
  in: 'Inches',
  yd: 'Yards',
  m: 'Meters',
  cm: 'Centimeters',
  mm: 'Millimeters',
};
const quantity = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 });
export type CalibrationPointKey = keyof typeof calibrationPointLabels;
export type CoordinateDraft = { x: string; y: string };
export type CalibrationPoints = Partial<Record<CalibrationPointKey, CoordinateDraft>>;
type Sheet = z.infer<typeof EnterpriseTakeoffSheet>;
type CalibrationInput = z.infer<typeof EnterpriseTakeoffCalibrationInput>;
type CalibrationInputs = Omit<CalibrationInput, 'clientRequestId'>;
type Calibration = z.infer<typeof EnterpriseTakeoffCalibration>;

export function parseCalibrationPoint(draft: CoordinateDraft | undefined) {
  if (!draft?.x.trim() || !draft.y.trim()) return null;
  const x = Number(draft.x);
  const y = Number(draft.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function initialPoints(calibration: Calibration | null): CalibrationPoints {
  if (!calibration) return {};
  const text = (point: { x: number; y: number }) => ({ x: String(point.x), y: String(point.y) });
  return {
    referenceA: text(calibration.pointA),
    referenceB: text(calibration.pointB),
    ...(calibration.verification
      ? {
          checkA: text(calibration.verification.pointA),
          checkB: text(calibration.verification.pointB),
        }
      : {}),
  };
}

export function TakeoffCalibrationControls({
  path,
  sheet,
  points,
  canPick,
  canEdit,
  onPoints,
  onPointInput,
  onPick,
  onCancelPick,
}: {
  path: string;
  sheet: Sheet;
  points: CalibrationPoints;
  canPick: boolean;
  canEdit: boolean;
  onPoints: (points: CalibrationPoints | null) => void;
  onPointInput: (key: CalibrationPointKey, point: CoordinateDraft) => void;
  onPick: (key: CalibrationPointKey, button: HTMLButtonElement) => void;
  onCancelPick: () => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'takeoff-calibration', sheet.id];
  const [draft, setDraft] = useState<{ revision: number; initial: Calibration | null } | null>(
    null,
  );
  const calibration = useQuery({
    queryKey: key,
    queryFn: () => api.get(path, { schema: EnterpriseTakeoffCalibrationState }),
  });
  const saved = calibration.data?.calibration ?? null;

  return (
    <section aria-label="Sheet scale calibration" className="enterprise-takeoff-calibration">
      <h4>Sheet scale</h4>
      {calibration.isPending && <p role="status">Loading saved scale…</p>}
      {calibration.isError && (
        <div>
          <p className="enterprise-error" role="alert">
            {errorHint(calibration.error)}
          </p>
          <button type="button" onClick={() => void calibration.refetch()}>
            Retry loading scale
          </button>
        </div>
      )}
      {calibration.isSuccess && !saved && <p>This sheet has no saved scale.</p>}
      {saved && (
        <p>
          Revision {saved.revision} · {quantity.format(saved.scale)} {saved.unit} per drawing point
        </p>
      )}
      {!draft && canEdit && calibration.isSuccess && session.can('estimate:write') && (
        <button
          type="button"
          onClick={() => {
            onPoints(initialPoints(saved));
            setDraft({ revision: calibration.data.revision, initial: saved });
          }}
        >
          {saved ? 'Recalibrate sheet' : 'Calibrate scale'}
        </button>
      )}
      {draft && session.can('estimate:write') && (
        <CalibrationForm
          path={path}
          sheet={sheet}
          baseline={draft.revision}
          initial={draft.initial}
          points={points}
          canPick={canPick}
          onPointInput={onPointInput}
          onPick={onPick}
          onCancel={() => {
            setDraft(null);
            onPoints(null);
            onCancelPick();
            void calibration.refetch();
          }}
          onSaved={(result) => {
            client.setQueryData(key, { revision: result.revision, calibration: result });
            void client.invalidateQueries({
              queryKey: [...orgKey(session.orgId, 'enterprise'), 'takeoff-lengths', sheet.id],
            });
            setDraft(null);
            onPoints(null);
            onCancelPick();
          }}
        />
      )}
    </section>
  );
}

function CalibrationForm({
  path,
  sheet,
  baseline,
  initial,
  points,
  canPick,
  onPointInput,
  onPick,
  onCancel,
  onSaved,
}: {
  path: string;
  sheet: Sheet;
  baseline: number;
  initial: Calibration | null;
  points: CalibrationPoints;
  canPick: boolean;
  onPointInput: (key: CalibrationPointKey, point: CoordinateDraft) => void;
  onPick: (key: CalibrationPointKey, button: HTMLButtonElement) => void;
  onCancel: () => void;
  onSaved: (result: Calibration) => void;
}) {
  const { api } = useApi();
  const [length, setLength] = useState(initial ? String(initial.knownLength) : '');
  const [unit, setUnit] = useState<EnterpriseTakeoffUnit>(initial?.unit ?? 'ft');
  const [check, setCheck] = useState(Boolean(initial?.verification));
  const [checkLength, setCheckLength] = useState(
    initial?.verification ? String(initial.verification.knownLength) : '',
  );
  const [error, setError] = useState('');
  const retry = useRef<{ key: string; id: string } | null>(null);
  const save = useMutation({
    mutationFn: (input: CalibrationInput) =>
      api.post(path, input, { ifMatch: baseline, schema: EnterpriseTakeoffCalibration }),
    onSuccess: onSaved,
  });
  const pointA = parseCalibrationPoint(points.referenceA);
  const pointB = parseCalibrationPoint(points.referenceB);
  const checkA = parseCalibrationPoint(points.checkA);
  const checkB = parseCalibrationPoint(points.checkB);
  const input: CalibrationInputs | null =
    pointA &&
    pointB &&
    Number(length) > 0 &&
    (!check || (checkA && checkB && Number(checkLength) > 0))
      ? {
          pointA,
          pointB,
          knownLength: Number(length),
          unit,
          verification:
            check && checkA && checkB
              ? { pointA: checkA, pointB: checkB, knownLength: Number(checkLength) }
              : null,
        }
      : null;
  let preview: ReturnType<typeof computeTakeoffCalibration> | null = null;
  let previewError = '';
  if (input) {
    try {
      preview = computeTakeoffCalibration(input, sheet);
    } catch (cause) {
      if (cause instanceof RangeError) previewError = cause.message;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input || !preview || save.isPending) return;
    setError('');
    try {
      const key = JSON.stringify(input);
      if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
      const payload = EnterpriseTakeoffCalibrationInput.parse({
        ...input,
        clientRequestId: retry.current.id,
      });
      await save.mutateAsync(payload);
    } catch (cause) {
      setError(isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause));
    }
  }

  function controls(id: CalibrationPointKey) {
    const point = points[id] ?? { x: '', y: '' };
    const label = calibrationPointLabels[id];
    return (
      <fieldset disabled={save.isPending}>
        <legend>{label}</legend>
        <button
          type="button"
          disabled={!canPick}
          onClick={(event) => onPick(id, event.currentTarget)}
        >
          Pick {label.toLowerCase()}
        </button>
        <div className="enterprise-calibration-coordinates">
          <label>
            {label} X (pt)
            <input
              type="number"
              min="0"
              max={sheet.widthPoints}
              step="any"
              value={point.x}
              onChange={(event) => onPointInput(id, { ...point, x: event.target.value })}
              required
            />
          </label>
          <label>
            {label} Y (pt)
            <input
              type="number"
              min="0"
              max={sheet.heightPoints}
              step="any"
              value={point.y}
              onChange={(event) => onPointInput(id, { ...point, y: event.target.value })}
              required
            />
          </label>
        </div>
      </fieldset>
    );
  }

  return (
    <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
      {controls('referenceA')}
      {controls('referenceB')}
      <label>
        Known reference length
        <input
          type="number"
          min="0"
          step="any"
          required
          value={length}
          onChange={(event) => setLength(event.target.value)}
        />
      </label>
      <label>
        Length unit
        <select
          value={unit}
          onChange={(event) => setUnit(EnterpriseTakeoffUnit.parse(event.target.value))}
        >
          {EnterpriseTakeoffUnit.options.map((option) => (
            <option key={option} value={option}>
              {unitLabels[option]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={check}
          onChange={(event) => setCheck(event.target.checked)}
        />
        Verify against a second dimension
      </label>
      {check && (
        <>
          {controls('checkA')}
          {controls('checkB')}
          <label>
            Known check length ({unit})
            <input
              type="number"
              min="0"
              step="any"
              required
              value={checkLength}
              onChange={(event) => setCheckLength(event.target.value)}
            />
          </label>
        </>
      )}
      {previewError && (
        <p role="alert" className="enterprise-error">
          {previewError}
        </p>
      )}
      {preview && (
        <p role="status">
          Computed scale · {quantity.format(preview.scale)} {unit} per drawing point
        </p>
      )}
      {preview?.verificationResult && (
        <p role="status">
          Check dimension · {quantity.format(preview.verificationResult.calculatedLength)} {unit}.{' '}
          {quantity.format(preview.verificationResult.errorPercent)}% difference from the entered
          check length.
          {preview.verificationResult.errorPercent >= 0.01 &&
            ' Check the marked dimensions before using this scale.'}
        </p>
      )}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      <div className="enterprise-actions">
        <button type="submit" disabled={!preview || save.isPending}>
          {save.isPending ? 'Saving scale…' : 'Save calibration'}
        </button>
        <button type="button" disabled={save.isPending} onClick={onCancel}>
          Cancel calibration
        </button>
      </div>
    </form>
  );
}
