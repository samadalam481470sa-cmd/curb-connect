/**
 * Tree-cover assistance from independently mapped OpenStreetMap building ways.
 *
 * IMPORTANT: This never downloads, modifies, analyzes or stores Google/Esri satellite tiles.
 * OSM building footprints are *ground footprints*, not verified roof polygons; eaves, dormers,
 * setbacks and pitch require a separate user confirmation before a contractor quote.
 * Attribute © OpenStreetMap contributors (ODbL).
 */
export interface RoofCoordinate { lon: number; lat: number }
export interface RoofFootprintCandidate {
  id: string;
  label: string;
  ring: RoofCoordinate[];
  planAreaSqFt: number;
  distanceMeters: number;
  containsTarget: boolean;
  sourceUrl: string;
}
export interface RoofFootprintResult {
  status: 'found' | 'no_footprint' | 'upstream_unavailable';
  provider: 'openstreetmap';
  message: string;
  candidates: RoofFootprintCandidate[];
}

type UnknownObject = Record<string, unknown>;
function object(value: unknown): UnknownObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownObject : {};
}
const METERS_PER_DEG_LAT = 111_320;
const SQFT_PER_M2 = 10.763910416709722;
type LocalPoint = { x: number; y: number };
function local(point: RoofCoordinate, anchor: RoofCoordinate): LocalPoint {
  return {
    x: (point.lon - anchor.lon) * METERS_PER_DEG_LAT * Math.cos(anchor.lat * Math.PI / 180),
    y: (point.lat - anchor.lat) * METERS_PER_DEG_LAT,
  };
}
function signedArea(ring: LocalPoint[]): number {
  return ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;
}
function containsPoint(ring: LocalPoint[], target: LocalPoint): boolean {
  let found = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > target.y) !== (b.y > target.y)
      && target.x < (b.x - a.x) * (target.y - a.y) / (b.y - a.y) + a.x) found = !found;
  }
  return found;
}
function edgeDistance(point: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const div = dx * dx + dy * dy;
  const t = div === 0 ? 0
    : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / div));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
function polygonDistance(ring: LocalPoint[]): number {
  const target: LocalPoint = { x: 0, y: 0 };
  if (containsPoint(ring, target)) return 0;
  return Math.min(...ring.map((a, i) => edgeDistance(target, a, ring[(i + 1) % ring.length]!)));
}
function isValidPoint(point: unknown): point is RoofCoordinate {
  const p = object(point);
  return typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 85 &&
    typeof p.lon === 'number' && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
}

export function mappedBuildingCandidates(
  payload: unknown, anchor: RoofCoordinate,
): RoofFootprintCandidate[] {
  const elements = object(payload).elements;
  if (!Array.isArray(elements)) return [];
  const results: RoofFootprintCandidate[] = [];
  for (const row of elements.slice(0, 150)) {
    const item = object(row);
    if (item.type !== 'way' || !Number.isSafeInteger(item.id) ||
      typeof item.id !== 'number' || item.id < 1 || !Array.isArray(item.geometry) ||
      item.geometry.length < 4 || item.geometry.length > 300) continue;
    if (!item.geometry.every(isValidPoint)) continue;
    const ring: RoofCoordinate[] = item.geometry.map(p => ({ lon: p.lon, lat: p.lat }));
    if (ring.length > 3 && Math.abs(ring[0]!.lat - ring[ring.length - 1]!.lat) < 1e-9 &&
      Math.abs(ring[0]!.lon - ring[ring.length - 1]!.lon) < 1e-9) ring.pop();
    if (ring.length < 3) continue;
    const plane = ring.map(p => local(p, anchor));
    const areaM2 = Math.abs(signedArea(plane));
    if (!Number.isFinite(areaM2) || areaM2 < 8 || areaM2 > 10_000) continue;
    const distance = polygonDistance(plane);
    if (!Number.isFinite(distance) || distance > 35) continue;
    const tags = object(item.tags);
    const name = typeof tags.name === 'string' ? tags.name.trim().slice(0, 75) : '';
    const candidate: RoofFootprintCandidate = {
      id: 'way/' + item.id,
      label: name || 'Mapped building ' + item.id,
      ring, planAreaSqFt: Math.round(areaM2 * SQFT_PER_M2),
      distanceMeters: Math.round(distance * 10) / 10,
      containsTarget: distance < 0.0001,
      sourceUrl: 'https://www.openstreetmap.org/way/' + item.id,
    };
    results.push(candidate);
  }
  return results.sort((a, b) => a.distanceMeters - b.distanceMeters ||
    Number(b.containsTarget) - Number(a.containsTarget) ||
    a.planAreaSqFt - b.planAreaSqFt).slice(0, 5);
}

export async function lookupMappedRoof(
  anchor: RoofCoordinate, fetcher: typeof fetch = fetch,
): Promise<RoofFootprintResult> {
  const base: RoofFootprintResult = {
    status: 'upstream_unavailable',provider:'openstreetmap',candidates:[],
    message:'Building-footprint service is temporarily unavailable. Trace the roof manually instead.',
  };
  // Fixed endpoint only. The user controls numeric coordinates, not the upstream host or query.
  const query = `[out:json][timeout:10];way(around:65,${anchor.lat.toFixed(6)},${anchor.lon.toFixed(6)})["building"];out geom;`;
  try {
    const response = await fetcher('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json', 'user-agent': 'FieldProRoofFinder/1.0 (https://curb-connect-web.onrender.com)' },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(12_000),
      redirect: 'error', cache: 'no-store',
    });
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 1_400_000)
      return base;
    const raw = await response.text();
    if (raw.length > 1_400_000) return base;
    const candidates = mappedBuildingCandidates(JSON.parse(raw) as unknown, anchor);
    return {
      status: candidates.length ? 'found' : 'no_footprint', provider:'openstreetmap', candidates,
      message: candidates.length
        ? 'Mapped building footprints found near this address. Choose the correct structure and verify against the site.'
        : 'No usable mapped building outline was found here. Trace a footprint or roof facets manually.',
    };
  } catch {
    // Do not relay upstream response bodies or incidental address data to the browser.
    return base;
  }
}
