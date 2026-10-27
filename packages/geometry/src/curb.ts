// Curb segments: piecewise polyline lengths, curved-curb approximation and validation
// (CV-047, CP-051). Coordinates are planar meters.
//
// Rule (CV-047 S): a curved curb is measured along validated piecewise geometry, never by the
// straight chord between its ends. A curved segment must carry >= 3 points, and when its design
// arc is known, the polyline must stay within `maxSagitta` of it.
import { at, GeometryError, isFiniteNumber, neumaierSum } from './numeric';
import {
  DEFAULT_TOLERANCE,
  distance,
  type Point,
  segmentsIntersect,
  segmentsProperlyCross,
  cross,
} from './polygon';

export const CURB_SEGMENT_KINDS = ['straight', 'curved', 'corner', 'return_transition'] as const;
export type CurbSegmentKind = (typeof CURB_SEGMENT_KINDS)[number];

/** Geometry roles kept separate (CV-047 B). */
export const CURB_GEOMETRY_ROLES = [
  'saw_cut_path',
  'removal_footprint',
  'return_transition',
  'replacement_area',
] as const;
export type CurbGeometryRole = (typeof CURB_GEOMETRY_ROLES)[number];

export interface Arc {
  readonly center: Point;
  readonly radius: number;
  /** Radians, counter-clockwise from +x. */
  readonly startAngle: number;
  /** Signed sweep in radians (negative = clockwise), |sweep| <= 2*pi. */
  readonly sweep: number;
}

export interface CurbSegment {
  readonly id: string;
  readonly kind: CurbSegmentKind;
  readonly points: readonly Point[];
  /** Design arc for curved segments, when known; enables the sagitta check. */
  readonly arc?: Arc;
}

export type CurbIssueCode =
  | 'too_few_points'
  | 'zero_length'
  | 'chord_only_curve'
  | 'curve_deviation'
  | 'self_overlap'
  | 'duplicate_linework'
  | 'non_finite_coordinate';

export interface CurbIssue {
  readonly code: CurbIssueCode;
  readonly segmentIds: readonly string[];
  readonly message: string;
}

export function polylineLength(points: readonly Point[]): number {
  const parts: number[] = [];
  for (let i = 1; i < points.length; i++) parts.push(distance(at(points, i - 1), at(points, i)));
  return neumaierSum(parts);
}

export function arcLength(arc: Arc): number {
  return Math.abs(arc.sweep) * arc.radius;
}

function checkArc(arc: Arc): void {
  if (
    !(arc.radius > 0) ||
    !isFiniteNumber(arc.sweep) ||
    arc.sweep === 0 ||
    Math.abs(arc.sweep) > 2 * Math.PI
  ) {
    throw new GeometryError('invalid_argument', 'arc needs radius > 0 and 0 < |sweep| <= 2*pi');
  }
}

/**
 * Segments needed so each chord deviates at most `maxSagitta` from the arc:
 * sagitta = r * (1 - cos(theta/2)) for chord angle theta, so theta = 2*acos(1 - s/r).
 */
export function arcSegmentCount(arc: Arc, maxSagitta: number): number {
  checkArc(arc);
  if (!(maxSagitta > 0)) throw new GeometryError('invalid_argument', 'maxSagitta must be > 0');
  if (maxSagitta >= arc.radius) return Math.max(2, Math.ceil(Math.abs(arc.sweep) / Math.PI));
  const theta = 2 * Math.acos(1 - maxSagitta / arc.radius);
  return Math.max(2, Math.ceil(Math.abs(arc.sweep) / theta));
}

/** Sample an arc into a polyline whose chords deviate <= maxSagitta (default 5 mm). */
export function arcToPolyline(arc: Arc, maxSagitta = 0.005): Point[] {
  const n = arcSegmentCount(arc, maxSagitta);
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = arc.startAngle + (arc.sweep * i) / n;
    out.push({
      x: arc.center.x + arc.radius * Math.cos(t),
      y: arc.center.y + arc.radius * Math.sin(t),
    });
  }
  return out;
}

/** Max radial deviation of polyline vertices and chord midpoints from an arc. */
export function arcDeviation(points: readonly Point[], arc: Arc): number {
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    const p = at(points, i);
    max = Math.max(max, Math.abs(distance(p, arc.center) - arc.radius));
    if (i > 0) {
      const q = at(points, i - 1);
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      max = Math.max(max, Math.abs(distance(mid, arc.center) - arc.radius));
    }
  }
  return max;
}

export interface CurbValidationOptions {
  /** Max allowed deviation of a curved polyline from its design arc, meters. Default 0.01. */
  readonly maxSagitta?: number;
  readonly tolerance?: number;
}

