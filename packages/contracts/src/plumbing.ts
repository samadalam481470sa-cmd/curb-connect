// Plumbing Pro (ConstructionOS module 10) — deterministic estimation core.
//
// The specification (PL-011, PL-012, PL-016, PL-018, PL-019) requires that every quantity trace back
// to a measured element and that every number come from a calculation engine rather than a model's
// guess. This module is that engine: pure functions over millimetres and minor currency units, no
// I/O, no rounding surprises beyond the documented steps.
//
// It is NOT a code-compliance tool. The fixture-unit and productivity tables below are *sample
// planning values*; PL-013/PL-014/PL-015 require a jurisdiction-selected, reviewed method before any
// result may be presented as compliant. Every response from this module is preliminary.
import { z } from 'zod';

// ================================================================ catalogs (sample values)

export const PLUMBING_SYSTEMS = ['cold_water', 'hot_water', 'sanitary_drainage', 'vent'] as const;
export const PlumbingSystemSchema = z.enum(PLUMBING_SYSTEMS);
export type PlumbingSystem = z.infer<typeof PlumbingSystemSchema>;

export const PLUMBING_SYSTEM_LABELS: Record<PlumbingSystem, string> = {
  cold_water: 'Domestic cold water',
  hot_water: 'Domestic hot water',
  sanitary_drainage: 'Sanitary drainage',
  vent: 'Vent',
};

export const PIPE_MATERIALS = [
  'pex_a',
  'copper_type_l',
  'pvc_schedule_40',
  'abs_schedule_40',
] as const;
export const PipeMaterialSchema = z.enum(PIPE_MATERIALS);
export type PipeMaterial = z.infer<typeof PipeMaterialSchema>;

export const PIPE_MATERIAL_LABELS: Record<PipeMaterial, string> = {
  pex_a: 'PEX-A',
  copper_type_l: 'Copper type L',
  pvc_schedule_40: 'PVC schedule 40',
  abs_schedule_40: 'ABS schedule 40',
};

/** Nominal sizes offered in the estimator, in millimetres (metric canonical). */
export const NOMINAL_SIZES_MM = [10, 15, 20, 25, 32, 40, 50, 75, 100, 150] as const;

export const FIXTURE_TYPES = [
  'water_closet',
  'lavatory',
  'bathtub',
  'shower',
  'kitchen_sink',
  'washing_machine',
  'floor_drain',
  'hose_bibb',
] as const;
export const FixtureTypeSchema = z.enum(FIXTURE_TYPES);
export type FixtureType = z.infer<typeof FixtureTypeSchema>;

export interface FixtureCatalogEntry {
  label: string;
  /** Sample drainage fixture units (DFU) for planning only — confirm with the adopted code. */
  drainageFu: number;
  /** Sample water-supply fixture units (WSFU) for planning only. */
  waterSupplyFu: number;
}

export const FIXTURE_CATALOG: Record<FixtureType, FixtureCatalogEntry> = {
  water_closet: { label: 'Water closet', drainageFu: 6, waterSupplyFu: 2.5 },
  lavatory: { label: 'Lavatory', drainageFu: 1, waterSupplyFu: 1 },
  bathtub: { label: 'Bathtub', drainageFu: 2, waterSupplyFu: 2 },
  shower: { label: 'Shower', drainageFu: 2, waterSupplyFu: 2 },
  kitchen_sink: { label: 'Kitchen sink', drainageFu: 2, waterSupplyFu: 1.5 },
  washing_machine: { label: 'Washing machine', drainageFu: 2, waterSupplyFu: 1.5 },
  floor_drain: { label: 'Floor drain', drainageFu: 1, waterSupplyFu: 0 },
  hose_bibb: { label: 'Hose bibb', drainageFu: 0, waterSupplyFu: 2.5 },
};

/**
 * Sample installed productivity for the estimator's labour line. Real bids must use the company's
 * own measured rates (PL-018); these values exist so the workflow can be exercised end to end.
 */
export const SAMPLE_LABOR_PRODUCTIVITY: Record<
  PlumbingSystem,
  { hoursPerMetre: number; hoursPerFitting: number }
> = {
  cold_water: { hoursPerMetre: 0.18, hoursPerFitting: 0.4 },
  hot_water: { hoursPerMetre: 0.22, hoursPerFitting: 0.45 },
  sanitary_drainage: { hoursPerMetre: 0.25, hoursPerFitting: 0.55 },
  vent: { hoursPerMetre: 0.15, hoursPerFitting: 0.35 },
};

