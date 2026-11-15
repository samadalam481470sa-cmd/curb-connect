// Geocoder adapters (RF-017, RF-077 R, ADD-021): provider-neutral address search with honest
// provenance. Every candidate says which provider produced it, its attribution, whether the
// provider's terms let us STORE the geocoded point, and whether it is synthetic.
//
//   fixture   deterministic synthetic results for tests and demos (always isSynthetic: true).
//   esri      Esri World Geocoding Service (findAddressCandidates). Without ESRI_API_KEY the
//             results are for search display only (storable: false): we keep the user's query and
//             their confirmed pin, never Esri's point. With a key we request forStorage=true.
//   google    Google Geocoding API, only when GOOGLE_MAPS_API_KEY is set. Coordinates are not
//             stored (storable: false); the place_id is kept as the reference.
// Building footprints are not provided by Esri or Google geocoding; only the fixture adapter returns
// structure candidates. Real footprint sources are a separate (vendor) adapter, not built yet.
import { createHash } from 'node:crypto';
import type { AddressCandidate, StructureCandidate } from '@fieldline/contracts';
import { problem } from '../../http/problem';

export interface GeocoderAdapter {
  readonly id: 'fixture' | 'esri' | 'google';
  search(query: string, options?: { limit?: number }): Promise<AddressCandidate[]>;
}

// ------------------------------------------------------------------ fixture (synthetic)
const FIXTURE_ATTRIBUTION = 'Synthetic fixture geocoder (Field Pro test data; not a real address)';

function square(lon: number, lat: number, half = 0.00008): StructureCandidate['footprint'] {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon - half, lat - half],
        [lon + half, lat - half],
        [lon + half, lat + half],
        [lon - half, lat + half],
        [lon - half, lat - half],
      ],
    ],
  };
}

interface FixtureEntry {
  match: RegExp;
  label: string;
  line1: string;
  locality: string;
  postalCode: string;
  lon: number;
  lat: number;
  confidence: number;
  precision: AddressCandidate['precision'];
  structures: StructureCandidate[];
}

/** Fictional places in the fictional town of Testville (coordinates in open water off 0,0). */
export const FIXTURE_PLACES: FixtureEntry[] = [
  {
    match: /^100 fixture way/i,
    label: '100 Fixture Way, Testville',
    line1: '100 Fixture Way',
    locality: 'Testville',
    postalCode: '00001',
    lon: 0.01,
    lat: 0.01,
    confidence: 0.97,
    precision: 'rooftop',
    structures: [
      { ref: 'fx-100-main', label: 'Main house', kind: 'main_house', footprint: square(0.01, 0.01), detectionConfidence: 0.91 },
    ],
  },
  {
    match: /^200 campus loop/i,
    label: '200 Campus Loop, Testville',
    line1: '200 Campus Loop',
    locality: 'Testville',
    postalCode: '00002',
    lon: 0.02,
    lat: 0.02,
    confidence: 0.93,
    precision: 'rooftop',
    structures: [
      { ref: 'fx-200-a', label: 'Building A', kind: 'main_house', footprint: square(0.0199, 0.02), detectionConfidence: 0.88 },
      { ref: 'fx-200-b', label: 'Detached garage', kind: 'detached_garage', footprint: square(0.0201, 0.02, 0.00004), detectionConfidence: 0.62 },
    ],
  },
  {
    match: /^300 border road/i,
    label: '300 Border Road, Testville',
    line1: '300 Border Road',
    locality: 'Testville',
    postalCode: '00003',
    lon: 0.03,
    lat: 0.03,
    confidence: 0.71,
    precision: 'interpolated',
    structures: [],
  },
];

function fixtureCandidate(e: FixtureEntry): AddressCandidate {
  return {
    provider: 'fixture',
    placeId: `fixture:${e.line1.toLowerCase().replaceAll(' ', '-')}`,
    label: e.label,
    address: { line1: e.line1, locality: e.locality, postalCode: e.postalCode, countryCode: 'US' },
    location: { type: 'Point', coordinates: [e.lon, e.lat] },
    confidence: e.confidence,
    precision: e.precision,
    attribution: FIXTURE_ATTRIBUTION,
    storable: true,
    isSynthetic: true,
    structures: e.structures,
  };
}

