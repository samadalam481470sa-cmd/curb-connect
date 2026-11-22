// Nearby builders, trades and building suppliers from OpenStreetMap (© OpenStreetMap
// contributors, ODbL) through the fixed Overpass endpoint, for the quick build's "who to call"
// list. The user supplies only numbers (lat, lon, radius); host and query shape are fixed here.
// Answers are cached in memory per rounded point for a day; nothing is stored.
import { type NearbyTradesResponse, nearbyTradesQuery, parseNearbyTrades } from '@fieldline/contracts';

const ATTRIBUTION = 'Business listings © OpenStreetMap contributors (ODbL)';
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 300;
const MAX_BYTES = 4_000_000;
const cache = new Map<string, { at: number; value: NearbyTradesResponse }>();

export async function lookupNearbyTrades(
  point: { lat: number; lon: number; radiusKm: number },
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<NearbyTradesResponse> {
  const key = `${point.lat.toFixed(3)},${point.lon.toFixed(3)},${Math.round(point.radiusKm)}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;
  const unavailable: NearbyTradesResponse = {
    status: 'upstream_unavailable',
    attribution: ATTRIBUTION,
    message: 'The map service did not answer. Try again in a minute.',
    companies: [],
  };
  try {
    const res = await fetcher('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'user-agent': 'FieldProHouseStudio/1.0 (https://curb-connect-web.onrender.com)',
      },
      body: new URLSearchParams({ data: nearbyTradesQuery(point.lat, point.lon, point.radiusKm) }).toString(),
      signal: AbortSignal.timeout(22_000),
      redirect: 'error',
    });
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return unavailable;
    const raw = await res.text();
    if (raw.length > MAX_BYTES) return unavailable;
    const companies = parseNearbyTrades(JSON.parse(raw) as unknown, point);
    const value: NearbyTradesResponse = {
      status: companies.length ? 'found' : 'empty',
      attribution: ATTRIBUTION,
      message: companies.length
        ? `Found ${companies.length} mapped trades and suppliers within ${point.radiusKm} km. Listings can be out of date; call to confirm.`
        : 'No trades or suppliers are mapped near this point yet.',
      companies,
    };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: nowMs, value });
    return value;
  } catch {
    return unavailable;
  }
}
