import { describe, expect, it } from 'vitest';
import {
  computeEstimate,
  countElbows,
  countTees,
  estimateTotals,
  lineTotalMinor,
  laborHoursFromTakeoff,
  measureRun,
  PipeRunSchema,
  PlumbingEstimateSchema,
  polylineLengthMm,
  summarizeFixtures,
  takeoffFromRuns,
  type PipeRun,
} from './plumbing';

function run(overrides: Partial<PipeRun> = {}): PipeRun {
  return PipeRunSchema.parse({
    id: 'r1',
    system: 'cold_water',
    material: 'pex_a',
    nominalSizeMm: 20,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 10_000, y: 0, z: 0 },
    ],
    ...overrides,
  });
}

describe('PL-011 pipe centreline length', () => {
  it('measures a 3D straight run exactly', () => {
    expect(
      polylineLengthMm([
        { x: 0, y: 0, z: 0 },
        { x: 3000, y: 4000, z: 0 },
      ]),
    ).toBe(5000);
  });

  it('sums 3 m + 4 m + 5 m to exactly 12 m', () => {
    expect(
      polylineLengthMm([
        { x: 0, y: 0, z: 0 },
        { x: 3000, y: 0, z: 0 },
        { x: 3000, y: 4000, z: 0 },
        { x: 3000, y: 4000, z: 5000 },
      ]),
    ).toBe(12_000);
  });

  it('refuses a run with fewer than two points', () => {
    expect(() => polylineLengthMm([{ x: 0, y: 0, z: 0 }])).toThrow(/at least two points/);
  });
});

describe('PL-011 waste and stock rounding', () => {
  it('applies waste before rounding up to whole stock lengths', () => {
    const measurement = measureRun(run());
    expect(measurement.installedMm).toBe(10_000);
    expect(measurement.wasteMm).toBe(500);
    expect(measurement.requiredMm).toBe(10_500);
    expect(measurement.stockPieces).toBe(2);
    expect(measurement.purchaseMm).toBe(12_000);
    expect(measurement.couplings).toBe(1);
  });

  it('orders three 6 m sticks for 12 m at 5% waste', () => {
    const measurement = measureRun(
      run({
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 12_000, y: 0, z: 0 },
        ],
      }),
    );
    expect(measurement.stockPieces).toBe(3);
    expect(measurement.purchaseMm).toBe(18_000);
  });

  it('adds only field-verified extra elbows, never guesses', () => {
    expect(measureRun(run()).elbows).toBe(0);
    expect(measureRun(run({ extraElbows: 2 })).elbows).toBe(2);
  });
});

describe('PL-012 fittings from topology', () => {
  it('counts a right-angle bend as one elbow and ignores shallow bends', () => {
    expect(
      countElbows([
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1000 },
        { x: 1000, y: 0, z: 1000 },
      ]),
    ).toBe(1);
    expect(
      countElbows([
        { x: 0, y: 0, z: 0 },
        { x: 1000, y: 0, z: 0 },
        { x: 2000, y: 0, z: 0 },
      ]),
    ).toBe(0);
    const shallow = [
      { x: 0, y: 0, z: 0 },
      { x: 1000, y: 0, z: 0 },
      { x: 2000, y: 100, z: 0 },
    ];
    expect(countElbows(shallow)).toBe(0);
  });

  it('counts one tee where three runs of the same system meet', () => {
    const a = run({
      id: 'a',
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1000, y: 0, z: 0 },
      ],
    });
    const b = run({
      id: 'b',
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1000, z: 0 },
      ],
    });
    const c = run({
      id: 'c',
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1000 },
      ],
    });
    expect(countTees([a, b, c])).toBe(1);
    expect(countTees([a, b])).toBe(0);
    // Different systems never share a fitting.
    expect(countTees([a, b, run({ id: 'c', system: 'vent' })])).toBe(0);
  });

  it('lists one elbow and the couplings implied by stock pieces', () => {
    const bent = run({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 4000, y: 0, z: 0 },
        { x: 4000, y: 4000, z: 0 },
      ],
    });
    const takeoff = takeoffFromRuns([bent]);
    expect(takeoff.lines.map((line) => [line.item, line.quantity])).toEqual([
      ['pipe', 12],
      ['elbow', 1],
      ['coupling', 1],
    ]);
  });
});

