// Land feasibility: parcel + zoning rules + ground heights + sourced unit costs -> lot layout,
// code check, earthwork, development cost, profit and monthly cash flow for three exit plans.
// Parcel coordinates are feet: x runs along the street frontage (0 = left/west corner), z runs
// back from the street (0 = street edge). Nothing here invents a price source: every cost line
// carries the source text the builder sees, and the starting values say they are starting values.

export interface ZoningRules {
  minLotSqft: number;
  minLotWidthFt: number;
  frontSetbackFt: number;
  sideSetbackFt: number;
  rearSetbackFt: number;
  /** Steepest ground a house pad may sit on, percent. */
  maxBuildSlopePct: number;
  /** Most of a lot the house footprint may cover, percent. */
  maxCoveragePct: number;
  /** Width of a new street through the parcel, right-of-way. */
  roadWidthFt: number;
  /** Where the rules came from (ordinance section, zoning letter, plat note). */
  source: string;
}

export interface Terrain {
  /** Elevations in feet. Row 0 = street edge, last row = back edge; column 0 = left side. */
  grid: number[][];
  source: string;
}

export type CostId =
  | 'clearing'
  | 'earthwork'
  | 'road'
  | 'mainLine'
  | 'services'
  | 'retaining'
  | 'permits'
  | 'engineering'
  | 'contingency';

export interface CostLine {
  id: CostId;
  label: string;
  /** What the unit cost is per: acre, cy, lf, lot, % of site cost. */
  unit: 'acre' | 'cy' | 'lf' | 'lot' | 'pct';
  unitCost: number;
  source: string;
}

export type ExitPlan = 'sell_pads' | 'build_sell' | 'build_hold';
export type LayoutChoice = 'auto' | 'street_front' | 'new_road';

export interface FeasibilityInputs {
  parcel: { widthFt: number; depthFt: number };
  rules: ZoningRules;
  terrain: Terrain;
  /** Share of the parcel under tree canopy, percent. */
  treeCoverPct: number;
  flood: { zone: string; specialHazard: boolean } | null;
  home: { widthFt: number; depthFt: number; buildCost: number };
  landPrice: number;
  costs: CostLine[];
  layout: LayoutChoice;
  plan: ExitPlan;
  revenue: {
    padPrice: number;
    homePrice: number;
    monthlyRent: number;
    /** Operating expenses as percent of rent (taxes, insurance, repairs, management, vacancy). */
    rentExpensePct: number;
    capRatePct: number;
    sellingCostPct: number;
  };
  timeline: {
    approvalMonths: number;
    siteWorkMonths: number;
    buildMonths: number;
    /** Lots or homes sold (or leased) per month once ready. */
    absorptionPerMonth: number;
    interestPct: number;
  };
}

export const STARTING_SOURCE =
  'Field Pro starting value, not a published price. Replace with your bid or cost book.';

export const DEFAULT_RULES: ZoningRules = {
  minLotSqft: 8000,
  minLotWidthFt: 60,
  frontSetbackFt: 25,
  sideSetbackFt: 5,
  rearSetbackFt: 15,
  maxBuildSlopePct: 25,
  maxCoveragePct: 45,
  roadWidthFt: 50,
  source:
    'Example rules. Enter your city zoning district (ordinance section) before relying on the count.',
};

export const DEFAULT_COSTS: CostLine[] = [
  {
    id: 'clearing',
    label: 'Tree clearing and grubbing',
    unit: 'acre',
    unitCost: 4500,
    source: STARTING_SOURCE,
  },
  {
    id: 'earthwork',
    label: 'Earthwork (cut + fill moved)',
    unit: 'cy',
    unitCost: 12,
    source: STARTING_SOURCE,
  },
  {
    id: 'road',
    label: 'New street with curb and storm drain',
    unit: 'lf',
    unitCost: 350,
    source: STARTING_SOURCE,
  },
  {
    id: 'mainLine',
    label: 'Water and sewer main extension',
    unit: 'lf',
    unitCost: 120,
    source: STARTING_SOURCE,
  },
  {
    id: 'services',
    label: 'Water and sewer taps + service per lot',
    unit: 'lot',
    unitCost: 6500,
    source: STARTING_SOURCE,
  },
  {
    id: 'retaining',
    label: 'Retaining wall where a lot falls more than 4 ft',
    unit: 'lf',
    unitCost: 300,
    source: STARTING_SOURCE,
  },
  {
    id: 'permits',
    label: 'Permits, impact and plat fees per lot',
    unit: 'lot',
    unitCost: 3500,
    source: STARTING_SOURCE,
  },
  {
    id: 'engineering',
    label: 'Civil engineering, survey and platting',
    unit: 'pct',
    unitCost: 8,
    source: STARTING_SOURCE,
  },
  { id: 'contingency', label: 'Contingency', unit: 'pct', unitCost: 10, source: STARTING_SOURCE },
];