/** Elbows shallower than this are treated as a bend in the pipe, not a fitting. */
export const MIN_ELBOW_DEVIATION_DEGREES = 15;

// ================================================================ geometry

export const Point3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number().default(0),
});
export type Point3 = { x: number; y: number; z: number };

/** Straight-line 3D distance in millimetres. Throws for fewer than two distinct points. */
export function distanceMm(a: Point3, b: Point3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Sum of centreline segment lengths (PL-011). */
export function polylineLengthMm(points: readonly Point3[]): number {
  if (points.length < 2) throw new Error('A pipe run needs at least two points.');
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceMm(points[i - 1]!, points[i]!);
  return total;
}

/** Direction change at one vertex, in degrees (0 = straight, 90 = right angle). */
export function deviationDegrees(previous: Point3, vertex: Point3, next: Point3): number {
  // Incoming direction (previous → vertex) against outgoing direction (vertex → next): a straight
  // run has parallel vectors and therefore a deviation of zero.
  const ax = vertex.x - previous.x;
  const ay = vertex.y - previous.y;
  const az = vertex.z - previous.z;
  const bx = next.x - vertex.x;
  const by = next.y - vertex.y;
  const bz = next.z - vertex.z;
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  if (la === 0 || lb === 0) return 0;
  const cosine = Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/** Interior vertices that need an elbow (PL-012: turns come from topology, never a guess). */
export function countElbows(points: readonly Point3[]): number {
  let elbows = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    if (
      deviationDegrees(points[i - 1]!, points[i]!, points[i + 1]!) >= MIN_ELBOW_DEVIATION_DEGREES
    ) {
      elbows += 1;
    }
  }
  return elbows;
}

function pointKey(point: Point3): string {
  return `${Math.round(point.x)}:${Math.round(point.y)}:${Math.round(point.z)}`;
}

// ================================================================ runs and their quantities

export const PipeRunSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().max(120).default(''),
    system: PlumbingSystemSchema,
    material: PipeMaterialSchema,
    nominalSizeMm: z.number().int().positive().max(600),
    /** Centreline in millimetres, at least two points. */
    points: z.array(Point3Schema).min(2).max(200),
    /** Cutting/waste allowance applied before stock lengths are ordered. */
    wastePercent: z.number().min(0).max(25).default(5),
    stockLengthMm: z.number().int().positive().max(20000).default(6000),
    /** Field-verified elbows not represented in the centreline (added by a human, never inferred). */
    extraElbows: z.number().int().min(0).max(200).default(0),
  })
  .strict();
export type PipeRun = z.infer<typeof PipeRunSchema>;

export interface RunMeasurement {
  installedMm: number;
  wasteMm: number;
  requiredMm: number;
  stockPieces: number;
  purchaseMm: number;
  elbows: number;
  couplings: number;
}

/** Measured + allowance + stock rounding for one run (PL-011), all in millimetres. */
export function measureRun(run: PipeRun): RunMeasurement {
  const installedMm = polylineLengthMm(run.points);
  const wasteMm = Math.round((installedMm * run.wastePercent) / 100);
  const requiredMm = installedMm + wasteMm;
  const stockPieces = Math.ceil(requiredMm / run.stockLengthMm);
  const purchaseMm = stockPieces * run.stockLengthMm;
  return {
    installedMm,
    wasteMm,
    requiredMm,
    stockPieces,
    purchaseMm,
    elbows: countElbows(run.points) + run.extraElbows,
    couplings: Math.max(0, stockPieces - 1),
  };
}

/**
 * Tees implied by three or more runs meeting at one endpoint of the same system. Points must share
 * coordinates exactly (the editor snaps vertices), so this is a topology fact, not a heuristic.
 */
export function countTees(runs: readonly PipeRun[]): number {
  const seen = new Map<string, Map<PlumbingSystem, number>>();
  for (const run of runs) {
    const endpoints = [run.points[0]!, run.points[run.points.length - 1]!];
    for (const point of endpoints) {
      const key = pointKey(point);
      const perSystem = seen.get(key) ?? new Map<PlumbingSystem, number>();
      perSystem.set(run.system, (perSystem.get(run.system) ?? 0) + 1);
      seen.set(key, perSystem);
    }
  }
  let tees = 0;
  for (const perSystem of seen.values()) {
    for (const count of perSystem.values()) tees += Math.max(0, count - 2);
  }
  return tees;
}

// ================================================================ fixtures