export class FixtureGeocoder implements GeocoderAdapter {
  readonly id = 'fixture' as const;
  async search(query: string): Promise<AddressCandidate[]> {
    const q = query.trim();
    // "Main Street" returns two candidates so ambiguity handling can be exercised.
    if (/^1 main street/i.test(q)) {
      return [
        fixtureCandidate({ ...FIXTURE_PLACES[0]!, match: /x/, label: '1 Main Street, Testville', line1: '1 Main Street', lon: 0.011, lat: 0.011, structures: [] }),
        fixtureCandidate({ ...FIXTURE_PLACES[0]!, match: /x/, label: '1 Main Street, Otherville', line1: '1 Main Street', locality: 'Otherville', lon: 0.05, lat: 0.05, structures: [] }),
      ];
    }
    return FIXTURE_PLACES.filter((e) => e.match.test(q)).map(fixtureCandidate);
  }
}

// ------------------------------------------------------------------ Esri World Geocoding
const ESRI_URL = 'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';
const ESRI_ATTRIBUTION = 'Geocoding by Esri World Geocoding Service';

interface EsriCandidate {
  address: string;
  location: { x: number; y: number };
  score: number;
  attributes: Record<string, string | number | undefined>;
}

function esriPrecision(addrType: string | undefined): AddressCandidate['precision'] {
  switch (addrType) {
    case 'PointAddress':
    case 'Subaddress':
      return 'rooftop';
    case 'Parcel':
      return 'parcel';
    case 'StreetAddress':
    case 'StreetInt':
      return 'interpolated';
    case 'StreetName':
      return 'street';
    default:
      return 'locality';
  }
}

export class EsriGeocoder implements GeocoderAdapter {
  readonly id = 'esri' as const;
  constructor(
    private readonly apiKey: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, options: { limit?: number } = {}): Promise<AddressCandidate[]> {
    const url = new URL(ESRI_URL);
    url.searchParams.set('f', 'json');
    url.searchParams.set('SingleLine', query);
    url.searchParams.set('maxLocations', String(options.limit ?? 5));
    url.searchParams.set('outFields', 'Addr_type,StAddr,SubAddr,City,RegionAbbr,Postal,CntryName,Country');
    if (this.apiKey) url.searchParams.set('forStorage', 'true');
    const headers: Record<string, string> = {};
    // The key travels in a header, never in a logged URL.
    if (this.apiKey) headers['X-Esri-Authorization'] = `Bearer ${this.apiKey}`;
    let body: { candidates?: EsriCandidate[]; error?: unknown };
    try {
      const res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`esri ${res.status}`);
      body = (await res.json()) as typeof body;
    } catch {
      throw problem('dependency_unavailable', 'Address search is unavailable right now. Drop a pin on the map instead.');
    }
    if (body.error) throw problem('dependency_unavailable', 'Address search is unavailable right now. Drop a pin on the map instead.');
    return (body.candidates ?? []).map((c) => {
      const a = c.attributes;
      const country = String(a.Country ?? 'US').slice(0, 2).toUpperCase();
      return {
        provider: 'esri',
        // findAddressCandidates has no stable id: derive one from the match + point so the server
        // can re-verify a picked candidate by re-running the same search.
        placeId: `esri:${createHash('sha256').update(`${c.address}|${c.location.x.toFixed(6)}|${c.location.y.toFixed(6)}`).digest('hex').slice(0, 24)}`,
        label: c.address,
        address: {
          line1: String(a.StAddr || c.address).slice(0, 200) || c.address.slice(0, 200),
          ...(a.SubAddr ? { line2: String(a.SubAddr).slice(0, 200) } : {}),
          locality: String(a.City || '-').slice(0, 120),
          ...(a.RegionAbbr ? { region: String(a.RegionAbbr) } : {}),
          ...(a.Postal ? { postalCode: String(a.Postal).slice(0, 20) } : {}),
          countryCode: /^[A-Z]{2}$/.test(country) ? country : 'US',
        },
        location: { type: 'Point', coordinates: [c.location.x, c.location.y] },
        confidence: Math.max(0, Math.min(1, c.score / 100)),
        precision: esriPrecision(a.Addr_type as string | undefined),
        attribution: ESRI_ATTRIBUTION,
        storable: this.apiKey !== null,
        isSynthetic: false,
        structures: [],
      } satisfies AddressCandidate;
    });
  }
}