export function flatTerrain(elevationFt = 0): Terrain {
  return {
    grid: [
      [elevationFt, elevationFt],
      [elevationFt, elevationFt],
    ],
    source: 'Flat ground (no heights entered)',
  };
}

/** Terrain from four corner heights: front-left, front-right, back-left, back-right. */
export function cornerTerrain(
  fl: number,
  fr: number,
  bl: number,
  br: number,
  source: string,
): Terrain {
  return {
    grid: [
      [fl, fr],
      [bl, br],
    ],
    source,
  };
}

/** Ground height at a parcel point by bilinear interpolation over the grid. */
export function elevationAt(
  terrain: Terrain,
  parcel: { widthFt: number; depthFt: number },
  x: number,
  z: number,
): number {
  const g = terrain.grid;
  const rows = g.length;
  const cols = g[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return 0;
  const u = Math.min(1, Math.max(0, x / parcel.widthFt)) * (cols - 1);
  const v = Math.min(1, Math.max(0, z / parcel.depthFt)) * (rows - 1);
  const c0 = Math.min(cols - 1, Math.floor(u));
  const r0 = Math.min(rows - 1, Math.floor(v));
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const fu = u - c0;
  const fv = v - r0;
  const at = (r: number, c: number) => g[r]![c]!;
  const top = at(r0, c0) * (1 - fu) + at(r0, c1) * fu;
  const bottom = at(r1, c0) * (1 - fu) + at(r1, c1) * fu;
  return top * (1 - fv) + bottom * fv;
}

/** Fill null samples from their neighbours; null when nothing is known. */
export function fillGrid(grid: (number | null)[][]): number[][] | null {
  const known = grid.flat().filter((v): v is number => typeof v === 'number');
  if (known.length === 0) return null;
  const mean = known.reduce((a, b) => a + b, 0) / known.length;
  return grid.map((row, r) =>
    row.map((v, c) => {
      if (typeof v === 'number') return v;
      const near = [grid[r - 1]?.[c], grid[r + 1]?.[c], row[c - 1], row[c + 1]].filter(
        (n): n is number => typeof n === 'number',
      );
      return near.length ? near.reduce((a, b) => a + b, 0) / near.length : mean;
    }),
  );
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface LotIssue {
  rule: string;
  why: string;
  fix: string;
}

export interface LotResult {
  number: number;
  rect: Rect;
  /** Which side faces the street the lot is addressed on. */
  faces: 'street' | 'road_left' | 'road_right';
  areaSqft: number;
  frontageFt: number;
  buildable: Rect;
  home: Rect | null;
  padElevationFt: number;
  slopePct: number;
  fallFt: number;
  cutCy: number;
  fillCy: number;
  retainingLf: number;
  issues: LotIssue[];
}

export interface Layout {
  choice: Exclude<LayoutChoice, 'auto'>;
  lots: LotResult[];
  road: Rect | null;
  roadLengthFt: number;
  /** Length of water/sewer main to run: along the new road, or along the frontage. */
  mainLengthFt: number;
  note: string;
}

const area = (r: Rect) => (r.x1 - r.x0) * (r.z1 - r.z0);

function lotRects(
  parcel: { widthFt: number; depthFt: number },
  rules: ZoningRules,
  choice: Exclude<LayoutChoice, 'auto'>,
): { rects: { rect: Rect; faces: LotResult['faces']; frontage: number }[]; road: Rect | null } {
  const rects: { rect: Rect; faces: LotResult['faces']; frontage: number }[] = [];
  if (choice === 'street_front') {
    const depth = parcel.depthFt;
    const width = Math.max(rules.minLotWidthFt, rules.minLotSqft / depth);
    const count = Math.floor(parcel.widthFt / width + 1e-9);
    if (count < 1) return { rects, road: null };
    const w = parcel.widthFt / count; // share any leftover frontage across the lots
    for (let i = 0; i < count; i++) {
      rects.push({
        rect: { x0: i * w, x1: (i + 1) * w, z0: 0, z1: depth },
        faces: 'street',
        frontage: w,
      });
    }
    return { rects, road: null };
  }
  // New street from the existing street straight back through the middle; lots on both sides
  // face it, so a lot's frontage runs along z and its depth along x.
  const road: Rect = {
    x0: (parcel.widthFt - rules.roadWidthFt) / 2,
    x1: (parcel.widthFt + rules.roadWidthFt) / 2,
    z0: 0,
    z1: parcel.depthFt,
  };
  const lotDepth = (parcel.widthFt - rules.roadWidthFt) / 2;
  if (lotDepth <= 0) return { rects, road: null };
  const width = Math.max(rules.minLotWidthFt, rules.minLotSqft / lotDepth);
  const count = Math.floor(parcel.depthFt / width + 1e-9);
  if (count < 1) return { rects, road: null };
  const w = parcel.depthFt / count;
  for (let i = 0; i < count; i++) {
    rects.push({
      rect: { x0: 0, x1: road.x0, z0: i * w, z1: (i + 1) * w },
      faces: 'road_left',
      frontage: w,
    });
    rects.push({
      rect: { x0: road.x1, x1: parcel.widthFt, z0: i * w, z1: (i + 1) * w },
      faces: 'road_right',
      frontage: w,
    });
  }
  return { rects, road };
}

function buildableOf(rect: Rect, faces: LotResult['faces'], rules: ZoningRules): Rect {
  const { frontSetbackFt: f, sideSetbackFt: s, rearSetbackFt: b } = rules;
  if (faces === 'street')
    return { x0: rect.x0 + s, x1: rect.x1 - s, z0: rect.z0 + f, z1: rect.z1 - b };
  if (faces === 'road_left')
    return { x0: rect.x0 + b, x1: rect.x1 - f, z0: rect.z0 + s, z1: rect.z1 - s };
  return { x0: rect.x0 + f, x1: rect.x1 - b, z0: rect.z0 + s, z1: rect.z1 - s };
}

/** Place the home against the front setback line, centred along the frontage. */
function placeHome(
  buildable: Rect,
  faces: LotResult['faces'],
  home: { widthFt: number; depthFt: number },
): Rect | null {
  const bw = buildable.x1 - buildable.x0;
  const bd = buildable.z1 - buildable.z0;
  if (bw <= 0 || bd <= 0) return null;
  if (faces === 'street') {
    if (home.widthFt > bw || home.depthFt > bd) return null;
    const x0 = buildable.x0 + (bw - home.widthFt) / 2;
    return { x0, x1: x0 + home.widthFt, z0: buildable.z0, z1: buildable.z0 + home.depthFt };
  }
  // Facing the new road: house width runs along z, depth along x away from the road.
  if (home.widthFt > bd || home.depthFt > bw) return null;
  const z0 = buildable.z0 + (bd - home.widthFt) / 2;
  return faces === 'road_left'
    ? { x0: buildable.x1 - home.depthFt, x1: buildable.x1, z0, z1: z0 + home.widthFt }
    : { x0: buildable.x0, x1: buildable.x0 + home.depthFt, z0, z1: z0 + home.widthFt };
}

/** Pad graded flat at the average ground height under the home plus a 10 ft apron. */
function earthwork(inputs: FeasibilityInputs, home: Rect | null, lot: Rect) {
  const pad: Rect = home
    ? {
        x0: Math.max(lot.x0, home.x0 - 10),
        x1: Math.min(lot.x1, home.x1 + 10),
        z0: Math.max(lot.z0, home.z0 - 10),
        z1: Math.min(lot.z1, home.z1 + 10),
      }
    : lot;
  const n = 8;
  const dx = (pad.x1 - pad.x0) / n;
  const dz = (pad.z1 - pad.z0) / n;
  const heights: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      heights.push(
        elevationAt(
          inputs.terrain,
          inputs.parcel,
          pad.x0 + (i + 0.5) * dx,
          pad.z0 + (j + 0.5) * dz,
        ),
      );
    }
  }
  const padElevation = heights.reduce((a, b) => a + b, 0) / heights.length;
  const cell = dx * dz;
  let cut = 0;
  let fill = 0;
  for (const h of heights) {
    if (h > padElevation) cut += (h - padElevation) * cell;
    else fill += (padElevation - h) * cell;
  }
  return { padElevation, cutCy: cut / 27, fillCy: fill / 27 };
}

