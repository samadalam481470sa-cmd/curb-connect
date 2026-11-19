import { describe, expect, it } from 'vitest';
import {
  acceptProposal,
  exportIfc,
  HomeDesign,
  ifcGuid,
  importIfc,
  parseArgs,
  parseBrief,
  parseStep,
  planDesign,
  type BuildingElement,
} from './index';

let seq = 0;
const nextId = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

const BRIEF =
  'Design me a 4,500-square-foot, two-story modern luxury home with five bedrooms, four bathrooms, a three-car garage, a swimming pool, solar panels, and a $950,000 construction budget in Texas.';

describe('parseBrief', () => {
  it('extracts the program from the example brief', () => {
    const b = parseBrief(BRIEF);
    expect(b).toEqual({
      areaSqFt: 4500,
      levels: 2,
      bedrooms: 5,
      bathrooms: 4,
      garageCars: 3,
      pool: true,
      solar: true,
      budgetUsd: 950000,
      state: 'TX',
    });
  });

  it('leaves unknown fields null instead of guessing', () => {
    const b = parseBrief('a small cabin');
    expect(b.areaSqFt).toBeNull();
    expect(b.budgetUsd).toBeNull();
    expect(b.state).toBeNull();
    expect(b.pool).toBe(false);
  });

  it('understands k/m budgets, word numbers and two-letter state codes', () => {
    expect(parseBrief('budget $1.2m').budgetUsd).toBe(1_200_000);
    expect(parseBrief('budget $850k').budgetUsd).toBe(850_000);
    expect(parseBrief('three bedrooms in FL').state).toBe('FL');
    expect(parseBrief('three bedrooms').bedrooms).toBe(3);
  });
});

