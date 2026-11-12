import type { MapFacet } from './facetMath';

export type LonLat = { lon: number; lat: number };
type XY = { x: number; y: number };
type Edge = { a: XY; b: XY };
const EPS = 1e-8;
const OFFSET_M = 0.004;
const cross = (a: XY, b: XY) => a.x * b.y - a.y * b.x;
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: XY, b: XY) => a.x * b.x + a.y * b.y;
const point = (e: Edge, t: number): XY => ({
  x: e.a.x + (e.b.x - e.a.x) * t,
  y: e.a.y + (e.b.y - e.a.y) * t,
});
const inRange = (t: number) => t >= -EPS && t <= 1 + EPS;

function splitAt(edge: Edge, other: Edge, values: number[]) {
  const d = sub(edge.b, edge.a);
  const e = sub(other.b, other.a);
  const offset = sub(other.a, edge.a);
  const denominator = cross(d, e);
  if (Math.abs(denominator) > EPS) {
    const t = cross(offset, e) / denominator;
    const u = cross(offset, d) / denominator;
    if (inRange(t) && inRange(u)) values.push(Math.min(1, Math.max(0, t)));
    return;
  }
  if (Math.abs(cross(offset, d)) > EPS) return;
  const lenSquared = dot(d, d);
  if (lenSquared <= EPS) return;
  for (const endpoint of [other.a, other.b]) {
    const t = dot(sub(endpoint, edge.a), d) / lenSquared;
    if (inRange(t)) values.push(Math.min(1, Math.max(0, t)));
  }
}

function inside(p: XY, ring: XY[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/**
 * Computes visible perimeter segments of the UNION of traced roof planes.
 * Splits crossing/overlapping edges, then keeps only edges separating occupied from
 * unoccupied space. This does NOT infer an unseen building footprint from satellite data.
 * The separate contractor-traced outline, when supplied, takes priority.
 */
export function derivedRoofOutline(
  facets: readonly Pick<MapFacet, 'ring'>[],
): LonLat[][] {
  const first = facets.flatMap((f) => f.ring)[0];
  if (!first) return [];
  const lonScale = 111320 * Math.cos(first.lat * Math.PI / 180);
  const latScale = 111320;
  const fromLatLon = (p: LonLat): XY => ({
    x: (p.lon - first.lon) * lonScale, y: (p.lat - first.lat) * latScale,
  });
  const toLatLon = (p: XY): LonLat => ({
    lon: first.lon + p.x / lonScale, lat: first.lat + p.y / latScale,
  });

  const polygons = facets.filter((f) => f.ring.length >= 3 && f.ring.length <= 200)
    .map((f) => f.ring.map(fromLatLon));
  const edges: Edge[] = polygons.flatMap((ring) => ring.map((a, i) => ({
    a, b: ring[(i + 1) % ring.length]!,
  })).filter((edge) => Math.hypot(edge.a.x - edge.b.x, edge.a.y - edge.b.y) > EPS));
  // Cap expensive pairwise testing; a traced job can still use a manually drawn outline.
  if (edges.length > 800) return [];
  const boundary: LonLat[][] = [];
  for (const edge of edges) {
    const params = [0, 1];
    for (const other of edges) {
      if (edge === other) continue;
      splitAt(edge, other, params);
    }
    params.sort((a, b) => a - b);
    for (let i = 1; i < params.length; i++) {
      const t0 = params[i - 1]!;
      const t1 = params[i]!;
      if (t1 - t0 < EPS) continue;
      const start = point(edge, t0);
      const end = point(edge, t1);
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      if (distance < OFFSET_M * 2) continue;
      const mid = point(edge, (t0 + t1) / 2);
      const normal = { x: -(end.y - start.y) / distance, y: (end.x - start.x) / distance };
      const left = { x: mid.x + normal.x * OFFSET_M, y: mid.y + normal.y * OFFSET_M };
      const right = { x: mid.x - normal.x * OFFSET_M, y: mid.y - normal.y * OFFSET_M };
      const leftCovered = polygons.some((ring) => inside(left, ring));
      const rightCovered = polygons.some((ring) => inside(right, ring));
      if (leftCovered !== rightCovered) boundary.push([toLatLon(start), toLatLon(end)]);
    }
  }
  return boundary;
}

/** Render only one explicitly traced footprint OR the calculated facet union edges. */
export function cleanOutlineSegments(
  facets: readonly Pick<MapFacet, 'ring'>[],
  explicitOutline: readonly LonLat[],
): LonLat[][] {
  if (explicitOutline.length >= 3) {
    return [[...explicitOutline, explicitOutline[0]!]];
  }
  return derivedRoofOutline(facets);
}
