// Building footprints from USGS 3DEP LiDAR building classification (LAS class 6).
// Public-domain source. Points are rasterised to a metre grid, close gaps, then each connected blob
// becomes one footprint (convex hull of its cells). Convex hulls overstate L-shaped roofs, so the
// output is a candidate outline for review, not a surveyed footprint. Coverage is only what the
// source classified: unclassified buildings are absent, not guessed.
import { mercatorRingToLonLat, type LonLat } from '@fieldline/geometry';
export interface ClassifiedPoint {
  x: number; // EPSG:3857 metres
  y: number;
  c: number; // LAS classification
}

export interface Box {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
}

export interface ClassFootprint {
  id: string;
  areaM2: number;
  /** Closed ring in EPSG:3857 metres. */
  ring: [number, number][];
}

export interface Class6Options {
  cellM?: number; // grid size, default 1 m
  minAreaM2?: number; // drop blobs smaller than this, default 20 m²
}

export interface Class6Result {
  footprints: ClassFootprint[];
  /** Class-6 points inside the box (the source's own count, before any filtering). */
  classifiedPoints: number;
}

export const BUILDING_CLASS = 6;

/**
 * A class-6 footprint ring (EPSG:3857 metres, closed) as lon/lat vertices, via the shared
 * CRS helper — not hand-rolled spherical Mercator math. The closing vertex is kept.
 */
export function footprintRingToLonLat(ring: readonly (readonly [number, number])[]): LonLat[] {
  return mercatorRingToLonLat(ring);
}

function convexHull(points: [number, number][]): [number, number][] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Footprints from class-6 points inside `box`. Pure: no I/O. */
export function class6Footprints(
  points: Iterable<ClassifiedPoint>,
  box: Box,
  options: Class6Options = {},
): Class6Result {
  const cell = options.cellM ?? 1;
  const minArea = options.minAreaM2 ?? 20;
  if (!(cell > 0) || cell > 10) throw new RangeError('cellM must be between 0 and 10 metres.');
  const W = Math.ceil((box.maxx - box.minx) / cell);
  const H = Math.ceil((box.maxy - box.miny) / cell);
  if (W <= 0 || H <= 0 || W * H > 50_000_000) throw new RangeError('box is empty or too large.');

  const grid = new Uint8Array(W * H);
  let classifiedPoints = 0;
  for (const p of points) {
    if (p.c !== BUILDING_CLASS) continue;
    if (p.x < box.minx || p.x > box.maxx || p.y < box.miny || p.y > box.maxy) continue;
    classifiedPoints++;
    const x = Math.min(W - 1, Math.floor((p.x - box.minx) / cell));
    const y = Math.min(H - 1, Math.floor((p.y - box.miny) / cell));
    grid[x + y * W] = 1;
  }

  // Closing (dilate then erode, 3x3) joins the scattered hits on one roof into one blob.
  const dilated = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let on = 0;
    for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) if (grid[x + dx + (y + dy) * W]) { on = 1; break; }
    if (on) dilated[x + y * W] = 1;
  }
  const closed = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let all = 1;
    for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!dilated[x + dx + (y + dy) * W]) { all = 0; break; }
    if (all) closed[x + y * W] = 1;
  }

  const seen = new Uint8Array(W * H);
  const footprints: ClassFootprint[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!closed[s] || seen[s]) continue;
    const stack = [s];
    const cells: number[] = [];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % W, y = Math.floor(i / W);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = nx + ny * W;
        if (closed[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    const areaM2 = cells.length * cell * cell;
    if (areaM2 < minArea) continue;
    const corners: [number, number][] = [];
    for (const i of cells) {
      const x = i % W, y = Math.floor(i / W);
      const x0 = box.minx + x * cell, y0 = box.miny + y * cell;
      corners.push([x0, y0], [x0 + cell, y0], [x0, y0 + cell], [x0 + cell, y0 + cell]);
    }
    const hull = convexHull(corners);
    footprints.push({
      id: `class6-${footprints.length + 1}`,
      areaM2: Math.round(areaM2 * 10) / 10,
      ring: [...hull, hull[0]!],
    });
  }
  return { footprints, classifiedPoints };
}
