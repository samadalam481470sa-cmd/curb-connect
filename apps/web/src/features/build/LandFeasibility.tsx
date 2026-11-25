'use client';
// Land feasibility: what can be built on a piece of land and what it earns. Pulls real ground
// heights (USGS 3DEP) and the FEMA flood zone for the lot, lays out lots against the zoning
// rules, flags any lot that breaks a rule with the reason and a fix, and prices the site work
// with a source on every line. Shown in 3D with slope heatmap, trees, labels and underground lines.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SiteTerrainResponseSchema, type StudioLot } from '@fieldline/contracts';
import {
  ConceptPlanResponseSchema,
  LandFeasibilityProjectListSchema,
  SavedLandFeasibilityProjectSchema,
  type ConceptPlanRequest,
  type SavedLandFeasibilityProject,
} from '@fieldline/contracts';
import { z } from 'zod';
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
import { planSubdivision } from './subdivision';
import {
  STAGE_LABELS,
  assignPhases,
  lotStageAtMonth,
  phaseStageAtMonth,
  phaseUnderwriting,
  type LotStage,
} from './phases';
import { underwrite } from './underwriting';
import { farmScenario } from './farmScenario';
import { shortStay } from './shortStay';
import {
  DECISION_CLASSES,
  DECISION_LAYER_NOTE,
  decisionClass,
  decisionShares,
  normalizeZoneRect,
  zoneAcres,
  type DecisionClassId,
  type DecisionZone,
} from './decisionClasses';
import { mainLinePoints, slopeBands, trenchDepthCheck } from './slopeGrading';
import { StreamCrossings, SiteStreamsResponseSchema, type SiteStreamsResponse } from './StreamCrossings';
import { SewerDepthInput } from './SewerDepthInput';
import { SavedFeasibilityProjects } from './SavedFeasibilityProjects';
import { problemText } from './StudioHouses';
import {
  bufferLonLatRing,
  geodesicAreaAcres,
  meanLonLat,
  parseGeoJsonPolygons,
  projectRing,
  tangentPlane,
  type LonLat,
} from '@fieldline/geometry';

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
  // Subdivision quick plan + underwriting: defaults from the zoning rules above, HOA blank (0).
  const [subTargetLotSqft, setSubTargetLotSqft] = useState(8000);
  const [subRoadsPct, setSubRoadsPct] = useState(15);
  const [subShow3d, setSubShow3d] = useState(false);
  const [hoaMonthly, setHoaMonthly] = useState(0);
  // Sewer depth (contractor-entered; blank/0 = no effect) + saved feasibility projects.
  const [sewerDepth, setSewerDepth] = useState({ depthFt: 0, extraCostPerFtPerLf: 0 });
  // Geodesic parcel area + setback buffer (QGIS QgsDistanceArea / GEOS buffer ideas):
  // the rectangle's true ellipsoidal area, and the buildable area after a setback inset.
  // Roof facets stay on the tangent plane (house-scale difference is far under 0.01%);
  // for a multi-acre parcel the ellipsoid figure is the honest one.
  const [setbackFt, setSetbackFt] = useState(0);
  const [parcelImport, setParcelImport] = useState<{
    acres: number;
    vertices: number;
    name: string;
  } | null>(null);
  const [parcelImportMessage, setParcelImportMessage] = useState<string | null>(null);
  const [projects, setProjects] = useState<SavedLandFeasibilityProject[]>([]);
  const [projectName, setProjectName] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  // Stream/waterway crossings from USGS NHD, pulled with the ground heights.
  const [streams, setStreams] = useState<SiteStreamsResponse | null>(null);
  const [streamsBusy, setStreamsBusy] = useState(false);
  // Build phases + timeline playback: phase count 2 by default when the plan has
  // at least 2 lots, else 1. Playback only visualizes the timeline — it never
  // changes the cash-flow computation.
  const [phaseCountInput, setPhaseCountInput] = useState(2);
  const [playMonth, setPlayMonth] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Farm (agriculture) scenario: every figure contractor-entered, blank = no scenario.
  const [farmInputs, setFarmInputs] = useState({
    incomePerAcreYear: 0,
    costPerAcreYear: 0,
    holdYears: 5,
    appreciationPctPerYear: 0,
    sellingCostPct: 5,
  });
  // Short-stay (nightly rental) scenario: rates contractor-entered; units 0 = passing lots.
  const [stayInputs, setStayInputs] = useState({
    units: 0,
    nightlyRate: 0,
    occupancyPct: 0,
    expensePct: 0,
  });
  // Land decision-class layer: contractor-painted zones (judgment, not measured data).
  const [zones, setZones] = useState<DecisionZone[]>([]);
  const [paintClass, setPaintClass] = useState<DecisionClassId>('cultivated');
  const [showZones3d, setShowZones3d] = useState(false);
  const [draftZone, setDraftZone] = useState<{ x: number; z: number; x2?: number; z2?: number } | null>(null);
  const [zoneNums, setZoneNums] = useState({ x0: 0, z0: 0, widthFt: 100, depthFt: 100 });
  const zoneSeq = useRef(0);
  // Concept site plan PDF export.
  const [orgName, setOrgName] = useState('');
  const [conceptBusy, setConceptBusy] = useState(false);
  const [conceptNote, setConceptNote] = useState<string | null>(null);

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
      sewerDepth,
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
      sewerDepth,
      layout,
      plan,
      revenue,
      timeline,
    ],
  );
  const result = useMemo(() => runFeasibility(inputs), [inputs]);
  const subPlan = useMemo(
    () =>
      planSubdivision(parcel, {
        targetLotSqft: subTargetLotSqft,
        minLotWidthFt: rules.minLotWidthFt,
        roadsAllowancePct: subRoadsPct,
        roadWidthFt: rules.roadWidthFt,
      }),
    [parcel, subTargetLotSqft, rules.minLotWidthFt, subRoadsPct, rules.roadWidthFt],
  );
  const grading = useMemo(
    () => slopeBands(terrain, parcel, rules.maxBuildSlopePct),
    [terrain, parcel, rules.maxBuildSlopePct],
  );
  // Geodesic area of the parcel rectangle on the WGS84 ellipsoid, plus the buildable area
  // after the setback inset (a negative turf buffer). Needs the lot's lat/lon; otherwise
  // the rectangle acres above are the only figure.
  const geodesicParcel = useMemo(() => {
    if (!lot || lot.lat === null || lot.lon === null || parcel.widthFt <= 0 || parcel.depthFt <= 0) return null;
    try {
      const plane = tangentPlane({ lon: lot.lon, lat: lot.lat });
      const hw = parcel.widthFt * 0.3048 / 2;
      const hd = parcel.depthFt * 0.3048 / 2;
      const ring: LonLat[] = [
        plane.unproject({ x: -hw, y: -hd }),
        plane.unproject({ x: hw, y: -hd }),
        plane.unproject({ x: hw, y: hd }),
        plane.unproject({ x: -hw, y: hd }),
      ];
      const acres = geodesicAreaAcres(ring);
      let buildableAcres: number | null = null;
      if (setbackFt > 0) {
        // A buffer can come back as several rings; the buildable area is the largest.
        const buffered = bufferLonLatRing(ring, -(setbackFt * 0.3048));
        if (buffered.length > 0) {
          buildableAcres = Math.max(...buffered.map((r) => geodesicAreaAcres(r)));
        }
      }
      return { acres, buildableAcres };
    } catch {
      return null;
    }
  }, [lot, parcel.widthFt, parcel.depthFt, setbackFt]);

  /** Import a GeoJSON parcel outline: frontage/depth come from its bounding box. */
  const importParcelGeoJson = async (file: File) => {
    setParcelImportMessage(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setParcelImportMessage(`Could not read ${file.name}: not valid JSON.`);
      return;
    }
    const { polygons, errors } = parseGeoJsonPolygons(parsed);
    if (polygons.length === 0) {
      setParcelImportMessage(`No usable polygons in ${file.name}. ${errors.join(' ')}`);
      return;
    }
    const ring = polygons[0]!;
    try {
      const center = meanLonLat(ring);
      const { points } = projectRing(ring, center);
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const widthFt = (Math.max(...xs) - Math.min(...xs)) / 0.3048;
      const depthFt = (Math.max(...ys) - Math.min(...ys)) / 0.3048;
      const acres = geodesicAreaAcres(ring);
      setParcel((p) => ({ ...p, widthFt: Math.max(20, Math.round(widthFt)), depthFt: Math.max(20, Math.round(depthFt)) }));
      setParcelImport({ acres, vertices: ring.length, name: file.name });
      const skipped = errors.length > 0 ? ` Skipped: ${errors.join(' ')}` : '';
      const extra = polygons.length > 1 ? ` Only the first of ${polygons.length} polygons was used.` : '';
      setParcelImportMessage(
        `Imported parcel outline from ${file.name}: ${ring.length} vertices, ${acres.toFixed(2)} acres (geodesic, WGS84 ellipsoid). Frontage and depth were set from its bounding box — check them against the survey.${extra}${skipped}`,
      );
    } catch (e) {
      setParcelImportMessage(
        `Could not use ${file.name}: ${e instanceof Error ? e.message : 'invalid outline'}.`,
      );
    }
  };
  const dealMonths = Math.max(0, result.months.length - 1);
  const uw = useMemo(
    () =>
      underwrite({
        land: landPrice,
        sitework: result.siteCost,
        verticalBuild: result.costRows.find((r) => r.id === 'homes')?.total ?? 0,
        selling: result.sellingCost,
        hoaMonthlyPerLot: hoaMonthly,
        lotCount: result.passingLots,
        carryMonths: dealMonths,
        financing: result.interest,
        revenue: result.revenue,
        peakEquity: result.peakEquity,
        durationMonths: dealMonths,
        cumulativeByMonth: result.months.map((m) => m.cumulative),
      }),
    [landPrice, result, hoaMonthly, dealMonths],
  );
  // Farm scenario + short-stay case: pure math on the same run, contractor-entered rates.
  const farm = useMemo(
    () => farmScenario({ landPrice, acres: result.acres, ...farmInputs }),
    [landPrice, result.acres, farmInputs],
  );
  const stayUnits = stayInputs.units > 0 ? stayInputs.units : result.passingLots;
  const stay = useMemo(
    () =>
      shortStay({
        units: stayUnits,
        nightlyRate: stayInputs.nightlyRate,
        occupancyPct: stayInputs.occupancyPct,
        expensePct: stayInputs.expensePct,
        totalInvested: result.totalCost,
        capRatePct: revenue.capRatePct,
      }),
    [stayUnits, stayInputs, result.totalCost, revenue.capRatePct],
  );
  // Deepest trench cut along the main, from the entered sewer depth + ground heights.
  const trench = useMemo(
    () => trenchDepthCheck(terrain, parcel, mainLinePoints(result.layout, parcel), sewerDepth.depthFt),
    [terrain, parcel, result.layout, sewerDepth.depthFt],
  );
  const zoneShares = useMemo(() => decisionShares(zones, parcel), [zones, parcel]);
  // Build phases, prorated from the same underwriting inputs as the whole deal.
  const phaseCount = subPlan.lots.length >= 2 ? phaseCountInput : 1;
  const phased = useMemo(
    () => assignPhases(subPlan, phaseCount),
    [subPlan, phaseCount],
  );
  const phaseTimeline = useMemo(
    () => ({ ...timeline, totalMonths: dealMonths, lotCount: subPlan.lots.length }),
    [timeline, dealMonths, subPlan.lots.length],
  );
  const playMonthClamped = Math.min(Math.max(0, Math.floor(playMonth)), dealMonths);
  const playStage = phaseStageAtMonth(playMonthClamped, phaseTimeline);
  const lotPhaseStage = useMemo<Record<number, LotStage>>(() => {
    const stages: Record<number, LotStage> = {};
    for (const lot of subPlan.lots) {
      stages[lot.number] = lotStageAtMonth(
        playMonthClamped,
        phased.lotPhaseIndex[lot.number] ?? 0,
        Math.max(1, phased.phases.length),
        phaseTimeline,
      );
    }
    return stages;
  }, [subPlan, phased, playMonthClamped, phaseTimeline]);
  const phaseRows = useMemo(
    () =>
      phased.phases.map((phase) => ({
        phase,
        uw: phaseUnderwriting(phase, {
          land: landPrice,
          sitework: result.siteCost,
          verticalBuild: result.costRows.find((r) => r.id === 'homes')?.total ?? 0,
          selling: result.sellingCost,
          hoaMonthlyPerLot: hoaMonthly,
          totalLotCount: subPlan.lots.length,
          carryMonths: dealMonths,
          financing: result.interest,
          revenue: result.revenue,
          peakEquity: result.peakEquity,
          durationMonths: dealMonths,
        }),
      })),
    [phased, landPrice, result, hoaMonthly, subPlan.lots.length, dealMonths],
  );
  useEffect(() => {
    if (!playing || playMonthClamped >= dealMonths) return;
    const id = window.setTimeout(
      () => setPlayMonth((m) => Math.min(m + 1, dealMonths)),
      900,
    );
    return () => window.clearTimeout(id);
  }, [playing, playMonthClamped, dealMonths]);
  const sceneOptions = useMemo(
    () => ({
      ...options,
      underground: options.underground || view === 'underground',
      subdivision: subShow3d ? subPlan : null,
      subdivisionPhaseColors: subShow3d ? phased.lotPhaseColor : null,
      phaseStage: subShow3d ? lotPhaseStage : null,
      decisionZones: showZones3d ? zones : null,
    }),
    [options, view, subShow3d, subPlan, phased, lotPhaseStage, showZones3d, zones],
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
    // Streams ride along with the ground pull, but never overwrite its note: a failed
    // NHD query leaves the previous crossings in place and the component says so.
    setStreamsBusy(true);
    try {
      setStreams(
        await api.post(
          '/v1/site/streams',
          { lat: lot.lat, lon: lot.lon, widthFt: parcel.widthFt, depthFt: parcel.depthFt },
          { schema: SiteStreamsResponseSchema },
        ),
      );
    } catch {
      // Leave the previous value; the component shows its own unavailable state on the next pull.
    } finally {
      setStreamsBusy(false);
    }
  }

  // Saved feasibility projects: load the company's list once; save/delete update it locally.
  useEffect(() => {
    let cancelled = false;
    api
      .get('/v1/land-feasibility/projects', { schema: LandFeasibilityProjectListSchema })
      .then((list) => {
        if (!cancelled) setProjects(list.items);
      })
      .catch(() => {
        if (!cancelled) setNote('Could not load saved feasibility projects.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function saveProject() {
    const name = projectName.trim();
    if (!name) {
      setNote('Name the project before saving.');
      return;
    }
    setProjectBusy(true);
    try {
      const summary = { acres: result.acres, lotCount: result.passingLots, profit: result.profit };
      const saved = await api.post(
        '/v1/land-feasibility/projects',
        { name: name.slice(0, 120), inputs, summary },
        { schema: SavedLandFeasibilityProjectSchema },
      );
      setProjects((p) => [saved, ...p]);
      setNote(`Saved “${saved.name}”.`);
    } catch (e) {
      setNote(problemText(e));
    } finally {
      setProjectBusy(false);
    }
  }

  async function deleteProject(id: string) {
    setProjectBusy(true);
    try {
      await api.delete(`/v1/land-feasibility/projects/${id}`, {
        schema: z.object({ ok: z.boolean() }),
      });
      setProjects((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setNote(problemText(e));
    } finally {
      setProjectBusy(false);
    }
  }

  function loadProject(p: SavedLandFeasibilityProject) {
    const i = p.inputs;
    setParcel(i.parcel);
    setRules(i.rules);
    setTreeCoverPct(i.treeCoverPct);
    setFlood(i.flood);
    setFloodSource(null);
    setLandPrice(i.landPrice);
    setCosts(i.costs.map((c) => ({ ...c })));
    setSewerDepth(i.sewerDepth ?? { depthFt: 0, extraCostPerFtPerLf: 0 });
    setLayout(i.layout);
    setPlan(i.plan);
    setRevenue(i.revenue);
    setTimeline(i.timeline);
    // Restore the ground the run used: USGS terrain as-is; hand-entered corners from the
    // grid corners (exact for the 2x2 corner grids the hand-entry path produces).
    const savedGrid = fillGrid(i.terrain.grid);
    if (i.terrain.source.includes('USGS') && savedGrid) {
      setUsgs({ grid: savedGrid, source: i.terrain.source });
    } else {
      setUsgs(null);
      const g = savedGrid ?? [
        [500, 500],
        [500, 500],
      ];
      const last = g.length - 1;
      const at = (r: number, c: number) => g[r]?.[c] ?? 500;
      setCorners({
        fl: at(0, 0),
        fr: at(0, (g[0]?.length ?? 1) - 1),
        bl: at(last, 0),
        br: at(last, (g[last]?.length ?? 1) - 1),
      });
    }
    setNote(
      `Loaded “${p.name}”. Its summary was client-computed when saved; the house comes from the current House Studio design, not the saved run.`,
    );
  }

  const setRule = (k: keyof ZoningRules, v: number | string) => setRules((r) => ({ ...r, [k]: v }));

  // Concept site plan PDF: the server renders the current run verbatim (client-computed,
  // like the saved-project summaries) and returns the PDF bytes; nothing is sent anywhere.
  async function downloadConceptPlan() {
    if (!orgName.trim()) {
      setConceptNote('Enter your organization name — it is printed on the sheet.');
      return;
    }
    setConceptBusy(true);
    setConceptNote(null);
    try {
      const body: ConceptPlanRequest = {
        projectName: (projectName.trim() || 'Untitled feasibility run').slice(0, 120),
        organizationName: orgName.trim().slice(0, 120),
        parcelWidthFt: parcel.widthFt,
        parcelDepthFt: parcel.depthFt,
        acres: result.acres,
        road: result.layout.road,
        lots: result.layout.lots.map((l) => ({
          number: l.number,
          rect: l.rect,
          areaSqft: l.areaSqft,
          home: l.home,
          passes: passes(l),
          hasIssues: l.issues.length > 0,
        })),
        homeFootprint: { widthFt: home.widthFt, depthFt: home.depthFt },
        exitPlanLabel: PLANS.find((p) => p.id === plan)?.label ?? plan,
        summaryLines: [
          ...uw.items.map((i) => ({ label: i.label, value: money(i.total) })),
          { label: 'All-in cost', value: money(uw.totalCost) },
          {
            label: plan === 'build_hold' ? 'Revenue (value at cap rate)' : 'Revenue (sales)',
            value: money(result.revenue),
          },
          { label: 'Profit (estimate)', value: money(uw.profit) },
          {
            label: 'Return on cost (estimate)',
            value: uw.returnOnCostPct === null ? '—' : `${uw.returnOnCostPct.toFixed(1)}%`,
          },
          {
            label: 'Equity multiple (estimate)',
            value: uw.equityMultiple === null ? '—' : `${uw.equityMultiple.toFixed(2)}×`,
          },
          { label: 'Break-even revenue (estimate)', value: money(uw.breakEvenRevenue) },
          {
            label: 'Break-even price per lot (estimate)',
            value: uw.breakEvenPerLot === null ? '—' : money(uw.breakEvenPerLot),
          },
          {
            label: 'Payback (estimate)',
            value: uw.paybackYears === null ? '—' : `${uw.paybackYears.toFixed(1)} years`,
          },
          { label: 'Peak cash needed (estimate)', value: money(uw.peakCash) },
        ],
        assumptions: [
          result.layout.note,
          `Ground heights: ${terrain.source}. Cut ${Math.round(result.cutCy).toLocaleString()} cy / fill ${Math.round(result.fillCy).toLocaleString()} cy vs flat house pads (estimate).`,
          'Water and sewer mains are schematic until the city utility map is added.',
          `Zoning rules: ${rules.source}`,
          'Every cost line carries its source in the feasibility run; starting values are not published prices.',
        ],
      };
      const data = await api.post('/v1/land-feasibility/concept-plan', body, {
        schema: ConceptPlanResponseSchema,
      });
      const bytes = Uint8Array.from(atob(data.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      setConceptNote(
        `Concept site plan downloaded (${data.pages} page${data.pages === 1 ? '' : 's'}). It is labelled a concept for discussion — not a survey.`,
      );
    } catch (e) {
      setConceptNote(problemText(e));
    } finally {
      setConceptBusy(false);
    }
  }

  // Decision-class painting: drag on the 2D plan (or type the rectangle) to add a zone.
  const addZone = (rect: { x0: number; x1: number; z0: number; z1: number }) => {
    zoneSeq.current += 1;
    setZones((zs) => [...zs, { id: `zone-${zoneSeq.current}`, classId: paintClass, rect }]);
  };
  const svgPoint = (e: ReactPointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    return {
      x: ((e.clientX - box.left) / box.width) * parcel.widthFt,
      z: ((e.clientY - box.top) / box.height) * parcel.depthFt,
    };
  };
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
            What you can build on this land, how it sits on the ground, and what it earns. Ground
            heights are elevation from USGS 3DEP LiDAR. Every cost line shows where its price
            came from.
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
          <label className="lf-field">
            <span>Project name</span>
            <input
              className="wb-input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Oak Creek 42 lots"
              aria-label="Project name for saving this feasibility run"
            />
          </label>
          <SavedFeasibilityProjects
            projects={projects}
            onLoad={loadProject}
            onDelete={deleteProject}
            onSave={() => void saveProject()}
            busy={projectBusy}
          />
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
                  <Num
                    label="Setback"
                    suffix="ft"
                    value={setbackFt}
                    min={0}
                    onChange={(n) => setSetbackFt(Math.max(0, n))}
                  />
                </div>
                <p className="wb-muted">
                  {result.acres.toFixed(2)} acres · {relief.toFixed(1)} ft of relief · ground:{' '}
                  {terrain.source}
                  {usgs ? ' — elevation from USGS 3DEP LiDAR' : ''}
                </p>
                {geodesicParcel && (
                  <p className="wb-muted">
                    {geodesicParcel.acres.toFixed(2)} acres geodesic (WGS84 ellipsoid — the
                    survey-grade area for this parcel, not the flat rectangle above).
                    {geodesicParcel.buildableAcres !== null &&
                      ` After a ${setbackFt} ft setback: ${geodesicParcel.buildableAcres.toFixed(2)} acres buildable.`}
                  </p>
                )}
                {!lot && (
                  <p className="wb-muted">
                    Select a lot address in the Lot tab below to show the geodesic parcel area
                    and the setback buildable area.
                  </p>
                )}
                {parcelImport && (
                  <p className="wb-muted">
                    Parcel outline imported from {parcelImport.name}: {parcelImport.vertices}{' '}
                    vertices, {parcelImport.acres.toFixed(2)} acres (geodesic, WGS84 ellipsoid).
                  </p>
                )}
                {parcelImportMessage && (
                  <p role="status" className="wb-muted">{parcelImportMessage}</p>
                )}
                <div className="wb-actions">
                  <button
                    type="button"
                    className="hs-pill"
                    onClick={() => void pullGround()}
                    disabled={busy}
                  >
                    {busy ? 'Pulling…' : 'Pull real ground heights + flood zone'}
                  </button>
                  <label className="hs-pill">
                    Import parcel GeoJSON
                    <input
                      type="file"
                      accept=".geojson,.json,application/json"
                      hidden
                      aria-label="Import a GeoJSON parcel outline"
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        e.currentTarget.value = '';
                        if (file) void importParcelGeoJson(file);
                      }}
                    />
                  </label>
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

              <StreamCrossings parcel={parcel} streams={streams} loading={streamsBusy} />

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

          <div className="wb-card">
            <h3>Subdivision lot plan — planning layout, not a survey</h3>
            <p className="wb-muted">
              A quick grid from the parcel size and a target lot size. It is not a survey, a plat,
              or a zoning approval — the lot check above is what tests each lot against the rules.
              Minimum lot width and street width come from the zoning rules.
            </p>
            <div className="lf-fields">
              <Num
                label="Target lot size"
                suffix="sq ft"
                step={500}
                value={subTargetLotSqft}
                onChange={(n) => setSubTargetLotSqft(Math.max(500, n))}
              />
              <Num
                label="Roads allowance"
                suffix="% of parcel"
                step={1}
                value={subRoadsPct}
                onChange={(n) => setSubRoadsPct(Math.min(90, Math.max(0, n)))}
              />
            </div>
            <p className="wb-muted" role="status">
              {subPlan.lots.length > 0 ? (
                <>
                  {subPlan.lots.length} lots · avg{' '}
                  {Math.round(subPlan.avgLotSqft).toLocaleString()} sq ft each ·{' '}
                  {subPlan.grossAcres.toFixed(2)} acres gross,{' '}
                  {subPlan.roadAllowanceAcres.toFixed(2)} acres for roads ·{' '}
                  {subPlan.densityLotsPerAcre.toFixed(1)} lots per acre ·{' '}
                  {subPlan.shape === 'spine_road'
                    ? `new street through the middle (${subPlan.lotsPerRow} lots per side)`
                    : 'one row on the existing street'}
                  .
                </>
              ) : (
                subPlan.note
              )}
            </p>
            {subPlan.lots.length > 0 && (
              <svg
                className="lf-chart"
                viewBox={`0 0 ${parcel.widthFt} ${parcel.depthFt}`}
                role="img"
                aria-label={`Subdivision plan with ${subPlan.lots.length} numbered lots.`}
                style={{ height: 'auto', maxHeight: 320 }}
              >
                <rect
                  x={0}
                  y={0}
                  width={parcel.widthFt}
                  height={parcel.depthFt}
                  fill="#1a2b1f"
                  stroke="#f5c451"
                />
                {subPlan.road && (
                  <rect
                    x={subPlan.road.x0}
                    y={subPlan.road.z0}
                    width={subPlan.road.x1 - subPlan.road.x0}
                    height={subPlan.road.z1 - subPlan.road.z0}
                    fill="#4a4d52"
                  />
                )}
                {subPlan.lots.map((l) => {
                  const color = phased.lotPhaseColor[l.number] ?? '#3fb27f';
                  const dimmed = lotPhaseStage[l.number] === 'not_started';
                  return (
                    <g key={l.number}>
                      <rect
                        x={l.rect.x0}
                        y={l.rect.z0}
                        width={l.rect.x1 - l.rect.x0}
                        height={l.rect.z1 - l.rect.z0}
                        fill={color}
                        fillOpacity={dimmed ? 0.03 : 0.12}
                        stroke={color}
                        strokeOpacity={dimmed ? 0.3 : 1}
                        strokeWidth={Math.max(2, parcel.widthFt / 200)}
                      />
                      <text
                        x={(l.rect.x0 + l.rect.x1) / 2}
                        y={(l.rect.z0 + l.rect.z1) / 2}
                        fill="#e6edf7"
                        fontSize={Math.max(14, parcel.widthFt / 22)}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        {l.number}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
            <label className="lf-check">
              <input
                type="checkbox"
                checked={subShow3d}
                onChange={(e) => setSubShow3d(e.target.checked)}
              />
              Show this grid on the 3D site plan (phase-coloured “Sub lot” outlines)
            </label>
            <p className="wb-muted">{subPlan.note}</p>
          </div>

          <div className="wb-card">
            <h3>Land decision classes — your judgment, painted on the parcel</h3>
            <p className="wb-muted">{DECISION_LAYER_NOTE}</p>
            <div className="lf-plans" role="radiogroup" aria-label="Decision class to paint">
              {DECISION_CLASSES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={paintClass === c.id}
                  className={`hs-pill${paintClass === c.id ? ' is-on' : ''}`}
                  onClick={() => setPaintClass(c.id)}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      backgroundColor: c.color,
                      marginRight: 6,
                      verticalAlign: 'middle',
                    }}
                  />
                  {c.label}
                </button>
              ))}
            </div>
            <p className="wb-muted">{decisionClass(paintClass).blurb}</p>
            <svg
              className="lf-chart"
              viewBox={`0 0 ${parcel.widthFt} ${parcel.depthFt}`}
              role="img"
              aria-label={`Decision-class painting plan with ${zones.length} painted zones. Drag to paint a ${decisionClass(paintClass).label} zone, or use the number fields below.`}
              style={{ height: 'auto', maxHeight: 320, touchAction: 'none', cursor: 'crosshair' }}
              onPointerDown={(e) => {
                const p = svgPoint(e);
                if (p) {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDraftZone(p);
                }
              }}
              onPointerMove={(e) => {
                if (!draftZone) return;
                const p = svgPoint(e);
                if (p) setDraftZone((d) => (d ? { ...d, x2: p.x, z2: p.z } : d));
              }}
              onPointerUp={(e) => {
                const start = draftZone;
                setDraftZone(null);
                if (!start) return;
                const p = svgPoint(e);
                if (!p) return;
                const rect = normalizeZoneRect(start, p, parcel);
                if (rect) addZone(rect);
              }}
            >
              <rect
                x={0}
                y={0}
                width={parcel.widthFt}
                height={parcel.depthFt}
                fill="#1a2b1f"
                stroke="#f5c451"
              />
              {zones.map((z) => {
                const c = decisionClass(z.classId);
                return (
                  <g key={z.id}>
                    <rect
                      x={z.rect.x0}
                      y={z.rect.z0}
                      width={z.rect.x1 - z.rect.x0}
                      height={z.rect.z1 - z.rect.z0}
                      fill={c.color}
                      fillOpacity={0.45}
                      stroke={c.color}
                      strokeWidth={Math.max(2, parcel.widthFt / 200)}
                    />
                    <text
                      x={(z.rect.x0 + z.rect.x1) / 2}
                      y={(z.rect.z0 + z.rect.z1) / 2}
                      fill="#e6edf7"
                      fontSize={Math.max(12, parcel.widthFt / 26)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {c.label}
                    </text>
                  </g>
                );
              })}
              {draftZone && draftZone.x2 !== undefined && draftZone.z2 !== undefined && (
                <rect
                  x={Math.min(draftZone.x, draftZone.x2)}
                  y={Math.min(draftZone.z, draftZone.z2)}
                  width={Math.abs(draftZone.x2 - draftZone.x)}
                  height={Math.abs(draftZone.z2 - draftZone.z)}
                  fill={decisionClass(paintClass).color}
                  fillOpacity={0.3}
                  stroke={decisionClass(paintClass).color}
                  strokeDasharray="8 6"
                />
              )}
            </svg>
            <p className="wb-muted">
              Drag on the plan to paint a {decisionClass(paintClass).label} zone, or type the
              rectangle below (feet from the front-left corner). Zones can overlap; shares are
              of the whole parcel and can add past 100%.
            </p>
            <div className="lf-fields">
              <Num label="From left" suffix="ft" value={zoneNums.x0} onChange={(n) => setZoneNums((z) => ({ ...z, x0: n }))} />
              <Num label="From street" suffix="ft" value={zoneNums.z0} onChange={(n) => setZoneNums((z) => ({ ...z, z0: n }))} />
              <Num label="Width" suffix="ft" value={zoneNums.widthFt} onChange={(n) => setZoneNums((z) => ({ ...z, widthFt: n }))} />
              <Num label="Depth" suffix="ft" value={zoneNums.depthFt} onChange={(n) => setZoneNums((z) => ({ ...z, depthFt: n }))} />
            </div>
            <div className="wb-actions">
              <button
                type="button"
                className="hs-pill"
                onClick={() => {
                  const rect = normalizeZoneRect(
                    { x: zoneNums.x0, z: zoneNums.z0 },
                    { x: zoneNums.x0 + zoneNums.widthFt, z: zoneNums.z0 + zoneNums.depthFt },
                    parcel,
                  );
                  if (rect) addZone(rect);
                }}
              >
                Add {decisionClass(paintClass).label} zone
              </button>
              <label className="lf-check">
                <input
                  type="checkbox"
                  checked={showZones3d}
                  onChange={(e) => setShowZones3d(e.target.checked)}
                />
                Show zones on the 3D site plan
              </label>
            </div>
            {zones.length > 0 && (
              <>
                <div className="wb-table-wrap">
                  <table className="wb-table">
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th>Zones</th>
                        <th>Acres painted</th>
                        <th>Share of parcel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zoneShares.map((s) => (
                        <tr key={s.classId}>
                          <td>
                            <span
                              aria-hidden="true"
                              style={{
                                display: 'inline-block',
                                width: 12,
                                height: 12,
                                borderRadius: 3,
                                backgroundColor: s.color,
                                marginRight: 6,
                                verticalAlign: 'middle',
                              }}
                            />
                            {s.label}
                          </td>
                          <td>{s.zones}</td>
                          <td>{s.acres.toFixed(2)}</td>
                          <td>{s.sharePct.toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="lf-zone-list">
                  {zones.map((z) => (
                    <li key={z.id}>
                      {decisionClass(z.classId).label} — {zoneAcres(z.rect).toFixed(2)} acres (
                      {Math.round(z.rect.x1 - z.rect.x0)} × {Math.round(z.rect.z1 - z.rect.z0)}{' '}
                      ft){' '}
                      <button
                        type="button"
                        className="hs-pill"
                        aria-label={`Remove this ${decisionClass(z.classId).label} zone`}
                        onClick={() => setZones((zs) => zs.filter((x) => x.id !== z.id))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="wb-card">
            <h3>Concept site plan (PDF)</h3>
            <p className="wb-muted">
              A “Concept for Discussion” sheet from this run: the numbered lot plan with home
              footprints, the exit plan, and the underwriting summary. It is labelled a concept
              on its face — not a survey, plat or zoning approval. The PDF is downloaded to
              your device; nothing is sent anywhere.
            </p>
            <div className="lf-fields">
              <label className="lf-field">
                <span>Organization name (printed on the sheet)</span>
                <input
                  className="wb-input"
                  value={orgName}
                  maxLength={120}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Your company name"
                  aria-label="Organization name printed on the concept sheet"
                />
              </label>
            </div>
            <div className="wb-actions">
              <button
                type="button"
                className="hs-pill"
                disabled={conceptBusy || !orgName.trim()}
                onClick={() => void downloadConceptPlan()}
              >
                {conceptBusy ? 'Rendering…' : 'Download concept site plan (PDF)'}
              </button>
            </div>
            {!orgName.trim() && (
              <p className="wb-muted">Enter your organization name — it is printed on the sheet.</p>
            )}
            {conceptNote && (
              <p className="wb-muted" role="status">
                {conceptNote}
              </p>
            )}
          </div>

          <div className="wb-card wb-table-card">
            <h3>Build phases — estimates</h3>
            <p className="wb-muted">
              Split the subdivision lots above into colour-coded phases, in lot-number order.
              Each phase&apos;s sales, costs and profit are prorated from the underwriting
              below by its share of the lots — every figure is an estimate from your own
              inputs, and blank means no sale price has been entered yet, not zero.
            </p>
            <div className="lf-fields">
              <Num
                label="Phases"
                step={1}
                min={1}
                value={phaseCount}
                onChange={(n) => setPhaseCountInput(Math.min(6, Math.max(1, Math.floor(n) || 1)))}
              />
            </div>
            {phased.note && (
              <p className="wb-muted" role="status">
                {phased.note}
              </p>
            )}
            {phaseRows.length > 0 && (
              <div className="wb-table-wrap">
                <table className="wb-table">
                  <thead>
                    <tr>
                      <th>Phase</th>
                      <th>Lots</th>
                      <th>Sales (est.)</th>
                      <th>Costs (est.)</th>
                      <th>Profit (est.)</th>
                      <th>Return on cost (est.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phaseRows.map(({ phase, uw }) => (
                      <tr key={phase.index} className={uw.profit < 0 ? 'lf-row--bad' : ''}>
                        <td>
                          <span
                            aria-hidden="true"
                            style={{
                              display: 'inline-block',
                              width: 12,
                              height: 12,
                              borderRadius: 3,
                              backgroundColor: phase.color,
                              marginRight: 6,
                              verticalAlign: 'middle',
                            }}
                          />
                          {phase.name}
                        </td>
                        <td>
                          {phase.lotCount} ({phase.lotNumbers.join(', ')})
                        </td>
                        <td>{uw.revenue > 0 ? money(uw.revenue) : '—'}</td>
                        <td>{uw.totalCost > 0 ? money(uw.totalCost) : '—'}</td>
                        <td>
                          {uw.revenue > 0 || uw.totalCost > 0 ? money(uw.profit) : '—'}
                        </td>
                        <td>
                          {uw.returnOnCostPct === null
                            ? '—'
                            : `${uw.returnOnCostPct.toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3>Timeline playback</h3>
            <p className="wb-muted">
              Play the build out over the deal months: paper lots, then pads, then homes
              vertical, then selling. The 2D plan above and the 3D overlay colour each lot
              by phase and dim lots whose phase has not started yet. Playback only
              visualizes the timeline — it does not change the cash-flow computation.
            </p>
            {dealMonths > 0 ? (
              <div className="wb-actions">
                <button
                  type="button"
                  className="hs-pill"
                  aria-pressed={playing && playMonthClamped < dealMonths}
                  onClick={() => {
                    if (playing && playMonthClamped < dealMonths) setPlaying(false);
                    else {
                      if (playMonthClamped >= dealMonths) setPlayMonth(0);
                      setPlaying(true);
                    }
                  }}
                >
                  {playing && playMonthClamped < dealMonths
                    ? 'Pause'
                    : playMonthClamped >= dealMonths
                      ? 'Replay'
                      : 'Play'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={dealMonths}
                  step={1}
                  value={playMonthClamped}
                  aria-label="Playback month"
                  onChange={(e) => {
                    setPlaying(false);
                    setPlayMonth(Number(e.target.value));
                  }}
                  style={{ flex: 1, minWidth: 120 }}
                />
                <span role="status">
                  Month {playMonthClamped} of {dealMonths} — {STAGE_LABELS[playStage]}
                </span>
              </div>
            ) : (
              <p className="wb-muted" role="status">
                No deal months to play yet — the timeline above sets the deal length.
              </p>
            )}
          </div>

          <div className="lf-grid">
            <div className="wb-card wb-table-card">
              <h3>Underwriting — estimates</h3>
              <p className="wb-muted">
                Itemized costs from the feasibility run above, plus HOA dues you enter. Every
                figure is an estimate from your inputs — no comps or prices are invented.
              </p>
              <div className="lf-fields">
                <Num
                  label="HOA dues"
                  suffix="$ / lot / month"
                  step={10}
                  value={hoaMonthly}
                  onChange={setHoaMonthly}
                />
              </div>
              <div className="wb-table-wrap">
                <table className="wb-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Total (estimate)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uw.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.label}</td>
                        <td>{money(item.total)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <b>All-in cost</b>
                      </td>
                      <td>
                        <b>{money(uw.totalCost)}</b>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <b>Revenue ({plan === 'build_hold' ? 'value at cap rate' : 'sales'})</b>
                      </td>
                      <td>
                        <b>{money(result.revenue)}</b>
                      </td>
                    </tr>
                    <tr className={uw.profit >= 0 ? '' : 'lf-row--bad'}>
                      <td>
                        <b>Profit (estimate)</b>
                      </td>
                      <td>
                        <b>{money(uw.profit)}</b>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="lf-summary" role="status">
                <div>
                  <span>Return on cost (est.)</span>
                  <strong>
                    {uw.returnOnCostPct === null ? '—' : `${uw.returnOnCostPct.toFixed(1)}%`}
                  </strong>
                </div>
                <div>
                  <span>Equity multiple (est.)</span>
                  <strong>
                    {uw.equityMultiple === null ? '—' : `${uw.equityMultiple.toFixed(2)}×`}
                  </strong>
                </div>
                <div>
                  <span>Annualized return (est.)</span>
                  <strong>
                    {uw.annualizedReturnPct === null
                      ? '—'
                      : `${uw.annualizedReturnPct.toFixed(1)}% / yr`}
                  </strong>
                </div>
                <div>
                  <span>Peak cash (est.)</span>
                  <strong>{money(uw.peakCash)}</strong>
                </div>
                <div>
                  <span>Break-even revenue (est.)</span>
                  <strong>{money(uw.breakEvenRevenue)}</strong>
                </div>
                <div>
                  <span>Break-even per lot (est.)</span>
                  <strong>
                    {uw.breakEvenPerLot === null ? '—' : money(uw.breakEvenPerLot)}
                  </strong>
                </div>
                <div>
                  <span>Payback (est.)</span>
                  <strong>
                    {uw.paybackYears === null ? '—' : `${uw.paybackYears.toFixed(1)} years`}
                  </strong>
                </div>
              </div>
              <p className="wb-muted">
                Break-even is the revenue at which profit is zero; per lot spreads it over the
                lots that pass. Payback is when the monthly cash balance first gets back to
                zero — blank when it never does inside the deal.
              </p>
              {!uw.complete && (
                <p className="wb-muted">
                  Enter a sale price (pad, home, or rent) above to complete the underwriting.
                </p>
              )}
            </div>

            <div className="wb-card wb-table-card">
              <h3>Slope &amp; grading — estimate, not engineering</h3>
              <p className="wb-muted">
                Share of the parcel in each slope band, sampled from the USGS 3DEP LiDAR
                elevations ({grading.sampled} samples, {grading.reliefFt.toFixed(1)} ft of
                relief). Cut {Math.round(result.cutCy).toLocaleString()} cy / fill{' '}
                {Math.round(result.fillCy).toLocaleString()} cy is a high-level estimate from
                ground heights vs flat house pads.
              </p>
              <div className="wb-table-wrap">
                <table className="wb-table">
                  <thead>
                    <tr>
                      <th>Slope band</th>
                      <th>Share of parcel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grading.bands.map((b) => (
                      <tr key={b.id} className={b.id === 'over_limit' && b.sharePct > 0 ? 'lf-row--bad' : ''}>
                        <td>{b.label}</td>
                        <td>{b.sharePct.toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="wb-muted">{grading.note}</p>
              <h3>Utility trench depth — estimate</h3>
              {trench ? (
                <>
                  <p role="status">
                    Deepest sewer cut <b>{trench.deepestCutFt.toFixed(1)} ft</b> (shallowest{' '}
                    {trench.shallowestCutFt.toFixed(1)} ft) over {Math.round(trench.mainLengthFt)}{' '}
                    ft of main; the ground falls {trench.fallFt.toFixed(1)} ft along it.
                  </p>
                  <p className="wb-muted">{trench.note}</p>
                </>
              ) : (
                <p className="wb-muted">
                  Enter a sewer depth in Development cost below to see the deepest trench cut
                  along the main. No depth entered means no readout — Field Pro does not assume
                  one.
                </p>
              )}
            </div>
          </div>

          <div className="lf-grid">
            <div className="wb-card">
              <h3>Farm scenario (agriculture) — estimates</h3>
              <p className="wb-muted">
                The farm-only case next to the three exit plans: buy the land, farm it or lease
                it for a hold period, then sell. Farm income, costs and appreciation are your
                figures — no source publishes crop yields or lease rates, so blank means no
                scenario, never an invented one.
              </p>
              <div className="lf-fields">
                <Num
                  label="Farm income"
                  suffix="$ / acre / year"
                  step={10}
                  value={farmInputs.incomePerAcreYear}
                  onChange={(n) => setFarmInputs((f) => ({ ...f, incomePerAcreYear: n }))}
                />
                <Num
                  label="Farm operating costs"
                  suffix="$ / acre / year"
                  step={10}
                  value={farmInputs.costPerAcreYear}
                  onChange={(n) => setFarmInputs((f) => ({ ...f, costPerAcreYear: n }))}
                />
                <Num
                  label="Hold period"
                  suffix="years"
                  value={farmInputs.holdYears}
                  onChange={(n) =>
                    setFarmInputs((f) => ({ ...f, holdYears: Math.min(60, Math.max(0, Math.floor(n) || 0)) }))
                  }
                />
                <Num
                  label="Land appreciation"
                  suffix="%/year"
                  step={0.25}
                  min={-99}
                  value={farmInputs.appreciationPctPerYear}
                  onChange={(n) => setFarmInputs((f) => ({ ...f, appreciationPctPerYear: n }))}
                />
                <Num
                  label="Selling costs at exit"
                  suffix="%"
                  step={0.5}
                  value={farmInputs.sellingCostPct}
                  onChange={(n) => setFarmInputs((f) => ({ ...f, sellingCostPct: Math.min(100, n) }))}
                />
              </div>
              {farm.complete ? (
                <>
                  <div className="lf-summary" role="status">
                    <div>
                      <span>Net farm income / yr (est.)</span>
                      <strong>{money(farm.annualNetIncome)}</strong>
                    </div>
                    <div>
                      <span>Payback (est.)</span>
                      <strong>
                        {farm.paybackYears === null ? '—' : `${farm.paybackYears.toFixed(1)} years`}
                      </strong>
                    </div>
                    <div>
                      <span>Value at exit (est.)</span>
                      <strong>{money(farm.exitValue)}</strong>
                    </div>
                    <div className={farm.profit >= 0 ? 'lf-good' : 'lf-bad'}>
                      <span>Profit over hold (est.)</span>
                      <strong>{money(farm.profit)}</strong>
                    </div>
                    <div>
                      <span>Return on cost (est.)</span>
                      <strong>
                        {farm.returnOnCostPct === null ? '—' : `${farm.returnOnCostPct.toFixed(1)}%`}
                      </strong>
                    </div>
                  </div>
                  {farm.valuation.length > 1 && (
                    <>
                      <h3>Land value over time (estimate)</h3>
                      <svg
                        className="lf-chart"
                        viewBox={`0 0 ${(farm.valuation.length - 1) * 10} 120`}
                        preserveAspectRatio="none"
                        role="img"
                        aria-label={`Land value from ${money(farm.valuation[0]!.value)} at purchase to ${money(farm.exitValue)} after ${farmInputs.holdYears} years at ${farmInputs.appreciationPctPerYear}% per year.`}
                      >
                        {(() => {
                          const values = farm.valuation.map((p) => p.value);
                          const lo = Math.min(...values);
                          const hi = Math.max(...values);
                          const y = (v: number) =>
                            hi > lo ? 110 - ((v - lo) / (hi - lo)) * 100 : 60;
                          const points = farm.valuation
                            .map((p) => `${p.year * 10},${y(p.value)}`)
                            .join(' ');
                          return (
                            <polyline
                              points={points}
                              fill="none"
                              stroke="#3fb27f"
                              strokeWidth={2}
                              vectorEffect="non-scaling-stroke"
                            />
                          );
                        })()}
                      </svg>
                      <p className="wb-muted">
                        {money(farm.valuation[0]!.value)} today → {money(farm.exitValue)} in{' '}
                        {farmInputs.holdYears} years at {farmInputs.appreciationPctPerYear}%/yr
                        (your rate). Farm income collected over the hold:{' '}
                        {money(farm.totalNetIncome)}.
                      </p>
                    </>
                  )}
                </>
              ) : null}
              <p className="wb-muted">{farm.note}</p>
            </div>

            <div className="wb-card">
              <h3>Short-stay case (nightly rental) — estimates</h3>
              <p className="wb-muted">
                Build the homes and rent them by the night instead of selling or leasing
                monthly. Nightly rate, occupancy and operating costs are your figures — no
                source publishes them, so blank means no case, never an invented one.
              </p>
              <div className="lf-fields">
                <Num
                  label="Homes rented nightly"
                  value={stayUnits}
                  onChange={(n) =>
                    setStayInputs((s) => ({ ...s, units: Math.max(0, Math.floor(n) || 0) }))
                  }
                />
                <Num
                  label="Nightly rate"
                  suffix="$ / night"
                  step={5}
                  value={stayInputs.nightlyRate}
                  onChange={(n) => setStayInputs((s) => ({ ...s, nightlyRate: n }))}
                />
                <Num
                  label="Occupancy"
                  suffix="% of nights"
                  step={1}
                  value={stayInputs.occupancyPct}
                  onChange={(n) => setStayInputs((s) => ({ ...s, occupancyPct: Math.min(100, n) }))}
                />
                <Num
                  label="Operating costs"
                  suffix="% of gross"
                  step={1}
                  value={stayInputs.expensePct}
                  onChange={(n) => setStayInputs((s) => ({ ...s, expensePct: Math.min(100, n) }))}
                />
              </div>
              {stay.complete ? (
                <div className="lf-summary" role="status">
                  <div>
                    <span>Nights / home / yr (est.)</span>
                    <strong>{Math.round(stay.nightsPerYear)}</strong>
                  </div>
                  <div>
                    <span>Net rental income / yr (est.)</span>
                    <strong>{money(stay.annualNet)}</strong>
                  </div>
                  <div>
                    <span>Payback (est.)</span>
                    <strong>
                      {stay.paybackYears === null ? '—' : `${stay.paybackYears.toFixed(1)} years`}
                    </strong>
                  </div>
                  <div>
                    <span>Cash-on-cash (est.)</span>
                    <strong>
                      {stay.cashOnCashPct === null ? '—' : `${stay.cashOnCashPct.toFixed(1)}%`}
                    </strong>
                  </div>
                  <div>
                    <span>Value at cap rate (est.)</span>
                    <strong>
                      {stay.valueAtCapRate === null ? '—' : money(stay.valueAtCapRate)}
                    </strong>
                  </div>
                </div>
              ) : null}
              <p className="wb-muted">{stay.note}</p>
            </div>
          </div>

          <div className="wb-card">
            <h3>Comparable sales</h3>
            <p className="wb-muted">
              No comparable-sales source is connected, so Field Pro shows no comps rather than
              inventing any. County appraisal district values in Land Scout are assessed values,
              not sale comps. Confirm pricing with recent sales from your title company or MLS
              before relying on a sale price above.
            </p>
          </div>

          <div className="lf-grid">
            <div className="wb-card wb-table-card">
              <h3>Development cost</h3>
              <p className="wb-muted">
                Change any price or source. Lots that break a rule are left as open space and not
                priced.
              </p>
              <SewerDepthInput
                depthFt={sewerDepth.depthFt}
                extraCostPerFtPerLf={sewerDepth.extraCostPerFtPerLf}
                onChange={setSewerDepth}
                mainLengthFt={result.layout.mainLengthFt}
              />
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
