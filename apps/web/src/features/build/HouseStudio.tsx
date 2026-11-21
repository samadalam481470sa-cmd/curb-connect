'use client';

// House Studio: the 3D build-up of the house with installed costs per system, a construction
// timeline, a blueprint plan view and CAD exports, laid out like an estimating command center.
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BlueprintPlan, floorPlanDxf } from './BlueprintPlan';
import {
  DEFAULT_ESCALATION_PERCENT,
  ESCALATION_SOURCE,
  NAHB_SOURCE,
  PHASES,
  SYSTEMS,
  type PhaseId,
  type StudioCostSettings,
  type SystemId,
  studioEstimate,
} from './studioCost';
import type { StudioView, StudioViewerHandle } from './StudioViewer';
import type { BuildSpec, Takeoff } from './takeoff';

const StudioViewer = dynamic(() => import('./StudioViewer').then((m) => m.StudioViewer), {
  ssr: false,
  loading: () => <div className="hs-viewer hs-viewer--loading">Loading 3D model…</div>,
});

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const short = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`;

type ViewMode = StudioView | 'top';

export function HouseStudio({
  spec,
  takeoff,
  projectName,
  costs,
  onCostsChange,
}: {
  spec: BuildSpec;
  takeoff: Takeoff;
  projectName: string;
  costs: StudioCostSettings;
  onCostsChange: (next: StudioCostSettings) => void;
}) {
  const estimate = useMemo(() => studioEstimate(takeoff, costs), [takeoff, costs]);
  const [step, setStep] = useState<PhaseId>(16);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<ViewMode>('iso');
  const [cutaway, setCutaway] = useState(0);
  const [explode, setExplode] = useState(false);
  const [orbit, setOrbit] = useState(false);
  const [blueprint, setBlueprint] = useState(true);
  const [grid, setGrid] = useState(false);
  const [hidden, setHidden] = useState<Set<SystemId>>(() => new Set());
  const [floorIndex, setFloorIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openSystem, setOpenSystem] = useState<SystemId | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const viewer = useRef<StudioViewerHandle | null>(null);

  // Play the build: one phase per beat; it stops by itself at the last phase.
  const running = playing && step < 16;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setStep((s) => Math.min(16, s + 1) as PhaseId), 1400 / speed);
    return () => clearInterval(id);
  }, [running, speed]);

  // Interior trades (MEP through finishes) are shown with the near end opened up, like an x-ray.
  const autoCut = step >= 11 && step <= 14;
  const effectiveCut = Math.max(cutaway, autoCut ? 0.45 : 0);
  const phase = PHASES[step - 1]!;
  const inPlace = estimate.inPlaceByPhase[step - 1] ?? 0;
  const safeFloor = Math.min(floorIndex, takeoff.layout.floors.length - 1);

  function toggleSystem(id: SystemId) {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function download(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function exportModel(kind: 'glb' | 'obj') {
    setExportMsg(null);
    try {
      const handle = viewer.current;
      if (!handle) throw new Error('Switch to a 3D view first.');
      const blob = kind === 'glb' ? await handle.exportGlb() : await handle.exportObj();
      download(`fieldpro-house.${kind}`, blob);
      setExportMsg(`Exported the visible model as ${kind.toUpperCase()}.`);
    } catch (err) {
      setExportMsg(err instanceof Error ? err.message : 'Export failed.');
    }
  }
  function exportSystemsCsv() {
    const rows = [['Phase', 'System', 'Key quantity', 'Installed cost (USD)', 'Basis']];
    for (const s of estimate.systems) {
      rows.push([PHASES[s.def.phase - 1]!.name, s.def.label, s.keyQty, String(s.amount), s.note]);
    }
    rows.push(['', 'Total', `${estimate.areaSqFt} SF`, String(estimate.total), NAHB_SOURCE.title]);
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    download('fieldpro-house-systems.csv', new Blob([csv], { type: 'text/csv' }));
  }

  return (
    <section className="hs" aria-label="House Studio 3D estimate">
      <aside className="hs-left" aria-label="Estimate summary">
        <div className="hs-title">
          <div>
            <strong>{projectName}</strong>
            <small>
              Concept model · {spec.bedrooms} bed / {spec.bathrooms} bath · {spec.stories} story
            </small>
          </div>
          <button
            type="button"
            className="hs-icon"
            aria-label="Cost settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((o) => !o)}
          >
            ⚙
          </button>
        </div>
        {settingsOpen && (
          <div className="hs-settings">
            <label>
              <span>Escalation since fall 2024 (%)</span>
              <input
                type="number"
                step="0.1"
                value={costs.escalationPercent}
                onChange={(e) => onCostsChange({ ...costs, escalationPercent: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              <span>Regional factor (1.00 = U.S. average)</span>
              <input
                type="number"
                step="0.01"
                min={0.5}
                max={2}
                value={costs.regionalFactor}
                onChange={(e) => onCostsChange({ ...costs, regionalFactor: Number(e.target.value) || 1 })}
              />
            </label>
            <button
              type="button"
              className="hs-pill"
              onClick={() => onCostsChange({ escalationPercent: DEFAULT_ESCALATION_PERCENT, regionalFactor: 1 })}
            >
              Reset to sourced defaults
            </button>
            <p>
              Installed costs (labor + materials) per sq ft from{' '}
              <a href={NAHB_SOURCE.url} target="_blank" rel="noreferrer">
                {NAHB_SOURCE.title}
              </a>
              , escalated with{' '}
              <a href={ESCALATION_SOURCE.url} target="_blank" rel="noreferrer">
                {ESCALATION_SOURCE.title}
              </a>
              . National averages for planning, not a bid.
            </p>
          </div>
        )}
        <div className="hs-total">
          <span>Total</span>
          <strong>{usd(estimate.total)}</strong>
        </div>
        <div className="hs-kpis">
          <div>
            <span>$ / SF</span>
            <strong>{usd(estimate.perSqFt)}</strong>
          </div>
          <div>
            <span>Concrete</span>
            <strong>{estimate.concreteYd3} CY</strong>
          </div>
          <div>
            <span>Studs</span>
            <strong>{estimate.studs.toLocaleString('en-US')}</strong>
          </div>
          <div>
            <span>Roof</span>
            <strong>{estimate.roofSquares} SQ</strong>
          </div>
        </div>
        <div className="hs-label">Systems</div>
        <ul className="hs-systems">
          {estimate.systems.map((s) => (
            <li key={s.def.id} className={hidden.has(s.def.id) ? 'is-off' : ''}>
              <span className="hs-swatch" style={{ background: s.def.color }} aria-hidden="true" />
              <span className="hs-sys-name">{s.def.label}</span>
              <span className="hs-sys-amt">{short(s.amount)}</span>
              <button
                type="button"
                className="hs-eye"
                aria-pressed={!hidden.has(s.def.id)}
                aria-label={`${hidden.has(s.def.id) ? 'Show' : 'Hide'} ${s.def.label} in the model`}
                onClick={() => toggleSystem(s.def.id)}
              >
                {hidden.has(s.def.id) ? '◌' : '◉'}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="hs-center">
        <div className="hs-toolbar" role="toolbar" aria-label="Model view">
          <div className="hs-group">
            <span className="hs-tag">View</span>
            {(['iso', 'top', 'front', 'side'] as const).map((v) => (
              <button key={v} type="button" className={`hs-pill ${view === v ? 'is-on' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === 'iso' ? 'Iso' : v[0]!.toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <label className="hs-group">
            <span className="hs-tag">Cutaway</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={effectiveCut}
              aria-label="Cutaway"
              title={autoCut && cutaway < 0.45 ? 'Opened automatically for interior work' : undefined}
              onChange={(e) => setCutaway(Number(e.target.value))}
            />
          </label>
          <div className="hs-group">
            <button
              type="button"
              className={`hs-pill ${step === 16 && !running ? 'is-on' : ''}`}
              onClick={() => {
                setPlaying(false);
                setStep(16);
              }}
            >
              Finished
            </button>
            <button type="button" className={`hs-pill ${explode ? 'is-on' : ''}`} aria-pressed={explode} onClick={() => setExplode((x) => !x)}>
              Explode
            </button>
            <button type="button" className={`hs-pill ${orbit ? 'is-on' : ''}`} aria-pressed={orbit} onClick={() => setOrbit((x) => !x)}>
              Orbit
            </button>
          </div>
          <div className="hs-group">
            <button type="button" className={`hs-pill ${blueprint ? 'is-on' : ''}`} aria-pressed={blueprint} onClick={() => setBlueprint((x) => !x)}>
              Blueprint
            </button>
            <button type="button" className={`hs-pill ${grid ? 'is-on' : ''}`} aria-pressed={grid} onClick={() => setGrid((x) => !x)}>
              Grid
            </button>
          </div>
          {view === 'top' && takeoff.layout.floors.length > 1 && (
            <div className="hs-group">
              {takeoff.layout.floors.map((f, i) => (
                <button key={f.level} type="button" className={`hs-pill ${i === safeFloor ? 'is-on' : ''}`} onClick={() => setFloorIndex(i)}>
                  L{f.level}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hs-stage">
          {view === 'top' ? (
            <BlueprintPlan layout={takeoff.layout} floorIndex={safeFloor} projectName={projectName} />
          ) : (
            <StudioViewer
              ref={viewer}
              spec={spec}
              takeoff={takeoff}
              step={step}
              hidden={hidden}
              view={view}
              cutaway={effectiveCut}
              explode={explode}
              orbit={orbit}
              blueprint={blueprint}
              grid={grid}
            />
          )}
        </div>

        <div className="hs-timeline" aria-label="Construction sequence">
          <div className="hs-timeline-row">
            <button
              type="button"
              className="hs-play"
              aria-label={running ? 'Pause' : 'Play the build'}
              onClick={() => {
                if (running) {
                  setPlaying(false);
                  return;
                }
                if (step >= 16) setStep(1);
                setPlaying(true);
              }}
            >
              {running ? '❚❚' : '▶'}
            </button>
            <div className="hs-step">
              <span>Step</span>
              <strong>{step}</strong>
            </div>
            <div className="hs-phase">
              <span>Phase</span>
              <strong>{phase.name}</strong>
            </div>
            <input
              className="hs-scrub"
              type="range"
              min={1}
              max={16}
              step={1}
              value={step}
              aria-label="Build phase"
              onChange={(e) => {
                setPlaying(false);
                setStep(Number(e.target.value) as PhaseId);
              }}
            />
            <div className="hs-group">
              <span className="hs-tag">Speed</span>
              {[0.5, 1, 2, 4].map((x) => (
                <button key={x} type="button" className={`hs-pill ${speed === x ? 'is-on' : ''}`} onClick={() => setSpeed(x)}>
                  {x}×
                </button>
              ))}
            </div>
            <div className="hs-inplace">
              <span>In place</span>
              <strong>{usd(inPlace)}</strong>
            </div>
          </div>
          <div className="hs-chips" role="tablist" aria-label="Phases">
            {PHASES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === step}
                className={`hs-chip ${p.id === step ? 'is-on' : ''} ${p.id < step ? 'is-done' : ''}`}
                onClick={() => {
                  setPlaying(false);
                  setStep(p.id);
                }}
              >
                <span>{String(p.id).padStart(2, '0')}</span>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <aside className="hs-right" aria-label="Takeoff">
        <div className="hs-title">
          <div>
            <strong>Takeoff</strong>
            <small>
              {SYSTEMS.length} systems · {estimate.areaSqFt.toLocaleString('en-US')} SF
            </small>
          </div>
        </div>
        <table className="hs-takeoff">
          <thead>
            <tr>
              <th>System</th>
              <th>Key qty</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {estimate.systems.map((s) => (
              <tr
                key={s.def.id}
                className={`${s.def.phase <= step ? 'is-built' : ''} ${openSystem === s.def.id ? 'is-open' : ''}`}
                onClick={() => setOpenSystem((o) => (o === s.def.id ? null : s.def.id))}
                title={s.note}
              >
                <td>
                  <span className="hs-swatch" style={{ background: s.def.color }} aria-hidden="true" />
                  {s.def.label}
                  {openSystem === s.def.id && <small className="hs-note">{s.note}</small>}
                </td>
                <td>{s.keyQty}</td>
                <td>{short(s.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hs-exports">
          <div className="hs-label">CAD + data</div>
          <button
            type="button"
            className="hs-pill"
            onClick={() =>
              download(`fieldpro-plan-L${safeFloor + 1}.dxf`, new Blob([floorPlanDxf(takeoff.layout, safeFloor)], { type: 'application/dxf' }))
            }
          >
            Plan DXF (AutoCAD)
          </button>
          <button type="button" className="hs-pill" onClick={() => void exportModel('glb')} disabled={view === 'top'}>
            3D GLB (SketchUp, Revit, Blender)
          </button>
          <button type="button" className="hs-pill" onClick={() => void exportModel('obj')} disabled={view === 'top'}>
            3D OBJ
          </button>
          <button type="button" className="hs-pill" onClick={exportSystemsCsv}>
            Systems CSV (Excel)
          </button>
          {exportMsg && <p className="hs-small">{exportMsg}</p>}
          <p className="hs-small">
            The 3D export holds what is on screen now: use the timeline, eye toggles and cutaway to
            choose.
          </p>
        </div>
      </aside>
    </section>
  );
}
