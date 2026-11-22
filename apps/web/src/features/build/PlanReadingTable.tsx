'use client';

// Correction table for a measured plan (drawing intelligence). Shows what was measured from the
// plan's lines and labels, how sure the reader is about each value, and lets the builder fix any
// value before it drives the 3D model, takeoff and costs. Nothing here is trusted blindly.
import type { HouseBriefSpec, PlanGeometryReading } from '@fieldline/contracts';
import { useState } from 'react';

function Sure({ value }: { value: number }) {
  const level = value >= 0.75 ? 'high' : value >= 0.45 ? 'medium' : 'low';
  return (
    <span className={`hs-sure hs-sure-${level}`} title={`Confidence ${Math.round(value * 100)}%`}>
      {level === 'high' ? 'Sure' : level === 'medium' ? 'Check' : 'Unsure'}
    </span>
  );
}

export function PlanReadingTable({
  reading,
  spec,
  onApply,
}: {
  reading: PlanGeometryReading;
  spec: HouseBriefSpec;
  onApply: (spec: HouseBriefSpec) => void;
}) {
  const [draft, setDraft] = useState(spec);
  const roomConf = reading.rooms.length ? 0.8 : 0;
  const set = <K extends keyof HouseBriefSpec>(key: K, value: HouseBriefSpec[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  return (
    <div className="hs-plan-reading" aria-label="Plan reading">
      <div className="hs-plan-head">
        <strong>Plan reading</strong>
        <span>
          Overall <Sure value={reading.confidence} /> · Scale{' '}
          {reading.scale.source === 'scale_note' ? reading.scale.label : reading.scale.source === 'dimensions' ? 'from dimensions' : 'not found'}
        </span>
      </div>
      <table className="hs-plan-table">
        <thead>
          <tr>
            <th scope="col">Value</th>
            <th scope="col">Use</th>
            <th scope="col">Read</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Length (ft)</th>
            <td>
              <input type="number" aria-label="Length in feet" value={draft.lengthFt} min={16} max={120} onChange={(e) => set('lengthFt', num(e.target.value, 16, 120, draft.lengthFt))} />
            </td>
            <td>{reading.footprint ? <Sure value={reading.footprint.confidence} /> : 'Not measured'}</td>
          </tr>
          <tr>
            <th scope="row">Width (ft)</th>
            <td>
              <input type="number" aria-label="Width in feet" value={draft.widthFt} min={16} max={80} onChange={(e) => set('widthFt', num(e.target.value, 16, 80, draft.widthFt))} />
            </td>
            <td>{reading.footprint ? <Sure value={reading.footprint.confidence} /> : 'Not measured'}</td>
          </tr>
          <tr>
            <th scope="row">Bedrooms</th>
            <td>
              <input type="number" aria-label="Bedrooms" value={draft.bedrooms} min={1} max={8} onChange={(e) => set('bedrooms', num(e.target.value, 1, 8, draft.bedrooms))} />
            </td>
            <td>{reading.rooms.some((r) => r.kind === 'bedroom') ? <Sure value={roomConf} /> : 'No labels'}</td>
          </tr>
          <tr>
            <th scope="row">Bathrooms</th>
            <td>
              <input type="number" aria-label="Bathrooms" value={draft.bathrooms} min={1} max={6} onChange={(e) => set('bathrooms', num(e.target.value, 1, 6, draft.bathrooms))} />
            </td>
            <td>{reading.rooms.some((r) => r.kind === 'bathroom') ? <Sure value={roomConf} /> : 'No labels'}</td>
          </tr>
          <tr>
            <th scope="row">Stories</th>
            <td>
              <select aria-label="Stories" value={draft.stories} onChange={(e) => set('stories', Number(e.target.value) === 2 ? 2 : 1)}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </td>
            <td>{reading.stories ? <Sure value={0.6} /> : 'Not stated'}</td>
          </tr>
          <tr>
            <th scope="row">Garage</th>
            <td>
              <select aria-label="Garage" value={draft.garage} onChange={(e) => set('garage', e.target.value as HouseBriefSpec['garage'])}>
                <option value="none">None</option>
                <option value="one_car">1-car</option>
                <option value="two_car">2-car</option>
              </select>
            </td>
            <td>{reading.rooms.some((r) => r.kind === 'garage') ? <Sure value={roomConf} /> : 'No label'}</td>
          </tr>
        </tbody>
      </table>
      <p className="hs-plan-facts">
        {reading.walls.count} wall runs · {reading.walls.totalLf.toLocaleString('en-US')} LF of wall
        {reading.walls.thicknessIn ? ` · ${reading.walls.thicknessIn}" thick` : ''} · {reading.doors} door swings
        {reading.windows ? ` · ${reading.windows} window tags` : ''}
      </p>
      {reading.rooms.length > 0 && (
        <ul className="hs-plan-rooms" aria-label="Rooms found">
          {reading.rooms.map((r, i) => (
            <li key={`${r.name}-${i}`}>
              {r.name}
              {r.widthFt && r.lengthFt ? ` — ${r.widthFt} × ${r.lengthFt} ft` : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="hs-plan-actions">
        <button type="button" className="hs-pill is-on" onClick={() => onApply(draft)}>
          Use these values
        </button>
        <button type="button" className="hs-pill" onClick={() => setDraft(spec)}>
          Reset
        </button>
      </div>
    </div>
  );
}