/** Validate segments: point counts, zero length, chord-only curves, overlaps, duplicate linework. */
export function validateCurbSegments(
  segments: readonly CurbSegment[],
  options: CurbValidationOptions = {},
): CurbIssue[] {
  const tol = options.tolerance ?? DEFAULT_TOLERANCE.length;
  const maxSag = options.maxSagitta ?? 0.01;
  const issues: CurbIssue[] = [];
  for (const s of segments) {
    if (s.points.some((p) => !isFiniteNumber(p.x) || !isFiniteNumber(p.y))) {
      issues.push({
        code: 'non_finite_coordinate',
        segmentIds: [s.id],
        message: `segment ${s.id} has non-finite coordinates`,
      });
      continue;
    }
    if (s.points.length < 2) {
      issues.push({
        code: 'too_few_points',
        segmentIds: [s.id],
        message: `segment ${s.id} needs at least 2 points`,
      });
      continue;
    }
    if (polylineLength(s.points) <= tol) {
      issues.push({
        code: 'zero_length',
        segmentIds: [s.id],
        message: `segment ${s.id} has zero length`,
      });
    }
    if (s.kind === 'curved') {
      if (s.points.length < 3) {
        issues.push({
          code: 'chord_only_curve',
          segmentIds: [s.id],
          message: `curved segment ${s.id} is a bare chord; trace it piecewise`,
        });
      } else if (s.arc && arcDeviation(s.points, s.arc) > maxSag) {
        issues.push({
          code: 'curve_deviation',
          segmentIds: [s.id],
          message: `curved segment ${s.id} deviates more than ${maxSag} m from its arc`,
        });
      }
    }
    // Self overlap: non-adjacent pieces touching, or adjacent pieces folding back.
    const pts = s.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let j = i + 1; j + 1 < pts.length; j++) {
        const a = at(pts, i);
        const b = at(pts, i + 1);
        const c = at(pts, j);
        const d = at(pts, j + 1);
        const hit =
          j === i + 1
            ? Math.abs(cross(a, b, d)) <= tol * Math.max(distance(a, b), distance(c, d)) &&
              (d.x - b.x) * (a.x - b.x) + (d.y - b.y) * (a.y - b.y) > 0
            : segmentsIntersect(a, b, c, d, tol);
        if (hit)
          issues.push({
            code: 'self_overlap',
            segmentIds: [s.id],
            message: `segment ${s.id} overlaps itself (pieces ${i} and ${j})`,
          });
      }
    }
  }
  // Duplicate linework between segments: collinear overlap of any pieces (end-to-end touching is fine).
  for (let x = 0; x < segments.length; x++) {
    for (let y = x + 1; y < segments.length; y++) {
      const s = at(segments, x);
      const t = at(segments, y);
      if (overlapsLinework(s.points, t.points, tol)) {
        issues.push({
          code: 'duplicate_linework',
          segmentIds: [s.id, t.id],
          message: `segments ${s.id} and ${t.id} overlap; the same curb would be counted twice`,
        });
      }
    }
  }
  return issues;
}

function overlapsLinework(p: readonly Point[], q: readonly Point[], tol: number): boolean {
  for (let i = 0; i + 1 < p.length; i++) {
    for (let j = 0; j + 1 < q.length; j++) {
      const a = at(p, i);
      const b = at(p, i + 1);
      const c = at(q, j);
      const d = at(q, j + 1);
      if (segmentsProperlyCross(a, b, c, d, tol)) continue; // a crossing is not double counting
      const len = Math.max(distance(a, b), tol);
      const collinear =
        Math.abs(cross(a, b, c)) / len <= tol && Math.abs(cross(a, b, d)) / len <= tol;
      if (!collinear) continue;
      // Project onto ab; overlap length > tol means shared linework.
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const t1 = (c.x - a.x) * ux + (c.y - a.y) * uy;
      const t2 = (d.x - a.x) * ux + (d.y - a.y) * uy;
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(len, Math.max(t1, t2));
      if (hi - lo > tol) return true;
    }
  }
  return false;
}

export interface CurbLengthSummary {
  readonly total: number;
  readonly byKind: Readonly<Record<CurbSegmentKind, number>>;
  readonly segments: readonly {
    readonly id: string;
    readonly kind: CurbSegmentKind;
    readonly length: number;
    readonly chordLength: number;
  }[];
  /** Number of segments (each is a separate saw setup in pricing). */
  readonly segmentCount: number;
}

/** Sum of piecewise lengths. Throws if validation issues exist (measure only valid geometry). */
export function curbLengths(
  segments: readonly CurbSegment[],
  options: CurbValidationOptions = {},
): CurbLengthSummary {
  const issues = validateCurbSegments(segments, options);
  if (issues.length > 0) {
    throw new GeometryError('invalid_curb_geometry', issues.map((i) => i.message).join('; '));
  }
  const byKind = { straight: 0, curved: 0, corner: 0, return_transition: 0 } as Record<
    CurbSegmentKind,
    number
  >;
  const rows = segments.map((s) => {
    const length = polylineLength(s.points);
    byKind[s.kind] += length;
    return {
      id: s.id,
      kind: s.kind,
      length,
      chordLength: distance(at(s.points, 0), at(s.points, s.points.length - 1)),
    };
  });
  return {
    total: neumaierSum(rows.map((r) => r.length)),
    byKind,
    segments: rows,
    segmentCount: rows.length,
  };
}