function slopeOf(inputs: FeasibilityInputs, r: Rect): { slopePct: number; fallFt: number } {
  const e = (x: number, z: number) => elevationAt(inputs.terrain, inputs.parcel, x, z);
  const a = e(r.x0, r.z0);
  const b = e(r.x1, r.z0);
  const c = e(r.x0, r.z1);
  const d = e(r.x1, r.z1);
  const w = Math.max(1, r.x1 - r.x0);
  const dpt = Math.max(1, r.z1 - r.z0);
  const gx = (b + d - a - c) / 2 / w;
  const gz = (c + d - a - b) / 2 / dpt;
  return {
    slopePct: Math.hypot(gx, gz) * 100,
    fallFt: Math.max(a, b, c, d) - Math.min(a, b, c, d),
  };
}

export function layoutParcel(
  inputs: FeasibilityInputs,
  choice: Exclude<LayoutChoice, 'auto'>,
): Layout {
  const { rules, parcel } = inputs;
  const { rects, road } = lotRects(parcel, rules, choice);
  const lots: LotResult[] = rects.map(({ rect, faces, frontage }, i) => {
    const buildable = buildableOf(rect, faces, rules);
    const home = placeHome(buildable, faces, inputs.home);
    const { slopePct, fallFt } = slopeOf(inputs, home ?? buildable);
    const lotFall = slopeOf(inputs, rect).fallFt;
    const work = earthwork(inputs, home, rect);
    const issues: LotIssue[] = [];
    const a = area(rect);
    if (a < rules.minLotSqft - 0.5) {
      issues.push({
        rule: 'Minimum lot size',
        why: `${Math.round(a).toLocaleString()} sq ft is under ${rules.minLotSqft.toLocaleString()}.`,
        fix: 'Combine with a neighbouring lot or ask for a variance.',
      });
    }
    if (frontage < rules.minLotWidthFt - 0.5) {
      issues.push({
        rule: 'Minimum lot width',
        why: `${Math.round(frontage)} ft of frontage is under ${rules.minLotWidthFt} ft.`,
        fix: 'Use fewer, wider lots.',
      });
    }
    if (!home) {
      issues.push({
        rule: 'House fits inside setbacks',
        why: `The ${inputs.home.widthFt} x ${inputs.home.depthFt} ft house does not fit the ${Math.max(0, Math.round(buildable.x1 - buildable.x0))} x ${Math.max(0, Math.round(buildable.z1 - buildable.z0))} ft buildable area.`,
        fix: 'Pick a narrower or two-story plan, or widen the lots.',
      });
    } else {
      const coverage = (area(home) / a) * 100;
      if (coverage > rules.maxCoveragePct + 1e-6) {
        issues.push({
          rule: 'Lot coverage',
          why: `The house covers ${coverage.toFixed(0)}% of the lot; the limit is ${rules.maxCoveragePct}%.`,
          fix: 'Build up instead of out, or use a smaller footprint.',
        });
      }
    }
    if (slopePct > rules.maxBuildSlopePct) {
      issues.push({
        rule: 'Building slope',
        why: `The pad area slopes ${slopePct.toFixed(1)}%; the limit is ${rules.maxBuildSlopePct}%.`,
        fix: 'Step the foundation, add retaining walls, or leave this lot as open space.',
      });
    }
    if (inputs.flood?.specialHazard) {
      issues.push({
        rule: 'Flood zone',
        why: `FEMA zone ${inputs.flood.zone} is a special flood hazard area.`,
        fix: 'Raise the pad above base flood elevation and get a floodplain permit, or confirm the zone with a survey (LOMA).',
      });
    }
    const frontLen = faces === 'street' ? rect.x1 - rect.x0 : rect.z1 - rect.z0;
    return {
      number: i + 1,
      rect,
      faces,
      areaSqft: a,
      frontageFt: frontage,
      buildable,
      home,
      padElevationFt: work.padElevation,
      slopePct,
      fallFt,
      cutCy: work.cutCy,
      fillCy: work.fillCy,
      retainingLf: lotFall > 4 ? frontLen : 0,
      issues,
    };
  });
  const roadLengthFt = road ? road.z1 - road.z0 : 0;
  return {
    choice,
    lots,
    road,
    roadLengthFt,
    mainLengthFt: road ? roadLengthFt : parcel.widthFt,
    note:
      choice === 'street_front'
        ? 'One row of lots on the existing street.'
        : `A new ${rules.roadWidthFt} ft street runs back through the middle with lots on both sides.`,
  };
}

