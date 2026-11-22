// "In real life" surroundings for a House Studio lot: mapped buildings, streets and trees from
// OpenStreetMap (© OpenStreetMap contributors, ODbL) through a fixed Overpass endpoint. The user
// supplies only numbers (lat, lon, radius); the host and query shape are fixed here. Government,
// military and custodial sites are never returned (footprint-policy.ts). Results are cached in
// memory per rounded point for a day; nothing is stored in the database.
import { parseSiteContext, type SiteContextResponse } from '@fieldline/contracts';
import { isSensitiveSite } from './footprint-policy';

const ATTRIBUTION = 'Map data © OpenStreetMap contributors (ODbL)';
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 300;
const MAX_BYTES = 4_000_000;
const cache = new Map<string, { at: number; value: SiteContextResponse }>();

const ROAD_KINDS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service';

export function siteContextQuery(lat: number, lon: number, radiusM: number): string {
  const around = `around:${Math.round(radiusM)},${lat.toFixed(6)},${lon.toFixed(6)}`;
  return `[out:json][timeout:15];(way(${around})["building"];way(${around})["highway"~"^(${ROAD_KINDS})$"];node(${around})["natural"="tree"];);out geom;`;
}

export async function lookupSiteContext(
  point: { lat: number; lon: number; radiusM: number },
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<SiteContextResponse> {
  const key = `${point.lat.toFixed(4)},${point.lon.toFixed(4)},${Math.round(point.radiusM)}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;
  const unavailable: SiteContextResponse = {
    status: 'upstream_unavailable',
    attribution: ATTRIBUTION,
    message: 'The map service did not answer. The lot is shown without its real surroundings for now.',
    buildings: [],
    roads: [],
    trees: [],
  };
  try {
    const res = await fetcher('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'user-agent': 'FieldProHouseStudio/1.0 (https://curb-connect-web.onrender.com)',
      },
      body: new URLSearchParams({ data: siteContextQuery(point.lat, point.lon, point.radiusM) }).toString(),
      signal: AbortSignal.timeout(18_000),
      redirect: 'error',
    });
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return unavailable;
    const raw = await res.text();
    if (raw.length > MAX_BYTES) return unavailable;
    const parsed = parseSiteContext(JSON.parse(raw) as unknown, point, isSensitiveSite);
    const found = parsed.buildings.length + parsed.roads.length + parsed.trees.length > 0;
    const value: SiteContextResponse = {
      status: found ? 'found' : 'empty',
      attribution: ATTRIBUTION,
      message: found
        ? `Found ${parsed.buildings.length} buildings, ${parsed.roads.length} streets and ${parsed.trees.length} mapped trees nearby. Mapped data can be out of date.`
        : 'Nothing is mapped around this point yet.',
      ...parsed,
    };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: nowMs, value });
    return value;
  } catch {
    return unavailable;
  }
}
