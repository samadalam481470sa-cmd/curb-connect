// Address search: prefer Field Pro API POST `/v1/properties/geocode`, fall back to Nominatim.
import { z } from 'zod';
import type { ApiClient } from '../../lib/api';
import { isApiError } from '../../lib/api';

export interface GeocodeHit {
  readonly id: string;
  readonly label: string;
  readonly lng: number;
  readonly lat: number;
  readonly provider: string;
  readonly confidence: number | null;
  readonly attribution?: string;
}

const ApiGeocodeCandidateSchema = z.object({
  provider: z.string(),
  placeId: z.string(),
  displayName: z.string(),
  lat: z.number(),
  lng: z.number(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

const ApiGeocodeResponseSchema = z.object({
  candidates: z.array(ApiGeocodeCandidateSchema),
  attribution: z.string().optional(),
});

const NOMINATIM_UA =
  'FieldPro/0.1 (construction measurement workspace; contact: support@fieldline.local)';

export async function geocodeViaApi(
  api: ApiClient,
  query: string,
  signal?: AbortSignal,
): Promise<{ hits: GeocodeHit[]; attribution?: string } | null> {
  const q = query.trim();
  if (q.length < 3) return { hits: [] };
  try {
    const data = await api.post(
      '/v1/properties/geocode',
      { q },
      { schema: ApiGeocodeResponseSchema, signal },
    );
    return {
      attribution: data.attribution,
      hits: data.candidates.map((c, i) => ({
        id: c.placeId || `api-${i}`,
        label: c.displayName,
        lng: c.lng,
        lat: c.lat,
        provider: c.provider,
        confidence: c.confidence ?? null,
        attribution: data.attribution,
      })),
    };
  } catch (error) {
    if (
      isApiError(error) &&
      (error.is('not_found') ||
        error.is('feature_unavailable') ||
        error.is('method_not_allowed') ||
        error.status === 404 ||
        error.status === 501)
    ) {
      return null;
    }
    if (isApiError(error) && error.kind === 'aborted') throw error;
    // Contract mismatch or other: try GET AddressSearch shape as a soft secondary.
    try {
      const alt = await api.get('/v1/properties/geocode', {
        query: { q, limit: 8 },
        signal,
      });
      const parsed = z
        .object({
          candidates: z.array(
            z.object({
              placeId: z.string().optional(),
              label: z.string(),
              provider: z.string(),
              confidence: z.number().optional(),
              location: z.object({
                coordinates: z.tuple([z.number(), z.number()]),
              }),
            }),
          ),
        })
        .safeParse(alt);
      if (!parsed.success) return null;
      return {
        hits: parsed.data.candidates.map((c, i) => ({
          id: c.placeId || `api-${i}`,
          label: c.label,
          lng: c.location.coordinates[0],
          lat: c.location.coordinates[1],
          provider: c.provider,
          confidence: c.confidence ?? null,
        })),
      };
    } catch {
      return null;
    }
  }
}

/** Browser Nominatim fallback. Requires a descriptive User-Agent per Nominatim usage policy. */
export async function geocodeViaNominatim(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '8');
  url.searchParams.set('addressdetails', '0');
  const res = await fetch(url.toString(), {
    signal,
    headers: {
      Accept: 'application/json',
      'User-Agent': NOMINATIM_UA,
    },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as Array<{
    place_id: number;
    display_name: string;
    lon: string;
    lat: string;
    importance?: number;
  }>;
  return json.map((row) => ({
    id: `nominatim-${row.place_id}`,
    label: row.display_name,
    lng: Number(row.lon),
    lat: Number(row.lat),
    provider: 'nominatim',
    confidence: row.importance ?? null,
  }));
}

export async function geocodeAddress(
  api: ApiClient | null,
  query: string,
  signal?: AbortSignal,
): Promise<{ hits: GeocodeHit[]; source: 'api' | 'nominatim' | 'empty' }> {
  if (api) {
    const apiResult = await geocodeViaApi(api, query, signal);
    if (apiResult !== null) {
      return {
        hits: apiResult.hits,
        source: apiResult.hits.length ? 'api' : 'empty',
      };
    }
  }
  const hits = await geocodeViaNominatim(query, signal);
  return { hits, source: hits.length ? 'nominatim' : 'empty' };
}
