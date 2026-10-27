// Image calibration: 2-point reference scale and 4+ point planar homography (CV-045, RR-032).
//
// Rule (CV-045 P): a precise length is never derived from raw pixel counts. Every measurement
// function takes a Calibration and returns { state: 'unknown' } unless the calibration is valid.
// Failures are explicit and typed: degenerate (collinear/duplicate) references, references too
// short to be reliable, inconsistent orientation or high reprojection error (points not on one
// plane), and points beyond the plane's horizon.
import { at, GeometryError, isFiniteNumber } from './numeric';
import { cross, distance, type Point } from './polygon';

export const CALIBRATION_VERSION = '1.0.0';

export type CalibrationFailure =
  | 'invalid_input'
  | 'reference_too_short'
  | 'degenerate_reference'
  | 'inconsistent_orientation'
  | 'out_of_plane'
  | 'singular';

export interface CalibrationOptions {
  /** Assumed 1-sigma click error, pixels. Default 1. */
  readonly pixelSigma?: number;
  /** Minimum pixel distance between any two reference points. Default 20 px. */
  readonly minPixelSpan?: number;
  /** Minimum real distance between any two reference points, meters. Default 0.1 m. */
  readonly minPlaneSpan?: number;
  /** 1-sigma uncertainty of the real reference measurement, meters. Default 0.003 m. */
  readonly referenceSigma?: number;
  /** Homography: maximum RMS reprojection error (m) with > 4 points. Default 0.02 m. */
  readonly maxReprojectionError?: number;
}

const DEFAULTS = {
  pixelSigma: 1,
  minPixelSpan: 20,
  minPlaneSpan: 0.1,
  referenceSigma: 0.003,
  maxReprojectionError: 0.02,
};

export type Homography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type Calibration =
  | {
      readonly status: 'valid';
      readonly method: 'reference_scale';
      readonly version: string;
      readonly metersPerPixel: number;
      /** Relative 1-sigma uncertainty of the scale. */
      readonly scaleRelativeSigma: number;
      readonly pixelSigma: number;
      /** Scale-only calibration ignores perspective: valid only in the reference plane facing the camera. */
      readonly advisory: string;
    }
  | {
      readonly status: 'valid';
      readonly method: 'homography';
      readonly version: string;
      /** Row-major 3x3, image px -> plane meters, normalized so H[8] = 1. */
      readonly h: Homography;
      readonly reprojectionRms: number;
      readonly reprojectionErrors: readonly number[];
      readonly pixelSigma: number;
      readonly referenceSigma: number;
      /** Sign of w for in-front points (all reference points share it). */
      readonly wSign: 1 | -1;
    }
  | {
      readonly status: 'failed';
      readonly method: 'reference_scale' | 'homography';
      readonly reason: CalibrationFailure;
      readonly message: string;
    };

export type Measurement =
  | {
      readonly state: 'known';
      readonly value: number;
      readonly sigma: number;
      readonly unit: 'm';
      readonly method: 'reference_scale' | 'homography';
    }
  | { readonly state: 'unknown'; readonly reason: string };

function fail(
  method: 'reference_scale' | 'homography',
  reason: CalibrationFailure,
  message: string,
): Calibration {
  return { status: 'failed', method, reason, message };
}

function finitePoints(points: readonly Point[]): boolean {
  return points.every((p) => isFiniteNumber(p.x) && isFiniteNumber(p.y));
}

/** Two clicked endpoints of a reference of known real length. */
export function calibrateReferenceScale(
  pixelA: Point,
  pixelB: Point,
  realLengthMeters: number,
  options: CalibrationOptions = {},
): Calibration {
  const o = { ...DEFAULTS, ...options };
  if (
    !finitePoints([pixelA, pixelB]) ||
    !(realLengthMeters > 0) ||
    !isFiniteNumber(realLengthMeters)
  ) {
    return fail(
      'reference_scale',
      'invalid_input',
      'reference needs finite points and a positive real length',
    );
  }
  const px = distance(pixelA, pixelB);
  if (px < o.minPixelSpan)
    return fail(
      'reference_scale',
      'reference_too_short',
      `reference spans ${px.toFixed(1)} px; need >= ${o.minPixelSpan}`,
    );
  if (realLengthMeters < o.minPlaneSpan)
    return fail(
      'reference_scale',
      'reference_too_short',
      `reference is ${realLengthMeters} m; need >= ${o.minPlaneSpan}`,
    );
  const rel = Math.hypot((Math.SQRT2 * o.pixelSigma) / px, o.referenceSigma / realLengthMeters);
  return {
    status: 'valid',
    method: 'reference_scale',
    version: CALIBRATION_VERSION,
    metersPerPixel: realLengthMeters / px,
    scaleRelativeSigma: rel,
    pixelSigma: o.pixelSigma,
    advisory:
      'scale-only: valid for lengths in the reference plane, parallel to the image; perspective is not corrected',
  };
}