/**
 * A lot is usable when it breaks no hard rule. A flood zone is a warning, not a stop: the lot can
 * still be built with a raised pad and a floodplain permit, so it stays in the count.
 */
export function passes(lot: LotResult): boolean {
  return lot.issues.every((i) => i.rule === 'Flood zone');
}

/** Pick the layout with the most usable lots (ties go to the simpler layout). */
export function bestLayout(inputs: FeasibilityInputs): Layout {
  if (inputs.layout !== 'auto') return layoutParcel(inputs, inputs.layout);
  const a = layoutParcel(inputs, 'street_front');
  const b = layoutParcel(inputs, 'new_road');
  const good = (l: Layout) => l.lots.filter(passes).length;
  return good(b) > good(a) ? b : a;
}

export interface CostRow {
  id: CostId | 'land' | 'homes';
  label: string;
  quantity: number;
  unit: string;
  unitCost: number;
  total: number;
  source: string;
}

export interface CashMonth {
  month: number;
  out: number;
  in: number;
  interest: number;
  net: number;
  cumulative: number;
}

export interface FeasibilityResult {
  layout: Layout;
  lotCount: number;
  passingLots: number;
  acres: number;
  cutCy: number;
  fillCy: number;
  costRows: CostRow[];
  siteCost: number;
  totalCost: number;
  revenue: number;
  sellingCost: number;
  interest: number;
  profit: number;
  marginPct: number;
  /** Build and hold only. */
  hold: { noi: number; value: number; cashOnCashPct: number } | null;
  peakEquity: number;
  months: CashMonth[];
}

