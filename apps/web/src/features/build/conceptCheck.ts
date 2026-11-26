// Concept check for House Studio plans (AI Architecture reel, tool #4 idea: a concept-design
// checker over the house model). Pure rules over the same schematic rectangles the layout
// generator produces — no AI, no API, nothing to connect.
//
// This is a planning-sketch flag list, NOT a code review: the rectangle model cannot see
// doors, windows, structure or local code, and the UI says so wherever findings are shown.
// Thresholds below are stated planning minimums shown to the user, not code citations.
import type { HouseLayout, HouseProgram, Room, RoomKind } from './layout';

export type ConceptCheckId =
  | 'room_too_small'
  | 'bath_access'
  | 'bedroom_egress'
  | 'missing_stair'
  | 'program_mismatch'
  | 'plumbing_spread'
  | 'room_overlap'
  | 'room_out_of_bounds';

export interface ConceptFinding {
  id: string;
  severity: 'problem' | 'note';
  check: ConceptCheckId;
  /** Floor the finding belongs to (1-based level), or null for whole-house findings. */
  floorLevel: number | null;
  /** Room to highlight in the plan, when the finding is about one room. */
  roomId: string | null;
  roomName: string | null;
  title: string;
  reason: string;
  fix: string;
}

/** Stated planning minimums per room kind (shown in the UI; not building-code values). */
export const MIN_ROOM_SIZE: Partial<Record<RoomKind, { minDimFt: number; minAreaSqFt: number }>> = {
  bedroom: { minDimFt: 7, minAreaSqFt: 70 },
  primary: { minDimFt: 10, minAreaSqFt: 120 },
  bath: { minDimFt: 4, minAreaSqFt: 25 },
  kitchen: { minDimFt: 7, minAreaSqFt: 50 },
  living: { minDimFt: 10, minAreaSqFt: 120 },
  dining: { minDimFt: 8, minAreaSqFt: 70 },
  laundry: { minDimFt: 4, minAreaSqFt: 20 },
  flex: { minDimFt: 7, minAreaSqFt: 70 },
};

/** Wet rooms farther apart than this (center to center, same floor) get a soft cost note. */
export const PLUMBING_SPREAD_FT = 40;

const EPS = 0.05;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Shared wall length between two rectangles (0 when they only touch at a corner or not at all). */
export function sharedEdgeFt(a: Room, b: Room): number {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const sideBySide = Math.abs(a.x + a.w - b.x) <= EPS || Math.abs(b.x + b.w - a.x) <= EPS;
  const stacked = Math.abs(a.y + a.h - b.y) <= EPS || Math.abs(b.y + b.h - a.y) <= EPS;
  if (sideBySide && overlapY > EPS) return r1(overlapY);
  if (stacked && overlapX > EPS) return r1(overlapX);
  return 0;
}

/** True when the rectangle touches any edge of the footprint (an outside wall is possible). */
export function touchesExteriorWall(room: Room, lengthFt: number, widthFt: number): boolean {
  return (
    room.x <= EPS ||
    room.y <= EPS ||
    room.x + room.w >= lengthFt - EPS ||
    room.y + room.h >= widthFt - EPS
  );
}

const ACCESS_KINDS: ReadonlySet<RoomKind> = new Set(['hall', 'living', 'dining', 'flex', 'kitchen']);
const SLEEP_KINDS: ReadonlySet<RoomKind> = new Set(['bedroom', 'primary']);
const WET_KINDS: ReadonlySet<RoomKind> = new Set(['kitchen', 'bath', 'laundry']);