// --- Linear algebra (small, dense, deterministic) ------------------------------------------

/** Solve A x = b (n x n) by Gaussian elimination with partial pivoting; null when singular. */
export function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(at(at(m, r), col)) > Math.abs(at(at(m, piv), col))) piv = r;
    if (Math.abs(at(at(m, piv), col)) < 1e-12) return null;
    [m[col], m[piv]] = [at(m, piv), at(m, col)];
    const pr = at(m, col);
    for (let r = col + 1; r < n; r++) {
      const row = at(m, r);
      const f = at(row, col) / at(pr, col);
      for (let c = col; c <= n; c++) row[c] = at(row, c) - f * at(pr, c);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = at(m, r);
    let s = at(row, n);
    for (let c = r + 1; c < n; c++) s -= at(row, c) * at(x, c);
    x[r] = s / at(row, r);
  }
  return x;
}

/** Hartley normalization: centroid to origin, mean distance sqrt(2). Returns T (row-major 3x3). */
function normalization(points: readonly Point[]): { t: Homography; pts: Point[] } {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const mean = points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / points.length;
  const k = mean > 0 ? Math.SQRT2 / mean : 1;
  return {
    t: [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1],
    pts: points.map((p) => ({ x: k * (p.x - cx), y: k * (p.y - cy) })),
  };
}

function mul(a: Homography, b: Homography): Homography {
  const r: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r.push(a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!);
  return r as unknown as Homography;
}

function invertSimilarity(t: Homography): Homography {
  const k = t[0];
  return [1 / k, 0, -t[2] / k, 0, 1 / k, -t[5] / k, 0, 0, 1];
}

function applyH(h: Homography, p: Point): { x: number; y: number; w: number } {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w, w };
}

function hasCollinearTriple(points: readonly Point[]): boolean {
  // Points are normalized (mean distance sqrt 2), so an absolute threshold is scale-free.
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      for (let k = j + 1; k < points.length; k++)
        if (Math.abs(cross(at(points, i), at(points, j), at(points, k))) < 1e-3) return true;
  return false;
}

