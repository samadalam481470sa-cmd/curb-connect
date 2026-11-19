import { describe, expect, it } from 'vitest';
import {
  HomeDesign,
  checkDesign,
  estimateDesign,
  measureElement,
  modelledFloorAreaSqFt,
  segmentLength,
  type AssemblyRule,
  type BuildingElement,
  type HomeDesign as Design,
} from './index';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function wall(n: number, start: [number, number], end: [number, number], extra: Partial<BuildingElement> = {}): BuildingElement {
  return {
    id: uid(n),
    type: 'wall',
    name: `wall ${n}`,
    level: 0,
    start: { x: start[0], y: start[1] },
    end: { x: end[0], y: end[1] },
    heightM: 3,
    thicknessM: 0.15,
    ...extra,
  };
}

function design(elements: BuildingElement[], overrides: Partial<Design> = {}): Design {
  return HomeDesign.parse({
    id: uid(900),
    projectId: uid(901),
    name: 'Test house',
    targetAreaSqFt: 100,
    budgetCents: 1_000_000,
    levels: [{ index: 0, name: 'Ground', elevationM: 0, heightM: 3 }],
    elements,
    version: 1,
    ...overrides,
  });
}

describe('HomeDesign schema', () => {
  it('accepts a valid design', () => {
    expect(design([wall(1, [0, 0], [4, 0])]).elements).toHaveLength(1);
  });

  it('rejects non-finite or non-positive dimensions', () => {
    expect(() => design([wall(1, [0, 0], [4, 0], { heightM: 0 })])).toThrow();
    expect(() => design([wall(1, [0, 0], [4, 0], { thicknessM: Number.NaN })])).toThrow();
  });

  it('rejects zero-length walls', () => {
    expect(() => design([wall(1, [2, 2], [2, 2])])).toThrow(/zero length/);
  });

  it('requires doors and windows to reference a host', () => {
    const door = wall(2, [0, 0], [0.9, 0], { type: 'door' });
    expect(() => design([door])).toThrow(/host wall/);
  });

  it('rejects fractional or out-of-range levels and non-integer money', () => {
    expect(() => design([], { budgetCents: 10.5 })).toThrow();
    expect(() => design([], { levels: [] })).toThrow();
    expect(() => design([], { version: 0 })).toThrow();
  });
});

describe('checkDesign', () => {
  it('reports no issues for a consistent model', () => {
    const d = design([wall(1, [0, 0], [4, 0]), wall(3, [0, 0], [0, 4])], { targetAreaSqFt: 100 });
    expect(checkDesign(d)).toEqual([]);
  });

  it('flags duplicate ids and unknown levels', () => {
    const d = design([wall(1, [0, 0], [4, 0]), wall(1, [0, 0], [0, 4], { level: 7 })]);
    const codes = checkDesign(d).map((i) => i.code);
    expect(codes).toContain('duplicate-id');
    expect(codes).toContain('unknown-level');
  });

  it('flags openings with a missing host, a non-wall host, or that are too wide', () => {
    const host = wall(1, [0, 0], [2, 0]);
    const floor: BuildingElement = { ...wall(5, [0, 0], [1, 0]), type: 'floor' };
    const missing = wall(2, [0, 0], [0.9, 0], { type: 'door', hostId: uid(77) });
    const badHost = wall(3, [0, 0], [0.9, 0], { type: 'window', hostId: floor.id });
    const tooWide = wall(4, [0, 0], [3, 0], { type: 'window', hostId: host.id, widthM: 3 });
    const codes = checkDesign(design([host, floor, missing, badHost, tooWide])).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['missing-host', 'bad-host', 'opening-too-wide']));
  });

  it('warns when an opening is taller than its level', () => {
    const host = wall(1, [0, 0], [2, 0]);
    const door = wall(2, [0.2, 0], [1, 0], { type: 'door', hostId: host.id, heightM: 4 });
    const issues = checkDesign(design([host, door]));
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'opening-taller-than-level' }));
  });

  it('warns when modelled floor area is more than 10% from target', () => {
    const floor: BuildingElement = { ...wall(1, [0, 0], [10, 0]), type: 'floor', thicknessM: 0.2 };
    const issues = checkDesign(design([floor], { targetAreaSqFt: 1000 }));
    expect(issues.map((i) => i.code)).toContain('area-mismatch');
  });

  it('does not warn about area when no floor is modelled', () => {
    expect(checkDesign(design([wall(1, [0, 0], [4, 0])])).map((i) => i.code)).not.toContain('area-mismatch');
  });
});

