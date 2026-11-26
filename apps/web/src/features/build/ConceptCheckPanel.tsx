'use client';

// Concept check panel: plain-language flags over the schematic plan (room sizes, bath access,
// bedroom outside walls, stairs, program counts, plumbing spread). Planning-sketch flags only —
// this is NOT a code review, and the panel says so. Clicking a finding highlights the room in
// the floor plan above via the existing selection.
import { useMemo, useState } from 'react';
import { Panel } from '../command/Panel';
import {
  areaSchedule,
  conceptCheck,
  MIN_ROOM_SIZE,
  PLUMBING_SPREAD_FT,
  type ConceptFinding,
} from './conceptCheck';
import type { HouseLayout, HouseProgram } from './layout';

export function ConceptCheckPanel({
  layout,
  program,
  onSelectRoom,
}: {
  layout: HouseLayout;
  program: HouseProgram;
  /** Highlight a room in the plan (floorIndex is 0-based into layout.floors). */
  onSelectRoom: (roomId: string, floorIndex: number) => void;
}) {
  const findings = useMemo(() => conceptCheck(layout, program), [layout, program]);
  const schedule = useMemo(() => areaSchedule(layout), [layout]);
  const [showSchedule, setShowSchedule] = useState(false);
  const problems = findings.filter((f) => f.severity === 'problem').length;

  const floorIndexFor = (f: ConceptFinding) =>
    f.floorLevel === null ? 0 : Math.max(0, layout.floors.findIndex((fl) => fl.level === f.floorLevel));

  return (
    <Panel title="Concept check" id="concept-check">
      <p className="web-muted web-small" style={{ marginBottom: 9 }}>
        Planning-sketch flags over the schematic rectangles — <strong>not a code review</strong>.
        This model cannot see doors, windows, structure or local code. Minimums used here:{' '}
        {Object.entries(MIN_ROOM_SIZE)
          .map(([kind, m]) => `${kind} ${m!.minDimFt} ft / ${m!.minAreaSqFt} sq ft`)
          .join('; ')}
        ; wet rooms more than {PLUMBING_SPREAD_FT} ft apart get a cost note.
      </p>
      {findings.length === 0 ? (
        <p role="status">No concept flags on this sketch. Still confirm doors, windows and code items on the real plan.</p>
      ) : (
        <>
          <p role="status" style={{ marginBottom: 8 }}>
            {problems} problem{problems === 1 ? '' : 's'}, {findings.length - problems} note
            {findings.length - problems === 1 ? '' : 's'}. Click a finding to highlight the room.
          </p>
          <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
            {findings.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="cc-btn cc-btn--sm"
                  style={{ textAlign: 'left', width: '100%', whiteSpace: 'normal' }}
                  disabled={f.roomId === null}
                  onClick={() => f.roomId && onSelectRoom(f.roomId, floorIndexFor(f))}
                  aria-label={`${f.title}. ${f.reason} Suggested fix: ${f.fix}`}
                >
                  <strong>{f.severity === 'problem' ? 'Problem: ' : 'Note: '}{f.title}</strong>
                  <span style={{ display: 'block', fontWeight: 400 }}>{f.reason}</span>
                  <span style={{ display: 'block', fontWeight: 400 }}>Fix: {f.fix}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          className="cc-btn cc-btn--sm"
          aria-expanded={showSchedule}
          onClick={() => setShowSchedule((s) => !s)}
        >
          {showSchedule ? 'Hide area schedule' : 'Show area schedule'}
        </button>
        {showSchedule && (
          <table className="hs-takeoff" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Floor</th>
                <th>Room</th>
                <th>Size</th>
                <th>Area</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((r) => (
                <tr key={`${r.floorLevel}-${r.roomId}`}>
                  <td>{r.floorLevel}</td>
                  <td>{r.name}</td>
                  <td>
                    {r.w} × {r.h} ft
                  </td>
                  <td>{r.areaSqFt} sq ft</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
