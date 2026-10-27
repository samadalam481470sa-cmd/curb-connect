// Planar polygon math and validation (RF-023, RF-025).
//
// Coordinates are planar meters (local tangent plane, plan-scale blueprint meters, or homography
// plane meters). Rings are OPEN (last vertex != first, closure implied) unless a function says
// otherwise. Counter-clockwise (CCW) is the canonical winding: positive signed area.
import { at, cyclic, GeometryError, isFiniteNumber, neumaierSum } from './numeric';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Tolerances used by validation. Lengths in meters, areas in square meters. */
export interface Tolerance {
  /** Two vertices closer than this are the same point. Default 1e-6 m (1 micron). */
  readonly length: number;
  /** A polygon with |area| below this is zero-area. Default 1e-9 m2. */
  readonly area: number;
}

export const DEFAULT_TOLERANCE: Tolerance = Object.freeze({ length: 1e-6, area: 1e-9 });

export type PolygonIssueCode =
  | 'non_finite_coordinate'
  | 'unclosed'
  | 'too_few_vertices'
  | 'duplicate_vertex'
  | 'zero_area'
  | 'self_intersection';

export interface PolygonIssue {
  readonly code: PolygonIssueCode;
  readonly message: string;
  /** Vertex or edge indices involved (edge i runs from vertex i to vertex i+1). */
  readonly indices: readonly number[];
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function samePoint(a: Point, b: Point, tol = DEFAULT_TOLERANCE.length): boolean {
  return distance(a, b) <= tol;
}

/** Twice the signed area of triangle (a, b, c); > 0 when counter-clockwise. */
export function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Shoelace signed area of an open ring, computed relative to the first vertex to limit
 * cancellation when coordinates are large (e.g. projected meters far from the origin).
 */
export function signedArea(ring: readonly Point[]): number {
  if (ring.length < 3) return 0;
  const o = at(ring, 0);
  const terms: number[] = [];
  for (let i = 1; i < ring.length - 1; i++) {
    terms.push(cross(o, at(ring, i), at(ring, i + 1)));
  }
  return neumaierSum(terms) / 2;
}

export function area(ring: readonly Point[]): number {
  return Math.abs(signedArea(ring));
}

export function perimeter(ring: readonly Point[]): number {
  if (ring.length < 2) return 0;
  const lengths: number[] = [];
  for (let i = 0; i < ring.length; i++) lengths.push(distance(at(ring, i), cyclic(ring, i + 1)));
  return neumaierSum(lengths);
}

/** Area centroid. Throws for zero-area rings (validate first). */
export function centroid(ring: readonly Point[]): Point {
  const a = signedArea(ring);
  if (Math.abs(a) <= DEFAULT_TOLERANCE.area) {
    throw new GeometryError('zero_area', 'centroid is undefined for a zero-area polygon');
  }
  const o = at(ring, 0);
  const cx: number[] = [];
  const cy: number[] = [];
  for (let i = 1; i < ring.length - 1; i++) {
    const b = at(ring, i);
    const c = at(ring, i + 1);
    const w = cross(o, b, c);
    cx.push(w * (o.x + b.x + c.x));
    cy.push(w * (o.y + b.y + c.y));
  }
  return { x: neumaierSum(cx) / (6 * a), y: neumaierSum(cy) / (6 * a) };
}

export function isCounterClockwise(ring: readonly Point[]): boolean {
  return signedArea(ring) > 0;
}

/** Return the ring with CCW winding (a reversed copy when it is clockwise), keeping vertex 0. */
export function normalizeWinding<T extends Point>(ring: readonly T[]): T[] {
  if (signedArea(ring) >= 0) return [...ring];
  const [first, ...rest] = ring;
  return first === undefined ? [] : [first, ...rest.reverse()];
}

/** Strip an explicit closing vertex (GeoJSON style) from a closed ring. */
export function openRing<T extends Point>(ring: readonly T[], tol = DEFAULT_TOLERANCE.length): T[] {
  if (ring.length >= 2 && samePoint(at(ring, 0), at(ring, ring.length - 1), tol))
    return ring.slice(0, -1);
  return [...ring];
}

function onSegment(p: Point, a: Point, b: Point, tol: number): boolean {
  const len = distance(a, b);
  if (len <= tol) return distance(p, a) <= tol;
  if (Math.abs(cross(a, b, p)) / len > tol) return false;
  const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
  return t >= -tol / len && t <= 1 + tol / len;
}

/** Distance from p to segment ab. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when closed segments ab and cd share at least one point (collinear overlap included). */
export function segmentsIntersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tol = DEFAULT_TOLERANCE.length,
): boolean {
  const scale = Math.max(distance(a, b), distance(c, d), tol);
  const d1 = cross(c, d, a) / scale;
  const d2 = cross(c, d, b) / scale;
  const d3 = cross(a, b, c) / scale;
  const d4 = cross(a, b, d) / scale;
  if (
    ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) &&
    ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))
  ) {
    return true;
  }
  return (
    onSegment(a, c, d, tol) ||
    onSegment(b, c, d, tol) ||
    onSegment(c, a, b, tol) ||
    onSegment(d, a, b, tol)
  );
}

