'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AREA_SUMMARIES } from '../../components/AreaPage';
import { RouteGate } from '../../components/RouteGate';
import { SupplierLinks } from '../command/MaterialLookup';
import { PermitCenter } from './PermitCenter';
import { calibrateDepth, type DepthReading, type DepthMethod } from './depthCalibration';
import { EstimateBand, Kpi, money0, num, NumberField, Panel, SelectField } from '../command/Panel';
import {
  DEFAULT_CURB_INPUTS,
  estimateCurb,
  SAMPLE_CURB_RATES,
  type CurbInputs,
  type CurbRates,
  type Triple,
} from './curbEstimate';

const DRAFT_KEY = 'fieldpro.curb.workspace.v1';

const range = (t: Triple | null, digits = 1, unit = '') =>
  !t
    ? 'unknown'
    : t.low === t.high
      ? `${num(t.base, digits)}${unit}`
      : `${num(t.low, digits)}–${num(t.high, digits)}${unit}`;

export function CurbWorkspace() {
  return (
    <RouteGate routeId="curb">
      <Workspace />
    </RouteGate>
  );
}

function Workspace() {
  const [input, setInput] = useState<CurbInputs>(DEFAULT_CURB_INPUTS);
  const [rates, setRates] = useState<CurbRates>(SAMPLE_CURB_RATES);
  const [ratesEdited, setRatesEdited] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [readings, setReadings] = useState<DepthReading[]>([]);
  const [stationFt, setStationFt] = useState('');
  const [depthIn, setDepthIn] = useState('');
  const [depthMethod, setDepthMethod] = useState<DepthMethod>('core');
  const [depthNote, setDepthNote] = useState('');
  const [depthError, setDepthError] = useState('');

  useEffect(() => {
    // Restore after paint: reading storage during render would break hydration.
    const handle = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw) as {
            input?: CurbInputs;
            rates?: CurbRates;
            ratesEdited?: boolean;
            readings?: DepthReading[];
          };
          if (d.input) setInput({ ...DEFAULT_CURB_INPUTS, ...d.input });
          if (d.rates) setRates({ ...SAMPLE_CURB_RATES, ...d.rates });
          if (d.ratesEdited) setRatesEdited(true);
          if (Array.isArray(d.readings) && d.readings.length <= 100) {
            const valid = d.readings.filter(p => p && typeof p.id === 'string' &&
              Number.isFinite(p.stationFt) && Number.isFinite(p.depthIn) && typeof p.method === 'string');
            setReadings(valid);
          }
        }
      } catch {
        // ignore
      }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ input, rates, ratesEdited, readings }));
    } catch {
      // ignore
    }
  }, [input, rates, ratesEdited, readings, loaded]);

  const deferred = useDeferredValue(input);
  const calibration = useMemo(() => {
    try {
      return calibrateDepth(input.cutLengthFt,input.depthLowIn,input.depthBaseIn,input.depthHighIn,readings);
    } catch { return null; }
  }, [input.cutLengthFt,input.depthLowIn,input.depthBaseIn,input.depthHighIn,readings]);
  const calibratedInput = calibration && readings.length > 0 ? {
    ...deferred, depthLowIn:calibration.lowIn,
    depthBaseIn:calibration.baseIn,depthHighIn:calibration.highIn,
  } : deferred;
  const est = useMemo(() => estimateCurb(calibratedInput, rates), [calibratedInput, rates]);
  const addReading = () => {
    const station = Number(stationFt), depth = Number(depthIn);
    if (!stationFt.trim() || !depthIn.trim() || !Number.isFinite(station) ||
      !Number.isFinite(depth) || station < 0 || station > input.cutLengthFt ||
      depth <= 0 || depth > 120 || readings.some(p=>p.stationFt===station)) {
      setDepthError('Enter a unique station within the cut length and a measured depth between 0 and 120 inches.');
      return;
    }
    setReadings(prev=>[...prev,{id:crypto.randomUUID(),stationFt:station,depthIn:depth,
      method:depthMethod,recordedAt:new Date().toISOString(),note:depthNote.slice(0,250)}]);
    setDepthError('');setStationFt('');setDepthIn('');setDepthNote('');
  };

  const set = <K extends keyof CurbInputs>(k: K, v: CurbInputs[K]) =>
    setInput((i) => ({ ...i, [k]: v }));
  const setRate = (k: keyof CurbRates, v: number) => {
    setRates((r) => ({ ...r, [k]: Math.max(0, v) }));
    setRatesEdited(true);
  };

  // Cross-section drawing scale: inches -> SVG units.
  const H = Math.max(6, input.curbHeightIn);
  const Wd = Math.max(4, input.curbWidthIn);
  const depthBase = Math.min(H, Math.max(0, input.depthBaseIn));
  const depthHigh = Math.min(H, Math.max(0, input.depthHighIn));

  return (
    <>
      <header className="cc-page-head">
        <div>
          <div className="cc-eyebrow">Curb Cutting // Measurement + pricing</div>
          <h1 tabIndex={-1} data-route-heading="">
            Curb Cutting
          </h1>
          <p>
            Enter the cut path and curb profile. Quantities come from the shared curb engine, and an
            unverified buried depth is carried as a low / base / high range instead of a guess.
          </p>
        </div>
      </header>

      <div className="cc-split">
        <div className="cc-stack">
          <Panel title="Section + path view" id="curb-view">
            <div className="cc-split cc-split--wide-left" style={{ gap: 12 }}>
              <div className="cc-blueprint" style={{ padding: 12 }}>
                <svg
                  viewBox="-10 -10 140 70"
                  role="img"
                  aria-label={`Cut path ${num(est.cutLengthFt)} feet`}
                >
                  <text className="cc-dimtext" x={0} y={-3} fontSize={4}>
                    PLAN · CUT PATH
                  </text>
                  <rect
                    x={0}
                    y={14}
                    width={120}
                    height={14}
                    fill="rgba(148,163,184,0.08)"
                    stroke="#4f6f8f"
                    strokeWidth={0.4}
                  />
                  <line
                    x1={10}
                    y1={14}
                    x2={110}
                    y2={14}
                    stroke="#22d3ee"
                    strokeWidth={1.2}
                    className="cc-draw"
                    pathLength={400}
                  />
                  {input.sawPasses === 2 && (
                    <line
                      x1={10}
                      y1={28}
                      x2={110}
                      y2={28}
                      stroke="#22d3ee"
                      strokeWidth={1.2}
                      className="cc-draw"
                      pathLength={400}
                    />
                  )}
                  <rect
                    x={10}
                    y={14}
                    width={100}
                    height={14}
                    fill="rgba(251,191,36,0.12)"
                    stroke="#fbbf24"
                    strokeDasharray="2 1"
                    strokeWidth={0.4}
                  />
                  <line className="cc-dimline" x1={10} y1={36} x2={110} y2={36} />
                  <text className="cc-dimtext" x={60} y={42} fontSize={4} textAnchor="middle">
                    {num(est.cutLengthFt)} ft · {input.sawPasses} pass
                    {input.sawPasses === 2 ? 'es' : ''}
                  </text>
                  <text className="cc-room-dim" x={60} y={23} fontSize={3.4} textAnchor="middle">
                    REMOVAL ZONE {input.removalWidthIn} in
                  </text>
                </svg>
                <div className="cc-blueprint__scan" aria-hidden="true" />
              </div>
              <div className="cc-blueprint" style={{ padding: 12 }}>
                <svg
                  viewBox={`${-8} ${-8} ${Wd + 30} ${H + 18}`}
                  role="img"
                  aria-label={`Curb section ${input.curbWidthIn} by ${input.curbHeightIn} inches`}
                >
                  <text className="cc-dimtext" x={-6} y={-3} fontSize={2.4}>
                    SECTION
                  </text>
                  <rect
                    x={0}
                    y={0}
                    width={Wd}
                    height={H}
                    fill="rgba(34,211,238,0.08)"
                    stroke="#22d3ee"
                    strokeWidth={0.35}
                  />
                  <rect x={0} y={0} width={Wd} height={depthHigh} fill="rgba(167,139,250,0.14)" />
                  <line
                    x1={-3}
                    y1={depthBase}
                    x2={Wd + 3}
                    y2={depthBase}
                    stroke="#fbbf24"
                    strokeWidth={0.4}
                    strokeDasharray="1 0.6"
                  />
                  <text className="cc-dimtext" x={Wd + 4} y={depthBase + 1} fontSize={2.2}>
                    {input.depthBaseIn}″ base
                  </text>
                  <text
                    className="cc-room-dim"
                    x={Wd / 2}
                    y={H + 5}
                    fontSize={2.2}
                    textAnchor="middle"
                  >
                    {input.curbWidthIn}″ × {input.curbHeightIn}″
                  </text>
                </svg>
              </div>
            </div>
          </Panel>

          <Panel title="Job measurements" id="curb-inputs">
            <div className="cc-form-grid">
              <NumberField
                label="Cut length"
                suffix="ft"
                value={input.cutLengthFt}
                min={0}
                step={0.5}
                onChange={(v) => set('cutLengthFt', v)}
              />
              <SelectField
                label="Saw passes"
                value={input.sawPasses}
                options={[
                  { value: 1, label: '1 (single line)' },
                  { value: 2, label: '2 (both faces)' },
                ]}
                onChange={(v) => set('sawPasses', v as 1 | 2)}
              />
              <NumberField
                label="Depth low"
                suffix="in"
                value={input.depthLowIn}
                min={0}
                step={0.5}
                onChange={(v) => set('depthLowIn', v)}
              />
              <NumberField
                label="Depth base"
                suffix="in"
                value={input.depthBaseIn}
                min={0}
                step={0.5}
                onChange={(v) => set('depthBaseIn', v)}
              />
              <NumberField
                label="Depth high"
                suffix="in"
                value={input.depthHighIn}
                min={0}
                step={0.5}
                onChange={(v) => set('depthHighIn', v)}
              />
              <NumberField
                label="Curb height"
                suffix="in"
                value={input.curbHeightIn}
                min={0}
                onChange={(v) => set('curbHeightIn', v)}
              />
              <NumberField
                label="Curb width"
                suffix="in"
                value={input.curbWidthIn}
                min={0}
                onChange={(v) => set('curbWidthIn', v)}
              />
              <NumberField
                label="Removal width"
                suffix="in"
                value={input.removalWidthIn}
                min={0}
                onChange={(v) => set('removalWidthIn', v)}
              />
              <NumberField
                label="Pour thickness"
                suffix="in"
                value={input.restorationThicknessIn}
                min={0}
                onChange={(v) => set('restorationThicknessIn', v)}
              />
            </div>
          </Panel>

          <Panel title="Field core / probe depth calibration" id="curb-depth-evidence">
            <p className="web-muted web-small">
              Log measured depth at each station along the planned cut. Spot samples update the
              probable base quantity, but cannot prove continuous buried depth, soil capacity,
              reinforcement, or utility clearance. Confirm with an approved field method.
            </p>
            <div className="cc-form-grid">
              <label className="cc-field"><span>Station from cut start (ft)</span>
                <input className="cc-input" type="number" min="0" max={input.cutLengthFt}
                  step="0.1" value={stationFt} onChange={e=>setStationFt(e.currentTarget.value)}/></label>
              <label className="cc-field"><span>Measured depth (in)</span>
                <input className="cc-input" type="number" min="0.1" max="120" step="0.1"
                  value={depthIn} onChange={e=>setDepthIn(e.currentTarget.value)}/></label>
              <label className="cc-field"><span>Evidence source</span>
                <select className="cc-input" value={depthMethod}
                  onChange={e=>setDepthMethod(e.currentTarget.value as DepthMethod)}>
                  <option value="core">Physical core</option>
                  <option value="probe">Physical probe</option>
                  <option value="documented_as_built">Documented as-built (not field-verified)</option>
                </select></label>
              <label className="cc-field"><span>Reference / notes</span>
                <input className="cc-input" value={depthNote} maxLength={250}
                  placeholder="Core ID, photo reference, technician"
                  onChange={e=>setDepthNote(e.currentTarget.value)}/></label>
            </div>
            {depthError && <p role="alert" className="web-denied-reason">{depthError}</p>}
            <div className="cc-actions" style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
              <button type="button" className="cc-btn cc-btn--primary" onClick={addReading}>Add measurement</button>
              <button type="button" className="cc-btn" disabled={readings.length===0}
                onClick={() => {
                  const blob=new Blob([JSON.stringify({inputs:input,readings},null,2)],{type:'application/json'});
                  const url=URL.createObjectURL(blob);const link=document.createElement('a');
                  link.href=url;link.download='fieldpro-depth-evidence.json';link.click();
                  window.setTimeout(()=>URL.revokeObjectURL(url),0);
                }}>Export evidence JSON</button>
            </div>
            {readings.length>0 && <div className="cc-table-wrap" style={{marginTop:14}}>
              <table className="cc-table"><thead><tr>
                <th>Station (ft)</th><th>Depth (in)</th><th>Evidence</th><th>Action</th>
              </tr></thead><tbody>
                {readings.map(p=><tr key={p.id}><td>{num(p.stationFt,1)}</td>
                  <td>{num(p.depthIn,2)}</td><td>{p.method.replaceAll('_',' ')}{p.note ? ' · '+p.note : ''}</td>
                  <td><button type="button" className="cc-btn cc-btn--sm"
                    onClick={()=>setReadings(all=>all.filter(x=>x.id!==p.id))}>Remove</button></td>
                </tr>)}
              </tbody></table>
            </div>}
            {calibration && <p role="status" className="web-muted web-small" style={{marginTop:12}}>
              {calibration.count} observation(s) · measured median baseline {num(calibration.baseIn,2)} in
              · conservative range {num(calibration.lowIn,2)}–{num(calibration.highIn,2)} in.
              {calibration.outOfRange ? ' An observation was outside the initial bounds; inspect before bidding.' : ''}
              {' '}Range remains provisional until the full cut path has been verified and accepted on site.
            </p>}
          </Panel>
          <Panel title="Rates" id="curb-rates">
            {!ratesEdited && (
              <div className="cc-callout" style={{ marginBottom: 10 }}>
                <p>
                  Sample rates for a first look. Replace them with your price book before quoting.
                  Concrete defaults to the DFW ready-mix reference ($/yd³).
                </p>
              </div>
            )}
            <div className="cc-form-grid">
              <NumberField
                label="Saw"
                suffix="$/in-ft"
                value={rates.sawPerInchFt}
                step={0.05}
                onChange={(v) => setRate('sawPerInchFt', v)}
              />
              <NumberField
                label="Remove + haul"
                suffix="$/yd³"
                value={rates.removalPerYd3}
                step={5}
                onChange={(v) => setRate('removalPerYd3', v)}
              />
              <NumberField
                label="Place + finish"
                suffix="$/ft²"
                value={rates.placementPerSqFt}
                step={0.5}
                onChange={(v) => setRate('placementPerSqFt', v)}
              />
              <NumberField
                label="Concrete"
                suffix="$/yd³"
                value={rates.concretePerYd3}
                step={1}
                onChange={(v) => setRate('concretePerYd3', v)}
              />
              <NumberField
                label="Mobilization"
                suffix="$"
                value={rates.mobilization}
                step={25}
                onChange={(v) => setRate('mobilization', v)}
              />
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="cc-eyebrow" style={{ marginBottom: 4 }}>
                Compare ready-mix and blades
              </div>
              <SupplierLinks query="ready mix concrete delivery" />
            </div>
          </Panel>
        </div>

        <aside className="cc-rail" aria-label="Curb estimate">
          <Panel title="Estimate band" id="curb-band">
            {est.cost ? (
              <EstimateBand low={est.cost.low} base={est.cost.base} high={est.cost.high} />
            ) : (
              <div className="cc-callout cc-callout--danger" role="status">
                <p>
                  Enter a cut depth to price this job. Nothing is estimated from an unknown depth.
                </p>
              </div>
            )}
            <div className="cc-kpis">
              <Kpi label="Saw" value={range(est.inchFeet, 0)} unit="in-ft" accent />
              <Kpi label="Removal" value={range(est.removalYd3, 2)} unit="yd³" />
              <Kpi label="Restore" value={range(est.restorationSqFt, 0)} unit="ft²" />
              <Kpi label="Concrete" value={range(est.restorationYd3, 2)} unit="yd³" />
            </div>
            {est.cost && (
              <dl style={{ margin: '12px 0 0' }}>
                <div className="cc-total cc-total--grand">
                  <dt>Base</dt>
                  <dd>{money0(est.cost.base)}</dd>
                </div>
              </dl>
            )}
          </Panel>

          <div className="cc-stack" style={{ gap: 8 }}>
            {est.depthState === 'bounded' && (
              <div className="cc-callout" role="note">
                <p>
                  <strong>{readings.length ? 'Depth sampled — not continuously verified.' : 'Depth not verified.'}</strong>
                  The conservative range is {num(calibration?.lowIn ?? input.depthLowIn,1)}–
                  {num(calibration?.highIn ?? input.depthHighIn,1)} in.
                  {readings.length ? ' Field observations adjust the base estimate only; confirm full-depth conditions before quoting.' : ' Record physical core or probe evidence above to calibrate the base estimate.'}
                </p>
              </div>
            )}
            <div className="cc-callout cc-callout--danger" role="note">
              <p>
                <strong>Utilities.</strong> Call 811 and wait for locates before any saw cutting or
                excavation.
              </p>
            </div>
            <div className="cc-callout" role="note">
              <p>
                <strong>Permit.</strong> Public right-of-way work may require prior city approval and
                inspection. <a href="#permit-center">Find the official permit portal below.</a>
              </p>
            </div>
            <div className="cc-callout cc-callout--info">
              <p>{AREA_SUMMARIES.curb}</p>
            </div>
            {est.issues.length > 0 && (
              <div className="cc-callout cc-callout--danger">
                <p>{est.issues.join('; ')}</p>
              </div>
            )}
          </div>
        </aside>
      </div>
      <PermitCenter />
    </>
  );
}