describe('PL-016 traceable takeoff', () => {
  it('aggregates runs of the same system, material and size and keeps their ids', () => {
    const a = run({ id: 'a' });
    const b = run({ id: 'b' });
    const takeoff = takeoffFromRuns([a, b]);
    const pipeLines = takeoff.lines.filter((line) => line.item === 'pipe');
    expect(pipeLines).toHaveLength(1);
    expect(pipeLines[0]!.sourceRunIds).toEqual(['a', 'b']);
    expect(pipeLines[0]!.quantity).toBe(24);
    expect(takeoff.aggregated).toBe(true);
  });

  it('is deterministic across repeated generation', () => {
    const runs = [
      run({ id: 'a' }),
      run({ id: 'b', system: 'hot_water', material: 'copper_type_l', nominalSizeMm: 15 }),
    ];
    expect(takeoffFromRuns(runs)).toEqual(takeoffFromRuns(runs));
  });

  it('keeps every line tied to at least one run', () => {
    const takeoff = takeoffFromRuns([
      run({ id: 'a' }),
      run({ id: 'b', material: 'copper_type_l', nominalSizeMm: 15 }),
    ]);
    for (const line of takeoff.lines) expect(line.sourceRunIds.length).toBeGreaterThan(0);
  });
});

describe('PL-013 fixture demand input', () => {
  it('reconciles fixture counts with their unit totals', () => {
    const summary = summarizeFixtures([
      { id: 'f1', type: 'water_closet', quantity: 2 },
      { id: 'f2', type: 'lavatory', quantity: 1 },
    ]);
    expect(summary.totalQuantity).toBe(3);
    expect(summary.totalDrainageFu).toBe(13);
    expect(summary.totalWaterSupplyFu).toBe(6);
  });
});

describe('PL-018 labour estimating', () => {
  it('turns the twelve purchased metres at 0.2 h/m into 2.4 hours', () => {
    const takeoff = takeoffFromRuns([run()]);
    const rates = {
      cold_water: { hoursPerMetre: 0.2, hoursPerFitting: 0 },
      hot_water: { hoursPerMetre: 0.2, hoursPerFitting: 0 },
      sanitary_drainage: { hoursPerMetre: 0.2, hoursPerFitting: 0 },
      vent: { hoursPerMetre: 0.2, hoursPerFitting: 0 },
    } as const;
    expect(laborHoursFromTakeoff(takeoff, rates).hours).toBe(2.4);
  });
});

describe('PL-019 proposal totals', () => {
  it('rounds each documented step once', () => {
    const totals = estimateTotals({
      materialMinor: 10_000,
      laborMinor: 5000,
      equipmentMinor: 0,
      contingencyPercent: 10,
      overheadPercent: 5,
      markupPercent: 20,
      taxPercent: 10,
    });
    expect(totals).toMatchObject({
      contingencyMinor: 1500,
      overheadMinor: 750,
      markupMinor: 3450,
      preTaxMinor: 20_700,
      taxMinor: 2070,
      totalMinor: 22_770,
    });
  });

  it('rounds a fractional line total half-up', () => {
    expect(lineTotalMinor(12.6, 1234)).toBe(15_548);
  });

  it('rejects a negative unit price', () => {
    expect(() => lineTotalMinor(1, -1)).toThrow(/non-negative/);
  });
});

describe('deterministic estimate', () => {
  const estimate = PlumbingEstimateSchema.parse({
    name: 'Riverside bathroom rough-in',
    fixtures: [{ id: 'f1', type: 'water_closet', quantity: 1 }],
    runs: [
      {
        id: 'a',
        system: 'cold_water',
        material: 'pex_a',
        nominalSizeMm: 20,
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 6000, y: 0, z: 0 },
        ],
      },
    ],
    prices: { 'cold_water|pex_a|20|pipe': 850 },
    laborRateMinorPerHour: 9500,
  });

  it('computes the same result twice', () => {
    expect(computeEstimate(estimate)).toEqual(computeEstimate(estimate));
  });

  it('flags fitting lines that still need a price', () => {
    const result = computeEstimate(estimate);
    expect(result.materialMinor).toBe(10_200);
    expect(result.unpricedLineKeys).toContain('cold_water|pex_a|20|coupling');
    expect(result.totals.totalMinor).toBeGreaterThan(0);
  });

  it('rejects a single-point run at the schema boundary', () => {
    expect(
      PipeRunSchema.safeParse({
        id: 'x',
        system: 'cold_water',
        material: 'pex_a',
        nominalSizeMm: 20,
        points: [{ x: 0, y: 0, z: 0 }],
      }).success,
    ).toBe(false);
  });
});