// ------------------------------------------------------------------ Google Geocoding (behind key)
const GOOGLE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
/** location_type -> precision. Google returns no numeric score; confidence is a documented mapping. */
const GOOGLE_TYPES: Record<string, { precision: AddressCandidate['precision']; confidence: number }> = {
  ROOFTOP: { precision: 'rooftop', confidence: 0.9 },
  RANGE_INTERPOLATED: { precision: 'interpolated', confidence: 0.7 },
  GEOMETRIC_CENTER: { precision: 'street', confidence: 0.5 },
  APPROXIMATE: { precision: 'locality', confidence: 0.3 },
};

interface GoogleResult {
  place_id: string;
  formatted_address: string;
  geometry: { location: { lat: number; lng: number }; location_type: string };
  address_components: { long_name: string; short_name: string; types: string[] }[];
}

export class GoogleGeocoder implements GeocoderAdapter {
  readonly id = 'google' as const;
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, options: { limit?: number } = {}): Promise<AddressCandidate[]> {
    const url = new URL(GOOGLE_URL);
    url.searchParams.set('address', query);
    url.searchParams.set('key', this.apiKey);
    let body: { status: string; results?: GoogleResult[] };
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      body = (await res.json()) as typeof body;
    } catch {
      throw problem('dependency_unavailable', 'Address search is unavailable right now. Drop a pin on the map instead.');
    }
    if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
      throw problem('dependency_unavailable', 'Address search is unavailable right now. Drop a pin on the map instead.');
    }
    return (body.results ?? []).slice(0, options.limit ?? 5).map((r) => {
      const part = (type: string, short = false) => {
        const c = r.address_components.find((x) => x.types.includes(type));
        return c ? (short ? c.short_name : c.long_name) : undefined;
      };
      const t = GOOGLE_TYPES[r.geometry.location_type] ?? { precision: 'locality' as const, confidence: 0.3 };
      const line1 = [part('street_number'), part('route')].filter(Boolean).join(' ') || r.formatted_address;
      return {
        provider: 'google',
        placeId: `google:${r.place_id}`,
        label: r.formatted_address,
        address: {
          line1: line1.slice(0, 200),
          locality: (part('locality') ?? part('postal_town') ?? '-').slice(0, 120),
          ...(part('administrative_area_level_1', true) ? { region: part('administrative_area_level_1', true)! } : {}),
          ...(part('postal_code') ? { postalCode: part('postal_code')! } : {}),
          countryCode: (part('country', true) ?? 'US').toUpperCase().slice(0, 2),
        },
        location: { type: 'Point', coordinates: [r.geometry.location.lng, r.geometry.location.lat] },
        confidence: t.confidence,
        precision: t.precision,
        attribution: 'Geocoding by Google',
        storable: false,
        isSynthetic: false,
        structures: [],
      } satisfies AddressCandidate;
    });
  }
}

// ------------------------------------------------------------------ selection
let override: GeocoderAdapter | null = null;

/** Tests may inject an adapter (e.g. a fetch-stubbed Esri adapter). */
export function setGeocoderForTests(adapter: GeocoderAdapter | null): void {
  override = adapter;
}

/**
 * GEOCODER_PROVIDER = fixture | esri | google. Default: fixture under vitest, esri otherwise. The
 * fixture adapter is refused in production so synthetic places can never reach real customers.
 */
export function geocoder(): GeocoderAdapter {
  if (override) return override;
  const env = process.env;
  const chosen = env.GEOCODER_PROVIDER ?? (env.VITEST ? 'fixture' : 'esri');
  if (chosen === 'fixture') {
    if (env.NODE_ENV === 'production') throw problem('feature_unavailable', 'The fixture geocoder is disabled in production.');
    return new FixtureGeocoder();
  }
  if (chosen === 'google') {
    if (!env.GOOGLE_MAPS_API_KEY) throw problem('feature_unavailable', 'Google geocoding needs GOOGLE_MAPS_API_KEY.');
    return new GoogleGeocoder(env.GOOGLE_MAPS_API_KEY);
  }
  return new EsriGeocoder(env.ESRI_API_KEY ?? null);
}
