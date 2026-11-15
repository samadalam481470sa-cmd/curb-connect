'use client';

// CV-045 D / ADD-044 / ADD-053 measurement form: every value records its source (provenance),
// precision and date, and "Unknown" is a real choice with a reason, never zero. Depth, thickness
// and buried depth can never come from a photo. Field-verified / survey values need the verify
// permission (the API enforces it too). Photo-derived values need an accepted calibration.
import { CURB_MEASUREMENT_KINDS, UNKNOWN_REASONS, type CurbMeasurementKind, type MeasurementSource, type UnknownReason } from '@fieldline/contracts';
import { Button, Field, ProvenanceBadge, RadioGroup, Select, TextInput } from '@fieldline/ui';
import { useState } from 'react';
import { useSession } from '../../lib/session';
import { ErrorNotice } from '../common';
import type { CurbCalibration } from './curbApi';
import { Panel } from './CurbCommon';
import { allowedSources, MEASUREMENT_UNIT, NOT_FROM_PHOTO } from './model';
import { useCurbProject } from './useCurbProject';

const SOURCE_LABEL: Record<MeasurementSource, string> = {
  user_entered: 'Entered (not verified)',
  field_verified: 'Field verified (tape / wheel on site)',
  survey_supplied: 'Survey supplied',
  imagery_derived: 'From calibrated photo',
  machine_estimated: 'Machine estimate',
};

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function MeasurementForm() {
  const { detail, run, save, lastError } = useCurbProject();
  const session = useSession();
  const canVerify = session.can('curb_measurement:verify');
  const [kind, setKind] = useState<CurbMeasurementKind>('cut_length');
  const [state, setState] = useState<'known' | 'unknown' | null>(null);
  const [value, setValue] = useState('');
  const [precision, setPrecision] = useState('0.01');
  const [source, setSource] = useState<MeasurementSource>('user_entered');
  const [reason, setReason] = useState<UnknownReason>(NOT_FROM_PHOTO.has('cut_length') ? 'not_observable' : 'not_measured_yet');
  const [segmentId, setSegmentId] = useState('');
  const sources = allowedSources(kind, canVerify);
  const unit = MEASUREMENT_UNIT[kind];
  const accepted = ((detail?.calibrations ?? []) as CurbCalibration[]).filter((c) => c.status === 'accepted');
  const cal = accepted[accepted.length - 1];
  const n = Number(value);
  const p = Number(precision);
  const valid = state === 'unknown' || (state === 'known' && value !== '' && Number.isFinite(n) && n >= 0 && Number.isFinite(p) && p >= 0 && sources.includes(source) && (source !== 'imagery_derived' || !!cal));

  const submit = async () => {
    const measurement =
      state === 'unknown'
        ? { state: 'unknown' as const, reason }
        : { state: 'known' as const, value: n, unit, source, measuredAt: new Date().toISOString(), precision: p, ...(source === 'imagery_derived' && cal && { evidence: { mediaAssetIds: [cal.mediaAssetId], calibrationId: cal.id, inferenceResultId: null } }) };
    const ok = await run('CurbMeasurementRecorded', { kind, measurement, ...(segmentId && { segment_id: segmentId }), ...(source === 'imagery_derived' && state === 'known' && cal && { calibration_id: cal.id }) });
    if (ok) {
      setValue('');
      setState(null);
    }
  };

  return (
    <Panel title="Measurements" id="measurements">
      <div className="curb-row">
        <Field label="Dimension">
          <Select
            value={kind}
            onChange={(e) => {
              const k = e.target.value as CurbMeasurementKind;
              setKind(k);
              if (!allowedSources(k, canVerify).includes(source)) setSource('user_entered');
              setReason(NOT_FROM_PHOTO.has(k) ? 'not_observable' : 'not_measured_yet');
            }}
            options={CURB_MEASUREMENT_KINDS.map((k) => ({ value: k, label: humanize(k) }))}
          />
        </Field>
        <Field label="Segment (optional)">
          <Select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} options={[{ value: '', label: 'Whole project' }, ...(detail?.segments ?? []).map((s) => ({ value: s.id, label: s.label ?? humanize(s.kind) }))]} />
        </Field>
      </div>
      {NOT_FROM_PHOTO.has(kind) && <p className="curb-warn">{humanize(kind)} cannot be seen in a photo. Record it from a field check or core, or mark it Unknown.</p>}
      <RadioGroup
        legend="Value"
        orientation="horizontal"
        value={state}
        onChange={(v) => setState(v as 'known' | 'unknown')}
        options={[
          { value: 'known', label: 'I have a value' },
          { value: 'unknown', label: 'Unknown' },
        ]}
      />
      {state === 'known' && (
        <div className="curb-row">
          <Field label={`Value (${unit})`}>
            <TextInput inputMode="decimal" value={value} suffix={unit} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label={`Precision (± ${unit})`}>
            <TextInput inputMode="decimal" value={precision} onChange={(e) => setPrecision(e.target.value)} />
          </Field>
          <Field label="Source" hint={canVerify ? undefined : 'Field-verified and survey values need a reviewer or crew manager.'}>
            <Select value={source} onChange={(e) => setSource(e.target.value as MeasurementSource)} options={sources.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} />
          </Field>
        </div>
      )}
      {state === 'known' && source === 'imagery_derived' && !cal && <p className="curb-error">No accepted calibration: a photo-derived value cannot be recorded.</p>}
      {state === 'unknown' && (
        <Field label="Why unknown">
          <Select value={reason} onChange={(e) => setReason(e.target.value as UnknownReason)} options={UNKNOWN_REASONS.map((r) => ({ value: r, label: humanize(r) }))} />
        </Field>
      )}
      <Button disabled={!valid} loading={save === 'saving'} onClick={() => void submit()}>
        Record measurement
      </Button>
      {save === 'error' && lastError !== null && <ErrorNotice error={lastError} title="Measurement not recorded" />}
      <MeasurementList />
    </Panel>
  );
}

function MeasurementList() {
  const { detail } = useCurbProject();
  const rows = detail?.measurements ?? [];
  if (!rows.length) return <p className="web-muted">No measurements yet.</p>;
  return (
    <table className="curb-table">
      <caption>Recorded dimensions</caption>
      <thead>
        <tr>
          <th scope="col">Dimension</th>
          <th scope="col">Value</th>
          <th scope="col">Range</th>
          <th scope="col">Provenance</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const meas = m.measurement as { state: string; value?: number; unit?: string; source?: MeasurementSource; precision?: number; reason?: string };
          return (
            <tr key={m.id} data-state={meas.state}>
              <td>{humanize(m.kind)}</td>
              <td>{meas.state === 'known' ? `${meas.value} ${meas.unit} ±${meas.precision}` : <strong>Unknown{meas.reason ? ` (${humanize(meas.reason)})` : ''}</strong>}</td>
              <td>{m.low !== null && m.high !== null ? `${m.low.toFixed(2)} to ${m.high.toFixed(2)}` : '—'}</td>
              <td>{meas.state === 'known' && meas.source ? <ProvenanceBadge source={meas.source} compact /> : 'No value'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
