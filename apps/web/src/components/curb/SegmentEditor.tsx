'use client';

// CV-047 / ADD-043 curb path and segment editor on the photo. Saw-cut path, removal footprint,
// return, replacement and obstruction are separate kinds made of straight / curved pieces. Saved
// segments are drawn colour-coded by confidence (field verified / high / medium / low / no
// calibrated length) with a scale bar from the accepted calibration. Image-space tracing needs an
// accepted calibration of that photo; a correction needs a reason and keeps earlier versions.
import { CURB_SEGMENT_KINDS, type CurbSegmentKind } from '@fieldline/contracts';
import { Button, Field, Select, TextInput } from '@fieldline/ui';
import { useState } from 'react';
import { ErrorNotice } from '../common';
import type { CurbCalibration, CurbSegmentRow } from './curbApi';
import { Panel } from './CurbCommon';
import { CONFIDENCE_STYLE, pieceProblem, scaleBar, segmentConfidence, type ConfidenceBand } from './model';
import { PhotoStage, PointList, PointMarkers, type Pt } from './PhotoStage';
import type { PhotoRef } from './CalibrationPanel';
import { useCurbProject } from './useCurbProject';

type Shape = 'straight' | 'curved' | 'corner' | 'return_transition';
interface Piece {
  shape: Shape;
  points: Pt[];
}

const KIND_LABEL: Record<CurbSegmentKind, string> = {
  saw_cut_path: 'Saw-cut path',
  removal_footprint: 'Removal footprint',
  return_transition: 'Return / transition',
  driveway_replacement: 'Driveway replacement',
  sidewalk_replacement: 'Sidewalk replacement',
  obstruction: 'Obstruction',
  protected_asset: 'Protected asset (do not cut)',
};

