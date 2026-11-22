import { describe, expect, it } from 'vitest';
import { analyzePlanGeometry, extractPlanGeometry, parseFeetInches, parseRoomSize, parseScaleNote } from './plan-geometry';
import { drawPlan } from '../../test/fixtures/plan-pdf';

describe('plan geometry', () => {
  it('parses feet-inches, room sizes and scale notes', () => {
    expect(parseFeetInches(`24'-6"`)).toBeCloseTo(24.5);
    expect(parseFeetInches(`12' 0 1/2"`)).toBeCloseTo(12 + 0.5 / 12);
    expect(parseFeetInches('hello')).toBeNull();
    expect(parseRoomSize(`12'-0" x 14'-0"`)).toEqual([12, 14]);
    expect(parseRoomSize('11x13')).toEqual([11, 13]);
    expect(parseRoomSize('12\u2019-0" x 14\u2019-0"')).toEqual([12, 14]);
    expect(parseScaleNote(`SCALE: 1/4" = 1'-0"`)?.feetPerPoint).toBeCloseTo(1 / 18);
  });

  it('measures walls, outline, rooms and doors from a vector plan PDF', async () => {
    const pages = await extractPlanGeometry(await drawPlan());
    const r = analyzePlanGeometry(pages);
    expect(r.scale.source).toBe('scale_note');
    expect(r.scale.confidence).toBeGreaterThan(0.9); // note and dimensions agree
    expect(r.footprint).toMatchObject({ lengthFt: 48, widthFt: 32 });
    expect(r.walls.thicknessIn).toBe(6);
    expect(r.walls.exteriorLf).toBeGreaterThan(140);
    expect(r.walls.count).toBeGreaterThanOrEqual(5);
    expect(r.rooms.filter((x) => x.kind === 'bedroom')).toHaveLength(2);
    expect(r.rooms.find((x) => x.name === 'BEDROOM 1')).toMatchObject({ widthFt: 12, lengthFt: 14 });
    expect(r.rooms.some((x) => x.kind === 'bathroom')).toBe(true);
    expect(r.doors).toBe(3);
    expect(r.stories).toBe(1);
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('calibrates from dimension strings when the sheet has no scale note', async () => {
    const r = analyzePlanGeometry(await extractPlanGeometry(await drawPlan({ scaleNote: false })));
    expect(r.scale.source).toBe('dimensions');
    expect(r.footprint?.lengthFt).toBe(48);
    expect(r.footprint?.widthFt).toBe(32);
  });

  it('says plainly when nothing can be measured', () => {
    const r = analyzePlanGeometry([{ segments: [], arcs: [], texts: [{ str: 'NOTES', x: 0, y: 0 }] }]);
    expect(r.footprint).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.notes.join(' ')).toMatch(/No scale note/);
  });
});

describe('AutoCAD DXF plans', () => {
  it('reads walls, rooms and door blocks with the scale set by the drawing units', async () => {
    const { drawPlanDxf } = await import('../../test/fixtures/plan-dxf');
    const { analyzeDxfPlan } = await import('./plan-geometry');
    const r = analyzeDxfPlan(drawPlanDxf());
    expect(r.scale).toMatchObject({ source: 'scale_note', label: 'DXF units: inches' });
    expect(r.footprint).toMatchObject({ lengthFt: 48, widthFt: 32 });
    expect(r.walls.thicknessIn).toBe(6);
    expect(r.rooms.find((x) => x.name === 'BEDROOM 1')).toMatchObject({ widthFt: 12, lengthFt: 14 });
    expect(r.rooms.some((x) => x.name === 'LIVING ROOM')).toBe(true);
    expect(r.doors).toBe(3);
    expect(r.notes[0]).toMatch(/AutoCAD DXF/);
  });

  it('ignores a file that is not DXF', async () => {
    const { analyzeDxfPlan } = await import('./plan-geometry');
    const r = analyzeDxfPlan('hello world');
    expect(r.footprint).toBeNull();
  });
});