function center(r: Room): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Run every concept check over a layout. Findings come back problems first, then notes. */
export function conceptCheck(layout: HouseLayout, program: HouseProgram): ConceptFinding[] {
  const findings: ConceptFinding[] = [];
  const { lengthFt: L, widthFt: W } = layout.footprint;
  let seq = 0;
  const add = (f: Omit<ConceptFinding, 'id'>) => findings.push({ ...f, id: `cc-${(seq += 1)}` });

  for (const floor of layout.floors) {
    const rooms = floor.rooms;
    for (const room of rooms) {
      const area = room.w * room.h;
      // Out of bounds (only possible after manual room edits; generated plans tile exactly).
      if (room.x < -EPS || room.y < -EPS || room.x + room.w > L + EPS || room.y + room.h > W + EPS) {
        add({
          severity: 'problem',
          check: 'room_out_of_bounds',
          floorLevel: floor.level,
          roomId: room.id,
          roomName: room.name,
          title: `${room.name} sticks out of the footprint`,
          reason: `${room.name} on floor ${floor.level} extends past the ${L} × ${W} ft outline, so the plan no longer matches the takeoff footprint.`,
          fix: 'Move or shrink the room so it sits inside the outline, or reset the room edits.',
        });
      }
      // Too small against the stated planning minimums.
      const min = MIN_ROOM_SIZE[room.kind];
      if (min) {
        const smallDim = Math.min(room.w, room.h);
        if (smallDim < min.minDimFt || area < min.minAreaSqFt) {
          add({
            severity: 'problem',
            check: 'room_too_small',
            floorLevel: floor.level,
            roomId: room.id,
            roomName: room.name,
            title: `${room.name} is very small`,
            reason: `${room.name} on floor ${floor.level} is ${r1(room.w)} × ${r1(room.h)} ft (${Math.round(area)} sq ft). The planning minimum used here is ${min.minDimFt} ft on the short side and ${min.minAreaSqFt} sq ft.`,
            fix: 'Widen the footprint, drop a room from the program, or accept a tight room and note it for the client.',
          });
        }
      }
      // Bath access: a bath should share a wall with a hall or living space (or a bedroom, ensuite).
      if (room.kind === 'bath') {
        const neighbors = rooms.filter((o) => o.id !== room.id && sharedEdgeFt(room, o) > 0);
        const hasAccess = neighbors.some((o) => ACCESS_KINDS.has(o.kind));
        const ensuiteOnly = !hasAccess && neighbors.some((o) => SLEEP_KINDS.has(o.kind));
        if (!hasAccess) {
          add({
            severity: ensuiteOnly ? 'note' : 'problem',
            check: 'bath_access',
            floorLevel: floor.level,
            roomId: room.id,
            roomName: room.name,
            title: ensuiteOnly
              ? `${room.name} only opens off a bedroom`
              : `${room.name} has no hall access on this sketch`,
            reason: ensuiteOnly
              ? `${room.name} on floor ${floor.level} shares a wall only with a bedroom, so on this sketch it reads as an ensuite with no hall entry. Doors are not drawn in this model, so check the real plan.`
              : `${room.name} on floor ${floor.level} shares no wall with a hall, living, dining, kitchen or flex space, so there is no obvious way in on this sketch. Doors are not drawn in this model, so check the real plan.`,
            fix: 'Shift the bath next to the hall, or confirm on the real plan that a door from the hall or a bedroom is intended.',
          });
        }
      }
      // Bedroom egress: no exterior wall means no window wall on the sketch.
      if (SLEEP_KINDS.has(room.kind) && !touchesExteriorWall(room, L, W)) {
        add({
          severity: 'problem',
          check: 'bedroom_egress',
          floorLevel: floor.level,
          roomId: room.id,
          roomName: room.name,
          title: `${room.name} has no outside wall`,
          reason: `${room.name} on floor ${floor.level} touches no edge of the footprint, so there is no wall for an egress window on this sketch. The takeoff assumes one egress window per bedroom.`,
          fix: 'Move the bedroom to an outside wall, or treat the space as a flex/office room instead of a bedroom.',
        });
      }
    }
    // Overlaps (only possible after manual room edits).
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i]!;
        const b = rooms[j]!;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > EPS && oy > EPS) {
          add({
            severity: 'problem',
            check: 'room_overlap',
            floorLevel: floor.level,
            roomId: b.id,
            roomName: b.name,
            title: `${a.name} and ${b.name} overlap`,
            reason: `${a.name} and ${b.name} on floor ${floor.level} overlap by about ${Math.round(ox * oy)} sq ft, so room areas double-count that space.`,
            fix: 'Move or resize one of the rooms so they only share a wall, or reset the room edits.',
          });
        }
      }
    }
    // Plumbing spread (soft cost note only).
    const wet = rooms.filter((r) => WET_KINDS.has(r.kind));
    let farthest = 0;
    let farPair: [Room, Room] | null = null;
    for (let i = 0; i < wet.length; i++) {
      for (let j = i + 1; j < wet.length; j++) {
        const ca = center(wet[i]!);
        const cb = center(wet[j]!);
        const d = Math.hypot(ca.x - cb.x, ca.y - cb.y);
        if (d > farthest) {
          farthest = d;
          farPair = [wet[i]!, wet[j]!];
        }
      }
    }
    if (farPair && farthest > PLUMBING_SPREAD_FT) {
      add({
        severity: 'note',
        check: 'plumbing_spread',
        floorLevel: floor.level,
        roomId: farPair[1].id,
        roomName: farPair[1].name,
        title: 'Wet rooms are spread out',
        reason: `${farPair[0].name} and ${farPair[1].name} on floor ${floor.level} are about ${Math.round(farthest)} ft apart (center to center). Longer water and drain runs usually cost more; this is a cost note, not a code claim.`,
        fix: 'Group kitchen, baths and laundry closer together if the plan allows, or budget for the longer runs.',
      });
    }
  }

  // Two stories need a stair on each floor.
  if (layout.floors.length > 1) {
    for (const floor of layout.floors) {
      if (!floor.rooms.some((r) => r.kind === 'stair')) {
        add({
          severity: 'problem',
          check: 'missing_stair',
          floorLevel: floor.level,
          roomId: null,
          roomName: null,
          title: `No stair on floor ${floor.level}`,
          reason: `This is a ${layout.floors.length}-story plan but floor ${floor.level} has no stair space, so there is no way between floors on this sketch.`,
          fix: 'Add stair space to the program or switch to one story.',
        });
      }
    }
  }

  // Program mismatch: what was asked for vs what the sketch holds.
  const allRooms = layout.floors.flatMap((f) => f.rooms);
  const beds = allRooms.filter((r) => SLEEP_KINDS.has(r.kind)).length;
  const baths = allRooms.filter((r) => r.kind === 'bath').length;
  if (beds !== program.bedrooms) {
    add({
      severity: 'note',
      check: 'program_mismatch',
      floorLevel: null,
      roomId: null,
      roomName: null,
      title: 'Bedroom count differs from the program',
      reason: `The program asks for ${program.bedrooms} bedroom${program.bedrooms === 1 ? '' : 's'} but the sketch holds ${beds}.`,
      fix: 'Adjust the bedroom count in the program, or accept the sketch count and update the program to match.',
    });
  }
  if (baths !== program.bathrooms) {
    add({
      severity: 'note',
      check: 'program_mismatch',
      floorLevel: null,
      roomId: null,
      roomName: null,
      title: 'Bathroom count differs from the program',
      reason: `The program asks for ${program.bathrooms} bathroom${program.bathrooms === 1 ? '' : 's'} but the sketch holds ${baths}. Two-story plans get at least one bath on each floor.`,
      fix: 'Adjust the bathroom count in the program, or accept the sketch count and update the program to match.',
    });
  }

  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'problem' ? -1 : 1));
}

export interface AreaScheduleRow {
  floorLevel: number;
  roomId: string;
  name: string;
  kind: RoomKind;
  w: number;
  h: number;
  areaSqFt: number;
}

/** Room-by-room areas from the same rectangles (the "rebuild area schedule" line). */
export function areaSchedule(layout: HouseLayout): AreaScheduleRow[] {
  return layout.floors.flatMap((floor) =>
    floor.rooms.map((room) => ({
      floorLevel: floor.level,
      roomId: room.id,
      name: room.name,
      kind: room.kind,
      w: r1(room.w),
      h: r1(room.h),
      areaSqFt: Math.round(room.w * room.h),
    })),
  );
}
