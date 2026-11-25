// Geometry repair — the QGIS makeValid idea, implemented from the validation primitives in
// polygon.ts (no GEOS or QGIS code copied). A repair is always reported, never silent, and is
// only applied when the contractor confirms it in the UI. When a ring cannot be repaired
// deterministically the original ring is returned untouched with ok: false.
import { GeometryError } from './numeric';
import { at, cyclic } from './numeric';
import {
  DEFAULT_TOLERANCE,
  openRing,
  samePoint,
  segmentsProperlyCross,
  signedArea,
  validatePolygon,
  type Point,
  type Tolerance,
} from './polygon';
import { projectRing, type LonLat } from './projection';

export interface RepairResult {
  /** The repaired ring when ok is true; the untouched input ring when ok is false. */
  ring: Point[];
  /** Plain-language description of every change made (empty when nothing needed changing). */
  actions: string[];
  ok: boolean;
}

/** Crossing point of segments ab and cd when they properly cross; null otherwise. */
export function segmentCrossingPoint(a: Point, b: Point, c: Point, d: Point): Point | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const qpx = c.x - a.x;
  const qpy = c.y - a.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

/** Vertices from index `from` to index `to` inclusive, walking forward around the ring. */
function arc(ring: readonly Point[], from: number, to: number): Point[] {
  const n = ring.length;
  const out: Point[] = [];
  let i = ((from % n) + n) % n;
  const end = ((to % n) + n) % n;
  for (;;) {
    out.push(at(ring, i));
    if (i === end) break;
    i = (i + 1) % n;
  }
  return out;
}

/**
 * Repair an open planar ring: strip a closing duplicate, drop duplicate vertices, and split
 * a single bow-tie self-intersection into one simple outline (keeping the larger part).
 * Rings with several crossings, zero area, or non-finite coordinates cannot be repaired
 * deterministically and are returned untouched with ok: false.
 */
export function repairRing(
  input: readonly Point[],
  tolerance: Tolerance = DEFAULT_TOLERANCE,
): RepairResult {
  const actions: string[] = [];
  const fail = (why: string): RepairResult => ({ ring: [...input], actions: [...actions, why], ok: false });
  if (input.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return fail('Ring has non-finite coordinates — redraw the outline.');
  }
  let ring = openRing(input, tolerance.length);
  if (ring.length !== input.length) actions.push('Removed the closing duplicate vertex.');
  const deduped: Point[] = [];
  for (const p of ring) {
    if (deduped.length === 0 || !samePoint(deduped[deduped.length - 1]!, p, tolerance.length)) {
      deduped.push(p);
    }
  }
  if (deduped.length > 1 && samePoint(deduped[0]!, deduped[deduped.length - 1]!, tolerance.length)) {
    deduped.pop();
  }
  const dropped = ring.length - deduped.length;
  if (dropped > 0) actions.push(`Removed ${dropped} duplicate ${dropped === 1 ? 'vertex' : 'vertices'}.`);
  ring = deduped;
  if (ring.length < 3) {
    return fail(`Too few vertices left after cleanup (${ring.length}) — redraw the outline.`);
  }
  // A symmetric bow-tie has zero *signed* area, so the zero-area check runs after the split.
  const n = ring.length;
  const crossings: { i: number; j: number; point: Point }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = at(ring, i);
      const b = cyclic(ring, i + 1);
      const c = at(ring, j);
      const d = cyclic(ring, j + 1);
      if (!segmentsProperlyCross(a, b, c, d, tolerance.length)) continue;
      const point = segmentCrossingPoint(a, b, c, d);
      if (point) crossings.push({ i, j, point });
    }
  }
  if (crossings.length > 1) {
    return fail(
      `Ring crosses itself ${crossings.length} times — redraw the outline instead of repairing it.`,
    );
  }
  if (crossings.length === 1) {
    const { i, j, point } = crossings[0]!;
    const partA = [point, ...arc(ring, i + 1, j)];
    const partB = [point, ...arc(ring, j + 1, i)];
    const kept = Math.abs(signedArea(partA)) >= Math.abs(signedArea(partB)) ? partA : partB;
    const droppedArea = Math.abs(signedArea(kept === partA ? partB : partA));
    actions.push(
      `Split a self-intersection into a single outline (kept the larger part; ` +
        `dropped a ${droppedArea.toFixed(1)} m² piece).`,
    );
    ring = kept;
  }
  if (Math.abs(signedArea(ring)) <= tolerance.area) {
    return fail('Ring has zero area — redraw the outline.');
  }
  const remaining = validatePolygon(ring, { tolerance });
  const blocking = remaining.filter(
    (issue) => issue.code === 'self_intersection' || issue.code === 'zero_area',
  );
  if (blocking.length > 0) {
    return fail('Repair left the outline invalid — redraw it instead.');
  }
  return { ring, actions, ok: true };
}

/** Repair a lon/lat ring the same way, in its local tangent plane. */
export function repairLonLatRing(input: readonly LonLat[]): {
  ring: LonLat[];
  actions: string[];
  ok: boolean;
} {
  if (input.length < 3) {
    return { ring: [...input], actions: ['Too few vertices — redraw the outline.'], ok: false };
  }
  let projected;
  try {
    projected = projectRing(input);
  } catch (e) {
    return {
      ring: [...input],
      actions: [e instanceof GeometryError ? e.message : 'Invalid coordinates — redraw the outline.'],
      ok: false,
    };
  }
  const { plane: p, points } = projected;
  const repaired = repairRing(points);
  if (!repaired.ok) return { ring: [...input], actions: repaired.actions, ok: false };
  return { ring: repaired.ring.map((pt) => p.unproject(pt)), actions: repaired.actions, ok: true };
}
