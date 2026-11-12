'use client';

import { useState, type FormEvent } from 'react';
import { summarizeDepth, validDepthSamples, type DepthCalibration, type DepthSample } from './depthCalibration';
import { NumberField, Panel, SelectField } from '../command/Panel';

export function DepthCalibrationPanel({
  data,
  lengthFt,
  onChange,
}: {
  data: DepthCalibration;
  lengthFt: number;
  onChange: (data: DepthCalibration) => void;
}) {
  const [method, setMethod] = useState<'core' | 'probe'>('probe');
  const [station, setStation] = useState(0);
  const [measured, setMeasured] = useState(8);
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const summary = summarizeDepth(data, lengthFt);
  const samples = validDepthSamples(data, lengthFt);

  function add(event: FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(station) || station < 0 || station > lengthFt ||
      !Number.isFinite(measured) || measured <= 0 || measured > 60 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      setError('Record a valid station, positive depth up to 60 inches, and inspection date.');
      return;
    }
    const observation: DepthSample = {
      id: crypto.randomUUID(),
      method,
      stationFt: station,
      measuredIn: measured,
      date,
      notes: notes.trim().slice(0, 500),
    };
    onChange({ observations: [...data.observations, observation], fullCutVerified: false });
    setNotes('');
    setError('');
  }

  return (
    <Panel title="Field depth verification log" id="curb-depth-calibration">
      <p className="web-muted web-small">
        Record physical core or probe observations. This does not perform remote sensing.
        Spot samples do not verify all buried depths along the cut.
      </p>
      <form onSubmit={add}>
        <div className="cc-form-grid">
          <SelectField label="Method" value={method}
            options={[{ value: 'probe', label: 'Site probe' }, { value: 'core', label: 'Physical core' }]}
            onChange={(value) => setMethod(value as 'core' | 'probe')} />
          <NumberField label="Station along cut" suffix="ft" value={station}
            min={0} max={Math.max(0, lengthFt)} step={0.5} onChange={setStation} />
          <NumberField label="Measured depth" suffix="in" value={measured}
            min={0.1} max={60} step={0.125} onChange={setMeasured} />
          <label className="web-small" style={{ display: 'grid', gap: 5 }}>
            Inspection date
            <input className="cc-input" type="date" required value={date}
              onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="web-small" style={{ display: 'grid', gap: 5 }}>
            Evidence / location notes
            <input className="cc-input" value={notes} maxLength={500}
              placeholder="Station, photo or report reference"
              onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>
        {error && <p role="alert" className="cc-callout cc-callout--danger">{error}</p>}
        <button className="cc-btn cc-btn--sm cc-btn--primary" type="submit">
          Add field observation
        </button>
      </form>
      {samples.length > 0 && (
        <>
          <div className="cc-table-wrap">
            <table className="cc-table">
              <thead><tr><th>Station</th><th>Method</th><th>Measured</th><th>Date</th><th>Action</th></tr></thead>
              <tbody>{samples.map((sample) => (
                <tr key={sample.id}>
                  <td>{sample.stationFt} ft</td><td>{sample.method}</td>
                  <td>{sample.measuredIn} in</td><td>{sample.date}</td>
                  <td><button className="cc-btn cc-btn--sm" type="button"
                    onClick={() => onChange({
                      observations: data.observations.filter((s) => s.id !== sample.id),
                      fullCutVerified: false,
                    })}>Remove</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="web-muted web-small">
            {summary?.samples} usable observation(s), observed {summary?.low}–{summary?.high} in.
          </p>
          <label className="web-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={data.fullCutVerified}
              onChange={(event) => onChange({ ...data, fullCutVerified: event.target.checked })} />
            Site inspector confirms coverage of the entire proposed cut including both endpoints
          </label>
          {!summary?.verified && <p className="web-muted web-small">
            Partial coverage: observations are reference only; original uncertainty band remains.
          </p>}
          {data.fullCutVerified && !summary?.verified && <p role="note" className="web-muted web-small">
            Full-route claim requires at least two samples including stations 0 ft and {lengthFt} ft.
          </p>}
          {summary?.verified && (
            <p className="cc-callout" role="status">
              Full-route coverage attested. Quantities use measured low/base/high depths;
              intervening conditions and engineering suitability still require professional review.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