export const FixtureLineSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    type: FixtureTypeSchema,
    quantity: z.number().int().positive().max(1000),
    room: z.string().trim().max(120).optional(),
  })
  .strict();
export type FixtureLine = z.infer<typeof FixtureLineSchema>;

export interface FixtureSummaryLine {
  id: string;
  type: FixtureType;
  label: string;
  quantity: number;
  drainageFu: number;
  waterSupplyFu: number;
  drainageTotal: number;
  waterSupplyTotal: number;
}

export interface FixtureSummary {
  lines: FixtureSummaryLine[];
  totalQuantity: number;
  totalDrainageFu: number;
  totalWaterSupplyFu: number;
}

/** PL-004/PL-013 input side: fixture counts and their sample demand units. */
export function summarizeFixtures(fixtures: readonly FixtureLine[]): FixtureSummary {
  const lines = fixtures.map((fixture) => {
    const catalog = FIXTURE_CATALOG[fixture.type]!;
    return {
      id: fixture.id,
      type: fixture.type,
      label: catalog.label,
      quantity: fixture.quantity,
      drainageFu: catalog.drainageFu,
      waterSupplyFu: catalog.waterSupplyFu,
      drainageTotal: catalog.drainageFu * fixture.quantity,
      waterSupplyTotal: catalog.waterSupplyFu * fixture.quantity,
    };
  });
  const sum = (pick: (line: FixtureSummaryLine) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);
  return {
    lines,
    totalQuantity: sum((line) => line.quantity),
    totalDrainageFu: sum((line) => line.drainageTotal),
    totalWaterSupplyFu: sum((line) => line.waterSupplyTotal),
  };
}

// ================================================================ takeoff (PL-016)

export type TakeoffCategory = 'pipe' | 'fitting';

export interface TakeoffLine {
  /** Stable key: also the price-book lookup key. */
  key: string;
  category: TakeoffCategory;
  system: PlumbingSystem;
  /** Material and size for priced lines; absent on the generic tee line. */
  material?: PipeMaterial;
  nominalSizeMm?: number;
  description: string;
  item: 'pipe' | 'elbow' | 'coupling' | 'tee';
  quantity: number;
  unit: 'm' | 'ea';
  /** Every quantity links back to the runs that produced it (traceability requirement). */
  sourceRunIds: string[];
}

export interface Takeoff {
  lines: TakeoffLine[];
  installedMm: number;
  purchaseMm: number;
  runCount: number;
  /** True when at least one line came from more than one run. */
  aggregated: boolean;
}

interface PipeGroup {
  system: PlumbingSystem;
  material: PipeMaterial;
  nominalSizeMm: number;
  installedMm: number;
  purchaseMm: number;
  elbows: number;
  couplings: number;
  runIds: string[];
}

function roundMm(value: number): number {
  return Math.round(value);
}

function roundMetres(mm: number): number {
  return Math.round(mm) / 1000;
}

/**
 * Aggregates runs into priced units: purchase metres of pipe plus the fittings their topology
 * implies. Deterministic order (system, material, size) keeps repeated generation idempotent.
 */