describe('planDesign', () => {
  it('produces a valid two-storey concept whose area is close to the brief', () => {
    const plan = planDesign(BRIEF, { design: nextId(), project: nextId(), element: nextId });
    expect(plan.design.levels).toHaveLength(2);
    expect(plan.design.budgetCents).toBe(95_000_000);
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(plan.issues.map((i) => i.code)).not.toContain('area-mismatch');
    expect(plan.assumptions.some((a) => a.includes('not drawn'))).toBe(true);
  });

  it('records assumptions for missing data and uses defaults', () => {
    const plan = planDesign('a house', { design: nextId(), project: nextId(), element: nextId });
    expect(plan.design.targetAreaSqFt).toBe(2500);
    expect(plan.design.budgetCents).toBe(0);
    expect(plan.assumptions.join(' ')).toMatch(/No floor area/);
    expect(plan.assumptions.join(' ')).toMatch(/No construction budget/);
  });

  it('places a hosted door and windows that pass the checks', () => {
    const plan = planDesign('3 bedrooms, 2000 sq ft', { design: nextId(), project: nextId(), element: nextId });
    const types = plan.design.elements.map((e) => e.type);
    expect(types).toContain('door');
    expect(types.filter((t) => t === 'window').length).toBeGreaterThanOrEqual(3);
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('acceptProposal', () => {
  it('accepts a valid proposal and rejects one with a checked error', () => {
    const plan = planDesign('2000 sq ft', { design: nextId(), project: nextId(), element: nextId });
    expect(acceptProposal(plan.design).design.id).toBe(plan.design.id);
    const broken = { ...plan.design, levels: [{ ...plan.design.levels[0]!, index: 5 }] };
    // Elements still reference level 0, which no longer exists -> deterministic check error.
    expect(() => acceptProposal(broken)).toThrow(RangeError);
  });

  it('rejects structurally invalid input before running checks', () => {
    expect(() => acceptProposal({ nope: true })).toThrow();
  });
});

describe('STEP parser', () => {
  it('parses references, strings with escaped quotes, enums, nulls and nested lists', () => {
    const args = parseArgs("'it''s',$,*,#12,.ELEMENT.,(1.5,-2.,(3)),IFCLABEL('x')");
    expect(args[0]).toEqual({ kind: 'str', value: "it's" });
    expect(args[1]).toEqual({ kind: 'null' });
    expect(args[2]).toEqual({ kind: 'null' });
    expect(args[3]).toEqual({ kind: 'ref', id: 12 });
    expect(args[4]).toEqual({ kind: 'enum', value: 'ELEMENT' });
    expect(args[5]).toMatchObject({ kind: 'list' });
    expect(args[6]).toEqual({ kind: 'typed', name: 'IFCLABEL', args: [{ kind: 'str', value: 'x' }] });
  });

  it('rejects duplicate ids and malformed values', () => {
    expect(() => parseStep('#1=A();\n#1=B();')).toThrow(/Duplicate/);
    expect(() => parseArgs('@')).toThrow();
    expect(() => parseArgs("'open")).toThrow(/Unterminated/);
    expect(() => parseArgs('#x')).toThrow(/Bad reference/);
    expect(() => parseArgs('.lower.')).toThrow(/Bad enum/);
    expect(() => parseArgs('1 2')).toThrow();
  });

  it('ignores header lines and non-entity text', () => {
    expect(parseStep('ISO-10303-21;\nHEADER;\n#7=IFCX(1.);\nENDSEC;').size).toBe(1);
  });
});

describe('IFC export and import', () => {
  const plan = () => planDesign(BRIEF, { design: nextId(), project: nextId(), element: nextId });

  it('compresses GUIDs to 22 IFC characters', () => {
    const g = ifcGuid('00000000000000000000000000000001');
    expect(g).toHaveLength(22);
    expect(g).toMatch(/^[0-9A-Za-z_$]{22}$/);
  });

  it('writes an IFC4 file with the spatial hierarchy and wall geometry', () => {
    const design = plan().design;
    const { text, skipped } = exportIfc(design, { guidSeed: (i) => ifcGuid(i.toString(16).padStart(32, '0')) });
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text).toContain("FILE_SCHEMA(('IFC4'));");
    expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
    expect(text).toContain('IFCPROJECT(');
    expect(text.match(/IFCBUILDINGSTOREY\(/g)).toHaveLength(2);
    expect(text.match(/IFCWALL\(/g)).toHaveLength(8);
    expect(text.match(/IFCRELCONTAINEDINSPATIALSTRUCTURE\(/g)).toHaveLength(2);
    // Openings and slabs are reported, not silently dropped.
    expect(skipped.map((s) => s.type)).toEqual(expect.arrayContaining(['door', 'window', 'floor']));
  });

  it('round-trips wall geometry, levels and project name', () => {
    const design = plan().design;
    const { text } = exportIfc(design);
    const back = importIfc(text);
    expect(back.name).toBe(design.name);
    expect(back.levels.map((l) => l.name)).toEqual(['Ground floor', 'Level 2']);
    expect(back.levels[1]!.elevationM).toBeCloseTo(3, 6);
    expect(back.warnings).toEqual([]);

    const walls = design.elements.filter((e): e is BuildingElement => e.type === 'wall');
    expect(back.walls).toHaveLength(walls.length);
    for (const original of walls) {
      const match = back.walls.find((w) => w.name === original.name);
      expect(match, original.name).toBeDefined();
      expect(match!.start.x).toBeCloseTo(original.start.x, 4);
      expect(match!.start.y).toBeCloseTo(original.start.y, 4);
      expect(match!.end.x).toBeCloseTo(original.end.x, 4);
      expect(match!.end.y).toBeCloseTo(original.end.y, 4);
      expect(match!.heightM).toBeCloseTo(original.heightM, 4);
      expect(match!.thicknessM).toBeCloseTo(original.thicknessM, 4);
      expect(match!.level).toBe(original.level);
    }
  });

  it('reports walls it cannot read instead of failing the whole import', () => {
    const text = [
      'ISO-10303-21;',
      'DATA;',
      "#1=IFCWALL('g',$,'odd',$,$,$,#2,$,.STANDARD.);",
      "#2=IFCPRODUCTDEFINITIONSHAPE($,$,(#3));",
      '#3=IFCSHAPEREPRESENTATION($,$,$,(#4));',
      '#4=IFCMAPPEDITEM($,$);',
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n');
    const result = importIfc(text);
    expect(result.walls).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/odd/);
  });

  it('skips walls whose level is missing and imports unassigned walls on level 0', () => {
    const design = plan().design;
    const orphan = { ...design.elements.find((e) => e.type === 'wall')!, id: nextId(), name: 'orphan', level: 9 };
    const { text, skipped } = exportIfc({ ...design, elements: [...design.elements, orphan] });
    expect(skipped).toContainEqual(expect.objectContaining({ elementId: orphan.id, reason: 'level not found' }));
    expect(text).not.toContain("'orphan'");

    // A wall with no containment relationship is still imported, on level 0.
    const unassigned = importIfc(
      [
        'ISO-10303-21;',
        'DATA;',
        "#1=IFCWALL('g',$,'loose',$,$,#2,#3,$,.STANDARD.);",
        '#2=IFCLOCALPLACEMENT($,#4);',
        '#4=IFCAXIS2PLACEMENT3D(#5,#6,#7);',
        '#5=IFCCARTESIANPOINT((1.,2.,0.));',
        '#6=IFCDIRECTION((0.,0.,1.));',
        '#7=IFCDIRECTION((1.,0.,0.));',
        '#3=IFCPRODUCTDEFINITIONSHAPE($,$,(#8));',
        '#8=IFCSHAPEREPRESENTATION($,$,$,(#9));',
        '#9=IFCEXTRUDEDAREASOLID(#10,#4,#6,3.);',
        '#10=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,4.,0.2);',
        'ENDSEC;',
        'END-ISO-10303-21;',
      ].join('\n'),
    );
    expect(unassigned.walls).toEqual([
      { name: 'loose', level: 0, start: { x: 1, y: 2 }, end: { x: 5, y: 2 }, heightM: 3, thicknessM: 0.2 },
    ]);
  });

  it('keeps accepting the schema after a round trip (HomeDesign still validates)', () => {
    expect(HomeDesign.safeParse(plan().design).success).toBe(true);
  });
});