function path(points: readonly Pt[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ');
}

export function SegmentEditor({ photos }: { photos: PhotoRef[] }) {
  const { detail, run, save, lastError } = useCurbProject();
  const [spaceChoice, setSpace] = useState<'image_px' | 'plane_m' | null>(null);
  const space = spaceChoice ?? (photos.length ? 'image_px' : 'plane_m');
  // Photos load after the panel mounts: fall back to the first photo until one is chosen.
  const [chosenPhotoId, setPhotoId] = useState('');
  const photoId = photos.some((p) => p.id === chosenPhotoId) ? chosenPhotoId : (photos[0]?.id ?? '');
  const [kind, setKind] = useState<CurbSegmentKind>('saw_cut_path');
  const [label, setLabel] = useState('');
  const [pieces, setPieces] = useState<Piece[]>([{ shape: 'straight', points: [] }]);
  const [correcting, setCorrecting] = useState<CurbSegmentRow | null>(null);
  const [reason, setReason] = useState('');

  const cals = ((detail?.calibrations ?? []) as CurbCalibration[]).filter((c) => c.mediaAssetId === photoId && c.status === 'accepted');
  const cal = cals[cals.length - 1];
  const photo = photos.find((p) => p.id === photoId);
  const segments = (detail?.segments ?? []).filter((s) => (space === 'image_px' ? s.mediaAssetId === photoId : s.geometry?.space === 'plane_m'));
  const current = pieces[pieces.length - 1]!;
  const problems = pieces.map((p) => pieceProblem(p.shape, p.points)).filter((x): x is string => !!x);
  const needsCal = space === 'image_px' && !cal;
  const canSave = problems.length === 0 && !needsCal && (!correcting || reason.trim().length >= 3);

  const setCurrent = (fn: (p: Piece) => Piece) => setPieces((ps) => [...ps.slice(0, -1), fn(ps[ps.length - 1]!)]);

  const submit = async () => {
    const ok = await run('CurbSegmentSaved', {
      ...(correcting && { segment_id: correcting.id, correction_reason: reason }),
      kind,
      ...(label && { label }),
      ...(space === 'image_px' && { media_asset_id: photoId, calibration_id: cal!.id }),
      geometry: { space, pieces },
    });
    if (ok) {
      setPieces([{ shape: 'straight', points: [] }]);
      setCorrecting(null);
      setReason('');
    }
  };

  const startCorrection = (s: CurbSegmentRow) => {
    setCorrecting(s);
    setKind(s.kind as CurbSegmentKind);
    setLabel(s.label ?? '');
    setPieces((s.geometry?.pieces ?? [{ shape: 'straight', points: [] }]).map((p) => ({ shape: p.shape as Shape, points: p.points as Pt[] })));
  };

  const bar = scaleBar(cal?.metersPerPixel);
  return (
    <Panel title="Curb path and segments" id="segments">
      <div className="curb-row">
        <Field label="Trace on">
          <Select value={space} onChange={(e) => setSpace(e.target.value as 'image_px' | 'plane_m')} options={[{ value: 'image_px', label: 'A calibrated photo' }, { value: 'plane_m', label: 'Site sketch in metres' }]} />
        </Field>
        {space === 'image_px' && photos.length > 0 && (
          <Field label="Photo">
            <Select value={photoId} onChange={(e) => setPhotoId(e.target.value)} options={photos.map((p) => ({ value: p.id, label: p.label }))} />
          </Field>
        )}
        <Field label="Segment kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as CurbSegmentKind)} options={CURB_SEGMENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        </Field>
        <Field label="Label (optional)">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
      </div>
      {needsCal && (
        <p className="curb-error" role="alert">
          This photo has no accepted calibration. Calibrate it first, or trace a site sketch in metres. No length is computed from an uncalibrated photo.
        </p>
      )}
      {space === 'image_px' && photo && (
        <PhotoStage
          src={photo.viewUrl}
          alt={`Segment photo ${photo.label}`}
          onAddPoint={needsCal ? undefined : (p) => setCurrent((c) => ({ ...c, points: [...c.points, p] }))}
          footer={<ConfidenceLegend />}
        >
          {({ w, h, displayScale }) => (
            <>
              {segments
                .filter((s) => s.id !== correcting?.id)
                .map((s) => {
                  const band = segmentConfidence({ source: s.source, lengthM: s.geometry?.lengthM, sigmaM: s.geometry?.sigmaM });
                  const st = CONFIDENCE_STYLE[band];
                  return (s.geometry?.pieces ?? []).map((p, i) => (
                    <path key={`${s.id}-${i}`} d={path(p.points as Pt[])} fill="none" stroke={st.colorVar} strokeWidth={5} strokeDasharray={st.dash} vectorEffect="non-scaling-stroke" data-confidence={band}>
                      <title>{`${s.label ?? KIND_LABEL[s.kind as CurbSegmentKind] ?? s.kind}: ${st.label}`}</title>
                    </path>
                  ));
                })}
              {pieces.map((p, i) => (
                <path key={`draft-${i}`} d={path(p.points)} fill="none" stroke="var(--curb-accent)" strokeWidth={4} vectorEffect="non-scaling-stroke" />
              ))}
              <PointMarkers points={current.points} color="var(--curb-accent)" />
              {bar && displayScale > 0 && (
                <g data-testid="scale-bar" transform={`translate(${w * 0.04} ${h * 0.94})`}>
                  <rect x={0} y={-12} width={bar.meters / cal!.metersPerPixel!} height={12} fill="var(--curb-scale)" />
                  <text x={0} y={-22} fill="var(--curb-scale)" fontSize={Math.max(24, 14 / displayScale)} fontWeight={700}>
                    {bar.label}
                  </text>
                </g>
              )}
            </>
          )}
        </PhotoStage>
      )}
      {bar && space === 'image_px' && <p className="web-muted">Scale bar: {bar.label} from the accepted calibration ({`±${((cal?.uncertainty ?? 0) * 100).toFixed(1)}%`}).</p>}
      <div className="curb-row">
        <Field label="Current piece shape">
          <Select value={current.shape} onChange={(e) => setCurrent((c) => ({ ...c, shape: e.target.value as Shape }))} options={[{ value: 'straight', label: 'Straight' }, { value: 'curved', label: 'Curved (3+ points)' }, { value: 'corner', label: 'Corner' }, { value: 'return_transition', label: 'Return transition' }]} />
        </Field>
        <Button variant="secondary" size="sm" disabled={current.points.length < 2} onClick={() => setPieces((ps) => [...ps, { shape: 'straight', points: [current.points[current.points.length - 1]!] }])}>
          Start next piece
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPieces([{ shape: 'straight', points: [] }])}>
          Clear
        </Button>
      </div>
      <PointList legend={space === 'image_px' ? `Piece ${pieces.length} points (pixels)` : `Piece ${pieces.length} points (metres)`} points={current.points} onChange={(pts) => setCurrent((c) => ({ ...c, points: pts }))} />
      {problems.length > 0 && <p className="curb-warn">{problems[0]}</p>}
      {correcting && (
        <Field label="Reason for correction" hint="Kept with the version history together with the earlier photo and calibration." required>
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <div className="curb-row">
        <Button disabled={!canSave} loading={save === 'saving'} onClick={() => void submit()}>
          {correcting ? 'Save correction' : 'Save segment'}
        </Button>
        {correcting && (
          <Button variant="ghost" onClick={() => setCorrecting(null)}>
            Cancel correction
          </Button>
        )}
      </div>
      {save === 'error' && lastError !== null && <ErrorNotice error={lastError} title="Segment not saved" />}
      <SegmentTable segments={detail?.segments ?? []} onCorrect={startCorrection} />
    </Panel>
  );
}

export function ConfidenceLegend() {
  return (
    <ul className="curb-legend" aria-label="Segment confidence legend">
      {(Object.keys(CONFIDENCE_STYLE) as ConfidenceBand[]).map((b) => (
        <li key={b}>
          <svg width="28" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="28" y2="4" stroke={CONFIDENCE_STYLE[b].colorVar} strokeWidth="4" strokeDasharray={CONFIDENCE_STYLE[b].dash} />
          </svg>
          {CONFIDENCE_STYLE[b].label}
        </li>
      ))}
    </ul>
  );
}

function SegmentTable({ segments, onCorrect }: { segments: CurbSegmentRow[]; onCorrect: (s: CurbSegmentRow) => void }) {
  if (!segments.length) return <p className="web-muted">No segments yet.</p>;
  return (
    <table className="curb-table">
      <caption>Saved segments</caption>
      <thead>
        <tr>
          <th scope="col">Segment</th>
          <th scope="col">Length</th>
          <th scope="col">Confidence</th>
          <th scope="col">Version</th>
          <th scope="col" />
        </tr>
      </thead>
      <tbody>
        {segments.map((s) => {
          const band = segmentConfidence({ source: s.source, lengthM: s.geometry?.lengthM, sigmaM: s.geometry?.sigmaM });
          const L = s.geometry?.lengthM;
          const sig = s.geometry?.sigmaM;
          return (
            <tr key={s.id}>
              <td>{s.label ?? KIND_LABEL[s.kind as CurbSegmentKind] ?? s.kind}</td>
              <td>{typeof L === 'number' ? `${L.toFixed(2)} m${typeof sig === 'number' ? ` (±${(2 * sig).toFixed(2)} m, 2σ)` : ''}` : 'Unknown'}</td>
              <td data-confidence={band}>{CONFIDENCE_STYLE[band].label}</td>
              <td>
                v{s.geometry?.version ?? s.revision}
                {s.geometry?.history?.length ? ` (${s.geometry.history.length} earlier)` : ''}
              </td>
              <td>
                <button type="button" className="curb-link" onClick={() => onCorrect(s)}>
                  Correct
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
