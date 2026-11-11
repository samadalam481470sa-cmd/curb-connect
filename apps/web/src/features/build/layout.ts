// House Builder layout generator (HB-001).
//
// Turns a rectangular footprint plus a room program (bedrooms, baths, stories, garage) into a
// schematic floor plan made of axis-aligned rectangles that tile each floor exactly. It is a
// planning sketch for quantities and conversation with a client, not an architectural design:
// no code review, egress check or structural design happens here.

export interface HouseProgram {
  lengthFt: number;
  widthFt: number;
  stories: 1 | 2;
  bedrooms: number;
  bathrooms: number;
  garage: 'none' | 'one_car' | 'two_car';
}

export type RoomKind =
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'bedroom'
  | 'primary'
  | 'bath'
  | 'hall'
  | 'laundry'
  | 'stair'
  | 'garage'
  | 'flex';

export interface Room {
  id: string;
  name: string;
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Floor {
  level: number;
  rooms: Room[];
  /** Partition wall length inside the footprint (feet), excluding exterior walls. */
  interiorWallFt: number;
}

export interface HouseLayout {
  footprint: { lengthFt: number; widthFt: number };
  floors: Floor[];
  garage: Room | null;
  conditionedAreaSqFt: number;
  warnings: string[];
}

export const LIMITS = {
  minLength: 20,
  maxLength: 120,
  minWidth: 20,
  maxWidth: 80,
  maxBedrooms: 6,
  maxBathrooms: 5,
} as const;

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Split `total` into segments proportional to `weights`, rounded to 0.5 ft, summing exactly. */
export function splitLength(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let used = 0;
  weights.forEach((w, i) => {
    if (i === weights.length - 1) {
      out.push(round(total - used));
    } else {
      const seg = Math.round(((total * w) / sum) * 2) / 2;
      out.push(seg);
      used += seg;
    }
  });
  return out;
}

interface RowItem {
  name: string;
  kind: RoomKind;
  weight: number;
}

function row(
  items: readonly RowItem[],
  y: number,
  h: number,
  lengthFt: number,
  prefix: string,
): Room[] {
  const widths = splitLength(
    lengthFt,
    items.map((i) => i.weight),
  );
  let x = 0;
  return items.map((item, i) => {
    const room: Room = {
      id: `${prefix}-${i}`,
      name: item.name,
      kind: item.kind,
      x: round(x),
      y: round(y),
      w: widths[i]!,
      h: round(h),
    };
    x += widths[i]!;
    return room;
  });
}

/** Interior partition length for rectangles that exactly tile an L × W footprint. */
export function interiorWallLength(
  rooms: readonly Room[],
  lengthFt: number,
  widthFt: number,
): number {
  const perimeters = rooms.reduce((sum, r) => sum + 2 * (r.w + r.h), 0);
  return round((perimeters - 2 * (lengthFt + widthFt)) / 2, 1);
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));
}

export function normalizeProgram(p: HouseProgram): { program: HouseProgram; warnings: string[] } {
  const warnings: string[] = [];
  let lengthFt = Number.isFinite(p.lengthFt) ? p.lengthFt : 40;
  let widthFt = Number.isFinite(p.widthFt) ? p.widthFt : 30;
  // Keep the long side as "length" so rooms line up along it.
  if (widthFt > lengthFt) [lengthFt, widthFt] = [widthFt, lengthFt];
  const clampedL = Math.min(LIMITS.maxLength, Math.max(LIMITS.minLength, lengthFt));
  const clampedW = Math.min(LIMITS.maxWidth, Math.max(LIMITS.minWidth, widthFt));
  if (clampedL !== lengthFt || clampedW !== widthFt) {
    warnings.push(
      `Footprint limited to ${LIMITS.minLength}–${LIMITS.maxLength} ft by ${LIMITS.minWidth}–${LIMITS.maxWidth} ft.`,
    );
  }
  return {
    program: {
      lengthFt: round(clampedL, 1),
      widthFt: round(clampedW, 1),
      stories: p.stories === 2 ? 2 : 1,
      bedrooms: clampInt(p.bedrooms, 1, LIMITS.maxBedrooms),
      bathrooms: clampInt(p.bathrooms, 1, LIMITS.maxBathrooms),
      garage: p.garage,
    },
    warnings,
  };
}

/** Band depths across the width: private rooms, hallway, public rooms. */
function bands(widthFt: number): { privateD: number; hallD: number; publicD: number } {
  const hallD = widthFt >= 26 ? 4 : 3.5;
  const privateD = round(Math.min(14, Math.max(10, (widthFt - hallD) * 0.45)), 1);
  return { privateD, hallD, publicD: round(widthFt - hallD - privateD, 1) };
}

