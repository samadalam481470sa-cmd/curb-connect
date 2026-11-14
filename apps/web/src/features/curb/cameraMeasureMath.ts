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
  const A = matrix.map((row) => [...row]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row]![col]!) > Math.abs(A[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(A[pivot]![col]!) < 1e-10) {
      throw new Error(
        'Reference corners are too close or collinear. Mark all four distinct corners.',
      );
    }
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    const pivotValue = A[col]![col]!;
    for (let k = col; k <= n; k++) A[col]![k] = A[col]![k]! / pivotValue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = A[row]![col]!;
      for (let k = col; k <= n; k++) A[row]![k] = A[row]![k]! - factor * A[col]![k]!;
    }
  }
  return A.map((row) => row[n]!);
}

export function calibratePhotoPlane(
  corners: readonly Point2[],
  referenceWidthIn: number,
  referenceHeightIn: number,
): (point: Point2) => Point2 {
  if (corners.length !== 4)
    throw new Error('Mark all four reference corners, clockwise from the top-left.');
  if (![referenceWidthIn, referenceHeightIn].every((n) => finite(n) && n > 0 && n <= 240)) {
    throw new Error('Enter verified reference dimensions between 0 and 240 inches.');
  }
  if (
    corners.some((p) => !finite(p.x) || !finite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
  ) {
    throw new Error('Reference corners must be inside the captured image.');
  }
  const [a, b, c, d] = corners;
  // Corners must be successive and have consistent winding; reject crossed quadrilaterals.
  const signed = [a!, b!, c!, d!]
    .map((p, i, ps) => {
      const next = ps[(i + 1) % ps.length]!;
      return p.x * next.y - next.x * p.y;
    })
    .reduce((sum, value) => sum + value, 0);
  if (Math.abs(signed) < 0.000005)
    throw new Error('Reference corners do not enclose a usable area.');
  const cross = (p: Point2, q: Point2, r: Point2) =>
    (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
  const turns = [cross(a!, b!, c!), cross(b!, c!, d!), cross(c!, d!, a!), cross(d!, a!, b!)];
  if (
    turns.some((t) => Math.abs(t) < 1e-8) ||
    turns.some((t) => Math.sign(t) !== Math.sign(turns[0]!))
  ) {
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
    const { x, y } = corners[i]!,
      { x: u, y: v } = world[i]!;
    equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    equations.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const h = solve(equations);
  return (p: Point2) => {
    if (!finite(p.x) || !finite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
      throw new Error('Measurement points must lie within the captured image.');
    }
    const w = h[6]! * p.x + h[7]! * p.y + 1;
    if (Math.abs(w) < 1e-7)
      throw new Error('This photo is unsuitable for reliable perspective calibration.');
    const x = (h[0]! * p.x + h[1]! * p.y + h[2]!) / w;
    const y = (h[3]! * p.x + h[4]! * p.y + h[5]!) / w;
    if (![x, y].every(finite) || Math.abs(x) > 10000 || Math.abs(y) > 10000) {
      throw new Error(
        'This photo causes unstable perspective measurements. Retake it from a better angle.',
      );
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
    throw new Error(
      'The estimated path length is outside a credible range. Check calibration or break the job into shorter photos.',
    );
  }
  return { lengthFt, segmentsFt, planar: true, calibrated: true };
}

/** Common rigid references a crew is likely to carry. Dimensions in inches. */
export const REFERENCE_PRESETS = [
  { id: 'letter', label: 'Letter paper 8.5 × 11 in', widthIn: 8.5, heightIn: 11 },
  { id: 'legal', label: 'Legal paper 8.5 × 14 in', widthIn: 8.5, heightIn: 14 },
  { id: 'tabloid', label: 'Tabloid paper 11 × 17 in', widthIn: 11, heightIn: 17 },
  { id: 'a4', label: 'A4 paper 8.27 × 11.69 in', widthIn: 8.27, heightIn: 11.69 },
  { id: 'card', label: 'Bank/ID card 3.37 × 2.125 in', widthIn: 3.37, heightIn: 2.125 },
  { id: 'osb', label: 'Plywood/OSB sheet 48 × 96 in', widthIn: 48, heightIn: 96 },
] as const;

export type MeasurementQuality = {
  /** Middle (median) length from the perturbation runs. */
  medianFt: number;
  /** 90% range of the length when each tap is off by up to `tapErrorPx` pixels. */
  lowFt: number;
  highFt: number;
  /** Half-width of the range, in feet. */
  plusMinusFt: number;
  /** Farthest curb point from the reference centre, measured in reference diagonals. */
  extrapolation: number;
  /** Plain-language warnings about the setup. */
  warnings: string[];
};

/** Small deterministic PRNG so the accuracy range is the same every time for the same taps. */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Estimates how much the measured length could move if every tap were off by a few pixels.
 * It re-runs the full perspective calibration with randomly nudged taps (Monte Carlo) and
 * reports the 5th–95th percentile range. It also flags measurements that reach far past the
 * reference, where small calibration errors grow.
 */
export function assessMeasurement(
  referenceCorners: readonly Point2[],
  referenceWidthIn: number,
  referenceHeightIn: number,
  curbPath: readonly Point2[],
  image: { widthPx: number; heightPx: number },
  options: {
    /** Expected tap error in image pixels, used when no per-point value is given. */
    tapErrorPx?: number;
    /** Per-point error: about 1 px for points snapped to a detected corner or edge. */
    cornerErrorPx?: readonly number[];
    pathErrorPx?: readonly number[];
    runs?: number;
  } = {},
): MeasurementQuality {
  const tapErrorPx = options.tapErrorPx ?? 3;
  const runs = options.runs ?? 200;
  const base = measureCurbInPhoto(referenceCorners, referenceWidthIn, referenceHeightIn, curbPath);
  const sx = 1 / Math.max(1, image.widthPx);
  const sy = 1 / Math.max(1, image.heightPx);
  const rand = mulberry32(
    Math.round(
      [...referenceCorners, ...curbPath].reduce((s, p) => s + p.x * 7919 + p.y * 104729, 0) * 1000,
    ),
  );
  const nudgeBy =
    (errors: readonly number[] | undefined) =>
    (p: Point2, i: number): Point2 => {
      const e = errors?.[i] ?? tapErrorPx;
      return {
        x: Math.min(1, Math.max(0, p.x + (rand() * 2 - 1) * e * sx)),
        y: Math.min(1, Math.max(0, p.y + (rand() * 2 - 1) * e * sy)),
      };
    };
  const nudgeCorner = nudgeBy(options.cornerErrorPx);
  const nudgePath = nudgeBy(options.pathErrorPx);
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    try {
      samples.push(
        measureCurbInPhoto(
          referenceCorners.map(nudgeCorner),
          referenceWidthIn,
          referenceHeightIn,
          curbPath.map(nudgePath),
        ).lengthFt,
      );
    } catch {
      // A nudge that breaks calibration just means the setup is fragile; it widens the range.
    }
  }
  samples.sort((a, b) => a - b);
  const pick = (q: number) =>
    samples.length
      ? samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!
      : base.lengthFt;
  const lowFt = Math.min(pick(0.05), base.lengthFt);
  const highFt = Math.max(pick(0.95), base.lengthFt);

  const toWorld = calibratePhotoPlane(referenceCorners, referenceWidthIn, referenceHeightIn);
  const cx = referenceWidthIn / 24;
  const cy = referenceHeightIn / 24;
  const diagFt = Math.hypot(referenceWidthIn, referenceHeightIn) / 12;
  const extrapolation = Math.max(
    ...curbPath.map((p) => {
      const w = toWorld(p);
      return Math.hypot(w.x - cx, w.y - cy) / diagFt;
    }),
  );

  const warnings: string[] = [];
  const failedRuns = runs - samples.length;
  if (failedRuns > runs * 0.05) {
    warnings.push(
      'Calibration is unstable. Retake the photo with the reference larger and less tilted.',
    );
  }
  if (extrapolation > 12) {
    warnings.push(
      'The curb reaches far beyond the reference. Use a larger reference (such as a plywood sheet) or split the curb into shorter photos.',
    );
  }
  const refPx = Math.min(
    ...referenceCorners.map((p, i) => {
      const q = referenceCorners[(i + 1) % 4]!;
      return Math.hypot((p.x - q.x) * image.widthPx, (p.y - q.y) * image.heightPx);
    }),
  );
  if (refPx < 60) {
    warnings.push('The reference looks small in the photo. Move closer or use a larger reference.');
  }
  const plusMinusFt = (highFt - lowFt) / 2;
  if (plusMinusFt > base.lengthFt * 0.05) {
    warnings.push('The accuracy range is wider than 5% of the length. Tape-verify before quoting.');
  }
  return { medianFt: pick(0.5), lowFt, highFt, plusMinusFt, extrapolation, warnings };
}
