import { describe, expect, it } from 'vitest';
import { generateLayout, type HouseProgram } from './layout';
import { applyRoomEdits, clampRoomRect, removeRoomEdit, upsertRoomEdit } from './roomEdits';
import { computeTakeoff, DEFAULT_SPEC } from './takeoff';

const program: HouseProgram = {
  lengthFt: 50,
  widthFt: 32,
  stories: 1,
  bedrooms: 3,
  bathrooms: 2,
  garage: 'none',
};

describe('clampRoomRect', () => {
  it('keeps the rectangle inside the footprint with a minimum side', () => {
    expect(clampRoomRect({ x: -5, y: 40, w: 1, h: 2 }, 50, 32)).toEqual({ x: 0, y: 29, w: 3, h: 3 });
    expect(clampRoomRect({ x: 48, y: 0, w: 20, h: 10 }, 50, 32)).toEqual({ x: 30, y: 0, w: 20, h: 10 });
  });
});

describe('upsertRoomEdit / removeRoomEdit', () => {
  it('replaces an existing edit and removes by id', () => {
    const a = upsertRoomEdit([], { roomId: 'r1', x: 0, y: 0, w: 10, h: 10 });
    const b = upsertRoomEdit(a, { roomId: 'r1', x: 5, y: 0, w: 10, h: 10 });
    expect(b).toHaveLength(1);
    expect(b[0]!.x).toBe(5);
    expect(removeRoomEdit(b, 'r1')).toEqual([]);
  });
});

describe('applyRoomEdits', () => {
  it('moves a room and recomputes interior wall length on resize', () => {
    const layout = generateLayout(program);
    const target = layout.floors[0]!.rooms[0]!;
    const edited = applyRoomEdits(layout, [{ roomId: target.id, x: target.x + 2, y: target.y, w: target.w + 3, h: target.h }]);
    const moved = edited.floors[0]!.rooms[0]!;
    expect(moved.x).toBe(target.x + 2);
    expect(moved.w).toBe(target.w + 3);
    expect(edited.floors[0]!.interiorWallFt).not.toBe(layout.floors[0]!.interiorWallFt);
    expect(edited.conditionedAreaSqFt).toBe(layout.conditionedAreaSqFt);
  });

  it('ignores edits for rooms that no longer exist', () => {
    const layout = generateLayout(program);
    const edited = applyRoomEdits(layout, [{ roomId: 'nope', x: 0, y: 0, w: 10, h: 10 }]);
    expect(edited).toBe(layout);
  });

  it('returns the layout untouched with no edits', () => {
    const layout = generateLayout(program);
    expect(applyRoomEdits(layout, undefined)).toBe(layout);
    expect(applyRoomEdits(layout, [])).toBe(layout);
  });

  it('flows through computeTakeoff so the takeoff follows the edited plan', () => {
    const base = computeTakeoff(DEFAULT_SPEC);
    const target = base.layout.floors[0]!.rooms[0]!;
    const edited = computeTakeoff({
      ...DEFAULT_SPEC,
      roomEdits: [{ roomId: target.id, x: target.x, y: target.y, w: target.w + 4, h: target.h }],
    });
    expect(edited.layout.floors[0]!.rooms[0]!.w).toBe(target.w + 4);
    expect(edited.summary.interiorWallFt).not.toBe(base.summary.interiorWallFt);
  });
});