export function takeoffFromRuns(runs: readonly PipeRun[]): Takeoff {
  const groups = new Map<string, PipeGroup>();
  for (const run of runs) {
    const measurement = measureRun(run);
    const key = `${run.system}|${run.material}|${run.nominalSizeMm}`;
    const existing = groups.get(key);
    const group: PipeGroup = existing ?? {
      system: run.system,
      material: run.material,
      nominalSizeMm: run.nominalSizeMm,
      installedMm: 0,
      purchaseMm: 0,
      elbows: 0,
      couplings: 0,
      runIds: [],
    };
    group.installedMm += measurement.installedMm;
    group.purchaseMm += measurement.purchaseMm;
    group.elbows += measurement.elbows;
    group.couplings += measurement.couplings;
    group.runIds.push(run.id);
    groups.set(key, group);
  }

  const systemOrder = new Map(PLUMBING_SYSTEMS.map((system, index) => [system, index]));
  const ordered = [...groups.values()].sort(
    (a, b) =>
      (systemOrder.get(a.system) ?? 0) - (systemOrder.get(b.system) ?? 0) ||
      a.material.localeCompare(b.material) ||
      a.nominalSizeMm - b.nominalSizeMm,
  );

  const lines: TakeoffLine[] = [];
  for (const group of ordered) {
    const prefix = `${group.system}|${group.material}|${group.nominalSizeMm}`;
    const size = `${group.nominalSizeMm} mm`;
    const material = PIPE_MATERIAL_LABELS[group.material];
    lines.push({
      key: `${prefix}|pipe`,
      category: 'pipe',
      system: group.system,
      material: group.material,
      nominalSizeMm: group.nominalSizeMm,
      description: `${material} pipe, ${size}`,
      item: 'pipe',
      quantity: roundMetres(group.purchaseMm),
      unit: 'm',
      sourceRunIds: [...group.runIds],
    });
    if (group.elbows > 0) {
      lines.push({
        key: `${prefix}|elbow`,
        category: 'fitting',
        system: group.system,
        material: group.material,
        nominalSizeMm: group.nominalSizeMm,
        description: `${material} elbow, ${size}`,
        item: 'elbow',
        quantity: group.elbows,
        unit: 'ea',
        sourceRunIds: [...group.runIds],
      });
    }
    if (group.couplings > 0) {
      lines.push({
        key: `${prefix}|coupling`,
        category: 'fitting',
        system: group.system,
        material: group.material,
        nominalSizeMm: group.nominalSizeMm,
        description: `${material} coupling, ${size}`,
        item: 'coupling',
        quantity: group.couplings,
        unit: 'ea',
        sourceRunIds: [...group.runIds],
      });
    }
  }

  const tees = countTees(runs);
  if (tees > 0) {
    lines.push({
      key: 'all|fitting|tee',
      category: 'fitting',
      system: 'cold_water',
      description: 'Tee at a three-way junction',
      item: 'tee',
      quantity: tees,
      unit: 'ea',
      sourceRunIds: runs.map((run) => run.id),
    });
  }

  return {
    lines,
    installedMm: roundMm(
      [...groups.values()].reduce((total, group) => total + group.installedMm, 0),
    ),
    purchaseMm: roundMm([...groups.values()].reduce((total, group) => total + group.purchaseMm, 0)),
    runCount: runs.length,
    aggregated: [...groups.values()].some((group) => group.runIds.length > 1),
  };
}

// ================================================================ labour (PL-018)

export interface LaborBreakdown {
  hours: number;
  lines: { system: PlumbingSystem; hours: number }[];
}

/**
 * Installation hours from verified production rates. Only pipe metres and counted fittings are
 * costed; anything else must be added as an explicit, named adjustment by a human.
 */
export function laborHoursFromTakeoff(
  takeoff: Takeoff,
  rates: Record<
    PlumbingSystem,
    { hoursPerMetre: number; hoursPerFitting: number }
  > = SAMPLE_LABOR_PRODUCTIVITY,
): LaborBreakdown {
  const perSystem = new Map<PlumbingSystem, number>();
  for (const line of takeoff.lines) {
    const rate = rates[line.system];
    const hours =
      line.unit === 'm' ? line.quantity * rate.hoursPerMetre : line.quantity * rate.hoursPerFitting;
    perSystem.set(line.system, (perSystem.get(line.system) ?? 0) + hours);
  }
  const lines = [...perSystem.entries()].map(([system, hours]) => ({
    system,
    hours: Math.round(hours * 100) / 100,
  }));
  return {
    lines,
    hours: Math.round(lines.reduce((total, line) => total + line.hours, 0) * 100) / 100,
  };
}

// ================================================================ pricing and totals

/** Price per takeoff line, in minor currency units. Line total rounds once, half-up. */
export function lineTotalMinor(quantity: number, unitPriceMinor: number): number {
  if (!Number.isFinite(quantity) || quantity < 0)
    throw new Error('Quantity must be a positive number.');
  if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new Error('Unit price must be a non-negative integer in minor units.');
  }
  return Math.round(quantity * unitPriceMinor);
}

export function materialTotalMinor(
  prices: Readonly<Record<string, number>>,
  lines: readonly TakeoffLine[],
): number {
  return lines.reduce((total, line) => {
    const price = prices[line.key];
    return total + (price === undefined ? 0 : lineTotalMinor(line.quantity, price));
  }, 0);
}

export const EstimateTotalsInputSchema = z
  .object({
    materialMinor: z.number().int().min(0),
    laborMinor: z.number().int().min(0),
    equipmentMinor: z.number().int().min(0).default(0),
    contingencyPercent: z.number().min(0).max(50).default(5),
    overheadPercent: z.number().min(0).max(50).default(10),
    markupPercent: z.number().min(0).max(100).default(15),
    taxPercent: z.number().min(0).max(30).default(0),
  })
  .strict();
