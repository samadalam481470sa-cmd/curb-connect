// Nearby builders, trades and building suppliers from OpenStreetMap (© OpenStreetMap
// contributors, ODbL) through the fixed Overpass endpoint, for the quick build's "who to call"
// list. The user supplies only numbers (lat, lon, radius); host and query shape are fixed here.
// Answers are cached in memory per rounded point for a day; nothing is stored.
import {
  type NearbyCompany,
  type NearbyTrade,
  type NearbyTradesResponse,
  nearbyTradesQuery,
  parseNearbyTrades,
} from '@fieldline/contracts';

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

// --- Optional Google Places (New) search, per trade -------------------------------------------
// OpenStreetMap misses many small local firms. With GOOGLE_PLACES_API_KEY set, a search for one
// trade also asks Google's Places text search near the lot and merges the results. Only the trade
// word and the point go upstream. Results are cached for a day, within Google's caching terms.

const GOOGLE_QUERY: Record<NearbyTrade, string> = {
  builder: 'home builder general contractor',
  carpenter: 'framing carpenter contractor',
  roofer: 'roofing contractor',
  plumber: 'plumber',
  electrician: 'electrician',
  hvac: 'HVAC contractor',
  concrete: 'concrete contractor',
  drywall: 'drywall contractor',
  painter: 'painting contractor',
  flooring: 'flooring contractor',
  insulation: 'insulation contractor',
  landscaper: 'landscaping company',
  excavation: 'excavation contractor',
  hardware_store: 'hardware store',
  lumber_yard: 'lumber yard',
  equipment_rental: 'construction equipment rental',
};
const googleCache = new Map<string, { at: number; value: NearbyCompany[] }>();

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Google Places (New) searchText answer -> companies for one trade. */
export function parseGooglePlaces(raw: unknown, trade: NearbyTrade, origin: { lat: number; lon: number }): NearbyCompany[] {
  const places = (raw as { places?: unknown })?.places;
  if (!Array.isArray(places)) return [];
  const out: NearbyCompany[] = [];
  for (const p of places as Record<string, unknown>[]) {
    const name = (p.displayName as { text?: unknown } | undefined)?.text;
    const loc = p.location as { latitude?: unknown; longitude?: unknown } | undefined;
    if (typeof name !== 'string' || typeof loc?.latitude !== 'number' || typeof loc?.longitude !== 'number') continue;
    const site = typeof p.websiteUri === 'string' && /^https?:\/\//.test(p.websiteUri) ? p.websiteUri.slice(0, 300) : null;
    out.push({
      id: `g-${String(p.id ?? name).slice(0, 36)}`,
      name: name.slice(0, 120),
      trade,
      phone: typeof p.nationalPhoneNumber === 'string' ? p.nationalPhoneNumber.slice(0, 40) : null,
      website: site,
      address: typeof p.formattedAddress === 'string' ? p.formattedAddress.slice(0, 200) : null,
      distanceKm: Math.round(distanceKm(origin.lat, origin.lon, loc.latitude, loc.longitude) * 10) / 10,
    });
  }
  return out;
}

async function googleTrades(
  point: { lat: number; lon: number; radiusKm: number },
  trade: NearbyTrade,
  apiKey: string,
  fetcher: typeof fetch,
  nowMs: number,
): Promise<NearbyCompany[] | null> {
  const key = `${point.lat.toFixed(3)},${point.lon.toFixed(3)},${Math.round(point.radiusKm)},${trade}`;
  const hit = googleCache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;
  try {
    const res = await fetcher('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.location',
      },
      body: JSON.stringify({
        textQuery: GOOGLE_QUERY[trade],
        maxResultCount: 20,
        locationBias: { circle: { center: { latitude: point.lat, longitude: point.lon }, radius: Math.min(50_000, point.radiusKm * 1000) } },
      }),
      signal: AbortSignal.timeout(12_000),
      redirect: 'error',
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_BYTES) return null;
    const value = parseGooglePlaces(JSON.parse(text) as unknown, trade, point).filter((c) => c.distanceKm <= point.radiusKm * 1.5);
    if (googleCache.size >= MAX_CACHE) googleCache.delete(googleCache.keys().next().value!);
    googleCache.set(key, { at: nowMs, value });
    return value;
  } catch {
    return null;
  }
}

/** OpenStreetMap listings, plus Google Places for one trade when a key is set. */
export async function lookupNearbyTradesAll(
  req: { lat: number; lon: number; radiusKm: number; trade?: NearbyTrade },
  googleApiKey: string | undefined,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<NearbyTradesResponse> {
  const point = { lat: req.lat, lon: req.lon, radiusKm: req.radiusKm };
  const [osm, google] = await Promise.all([
    lookupNearbyTrades(point, fetcher, nowMs),
    googleApiKey && req.trade ? googleTrades(point, req.trade, googleApiKey, fetcher, nowMs) : Promise.resolve(null),
  ]);
  if (!google?.length) return osm;
  const seen = new Set(osm.companies.map((c) => c.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const extra = google.filter((c) => !seen.has(c.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const companies = [...osm.companies, ...extra].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 200);
  return {
    status: 'found',
    attribution: `${osm.attribution}; business listings from Google`,
    message: `Found ${companies.length} trades and suppliers within ${req.radiusKm} km (${extra.length} more from Google for this trade). Listings can be out of date; call to confirm.`,
    companies,
  };
}