export function generateLayout(input: HouseProgram): HouseLayout {
  const { program, warnings } = normalizeProgram(input);
  const { lengthFt: L, widthFt: W, stories, bedrooms, bathrooms } = program;
  const { privateD, hallD, publicD } = bands(W);

  const bedroomItems = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      i === 0
        ? { name: 'Primary bedroom', kind: 'primary' as const, weight: 14 }
        : { name: `Bedroom ${i + 1}`, kind: 'bedroom' as const, weight: 11 },
    );
  const bathItems = (count: number, start = 1) =>
    Array.from({ length: count }, (_, i) => ({
      name: `Bath ${start + i}`,
      kind: 'bath' as const,
      weight: 8,
    }));

  const floors: Floor[] = [];

  if (stories === 1) {
    const privateRow = [...bedroomItems(bedrooms), ...bathItems(bathrooms)];
    const publicRow = [
      { name: 'Living', kind: 'living' as const, weight: 16 },
      { name: 'Dining', kind: 'dining' as const, weight: 11 },
      { name: 'Kitchen', kind: 'kitchen' as const, weight: 13 },
      { name: 'Laundry', kind: 'laundry' as const, weight: 6 },
    ];
    const rooms = [
      ...row(privateRow, 0, privateD, L, 'f1p'),
      ...row([{ name: 'Hall', kind: 'hall', weight: 1 }], privateD, hallD, L, 'f1h'),
      ...row(publicRow, privateD + hallD, publicD, L, 'f1c'),
    ];
    floors.push({ level: 1, rooms, interiorWallFt: interiorWallLength(rooms, L, W) });
  } else {
    const downBaths = 1;
    const upBaths = Math.max(1, bathrooms - downBaths);
    const groundPrivate = [
      { name: 'Flex / office', kind: 'flex' as const, weight: 12 },
      ...bathItems(downBaths),
      { name: 'Laundry', kind: 'laundry' as const, weight: 7 },
      { name: 'Stair', kind: 'stair' as const, weight: 4 },
    ];
    const groundPublic = [
      { name: 'Living', kind: 'living' as const, weight: 18 },
      { name: 'Dining', kind: 'dining' as const, weight: 12 },
      { name: 'Kitchen', kind: 'kitchen' as const, weight: 14 },
    ];
    const ground = [
      ...row(groundPrivate, 0, privateD, L, 'f1p'),
      ...row([{ name: 'Hall', kind: 'hall', weight: 1 }], privateD, hallD, L, 'f1h'),
      ...row(groundPublic, privateD + hallD, publicD, L, 'f1c'),
    ];
    floors.push({ level: 1, rooms: ground, interiorWallFt: interiorWallLength(ground, L, W) });

    const half = Math.ceil(bedrooms / 2);
    const upA = [
      ...bedroomItems(bedrooms).slice(0, half),
      { name: 'Stair', kind: 'stair' as const, weight: 4 },
    ];
    const upB: RowItem[] = [
      ...bedroomItems(bedrooms).slice(half),
      ...bathItems(upBaths, downBaths + 1),
    ];
    const upper = [
      ...row(upA, 0, privateD, L, 'f2p'),
      ...row([{ name: 'Hall', kind: 'hall', weight: 1 }], privateD, hallD, L, 'f2h'),
      ...row(upB, privateD + hallD, publicD, L, 'f2c'),
    ];
    floors.push({ level: 2, rooms: upper, interiorWallFt: interiorWallLength(upper, L, W) });
    if (bathrooms < 2) warnings.push('Two-story plans get at least one bath on each floor.');
  }

  for (const floor of floors) {
    for (const room of floor.rooms) {
      if (room.kind !== 'hall' && room.kind !== 'stair' && Math.min(room.w, room.h) < 7) {
        warnings.push(
          `${room.name} on floor ${floor.level} is narrower than 7 ft (${Math.min(room.w, room.h)} ft). Increase the footprint or reduce rooms.`,
        );
      }
    }
  }

  let garage: Room | null = null;
  if (program.garage !== 'none') {
    const gw = program.garage === 'two_car' ? 22 : 12;
    const gd = Math.min(22, W);
    garage = {
      id: 'garage',
      name: program.garage === 'two_car' ? '2-car garage' : '1-car garage',
      kind: 'garage',
      x: L,
      y: round(W - gd),
      w: gw,
      h: gd,
    };
  }

  return {
    footprint: { lengthFt: L, widthFt: W },
    floors,
    garage,
    conditionedAreaSqFt: round(L * W * stories, 0),
    warnings,
  };
}
