/**
 * Planar image measurement using a known rectangular scale reference.
 * Four image corners are mapped to known real-world XY dimensions with a homography.
 * This is an approximate camera/photo takeoff, NOT ARKit/LiDAR or depth sensing.
 */
export type Point2 = { x: number; y: number };
export type ImageMeasurement = {
  lengthFt: number;
  segmentsFt: number[];
  planar: true;
  calibrated: true;
};
const finite = (n: number) => Number.isFinite(n);
const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Solve an 8-variable linear system by Gaussian elimination with pivoting. */
function solve(matrix: number[][]): number[] {
  const n = 8;
  const A = matrix.map(row => [...row]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row]![col]!) > Math.abs(A[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(A[pivot]![col]!) < 1e-10) {
      throw new Error('Reference corners are too close or collinear. Mark all four distinct corners.');
    }
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    const pivotValue = A[col]![col]!;
    for (let k = col; k <= n; k++) A[col]![k] /= pivotValue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = A[row]![col]!;
      for (let k = col; k <= n; k++) A[row]![k] -= factor * A[col]![k]!;
    }
  }
  return A.map(row => row[n]!);
}

export function calibratePhotoPlane(
  corners: readonly Point2[],
  referenceWidthIn: number,
  referenceHeightIn: number,
): (point: Point2) => Point2 {
  if (corners.length !== 4) throw new Error('Mark all four reference corners, clockwise from the top-left.');
  if (![referenceWidthIn, referenceHeightIn].every(n => finite(n) && n > 0 && n <= 240)) {
    throw new Error('Enter verified reference dimensions between 0 and 240 inches.');
  }
  if (corners.some(p => !finite(p.x) || !finite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) {
    throw new Error('Reference corners must be inside the captured image.');
  }
  const [a, b, c, d] = corners;
  // Corners must be successive and have consistent winding; reject crossed quadrilaterals.
  const signed = [a!, b!, c!, d!].map((p, i, ps) => {
    const next = ps[(i + 1) % ps.length]!;
    return p.x * next.y - next.x * p.y;
  }).reduce((sum, value) => sum + value, 0);
  if (Math.abs(signed) < 0.000005) throw new Error('Reference corners do not enclose a usable area.');
  const cross = (p: Point2, q: Point2, r: Point2) =>
    (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
  const turns = [cross(a!, b!, c!), cross(b!, c!, d!), cross(c!, d!, a!), cross(d!, a!, b!)];
  if (turns.some(t => Math.abs(t) < 1e-8) || turns.some(t => Math.sign(t) !== Math.sign(turns[0]!))) {
    throw new Error('Reference corners must form a non-crossing rectangle in clockwise order.');
  }

  const world: Point2[] = [
    { x: 0, y: 0 },
    { x: referenceWidthIn / 12, y: 0 },
    { x: referenceWidthIn / 12, y: referenceHeightIn / 12 },
    { x: 0, y: referenceHeightIn / 12 },
  ];
  const equations: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = corners[i]!, { x: u, y: v } = world[i]!;
    equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    equations.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const h = solve(equations);
  return (p: Point2) => {
    if (!finite(p.x) || !finite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
      throw new Error('Measurement points must lie within the captured image.');
    }
    const w = h[6]! * p.x + h[7]! * p.y + 1;
    if (Math.abs(w) < 1e-7) throw new Error('This photo is unsuitable for reliable perspective calibration.');
    const x = (h[0]! * p.x + h[1]! * p.y + h[2]!) / w;
    const y = (h[3]! * p.x + h[4]! * p.y + h[5]!) / w;
    if (![x, y].every(finite) || Math.abs(x) > 10000 || Math.abs(y) > 10000) {
      throw new Error('This photo causes unstable perspective measurements. Retake it from a better angle.');
    }
    return { x, y };
  };
}

export function measureCurbInPhoto(
  referenceCorners: readonly Point2[],
  referenceWidthIn: number,
  referenceHeightIn: number,
  curbPath: readonly Point2[],
): ImageMeasurement {
  if (curbPath.length < 2 || curbPath.length > 100) {
    throw new Error('Mark at least two curb points and at most 100.');
  }
  const toWorld = calibratePhotoPlane(referenceCorners, referenceWidthIn, referenceHeightIn);
  const projected = curbPath.map(toWorld);
  const segmentsFt = projected.slice(1).map((point, i) => dist(projected[i]!, point));
  const lengthFt = segmentsFt.reduce((sum, segment) => sum + segment, 0);
  if (!finite(lengthFt) || lengthFt <= 0 || lengthFt > 500) {
    throw new Error('The estimated path length is outside a credible range. Check calibration or break the job into shorter photos.');
  }
  return { lengthFt, segmentsFt, planar: true, calibrated: true };
}