export type EstimateTotalsInput = z.infer<typeof EstimateTotalsInputSchema>;

export interface EstimateTotals {
  materialMinor: number;
  laborMinor: number;
  equipmentMinor: number;
  contingencyMinor: number;
  overheadMinor: number;
  markupMinor: number;
  subtotalMinor: number;
  preTaxMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Documented rounding order (PL-019): direct costs add exactly, each percentage is calculated on
 * the documented base and rounded once, then tax applies to the final pre-tax price. No step reads
 * a rounded intermediate more than once, so the same input always yields the same total.
 */
export function estimateTotals(input: EstimateTotalsInput): EstimateTotals {
  const direct = input.materialMinor + input.laborMinor + input.equipmentMinor;
  const contingencyMinor = Math.round((direct * input.contingencyPercent) / 100);
  const overheadMinor = Math.round((direct * input.overheadPercent) / 100);
  const preMarkup = direct + contingencyMinor + overheadMinor;
  const markupMinor = Math.round((preMarkup * input.markupPercent) / 100);
  const preTax = preMarkup + markupMinor;
  const taxMinor = Math.round((preTax * input.taxPercent) / 100);
  return {
    materialMinor: input.materialMinor,
    laborMinor: input.laborMinor,
    equipmentMinor: input.equipmentMinor,
    contingencyMinor,
    overheadMinor,
    markupMinor,
    subtotalMinor: direct,
    preTaxMinor: preTax,
    taxMinor,
    totalMinor: preTax + taxMinor,
  };
}

// ================================================================ a whole estimate document

export const PlumbingEstimateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    /** Free text; the tool never claims a jurisdiction it was not given. */
    jurisdiction: z.string().trim().max(120).default(''),
    fixtures: z.array(FixtureLineSchema).max(500),
    runs: z.array(PipeRunSchema).max(500),
    prices: z.record(z.string(), z.number().int().min(0)),
    laborRateMinorPerHour: z.number().int().min(0),
    equipmentMinor: z.number().int().min(0).default(0),
    contingencyPercent: z.number().min(0).max(50).default(5),
    overheadPercent: z.number().min(0).max(50).default(10),
    markupPercent: z.number().min(0).max(100).default(15),
    taxPercent: z.number().min(0).max(30).default(0),
  })
  .strict();
export type PlumbingEstimate = z.infer<typeof PlumbingEstimateSchema>;

export interface PlumbingEstimateResult {
  fixtures: FixtureSummary;
  takeoff: Takeoff;
  labor: LaborBreakdown;
  laborMinor: number;
  materialMinor: number;
  totals: EstimateTotals;
  pricedLines: { line: TakeoffLine; unitPriceMinor: number; totalMinor: number }[];
  /** Lines without a price; the proposal may not be presented as final while any remain. */
  unpricedLineKeys: string[];
}

/** Deterministic end-to-end calculation for one estimate document. */
export function computeEstimate(estimate: PlumbingEstimate): PlumbingEstimateResult {
  const fixtures = summarizeFixtures(estimate.fixtures);
  const takeoff = takeoffFromRuns(estimate.runs);
  const labor = laborHoursFromTakeoff(takeoff);
  const laborMinor = Math.round(labor.hours * estimate.laborRateMinorPerHour);
  const pricedLines = takeoff.lines.map((line) => {
    const unitPriceMinor = estimate.prices[line.key] ?? 0;
    return { line, unitPriceMinor, totalMinor: lineTotalMinor(line.quantity, unitPriceMinor) };
  });
  const materialMinor = pricedLines.reduce((total, priced) => total + priced.totalMinor, 0);
  const totals = estimateTotals({
    materialMinor,
    laborMinor,
    equipmentMinor: estimate.equipmentMinor,
    contingencyPercent: estimate.contingencyPercent,
    overheadPercent: estimate.overheadPercent,
    markupPercent: estimate.markupPercent,
    taxPercent: estimate.taxPercent,
  });
  return {
    fixtures,
    takeoff,
    labor,
    laborMinor,
    materialMinor,
    totals,
    pricedLines,
    unpricedLineKeys: takeoff.lines
      .filter((line) => estimate.prices[line.key] === undefined)
      .map((line) => line.key),
  };
}

/** Human-readable feet/inches from millimetres (display only; stored measurements stay metric). */
export function formatFeetInches(mm: number): string {
  const totalInches = mm / 25.4;
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches - feet * 12;
  return `${feet}′ ${inches.toFixed(1)}″`;
}
