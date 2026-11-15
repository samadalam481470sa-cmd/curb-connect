'use client';

// CV-045 / ADD-042 calibration: place the two reference endpoints (known length in the curb
// plane), or 4+ curb-plane points with their plane coordinates (homography), or enter field
// dimensions. The resulting uncertainty is shown against the 5 % tolerance the API enforces; a
// refused calibration shows the server's reason and the next step (retake or field dimensions).
// Without an accepted calibration no photo-derived length exists ("Do not compute inches from
// uncalibrated photographs").
import { Button, Field, Select, TextInput } from '@fieldline/ui';
import { useState } from 'react';
import { ErrorNotice } from '../common';
import type { CurbCalibration } from './curbApi';
import { Panel } from './CurbCommon';
import {
  CALIBRATION_MAX_UNCERTAINTY,
  CALIBRATION_POINTS_NEEDED,
  formatPercent,
  pixelDistance,
  toleranceLevel,
  type CalibrationMethod,
} from './model';
import { PhotoStage, PointList, PointMarkers, type Pt } from './PhotoStage';
import { useCurbProject } from './useCurbProject';

const METHODS: { value: CalibrationMethod; label: string }[] = [
  { value: 'two_point_reference', label: 'Reference of known length (2 points)' },
  { value: 'four_point_homography', label: 'Curb-plane points (4 or more)' },
  { value: 'field_dimensions', label: 'Field dimensions (tape measure on site)' },
];

export interface PhotoRef {
  id: string;
  label: string;
  viewUrl: string | null;
}