function minPairDistance(points: readonly Point[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      min = Math.min(min, distance(at(points, i), at(points, j)));
  return min;
}

/**
 * Normalized DLT homography from >= 4 correspondences (image px -> plane meters), least squares
 * with h33 = 1. With exactly 4 points the fit is exact (zero reprojection error carries no
 * evidence of planarity), so add a 5th+ point to detect out-of-plane references.
 */
export function calibrateHomography(
  image: readonly Point[],
  plane: readonly Point[],
  options: CalibrationOptions = {},
): Calibration {
  const o = { ...DEFAULTS, ...options };
  if (
    image.length < 4 ||
    image.length !== plane.length ||
    !finitePoints(image) ||
    !finitePoints(plane)
  ) {
    return fail(
      'homography',
      'invalid_input',
      'need >= 4 finite image/plane correspondences of equal count',
    );
  }
  if (minPairDistance(image) < o.minPixelSpan || minPairDistance(plane) < o.minPlaneSpan) {
    return fail(
      'homography',
      'reference_too_short',
      'reference points are too close together to calibrate reliably',
    );
  }
  const src = normalization(image);
  const dst = normalization(plane);
  if (hasCollinearTriple(src.pts) || hasCollinearTriple(dst.pts)) {
    return fail('homography', 'degenerate_reference', 'three reference points are collinear');
  }
  // Orientation consistency: a plane-to-plane map seen from one side keeps (or flips) every
  // triangle's orientation uniformly. Mixed signs mean mislabeled or non-coplanar points.
  let sign = 0;
  for (let i = 0; i < image.length; i++)
    for (let j = i + 1; j < image.length; j++)
      for (let k = j + 1; k < image.length; k++) {
        const s = Math.sign(
          cross(at(src.pts, i), at(src.pts, j), at(src.pts, k)) *
            cross(at(dst.pts, i), at(dst.pts, j), at(dst.pts, k)),
        );
        if (sign === 0) sign = s;
        else if (s !== sign)
          return fail(
            'homography',
            'inconsistent_orientation',
            'reference order is inconsistent (crossed or out-of-plane points)',
          );
      }
  const ata = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const atb = new Array<number>(8).fill(0);
  for (let i = 0; i < image.length; i++) {
    const { x: u, y: v } = at(src.pts, i);
    const { x: X, y: Y } = at(dst.pts, i);
    const rows: [number[], number][] = [
      [[u, v, 1, 0, 0, 0, -u * X, -v * X], X],
      [[0, 0, 0, u, v, 1, -u * Y, -v * Y], Y],
    ];
    for (const [row, rhs] of rows) {
      for (let r = 0; r < 8; r++) {
        atb[r] = at(atb, r) + at(row, r) * rhs;
        const ar = at(ata, r);
        for (let c = 0; c < 8; c++) ar[c] = at(ar, c) + at(row, r) * at(row, c);
      }
    }
  }
  const hn = solveLinear(ata, atb);
  if (!hn) return fail('homography', 'singular', 'homography system is singular');
  let h = mul(invertSimilarity(dst.t), mul([...hn, 1] as unknown as Homography, src.t));
  h = h.map((v) => v / h[8]) as unknown as Homography;
  if (!h.every(isFiniteNumber)) return fail('homography', 'singular', 'homography is not finite');
  const ws = image.map((p) => applyH(h, p).w);
  const wSign = Math.sign(at(ws, 0));
  if (wSign === 0 || ws.some((w) => Math.sign(w) !== wSign)) {
    return fail(
      'homography',
      'inconsistent_orientation',
      'reference points straddle the plane horizon',
    );
  }
  const errors = image.map((p, i) => distance(applyH(h, p), at(plane, i)));
  const rms = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
  if (rms > o.maxReprojectionError) {
    return fail(
      'homography',
      'out_of_plane',
      `reprojection RMS ${rms.toFixed(4)} m exceeds ${o.maxReprojectionError} m; points are not on one plane`,
    );
  }
  return {
    status: 'valid',
    method: 'homography',
    version: CALIBRATION_VERSION,
    h,
    reprojectionRms: rms,
    reprojectionErrors: errors,
    pixelSigma: o.pixelSigma,
    referenceSigma: o.referenceSigma,
    wSign: wSign as 1 | -1,
  };
}

/** Map an image pixel to plane meters; null when the calibration is not valid or the point is beyond the horizon. */
export function imageToPlane(cal: Calibration, p: Point): Point | null {
  if (cal.status !== 'valid' || !finitePoints([p])) return null;
  if (cal.method === 'reference_scale')
    return { x: p.x * cal.metersPerPixel, y: p.y * cal.metersPerPixel };
  const r = applyH(cal.h, p);
  if (Math.sign(r.w) !== cal.wSign || Math.abs(r.w) < 1e-12) return null;
  return { x: r.x, y: r.y };
}

/**
 * Real length between two image points with a 1-sigma uncertainty: click error propagated
 * through the mapping (numerical Jacobian), combined in quadrature with the calibration's own
 * error (scale sigma, or sqrt(2) * reprojection RMS and reference sigma for homographies).
 */
export function measureLength(cal: Calibration, a: Point, b: Point): Measurement {
  if (cal.status !== 'valid')
    return { state: 'unknown', reason: `calibration failed: ${cal.reason}` };
  const pa = imageToPlane(cal, a);
  const pb = imageToPlane(cal, b);
  if (!pa || !pb) return { state: 'unknown', reason: 'point is outside the calibrated plane' };
  const value = distance(pa, pb);
  if (cal.method === 'reference_scale') {
    const px = distance(a, b);
    const clickRel = px > 0 ? (Math.SQRT2 * cal.pixelSigma) / px : 0;
    return {
      state: 'known',
      value,
      sigma: value * Math.hypot(cal.scaleRelativeSigma, clickRel),
      unit: 'm',
      method: 'reference_scale',
    };
  }
  const len = (q: Point[]): number => {
    const m0 = imageToPlane(cal, at(q, 0));
    const m1 = imageToPlane(cal, at(q, 1));
    if (!m0 || !m1) throw new GeometryError('outside_plane', 'perturbed point left the plane');
    return distance(m0, m1);
  };
  const step = 0.5;
  let varClick = 0;
  try {
    for (let i = 0; i < 2; i++) {
      for (const axis of ['x', 'y'] as const) {
        const plus = [{ ...a }, { ...b }];
        const minus = [{ ...a }, { ...b }];
        const pp = at(plus, i);
        const mm = at(minus, i);
        plus[i] = { ...pp, [axis]: pp[axis] + step };
        minus[i] = { ...mm, [axis]: mm[axis] - step };
        const g = (len(plus) - len(minus)) / (2 * step);
        varClick += g * g * cal.pixelSigma * cal.pixelSigma;
      }
    }
  } catch {
    return { state: 'unknown', reason: 'point is too close to the plane horizon' };
  }
  const sigma = Math.sqrt(
    varClick +
      2 * cal.reprojectionRms * cal.reprojectionRms +
      cal.referenceSigma * cal.referenceSigma,
  );
  return { state: 'known', value, sigma, unit: 'm', method: 'homography' };
}
