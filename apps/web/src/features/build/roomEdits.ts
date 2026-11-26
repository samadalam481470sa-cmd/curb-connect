// Room edits for the schematic plan (AI Architecture reel, tool #1 idea — the usable slice of
// a freeform plan editor): move and resize the generated room rectangles in 2D. Edits are
// stored on the house spec, applied over the generated layout inside computeTakeoff, so the
// takeoff, the 3D studio and the exports all follow the edited rectangles.
//
// Honest limits: rooms stay axis-aligned rectangles; rooms cannot be added or removed here
// (the program controls do that); edits are keyed by the generated room id, so changing the
// program can renumber rooms and orphan an edit (orphans are ignored, never applied to the
// wrong room); overlaps are allowed while dragging and are flagged by the concept check.
import type { RoomEdit } from '@fieldline/contracts';
import { interiorWallLength, type HouseLayout, type Room } from './layout';

export type { RoomEdit };

/** Smallest room side the editor allows, in feet. */
export const MIN_ROOM_SIDE_FT = 3;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Clamp a rectangle inside the footprint with a minimum side. */
export function clampRoomRect(
  rect: { x: number; y: number; w: number; h: number },
  lengthFt: number,
  widthFt: number,
): { x: number; y: number; w: number; h: number } {
  const w = Math.min(lengthFt, Math.max(MIN_ROOM_SIDE_FT, rect.w));
  const h = Math.min(widthFt, Math.max(MIN_ROOM_SIDE_FT, rect.h));
  const x = Math.min(Math.max(0, rect.x), Math.max(0, lengthFt - w));
  const y = Math.min(Math.max(0, rect.y), Math.max(0, widthFt - h));
  return { x: r1(x), y: r1(y), w: r1(w), h: r1(h) };
}

/** Insert or replace one room's edit. */
export function upsertRoomEdit(edits: readonly RoomEdit[], edit: RoomEdit): RoomEdit[] {
  const rest = edits.filter((e) => e.roomId !== edit.roomId);
  return [...rest, edit];
}

/** Drop one room's edit (back to the generated rectangle). */
export function removeRoomEdit(edits: readonly RoomEdit[], roomId: string): RoomEdit[] {
  return edits.filter((e) => e.roomId !== roomId);
}

/**
 * Apply stored edits over a generated layout. Unknown room ids are ignored. Interior wall
 * length is recomputed with the same perimeter formula the generator uses, so the takeoff
 * follows the edited rectangles (still an estimate, like the rest of the schematic takeoff).
 */
export function applyRoomEdits(layout: HouseLayout, edits: readonly RoomEdit[] | undefined): HouseLayout {
  if (!edits || edits.length === 0) return layout;
  const byId = new Map(edits.map((e) => [e.roomId, e]));
  const { lengthFt: L, widthFt: W } = layout.footprint;
  let changed = false;
  const floors = layout.floors.map((floor) => {
    const rooms: Room[] = floor.rooms.map((room) => {
      const edit = byId.get(room.id);
      if (!edit) return room;
      changed = true;
      const rect = clampRoomRect(edit, L, W);
      return { ...room, ...rect };
    });
    return { ...floor, rooms, interiorWallFt: interiorWallLength(rooms, L, W) };
  });
  if (!changed) return layout;
  return { ...layout, floors };
}