export function CalibrationPanel({ photos }: { photos: PhotoRef[] }) {
  const { detail, run, lastError, save } = useCurbProject();
  // Photos load after the panel mounts: fall back to the first photo until one is chosen.
  const [chosenPhotoId, setPhotoId] = useState('');
  const photoId = photos.some((p) => p.id === chosenPhotoId) ? chosenPhotoId : (photos[0]?.id ?? '');
  const [method, setMethod] = useState<CalibrationMethod>('two_point_reference');
  const [points, setPoints] = useState<Pt[]>([]);
  const [world, setWorld] = useState<Pt[]>([]);
  const [refLabel, setRefLabel] = useState('Tape measure');
  const [refLength, setRefLength] = useState('');
  const photo = photos.find((p) => p.id === photoId);
  const need = CALIBRATION_POINTS_NEEDED[method];
  const cals = ((detail?.calibrations ?? []) as CurbCalibration[]).filter((c) => c.mediaAssetId === photoId);
  const latest = cals[cals.length - 1];

  const lengthM = Number(refLength);
  const pointsOk = method === 'four_point_homography' ? points.length >= 4 && world.length === points.length : points.length === need;
  const lengthOk = method === 'four_point_homography' || (Number.isFinite(lengthM) && lengthM > 0);
  const canSubmit = !!photoId && pointsOk && lengthOk;

  const submit = async () => {
    const ok = await run('CurbCalibrationRecorded', {
      media_asset_id: photoId,
      method,
      reference_label: refLabel || undefined,
      ...(method !== 'four_point_homography' && { reference_length_m: lengthM }),
      image_points: points,
      ...(method === 'four_point_homography' && { world_points_m: world }),
    });
    if (ok) setPoints([]);
  };

  return (
    <Panel title="Calibration" id="calibration">
      {photos.length === 0 ? (
        <p className="curb-warn">Capture the &quot;known-length reference&quot; photo first, or calibrate with field dimensions.</p>
      ) : (
        <Field label="Photo">
          <Select value={photoId} onChange={(e) => { setPhotoId(e.target.value); setPoints([]); }} options={photos.map((p) => ({ value: p.id, label: p.label }))} />
        </Field>
      )}
      <Field label="Method">
        <Select value={method} onChange={(e) => { setMethod(e.target.value as CalibrationMethod); setPoints([]); setWorld([]); }} options={METHODS} />
      </Field>
      {method !== 'field_dimensions' && photo && (
        <>
          <p className="web-muted">
            {method === 'two_point_reference'
              ? `Click both ends of the reference on the photo (${points.length}/2). The reference must lie flat in the curb plane.`
              : `Click at least 4 points on the curb plane (${points.length} placed) and enter each point's plane position in metres.`}
          </p>
          <PhotoStage src={photo.viewUrl} alt={`Calibration photo ${photo.label}`} onAddPoint={(p) => setPoints((ps) => (method === 'two_point_reference' && ps.length >= 2 ? [ps[1]!, p] : [...ps, p]))}>
            {() => (
              <>
                {points.length === 2 && method === 'two_point_reference' && (
                  <line x1={points[0]![0]} y1={points[0]![1]} x2={points[1]![0]} y2={points[1]![1]} stroke="var(--curb-accent)" strokeWidth={4} vectorEffect="non-scaling-stroke" />
                )}
                <PointMarkers points={points} color="var(--curb-accent)" label={(i) => (method === 'two_point_reference' ? (i === 0 ? 'A' : 'B') : `P${i + 1}`)} />
              </>
            )}
          </PhotoStage>
          <PointList legend="Image points (pixels)" points={points} onChange={setPoints} />
          {method === 'two_point_reference' && points.length === 2 && <p className="web-muted">Reference spans {pixelDistance(points[0]!, points[1]!).toFixed(0)} px.</p>}
          {method === 'four_point_homography' && <PointList legend="Plane positions (metres), one per image point" points={world} onChange={setWorld} />}
        </>
      )}
      {method !== 'four_point_homography' && (
        <div className="curb-row">
          <Field label="Reference label">
            <TextInput value={refLabel} onChange={(e) => setRefLabel(e.target.value)} />
          </Field>
          <Field label={method === 'field_dimensions' ? 'Measured length on site' : 'Known reference length'} hint="In metres, e.g. 1.000">
            <TextInput inputMode="decimal" value={refLength} suffix="m" onChange={(e) => setRefLength(e.target.value)} />
          </Field>
        </div>
      )}
      <p className="web-muted">Tolerance: the calibration is refused above {formatPercent(CALIBRATION_MAX_UNCERTAINTY)} uncertainty.</p>
      <Button disabled={!canSubmit} loading={save === 'saving'} onClick={() => void submit()}>
        Record calibration
      </Button>
      {save === 'error' && lastError !== null && <ErrorNotice error={lastError} title="Calibration not recorded" />}
      {latest && <CalibrationResult c={latest} />}
    </Panel>
  );
}

export function CalibrationResult({ c }: { c: CurbCalibration }) {
  const level = c.failure ? 'refused' : toleranceLevel(c.uncertainty);
  return (
    <div className="curb-calibration" data-level={level} role="status">
      <p>
        <strong>{c.failure ? 'Calibration refused' : c.status === 'accepted' ? 'Calibration accepted' : `Calibration ${c.status}`}</strong>{' '}
        uncertainty {formatPercent(c.uncertainty)} (limit {formatPercent(CALIBRATION_MAX_UNCERTAINTY)})
        {c.metersPerPixel ? `, ${(c.metersPerPixel * 1000).toFixed(2)} mm/px` : ''}
        {c.residualErrorM !== null ? `, residual ${(c.residualErrorM * 1000).toFixed(1)} mm` : ''}.
      </p>
      <div className="curb-tolerance" aria-hidden="true">
        <span style={{ width: `${Math.min(100, ((c.uncertainty ?? CALIBRATION_MAX_UNCERTAINTY * 2) / (CALIBRATION_MAX_UNCERTAINTY * 2)) * 100)}%` }} />
        <i style={{ left: '50%' }} />
      </div>
      {c.failure && (
        <p className="curb-error">
          {c.failure.message} Next: {c.failure.next}
        </p>
      )}
    </div>
  );
}