describe('geometry helpers', () => {
  it('computes segment length and floor area in square feet', () => {
    expect(segmentLength({ start: { x: 0, y: 0 }, end: { x: 3, y: 4 } })).toBe(5);
    const floor: BuildingElement = { ...wall(1, [0, 0], [10, 0]), type: 'floor', thicknessM: 1 };
    expect(modelledFloorAreaSqFt(design([floor]))).toBeCloseTo(10 * 10.763910416709722, 6);
  });

  it('measures elements by area, length, volume and count', () => {
    const el = wall(1, [0, 0], [4, 0], { heightM: 3, thicknessM: 0.1 });
    expect(measureElement(el, 'length')).toBe(4);
    expect(measureElement(el, 'area')).toBe(12);
    expect(measureElement(el, 'volume')).toBeCloseTo(1.2, 10);
    expect(measureElement(el, 'count')).toBe(1);
  });
});

describe('estimateDesign', () => {
  const rules: AssemblyRule[] = [
    {
      type: 'wall',
      items: [
        {
          sku: 'FRAME-STUD',
          description: 'Stud',
          measure: 'length',
          quantityPerUnit: 2,
          unit: 'ea',
          wastePercent: 10,
          unitPriceCents: 500,
          laborCentsPerUnit: 100,
        },
      ],
    },
  ];

  it('prices quantities with waste and labor in integer cents, then adds contingency', () => {
    const d = design([wall(1, [0, 0], [4, 0])], { budgetCents: 10_000 });
    const est = estimateDesign(d, rules, { contingencyPercent: 10 });
    // base = 4 m * 2 = 8 units; with 10% waste = 8.8 units; material = round(8.8 * 500) = 4400
    // labor = round(8 * 100) = 800; subtotal = 5200; contingency = 520; total = 5720
    expect(est.lines).toHaveLength(1);
    expect(est.lines[0]).toMatchObject({ sku: 'FRAME-STUD', materialCents: 4400, laborCents: 800, totalCents: 5200 });
    expect(est.subtotalCents).toBe(5200);
    expect(est.contingencyCents).toBe(520);
    expect(est.totalCents).toBe(5720);
    expect(est.overBudgetCents).toBe(0);
    expect(Number.isInteger(est.totalCents)).toBe(true);
  });

  it('reports the amount over budget', () => {
    const d = design([wall(1, [0, 0], [4, 0])], { budgetCents: 5000 });
    const est = estimateDesign(d, rules, { contingencyPercent: 0 });
    expect(est.overBudgetCents).toBe(200);
  });

  it('filters rules by assemblyId when provided', () => {
    const d = design([wall(1, [0, 0], [4, 0], { assemblyId: 'EXT' })]);
    const scoped: AssemblyRule[] = [{ ...rules[0]!, assemblyId: 'INT' }];
    expect(estimateDesign(d, scoped).lines).toHaveLength(0);
    expect(estimateDesign(d, [{ ...rules[0]!, assemblyId: 'EXT' }]).lines).toHaveLength(1);
  });

  it('rejects invalid contingency values', () => {
    const d = design([]);
    expect(() => estimateDesign(d, [], { contingencyPercent: -1 })).toThrow(RangeError);
    expect(() => estimateDesign(d, [], { contingencyPercent: Number.NaN })).toThrow(RangeError);
  });

  it('defaults to 10% contingency', () => {
    const d = design([wall(1, [0, 0], [4, 0])]);
    expect(estimateDesign(d, rules).contingencyCents).toBe(520);
  });
});
