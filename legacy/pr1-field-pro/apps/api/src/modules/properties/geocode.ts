/**
 * Address geocoding proxy.
 *
 * Attribution / terms (keep these visible in product UI when showing results):
 * - OpenStreetMap Nominatim: data © OpenStreetMap contributors (ODbL). Usage policy requires a
 *   valid User-Agent identifying the application, max ~1 req/s, and no bulk scraping. Results
 *   must credit OSM. See https://operations.osmfoundation.org/policies/nominatim/
 * - Mapbox Geocoding API: results require Mapbox attribution when displayed on a map; token
 *   must stay server-side. See https://docs.mapbox.com/help/getting-started/attribution/
 * - Google Geocoding API: results must follow Google Maps Platform Terms; do not cache beyond
 *   permitted temporary session storage. Attribution required when shown with Maps.
 *
 * This module caches nothing. Callers rate-limit via Fastify route config.
 */
import { z } from 'zod';
import { problem } from '../../http/problem';

export const GeocodeCandidateSchema = z.object({
  provider: z.string(),
  placeId: z.string(),
  displayName: z.string(),
  lat: z.number(),
  lng: z.number(),
  line1: z.string().nullable(),
  locality: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});
export type GeocodeCandidate = z.infer<typeof GeocodeCandidateSchema>;

export interface GeocodeEnv {
  mapboxAccessToken?: string | null;
  googleGeocodingApiKey?: string | null;
  /** Override Nominatim base URL (tests). */
  nominatimUrl?: string;
}

const NominatimResult = z.object({
  place_id: z.union([z.number(), z.string()]),
  display_name: z.string(),
  lat: z.string(),
  lon: z.string(),
  importance: z.number().optional(),
  address: z
    .object({
      house_number: z.string().optional(),
      road: z.string().optional(),
      city: z.string().optional(),
      town: z.string().optional(),
      village: z.string().optional(),
      municipality: z.string().optional(),
      state: z.string().optional(),
      postcode: z.string().optional(),
      country_code: z.string().optional(),
    })
    .optional(),
});

async function geocodeNominatim(query: string, env: GeocodeEnv): Promise<GeocodeCandidate[]> {
  const base = env.nominatimUrl ?? 'https://nominatim.openstreetmap.org';
  const url = new URL('/search', base);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      // Nominatim usage policy requires a descriptive User-Agent.
      'User-Agent': 'FieldPro/1.0 (contractor MVP; contact: support@fieldpro.local)',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw problem('dependency_unavailable', `Nominatim returned ${res.status}. Try again shortly.`);
  }
  const raw = (await res.json()) as unknown;
  const list = z.array(NominatimResult).parse(raw);
  return list.map((r) => {
    const a = r.address;
    const line1 = a
      ? [a.house_number, a.road].filter(Boolean).join(' ') || null
      : null;
    const locality = a?.city ?? a?.town ?? a?.village ?? a?.municipality ?? null;
    return {
      provider: 'nominatim',
      placeId: String(r.place_id),
      displayName: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
      line1,
      locality,
      region: a?.state ?? null,
      postalCode: a?.postcode ?? null,
      countryCode: a?.country_code ? a.country_code.toUpperCase() : null,
      confidence: r.importance != null ? Math.min(1, Math.max(0, r.importance)) : null,
    };
  });
}

async function geocodeMapbox(query: string, token: string): Promise<GeocodeCandidate[]> {
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
  );
  url.searchParams.set('access_token', token);
  url.searchParams.set('limit', '5');
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) {
    throw problem('dependency_unavailable', `Mapbox geocoding returned ${res.status}.`);
  }
  const raw = (await res.json()) as {
    features?: Array<{
      id: string;
      place_name: string;
      center: [number, number];
      relevance?: number;
      text?: string;
      context?: Array<{ id: string; text: string; short_code?: string }>;
      address?: string;
    }>;
  };
  return (raw.features ?? []).map((f) => {
    const ctx = f.context ?? [];
    const find = (prefix: string) => ctx.find((c) => c.id.startsWith(prefix));
    const place = find('place');
    const region = find('region');
    const postcode = find('postcode');
    const country = find('country');
    const line1 = f.address && f.text ? `${f.address} ${f.text}` : (f.text ?? null);
    return {
      provider: 'mapbox',
      placeId: f.id,
      displayName: f.place_name,
      lat: f.center[1],
      lng: f.center[0],
      line1,
      locality: place?.text ?? null,
      region: region?.text ?? null,
      postalCode: postcode?.text ?? null,
      countryCode: country?.short_code?.toUpperCase().slice(-2) ?? null,
      confidence: f.relevance ?? null,
    };
  });
}

async function geocodeGoogle(query: string, key: string): Promise<GeocodeCandidate[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('key', key);
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) {
    throw problem('dependency_unavailable', `Google geocoding returned ${res.status}.`);
  }
  const raw = (await res.json()) as {
    status: string;
    results?: Array<{
      place_id: string;
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
      address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
    }>;
  };
  if (raw.status !== 'OK' && raw.status !== 'ZERO_RESULTS') {
    throw problem('dependency_unavailable', `Google geocoding status: ${raw.status}`);
  }
  return (raw.results ?? []).map((r) => {
    const comp = (type: string) => r.address_components.find((c) => c.types.includes(type));
    const streetNumber = comp('street_number')?.long_name;
    const route = comp('route')?.long_name;
    const line1 = [streetNumber, route].filter(Boolean).join(' ') || null;
    return {
      provider: 'google',
      placeId: r.place_id,
      displayName: r.formatted_address,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      line1,
      locality:
        comp('locality')?.long_name ??
        comp('postal_town')?.long_name ??
        comp('sublocality')?.long_name ??
        null,
      region: comp('administrative_area_level_1')?.short_name ?? null,
      postalCode: comp('postal_code')?.long_name ?? null,
      countryCode: comp('country')?.short_name ?? null,
      confidence: null,
    };
  });
}

/** Prefer Mapbox, then Google, else Nominatim. Never caches results. */
export async function geocodeAddress(query: string, env: GeocodeEnv): Promise<GeocodeCandidate[]> {
  const q = query.trim();
  if (q.length < 3) throw problem('validation_failed', 'Query must be at least 3 characters.');
  if (env.mapboxAccessToken) return geocodeMapbox(q, env.mapboxAccessToken);
  if (env.googleGeocodingApiKey) return geocodeGoogle(q, env.googleGeocodingApiKey);
  return geocodeNominatim(q, env);
}