const line = (c: CostLine, quantity: number): CostRow => ({
  id: c.id,
  label: c.label,
  quantity,
  unit: c.unit === 'pct' ? '% of site cost' : c.unit,
  unitCost: c.unitCost,
  total: c.unit === 'pct' ? 0 : quantity * c.unitCost,
  source: c.source,
});

export function runFeasibility(inputs: FeasibilityInputs): FeasibilityResult {
  const layout = bestLayout(inputs);
  const lots = layout.lots.filter(passes);
  // Lots that fail a hard rule are left as open space: not sold, not built, not serviced.
  const n = lots.length;
  const acres = (inputs.parcel.widthFt * inputs.parcel.depthFt) / 43_560;
  const cutCy = lots.reduce((s, l) => s + l.cutCy, 0);
  const fillCy = lots.reduce((s, l) => s + l.fillCy, 0);
  const cost = (id: CostId) => inputs.costs.find((c) => c.id === id)!;
  const qty: Record<CostId, number> = {
    clearing: acres * (inputs.treeCoverPct / 100),
    earthwork: cutCy + fillCy,
    road: layout.roadLengthFt,
    mainLine: n > 0 ? layout.mainLengthFt : 0,
    services: n,
    retaining: lots.reduce((s, l) => s + l.retainingLf, 0),
    permits: n,
    engineering: 0,
    contingency: 0,
  };
  const hard = (
    ['clearing', 'earthwork', 'road', 'mainLine', 'services', 'retaining', 'permits'] as CostId[]
  ).map((id) => line(cost(id), qty[id]));
  const hardTotal = hard.reduce((s, r) => s + r.total, 0);
  const eng = cost('engineering');
  const engRow: CostRow = {
    ...line(eng, eng.unitCost),
    quantity: eng.unitCost,
    total: (hardTotal * eng.unitCost) / 100,
  };
  const cont = cost('contingency');
  const contRow: CostRow = {
    ...line(cont, cont.unitCost),
    quantity: cont.unitCost,
    total: ((hardTotal + engRow.total) * cont.unitCost) / 100,
  };
  const siteCost = hardTotal + engRow.total + contRow.total;
  const builds = inputs.plan !== 'sell_pads';
  const rows: CostRow[] = [
    {
      id: 'land',
      label: 'Land purchase',
      quantity: 1,
      unit: 'parcel',
      unitCost: inputs.landPrice,
      total: inputs.landPrice,
      source: 'Your purchase price or asking price',
    },
    ...hard,
    engRow,
    contRow,
  ];
  if (builds) {
    rows.push({
      id: 'homes',
      label: 'Home construction',
      quantity: n,
      unit: 'home',
      unitCost: inputs.home.buildCost,
      total: n * inputs.home.buildCost,
      source: 'House Studio estimate for the current house',
    });
  }
  const homesCost = builds ? n * inputs.home.buildCost : 0;
  const totalBeforeCarry = inputs.landPrice + siteCost + homesCost;

  // ---- monthly cash flow
  const t = inputs.timeline;
  const approval = Math.max(0, Math.round(t.approvalMonths));
  const site = Math.max(1, Math.round(t.siteWorkMonths));
  const build = builds ? Math.max(1, Math.round(t.buildMonths)) : 0;
  const pace = Math.max(0.1, t.absorptionPerMonth);
  const sellMonths = n > 0 ? Math.ceil(n / pace) : 0;
  const readyAt = approval + site + build; // first month units can sell or lease
  const horizon = Math.min(
    240,
    readyAt + (inputs.plan === 'build_hold' ? Math.max(sellMonths, 12) : sellMonths) + 1,
  );
  const unitPrice =
    inputs.plan === 'sell_pads' ? inputs.revenue.padPrice : inputs.revenue.homePrice;
  const rent = inputs.revenue.monthlyRent * (1 - inputs.revenue.rentExpensePct / 100);
  const months: CashMonth[] = [];
  let cumulative = 0;
  let interest = 0;
  let sold = 0;
  let leased = 0;
  let revenue = 0;
  let sellingCost = 0;
  const softCost = engRow.total + n * cost('permits').unitCost;
  const siteHard = siteCost - softCost;
  for (let m = 0; m <= horizon; m++) {
    let out = 0;
    let inflow = 0;
    if (m === 0) out += inputs.landPrice;
    if (approval > 0 && m >= 1 && m <= approval) out += softCost / approval;
    else if (approval === 0 && m === 1) out += softCost;
    if (m > approval && m <= approval + site) out += siteHard / site;
    if (build > 0 && m > approval + site && m <= readyAt) out += homesCost / build;
    if (m > readyAt && n > 0) {
      if (inputs.plan === 'build_hold') {
        leased = Math.min(n, leased + pace);
        inflow += Math.floor(leased) * rent;
      } else if (sold < n) {
        const now = Math.min(n - sold, pace);
        sold += now;
        const gross = now * unitPrice;
        const fees = (gross * inputs.revenue.sellingCostPct) / 100;
        revenue += gross;
        sellingCost += fees;
        inflow += gross - fees;
      }
    }
    const carry = cumulative < 0 ? (-cumulative * t.interestPct) / 100 / 12 : 0;
    interest += carry;
    const net = inflow - out - carry;
    cumulative += net;
    months.push({ month: m, out, in: inflow, interest: carry, net, cumulative });
  }
  const peakEquity = Math.max(0, -Math.min(0, ...months.map((x) => x.cumulative)));
  let hold: FeasibilityResult['hold'] = null;
  let profit: number;
  if (inputs.plan === 'build_hold') {
    const noi = n * rent * 12;
    const value = inputs.revenue.capRatePct > 0 ? noi / (inputs.revenue.capRatePct / 100) : 0;
    hold = {
      noi,
      value,
      cashOnCashPct: totalBeforeCarry > 0 ? (noi / (totalBeforeCarry + interest)) * 100 : 0,
    };
    revenue = value;
    profit = value - totalBeforeCarry - interest;
  } else {
    profit = revenue - sellingCost - totalBeforeCarry - interest;
  }
  return {
    layout,
    lotCount: layout.lots.length,
    passingLots: n,
    acres,
    cutCy,
    fillCy,
    costRows: rows,
    siteCost,
    totalCost: totalBeforeCarry + interest + sellingCost,
    revenue,
    sellingCost,
    interest,
    profit,
    marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
    hold,
    peakEquity,
    months,
  };
}

/** Local slope at a parcel point, percent (for the heatmap). */
export function slopeAt(
  terrain: Terrain,
  parcel: { widthFt: number; depthFt: number },
  x: number,
  z: number,
): number {
  const h = Math.max(1, Math.min(parcel.widthFt, parcel.depthFt) / 40);
  const gx =
    (elevationAt(terrain, parcel, x + h, z) - elevationAt(terrain, parcel, x - h, z)) / (2 * h);
  const gz =
    (elevationAt(terrain, parcel, x, z + h) - elevationAt(terrain, parcel, x, z - h)) / (2 * h);
  return Math.hypot(gx, gz) * 100;
}
