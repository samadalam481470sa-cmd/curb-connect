'use client';
// Land feasibility: what can be built on a piece of land and what it earns. Pulls real ground
// heights (USGS 3DEP) and the FEMA flood zone for the lot, lays out lots against the zoning
// rules, flags any lot that breaks a rule with the reason and a fix, and prices the site work
// with a source on every line. Shown in 3D with slope heatmap, trees, labels and underground lines.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SiteTerrainResponseSchema, type StudioLot } from '@fieldline/contracts';
import { useApi } from '../../lib/session';
import {
  DEFAULT_COSTS,
  DEFAULT_RULES,
  cornerTerrain,
  fillGrid,
  passes,
  runFeasibility,
  type CostLine,
  type ExitPlan,
  type FeasibilityInputs,
  type FeasibilityResult,
  type LayoutChoice,
  type Terrain,
  type ZoningRules,
} from './siteFeasibility';
import { buildLandScene, disposeLandScene, type LandSceneOptions } from './landScene';
import { problemText } from './StudioHouses';

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n) >= 1e6 ? `${(Math.abs(n) / 1e6).toFixed(2)}M` : Math.round(Math.abs(n)).toLocaleString()}`;

type View = 'aerial' | 'street' | 'underground';

function LandViewer({
  inputs,
  result,
  options,
  view,
}: {
  inputs: FeasibilityInputs;
  result: FeasibilityResult;
  options: LandSceneOptions;
  view: View;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Group | null;
    span: number;
    streetY: number;
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      const failure =
        'This browser could not start 3D graphics (WebGL). The tables below still work.';
      const id = window.setTimeout(() => setFailed(failure), 0);
      return () => window.clearTimeout(id);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute(
      'aria-label',
      '3D site plan. Drag to orbit, scroll or pinch to zoom.',
    );
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070d18');
    const camera = new THREE.PerspectiveCamera(
      40,
      el.clientWidth / Math.max(1, el.clientHeight),
      1,
      40_000,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight('#dfe8ff', '#1a1d24', 1.2));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
    sun.position.set(-400, 700, 500);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);
    three.current = { renderer, scene, camera, controls, content: null, span: 400, streetY: 0 };
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    const resize = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    resize.observe(el);
    return () => {
      resize.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      if (three.current?.content) disposeLandScene(three.current.content);
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // Rebuild the site whenever the plan or a toggle changes.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (t.content) {
      t.scene.remove(t.content);
      disposeLandScene(t.content);
    }
    const built = buildLandScene(inputs, result, options);
    t.scene.add(built.group);
    t.content = built.group;
    t.span = built.span;
    t.streetY = built.streetY;
    const sun = t.scene.children.find((c) => c instanceof THREE.DirectionalLight) as
      THREE.DirectionalLight | undefined;
    if (sun) {
      const s = built.span * 0.75;
      Object.assign(sun.shadow.camera, {
        left: -s,
        right: s,
        top: s,
        bottom: -s,
        far: built.span * 4,
      });
      sun.position.set(-built.span * 0.6, built.span, built.span * 0.8);
      sun.shadow.camera.updateProjectionMatrix();
    }
  }, [inputs, result, options]);

  // Camera presets.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const s = t.span;
    const { depthFt } = inputs.parcel;
    if (view === 'street') {
      // Stand on the existing street at the middle of the frontage, eye height, looking in.
      t.camera.position.set(0, t.streetY + 6, depthFt / 2 + 32);
      t.controls.target.set(0, t.streetY + 6, 0);
    } else if (view === 'underground') {
      t.camera.position.set(-s * 0.55, s * 0.35, s * 0.75);
      t.controls.target.set(0, 0, 0);
    } else {
      t.camera.position.set(-s * 0.55, s * 1.05, s * 1.15);
      t.controls.target.set(0, 0, 0);
    }
    t.controls.maxDistance = s * 4;
    t.controls.update();
    // Re-run when the parcel size changes so the framing fits.
  }, [view, inputs.parcel]);

  return (
    <div className="lf-viewer" ref={host}>
      {failed && <p className="wb-muted lf-viewer__fail">{failed}</p>}
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  return (
    <label className="lf-field">
      <span>
        {label}
        {suffix ? <em> ({suffix})</em> : null}
      </span>
      <input
        className="wb-input"
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

const PLANS: { id: ExitPlan; label: string }[] = [
  { id: 'sell_pads', label: 'Sell finished pads' },
  { id: 'build_sell', label: 'Build and sell homes' },
  { id: 'build_hold', label: 'Build and hold (rent)' },
];

export function LandFeasibility({
  lot,
  home,
  homePrice,
}: {
  lot: StudioLot | null;
  /** The current House Studio house: footprint and build cost. */
  home: { widthFt: number; depthFt: number; buildCost: number };
  homePrice: number;
}) {
  const { api } = useApi();
  const [open, setOpen] = useState(true);
  const [parcel, setParcel] = useState(() =>
    lot ? { widthFt: lot.widthFt, depthFt: lot.depthFt } : { widthFt: 400, depthFt: 320 },
  );
  const [rules, setRules] = useState<ZoningRules>(DEFAULT_RULES);
  const [corners, setCorners] = useState({ fl: 500, fr: 500, bl: 500, br: 500 });
  const [usgs, setUsgs] = useState<Terrain | null>(null);
  const [flood, setFlood] = useState<FeasibilityInputs['flood']>(null);
  const [floodSource, setFloodSource] = useState<string | null>(null);
  const [treeCoverPct, setTreeCoverPct] = useState(40);
  const [landPrice, setLandPrice] = useState(500_000);
  const [costs, setCosts] = useState<CostLine[]>(() => DEFAULT_COSTS.map((c) => ({ ...c })));
  const [layout, setLayout] = useState<LayoutChoice>('auto');
  const [plan, setPlan] = useState<ExitPlan>('sell_pads');
  const [revenue, setRevenue] = useState({
    padPrice: 120_000,
    homePrice: homePrice > 0 ? homePrice : 450_000,
    monthlyRent: 2800,
    rentExpensePct: 35,
    capRatePct: 6,
    sellingCostPct: 5,
  });
  const [timeline, setTimeline] = useState({
    approvalMonths: 6,
    siteWorkMonths: 6,
    buildMonths: 8,
    absorptionPerMonth: 1,
    interestPct: 9,
  });
  const [options, setOptions] = useState<LandSceneOptions>({
    trees: true,
    heatmap: false,
    labels: true,
    underground: false,
    exaggeration: 3,
  });
  const [view, setView] = useState<View>('aerial');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Follow the House Studio lot and sale price when the builder changes them (adjusting state
  // while rendering, as React recommends, instead of in an effect).
  const [seenLot, setSeenLot] = useState(lot);
  if (lot !== seenLot) {
    setSeenLot(lot);
    if (lot) setParcel({ widthFt: lot.widthFt, depthFt: lot.depthFt });
  }
  const [seenPrice, setSeenPrice] = useState(homePrice);
  if (homePrice !== seenPrice) {
    setSeenPrice(homePrice);
    if (homePrice > 0) setRevenue((r) => ({ ...r, homePrice }));
  }

  const terrain = useMemo<Terrain>(
    () =>
      usgs ??
      cornerTerrain(
        corners.fl,
        corners.fr,
        corners.bl,
        corners.br,
        'Corner heights entered by hand',
      ),
    [usgs, corners],
  );

  const inputs = useMemo<FeasibilityInputs>(
    () => ({
      parcel,
      rules,
      terrain,
      treeCoverPct,
      flood,
      home,
      landPrice,
      costs,
      layout,
      plan,
      revenue,
      timeline,
    }),
    [
      parcel,
      rules,
      terrain,
      treeCoverPct,
      flood,
      home,
      landPrice,
      costs,
      layout,
      plan,
      revenue,
      timeline,
    ],
  );
  const result = useMemo(() => runFeasibility(inputs), [inputs]);
  const sceneOptions = useMemo(
    () => ({ ...options, underground: options.underground || view === 'underground' }),
    [options, view],
  );

  async function pullGround() {
    if (!lot || lot.lat === null || lot.lon === null) {
      setNote(
        'Find the lot address in the Lot tab below first. The ground heights come from that point.',
      );
      return;
    }
    setBusy(true);
    setNote('Asking USGS for ground heights and FEMA for the flood zone…');
    try {
      const out = await api.post(
        '/v1/site/terrain',
        {
          lat: lot.lat,
          lon: lot.lon,
          widthFt: parcel.widthFt,
          depthFt: parcel.depthFt,
          samples: 5,
        },
        { schema: SiteTerrainResponseSchema },
      );
      const grid = fillGrid(out.grid);
      if (grid) setUsgs({ grid, source: `${out.source} (${out.sourceUrl})` });
      setFlood(out.flood ? { zone: out.flood.zone, specialHazard: out.flood.specialHazard } : null);
      setFloodSource(out.flood ? `${out.flood.source} (${out.flood.sourceUrl})` : null);
      setNote(out.message);
    } catch (e) {
      setNote(problemText(e));
    } finally {
      setBusy(false);
    }
  }

  const setRule = (k: keyof ZoningRules, v: number | string) => setRules((r) => ({ ...r, [k]: v }));
  const setCost = (i: number, patch: Partial<CostLine>) =>
    setCosts((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const rise = terrain.grid.flat();
  const relief = rise.length ? Math.max(...rise) - Math.min(...rise) : 0;
  const lowest = Math.min(0, ...result.months.map((m) => m.cumulative));
  const highest = Math.max(1, ...result.months.map((m) => m.cumulative));

  return (
    <section className="wb lf" aria-labelledby="lf-title">
      <div className="lf-head">
        <div>
          <h2 id="lf-title">Land feasibility</h2>
          <p className="wb-muted">
            What you can build on this land, how it sits on the ground, and what it earns. Every
            cost line shows where its price came from.
          </p>
        </div>
        <button
          type="button"
          className="hs-pill"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div className="lf-body">
          <div className="lf-summary" role="status">
            <div>
              <span>Lots that pass</span>
              <strong>
                {result.passingLots} of {result.lotCount}
              </strong>
            </div>
            <div>
              <span>{plan === 'build_hold' ? 'Value at cap rate' : 'Revenue'}</span>
              <strong>{money(result.revenue)}</strong>
            </div>
            <div>
              <span>All-in cost</span>
              <strong>{money(result.totalCost)}</strong>
            </div>
            <div className={result.profit >= 0 ? 'lf-good' : 'lf-bad'}>
              <span>Profit</span>
              <strong>{money(result.profit)}</strong>
            </div>
            <div>
              <span>Margin</span>
              <strong>{result.marginPct.toFixed(1)}%</strong>
            </div>
            <div>
              <span>Cash needed (peak)</span>
              <strong>{money(result.peakEquity)}</strong>
            </div>
          </div>

          <div className="lf-grid">
            <div className="lf-3d">
              <div className="lf-toolbar" role="group" aria-label="Site view">
                {(['aerial', 'street', 'underground'] as View[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`hs-pill${view === v ? ' is-on' : ''}`}
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                  >
                    {v === 'aerial' ? 'Aerial' : v === 'street' ? 'Street view' : 'Underground'}
                  </button>
                ))}
                {(
                  [
                    ['trees', 'Trees'],
                    ['heatmap', 'Slope heatmap'],
                    ['labels', 'Labels'],
                  ] as [keyof LandSceneOptions, string][]
                ).map(([k, text]) => (
                  <label key={k} className="lf-check">
                    <input
                      type="checkbox"
                      checked={Boolean(options[k])}
                      onChange={(e) => setOptions((o) => ({ ...o, [k]: e.target.checked }))}
                    />
                    {text}
                  </label>
                ))}
                <label className="lf-check">
                  Height ×
                  <select
                    value={options.exaggeration}
                    onChange={(e) =>
                      setOptions((o) => ({ ...o, exaggeration: Number(e.target.value) }))
                    }
                  >
                    {[1, 2, 3, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <LandViewer inputs={inputs} result={result} options={sceneOptions} view={view} />
              <p className="wb-muted lf-legend">
                Lot lines: <b className="lf-key lf-key--ok">passes</b>{' '}
                <b className="lf-key lf-key--warn">flood warning</b>{' '}
                <b className="lf-key lf-key--bad">breaks a rule</b>. Blue dashed box = buildable
                area.
                {options.heatmap &&
                  ' Heatmap: green flat, yellow and orange steeper, red over the building limit.'}
                {(options.underground || view === 'underground') &&
                  ' Underground: blue water, green sewer. Lines are schematic until the city utility map is added.'}{' '}
                Height is drawn {options.exaggeration}× so slopes show.
              </p>
            </div>

            <div className="lf-inputs">
              <div className="wb-card">
                <h3>Land and ground</h3>
                <div className="lf-fields">
                  <Num
                    label="Frontage"
                    suffix="ft"
                    value={parcel.widthFt}
                    min={20}
                    onChange={(n) => setParcel((p) => ({ ...p, widthFt: Math.max(20, n) }))}
                  />
                  <Num
                    label="Depth"
                    suffix="ft"
                    value={parcel.depthFt}
                    min={20}
                    onChange={(n) => setParcel((p) => ({ ...p, depthFt: Math.max(20, n) }))}
                  />
                  <Num
                    label="Land price"
                    suffix="$"
                    step={1000}
                    value={landPrice}
                    onChange={setLandPrice}
                  />
                  <Num
                    label="Tree cover"
                    suffix="%"
                    value={treeCoverPct}
                    onChange={(n) => setTreeCoverPct(Math.min(100, n))}
                  />
                </div>
                <p className="wb-muted">
                  {result.acres.toFixed(2)} acres · {relief.toFixed(1)} ft of relief · ground:{' '}
                  {terrain.source}
                </p>
                <div className="wb-actions">
                  <button
                    type="button"
                    className="hs-pill"
                    onClick={() => void pullGround()}
                    disabled={busy}
                  >
                    {busy ? 'Pulling…' : 'Pull real ground heights + flood zone'}
                  </button>
                  {usgs && (
                    <button type="button" className="hs-pill" onClick={() => setUsgs(null)}>
                      Use hand-entered corners
                    </button>
                  )}
                </div>
                {note && (
                  <p className="wb-muted" role="status">
                    {note}
                  </p>
                )}
                {flood && (
                  <p className={flood.specialHazard ? 'lf-bad' : 'wb-muted'}>
                    FEMA flood zone {flood.zone}
                    {flood.specialHazard ? ': special flood hazard area.' : '.'}{' '}
                    {floodSource && <span className="wb-muted">Source: {floodSource}</span>}
                  </p>
                )}
                {!usgs && (
                  <div className="lf-fields">
                    <Num
                      label="Front-left height"
                      suffix="ft"
                      value={corners.fl}
                      onChange={(n) => setCorners((c) => ({ ...c, fl: n }))}
                    />
                    <Num
                      label="Front-right height"
                      suffix="ft"
                      value={corners.fr}
                      onChange={(n) => setCorners((c) => ({ ...c, fr: n }))}
                    />
                    <Num
                      label="Back-left height"
                      suffix="ft"
                      value={corners.bl}
                      onChange={(n) => setCorners((c) => ({ ...c, bl: n }))}
                    />
                    <Num
                      label="Back-right height"
                      suffix="ft"
                      value={corners.br}
                      onChange={(n) => setCorners((c) => ({ ...c, br: n }))}
                    />
                  </div>
                )}
              </div>

              <div className="wb-card">
                <h3>Zoning rules (CodeCheck)</h3>
                <div className="lf-fields">
                  <Num
                    label="Min lot size"
                    suffix="sq ft"
                    step={100}
                    value={rules.minLotSqft}
                    onChange={(n) => setRule('minLotSqft', Math.max(500, n))}
                  />
                  <Num
                    label="Min lot width"
                    suffix="ft"
                    value={rules.minLotWidthFt}
                    onChange={(n) => setRule('minLotWidthFt', Math.max(10, n))}
                  />
                  <Num
                    label="Front setback"
                    suffix="ft"
                    value={rules.frontSetbackFt}
                    onChange={(n) => setRule('frontSetbackFt', n)}
                  />
                  <Num
                    label="Side setback"
                    suffix="ft"
                    value={rules.sideSetbackFt}
                    onChange={(n) => setRule('sideSetbackFt', n)}
                  />
                  <Num
                    label="Rear setback"
                    suffix="ft"
                    value={rules.rearSetbackFt}
                    onChange={(n) => setRule('rearSetbackFt', n)}
                  />
                  <Num
                    label="Max building slope"
                    suffix="%"
                    value={rules.maxBuildSlopePct}
                    onChange={(n) => setRule('maxBuildSlopePct', Math.max(1, n))}
                  />
                  <Num
                    label="Max lot coverage"
                    suffix="%"
                    value={rules.maxCoveragePct}
                    onChange={(n) => setRule('maxCoveragePct', Math.min(100, Math.max(1, n)))}
                  />
                  <Num
                    label="New street width"
                    suffix="ft"
                    value={rules.roadWidthFt}
                    onChange={(n) => setRule('roadWidthFt', Math.max(20, n))}
                  />
                </div>
                <label className="lf-field lf-field--wide">
                  <span>Where these rules come from</span>
                  <input
                    className="wb-input"
                    value={rules.source}
                    onChange={(e) => setRule('source', e.target.value)}
                  />
                </label>
                <label className="lf-field">
                  <span>Lot layout</span>
                  <select
                    className="wb-input"
                    value={layout}
                    onChange={(e) => setLayout(e.target.value as LayoutChoice)}
                  >
                    <option value="auto">Best fit (most lots that pass)</option>
                    <option value="street_front">One row on the existing street</option>
                    <option value="new_road">New street through the middle</option>
                  </select>
                </label>
                <p className="wb-muted">{result.layout.note}</p>
              </div>
            </div>
          </div>

          <div className="wb-card wb-table-card">
            <h3>Lots</h3>
            <div className="wb-table-wrap">
              <table className="wb-table">
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Size</th>
                    <th>Frontage</th>
                    <th>Pad slope</th>
                    <th>Cut / fill</th>
                    <th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {result.layout.lots.map((l) => (
                    <tr
                      key={l.number}
                      className={
                        passes(l) ? (l.issues.length ? 'lf-row--warn' : '') : 'lf-row--bad'
                      }
                    >
                      <td>{l.number}</td>
                      <td>{Math.round(l.areaSqft).toLocaleString()} sq ft</td>
                      <td>{Math.round(l.frontageFt)} ft</td>
                      <td>{l.slopePct.toFixed(1)}%</td>
                      <td>
                        {Math.round(l.cutCy)} / {Math.round(l.fillCy)} cy
                      </td>
                      <td>
                        {l.issues.length === 0
                          ? 'Passes'
                          : l.issues.map((i) => (
                              <span key={i.rule} className="lf-issue">
                                <b>{i.rule}:</b> {i.why} <em>Fix: {i.fix}</em>
                              </span>
                            ))}
                      </td>
                    </tr>
                  ))}
                  {result.layout.lots.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        No lot fits these rules. Lower the minimum lot size or width, or use a
                        larger parcel.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="wb-muted">Rules: {rules.source}</p>
          </div>

          <div className="lf-grid">
            <div className="wb-card wb-table-card">
              <h3>Development cost</h3>
              <p className="wb-muted">
                Change any price or source. Lots that break a rule are left as open space and not
                priced.
              </p>
              <div className="wb-table-wrap">
                <table className="wb-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quantity</th>
                      <th>Unit price</th>
                      <th>Total</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.costRows.map((row) => {
                      const i = costs.findIndex((c) => c.id === row.id);
                      const editable = i >= 0;
                      return (
                        <tr key={row.id}>
                          <td>{row.label}</td>
                          <td>
                            {row.unit.startsWith('%')
                              ? '—'
                              : `${Math.round(row.quantity).toLocaleString()} ${row.unit}`}
                          </td>
                          <td>
                            {editable ? (
                              <input
                                className="wb-input lf-cost"
                                type="number"
                                min={0}
                                value={costs[i]!.unitCost}
                                aria-label={`${row.label} price`}
                                onChange={(e) =>
                                  setCost(i, { unitCost: Math.max(0, Number(e.target.value) || 0) })
                                }
                              />
                            ) : (
                              money(row.unitCost)
                            )}
                            {row.unit.startsWith('%') ? ' %' : ''}
                          </td>
                          <td>{money(row.total)}</td>
                          <td>
                            {editable ? (
                              <input
                                className="wb-input"
                                value={costs[i]!.source}
                                aria-label={`${row.label} source`}
                                onChange={(e) => setCost(i, { source: e.target.value })}
                              />
                            ) : (
                              row.source
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td>Interest carry ({timeline.interestPct}%/yr on cash out)</td>
                      <td>—</td>
                      <td>—</td>
                      <td>{money(result.interest)}</td>
                      <td>Your loan rate</td>
                    </tr>
                    {result.sellingCost > 0 && (
                      <tr>
                        <td>Selling costs ({revenue.sellingCostPct}%)</td>
                        <td>—</td>
                        <td>—</td>
                        <td>{money(result.sellingCost)}</td>
                        <td>Your broker and closing costs</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="wb-muted">
                Earthwork: {Math.round(result.cutCy).toLocaleString()} cy cut,{' '}
                {Math.round(result.fillCy).toLocaleString()} cy fill, from ground heights vs flat
                house pads.
              </p>
            </div>

            <div className="wb-card">
              <h3>Exit plan and timeline</h3>
              <div className="lf-plans" role="radiogroup" aria-label="Exit plan">
                {PLANS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={plan === p.id}
                    className={`hs-pill${plan === p.id ? ' is-on' : ''}`}
                    onClick={() => setPlan(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="lf-fields">
                {plan === 'sell_pads' && (
                  <Num
                    label="Pad sale price"
                    suffix="$ each"
                    step={1000}
                    value={revenue.padPrice}
                    onChange={(n) => setRevenue((r) => ({ ...r, padPrice: n }))}
                  />
                )}
                {plan === 'build_sell' && (
                  <Num
                    label="Home sale price"
                    suffix="$ each"
                    step={1000}
                    value={revenue.homePrice}
                    onChange={(n) => setRevenue((r) => ({ ...r, homePrice: n }))}
                  />
                )}
                {plan === 'build_hold' && (
                  <>
                    <Num
                      label="Rent"
                      suffix="$ / month"
                      step={50}
                      value={revenue.monthlyRent}
                      onChange={(n) => setRevenue((r) => ({ ...r, monthlyRent: n }))}
                    />
                    <Num
                      label="Operating costs"
                      suffix="% of rent"
                      value={revenue.rentExpensePct}
                      onChange={(n) =>
                        setRevenue((r) => ({ ...r, rentExpensePct: Math.min(95, n) }))
                      }
                    />
                    <Num
                      label="Cap rate"
                      suffix="%"
                      step={0.25}
                      value={revenue.capRatePct}
                      onChange={(n) => setRevenue((r) => ({ ...r, capRatePct: n }))}
                    />
                  </>
                )}
                {plan !== 'build_hold' && (
                  <Num
                    label="Selling costs"
                    suffix="%"
                    step={0.5}
                    value={revenue.sellingCostPct}
                    onChange={(n) => setRevenue((r) => ({ ...r, sellingCostPct: n }))}
                  />
                )}
                <Num
                  label="Approvals"
                  suffix="months"
                  value={timeline.approvalMonths}
                  onChange={(n) => setTimeline((t) => ({ ...t, approvalMonths: n }))}
                />
                <Num
                  label="Site work"
                  suffix="months"
                  value={timeline.siteWorkMonths}
                  onChange={(n) => setTimeline((t) => ({ ...t, siteWorkMonths: Math.max(1, n) }))}
                />
                {plan !== 'sell_pads' && (
                  <Num
                    label="Home construction"
                    suffix="months"
                    value={timeline.buildMonths}
                    onChange={(n) => setTimeline((t) => ({ ...t, buildMonths: Math.max(1, n) }))}
                  />
                )}
                <Num
                  label={plan === 'build_hold' ? 'Leased per month' : 'Sold per month'}
                  step={0.5}
                  value={timeline.absorptionPerMonth}
                  onChange={(n) =>
                    setTimeline((t) => ({ ...t, absorptionPerMonth: Math.max(0.1, n) }))
                  }
                />
                <Num
                  label="Loan rate"
                  suffix="%/yr"
                  step={0.25}
                  value={timeline.interestPct}
                  onChange={(n) => setTimeline((t) => ({ ...t, interestPct: n }))}
                />
              </div>
              {plan !== 'sell_pads' && (
                <p className="wb-muted">
                  Home cost {money(home.buildCost)} each comes from the House Studio estimate for
                  the current house.
                </p>
              )}
              {result.hold && (
                <p className="wb-muted">
                  Net rent {money(result.hold.noi)}/yr · cash-on-cost{' '}
                  {result.hold.cashOnCashPct.toFixed(1)}% · value {money(result.hold.value)} at a{' '}
                  {revenue.capRatePct}% cap rate.
                </p>
              )}
              <h3>Cash balance by month</h3>
              <svg
                className="lf-chart"
                viewBox={`0 0 ${Math.max(1, result.months.length) * 10} 120`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Cash balance over ${result.months.length} months; lowest ${money(lowest)}, ending ${money(result.months.at(-1)?.cumulative ?? 0)}.`}
              >
                {result.months.map((m, i) => {
                  const zero = (highest / (highest - lowest)) * 110 + 5;
                  const h = (Math.abs(m.cumulative) / (highest - lowest)) * 110;
                  return (
                    <rect
                      key={m.month}
                      x={i * 10 + 1}
                      width={8}
                      y={m.cumulative >= 0 ? zero - h : zero}
                      height={Math.max(0.5, h)}
                      fill={m.cumulative >= 0 ? '#3fb27f' : '#e5484d'}
                    >
                      <title>{`Month ${m.month}: ${money(m.cumulative)}`}</title>
                    </rect>
                  );
                })}
              </svg>
              <p className="wb-muted">
                Month 0 buys the land. Red bars are cash still out; green is cash back. Ends at{' '}
                {money(result.months.at(-1)?.cumulative ?? 0)} after {result.months.length - 1}{' '}
                months.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