/** True when segments cross at a single interior point of both (no touching, no collinear). */
export function segmentsProperlyCross(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tol = DEFAULT_TOLERANCE.length,
): boolean {
  const scale = Math.max(distance(a, b), distance(c, d), tol);
  const d1 = cross(c, d, a) / scale;
  const d2 = cross(c, d, b) / scale;
  const d3 = cross(a, b, c) / scale;
  const d4 = cross(a, b, d) / scale;
  return (
    ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) &&
    ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))
  );
}

/** Point-in-polygon: 1 inside, 0 on boundary, -1 outside. */
export function pointInPolygon(
  p: Point,
  ring: readonly Point[],
  tol = DEFAULT_TOLERANCE.length,
): 1 | 0 | -1 {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = at(ring, i);
    const b = at(ring, j);
    if (onSegment(p, a, b, tol)) return 0;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside ? 1 : -1;
}

/**
 * Validate an open ring. Pass `{ closed: true }` for input that must carry an explicit closing
 * vertex (GeoJSON); a missing closure is reported as `unclosed`. Issues are typed and ordered
 * deterministically; an empty array means the polygon is usable for quantities.
 */
export function validatePolygon(
  input: readonly Point[],
  options: { closed?: boolean; tolerance?: Tolerance } = {},
): PolygonIssue[] {
  const tol = options.tolerance ?? DEFAULT_TOLERANCE;
  const issues: PolygonIssue[] = [];
  const bad = input.flatMap((p, i) => (isFiniteNumber(p.x) && isFiniteNumber(p.y) ? [] : [i]));
  if (bad.length > 0) {
    return [
      {
        code: 'non_finite_coordinate',
        message: 'coordinates must be finite numbers',
        indices: bad,
      },
    ];
  }
  let ring: readonly Point[] = input;
  if (options.closed) {
    if (input.length < 2 || !samePoint(at(input, 0), at(input, input.length - 1), tol.length)) {
      issues.push({ code: 'unclosed', message: 'ring must end at its first vertex', indices: [] });
    } else {
      ring = input.slice(0, -1);
    }
  }
  if (ring.length < 3) {
    issues.push({
      code: 'too_few_vertices',
      message: `a polygon needs at least 3 vertices, got ${ring.length}`,
      indices: [],
    });
    return issues;
  }
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      if (samePoint(at(ring, i), at(ring, j), tol.length)) {
        issues.push({
          code: 'duplicate_vertex',
          message: `vertices ${i} and ${j} coincide`,
          indices: [i, j],
        });
      }
    }
  }
  if (area(ring) <= tol.area) {
    issues.push({ code: 'zero_area', message: 'polygon has zero area', indices: [] });
  }
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const a = at(ring, i);
      const b = cyclic(ring, i + 1);
      const c = at(ring, j);
      const d = cyclic(ring, j + 1);
      if (adjacent) {
        // Adjacent edges share a vertex; they intersect improperly only if they fold back.
        const shared = j === i + 1 ? b : a;
        const other1 = j === i + 1 ? a : b;
        const other2 = j === i + 1 ? d : c;
        if (
          onSegment(other2, shared, other1, tol.length) &&
          !samePoint(other2, shared, tol.length)
        ) {
          issues.push({
            code: 'self_intersection',
            message: `edges ${i} and ${j} overlap`,
            indices: [i, j],
          });
        } else if (
          onSegment(other1, shared, other2, tol.length) &&
          !samePoint(other1, shared, tol.length)
        ) {
          issues.push({
            code: 'self_intersection',
            message: `edges ${i} and ${j} overlap`,
            indices: [i, j],
          });
        }
      } else if (segmentsIntersect(a, b, c, d, tol.length)) {
        issues.push({
          code: 'self_intersection',
          message: `edges ${i} and ${j} intersect`,
          indices: [i, j],
        });
      }
    }
  }
  return issues;
}

/** A point strictly inside a simple polygon (centroid when inside, else a nudged ear midpoint). */
export function interiorPoint(ring: readonly Point[]): Point {
  const c = centroid(ring);
  if (pointInPolygon(c, ring) === 1) return c;
  const ccw = normalizeWinding(ring);
  for (let i = 0; i < ccw.length; i++) {
    const a = cyclic(ccw, i - 1);
    const b = at(ccw, i);
    const d = cyclic(ccw, i + 1);
    if (cross(a, b, d) > 0) {
      const candidate = { x: (a.x + b.x + d.x) / 3, y: (a.y + b.y + d.y) / 3 };
      if (pointInPolygon(candidate, ring) === 1) return candidate;
    }
  }
  throw new GeometryError(
    'no_interior_point',
    'could not find an interior point (invalid polygon?)',
  );
}

/**
 * True when two valid simple polygons share interior area: a proper edge crossing, a vertex of
 * one strictly inside the other, or an interior point of one inside (or on) the other (catches
 * identical/nested shapes). Polygons that only share edges or vertices do NOT overlap.
 */
export function polygonsOverlap(
  a: readonly Point[],
  b: readonly Point[],
  tol = DEFAULT_TOLERANCE.length,
): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsProperlyCross(at(a, i), cyclic(a, i + 1), at(b, j), cyclic(b, j + 1), tol))
        return true;
    }
  }
  if (a.some((p) => pointInPolygon(p, b, tol) === 1)) return true;
  if (b.some((p) => pointInPolygon(p, a, tol) === 1)) return true;
  return (
    pointInPolygon(interiorPoint(a), b, tol) >= 0 && pointInPolygon(interiorPoint(b), a, tol) >= 0
  );
}
