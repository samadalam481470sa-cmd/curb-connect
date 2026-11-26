import { describe, expect, it } from 'vitest';
import { areaSchedule, conceptCheck, sharedEdgeFt, touchesExteriorWall } from './conceptCheck';
import { generateLayout, type HouseLayout, type HouseProgram, type Room } from './layout';

const program: HouseProgram = {
  lengthFt: 50,
  widthFt: 32,
  stories: 1,
  bedrooms: 3,
  bathrooms: 2,
  garage: 'none',
};

function room(partial: Partial<Room> & Pick<Room, 'id' | 'name' | 'kind' | 'x' | 'y' | 'w' | 'h'>): Room {
  return partial;
}

function layoutOf(rooms: Room[], floors = 1): HouseLayout {
  return {
    footprint: { lengthFt: 50, widthFt: 32 },
    floors: Array.from({ length: floors }, (_, i) => ({
      level: i + 1,
      rooms: i === 0 ? rooms : [],
      interiorWallFt: 0,
    })),
    garage: null,
    conditionedAreaSqFt: 1600 * floors,
    warnings: [],
  };
}

describe('sharedEdgeFt / touchesExteriorWall', () => {
  it('measures shared walls and ignores corner touches', () => {
    const a = room({ id: 'a', name: 'A', kind: 'bath', x: 0, y: 0, w: 8, h: 10 });
    const side = room({ id: 'b', name: 'B', kind: 'hall', x: 8, y: 2, w: 6, h: 6 });
    const corner = room({ id: 'c', name: 'C', kind: 'hall', x: 8, y: 10, w: 6, h: 6 });
    expect(sharedEdgeFt(a, side)).toBe(6);
    expect(sharedEdgeFt(a, corner)).toBe(0);
  });

  it('detects exterior walls', () => {
    expect(touchesExteriorWall(room({ id: 'a', name: 'A', kind: 'bedroom', x: 0, y: 5, w: 10, h: 10 }), 50, 32)).toBe(true);
    expect(touchesExteriorWall(room({ id: 'a', name: 'A', kind: 'bedroom', x: 10, y: 10, w: 10, h: 10 }), 50, 32)).toBe(false);
  });
});

describe('conceptCheck', () => {
  it('passes a clean generated plan with no problems', () => {
    const layout = generateLayout(program);
    const findings = conceptCheck(layout, program);
    expect(findings.filter((f) => f.severity === 'problem')).toEqual([]);
  });

  it('flags a bath with no hall access', () => {
    const layout = layoutOf([
      room({ id: 'bed', name: 'Bedroom 2', kind: 'bedroom', x: 0, y: 0, w: 14, h: 14 }),
      room({ id: 'bath', name: 'Bath 1', kind: 'bath', x: 14, y: 0, w: 8, h: 14 }),
      room({ id: 'flex', name: 'Flex', kind: 'flex', x: 22, y: 0, w: 28, h: 14 }),
      room({ id: 'hall', name: 'Hall', kind: 'hall', x: 0, y: 14, w: 50, h: 4 }),
    ]);
    const bathFindings = conceptCheck(layout, program).filter((f) => f.check === 'bath_access');
    // Bath shares a wall with the bedroom and the flex room (an access kind) — no finding.
    expect(bathFindings).toEqual([]);
    const enclosed = layoutOf([
      room({ id: 'bed', name: 'Bedroom 2', kind: 'bedroom', x: 0, y: 0, w: 14, h: 14 }),
      room({ id: 'bath', name: 'Bath 1', kind: 'bath', x: 14, y: 0, w: 8, h: 14 }),
      room({ id: 'bed2', name: 'Bedroom 3', kind: 'bedroom', x: 22, y: 0, w: 14, h: 14 }),
      room({ id: 'hall', name: 'Hall', kind: 'hall', x: 36, y: 0, w: 14, h: 14 }),
    ]);
    const enclosedFindings = conceptCheck(enclosed, program).filter((f) => f.check === 'bath_access');
    expect(enclosedFindings).toHaveLength(1);
    expect(enclosedFindings[0]!.severity).toBe('note'); // ensuite-only
    expect(enclosedFindings[0]!.roomId).toBe('bath');
  });

  it('flags an interior bedroom with no exterior wall', () => {
    const layout = layoutOf([
      room({ id: 'bed', name: 'Bedroom 2', kind: 'bedroom', x: 20, y: 10, w: 12, h: 12 }),
      room({ id: 'hall', name: 'Hall', kind: 'hall', x: 0, y: 0, w: 50, h: 4 }),
    ]);
    const findings = conceptCheck(layout, program).filter((f) => f.check === 'bedroom_egress');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('problem');
  });

  it('flags a missing stair on a two-story plan', () => {
    const layout = layoutOf(
      [room({ id: 'bed', name: 'Bedroom 2', kind: 'bedroom', x: 0, y: 0, w: 14, h: 14 })],
      2,
    );
    const findings = conceptCheck(layout, { ...program, stories: 2 }).filter(
      (f) => f.check === 'missing_stair',
    );
    expect(findings).toHaveLength(2);
  });

  it('flags a tiny room against the stated minimums', () => {
    const layout = layoutOf([
      room({ id: 'bath', name: 'Bath 1', kind: 'bath', x: 0, y: 0, w: 3, h: 6 }),
      room({ id: 'hall', name: 'Hall', kind: 'hall', x: 3, y: 0, w: 10, h: 6 }),
    ]);
    const findings = conceptCheck(layout, program).filter((f) => f.check === 'room_too_small');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.reason).toContain('4 ft');
  });

  it('flags program count mismatches', () => {
    const layout = generateLayout({ ...program, stories: 2, bathrooms: 1 });
    const findings = conceptCheck(layout, { ...program, stories: 2, bathrooms: 1 }).filter(
      (f) => f.check === 'program_mismatch',
    );
    // Two-story generator puts a bath on each floor: 2 baths for a 1-bath program.
    expect(findings.some((f) => f.title.includes('Bathroom'))).toBe(true);
  });

  it('flags overlapping rooms from manual edits', () => {
    const layout = layoutOf([
      room({ id: 'a', name: 'Living', kind: 'living', x: 0, y: 0, w: 20, h: 14 }),
      room({ id: 'b', name: 'Kitchen', kind: 'kitchen', x: 15, y: 0, w: 20, h: 14 }),
    ]);
    const findings = conceptCheck(layout, program).filter((f) => f.check === 'room_overlap');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('problem');
  });

  it('notes plumbing spread over the threshold', () => {
    const layout = layoutOf([
      room({ id: 'k', name: 'Kitchen', kind: 'kitchen', x: 0, y: 0, w: 12, h: 12 }),
      room({ id: 'b', name: 'Bath 1', kind: 'bath', x: 42, y: 0, w: 8, h: 10 }),
      room({ id: 'h', name: 'Hall', kind: 'hall', x: 12, y: 0, w: 30, h: 4 }),
    ]);
    const findings = conceptCheck(layout, program).filter((f) => f.check === 'plumbing_spread');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('note');
  });
});

describe('areaSchedule', () => {
  it('lists every room with its area', () => {
    const layout = generateLayout(program);
    const rows = areaSchedule(layout);
    expect(rows.length).toBe(layout.floors[0]!.rooms.length);
    const total = rows.reduce((s, r) => s + r.areaSqFt, 0);
    expect(Math.abs(total - 1600)).toBeLessThan(5);
  });
});
