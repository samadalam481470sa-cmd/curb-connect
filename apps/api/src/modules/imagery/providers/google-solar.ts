// Google Solar API adapter (structured building insights only).
//
// Server-side only: the API key comes from AppConfig (GOOGLE_SOLAR_API_KEY), is sent in the
// X-Goog-Api-Key header so it never appears in a URL, and is never logged or included in an error.
// This adapter asks for building insights, not data layers or map tiles: Google Solar imagery is
// not licensed measurement imagery for this product, so the result is marked structured-only and
// cannot be mistaken for an analysis-eligible asset.
import { z } from 'zod';
import {
  BUILDING_INSIGHTS_QUALITIES,
  type BuildingInsights,
  type BuildingInsightsQuality,
  type BuildingInsightsQuery,
  type FetchLike,
  type GeoPoint,
  type ImageryBoundingBox,
  type ImageryProvider,
  type ImageryProviderCapabilities,
  type ImageryProviderStatus,
  providerFailure,
  type ProviderFailure,
  type ProviderResult,
} from './types';

export const GOOGLE_SOLAR_KEY_ENV = 'GOOGLE_SOLAR_API_KEY';
const DEFAULT_ENDPOINT = 'https://solar.googleapis.com/v1/buildingInsights:findClosest';
const DEFAULT_TIMEOUT_MS = 8_000;

// Google's proto JSON omits unset/default fields, so every optional field is optional here. Unknown
// enum values degrade to null instead of rejecting an otherwise usable response.
const DateSchema = z
  .object({
    year: z.number().int().optional(),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
  })
  .optional();

const LatLngSchema = z
  .object({
    latitude: z.number().finite().optional(),
    longitude: z.number().finite().optional(),
  })
  .optional();

const SizeSchema = z
  .object({
    areaMeters2: z.number().finite().optional(),
    groundAreaMeters2: z.number().finite().optional(),
  })
  .optional();

const SegmentSchema = z.object({
  pitchDegrees: z.number().finite().optional(),
  azimuthDegrees: z.number().finite().optional(),
  stats: SizeSchema,
});

const GoogleSolarResponseSchema = z.object({
  name: z.string().optional(),
  center: LatLngSchema,
  boundingBox: z.object({ sw: LatLngSchema, ne: LatLngSchema }).optional(),
  imageryDate: DateSchema,
  imageryProcessedDate: DateSchema,
  postalCode: z.string().optional(),
  regionCode: z.string().optional(),
  imageryQuality: z.string().optional(),
  solarPotential: z
    .object({
      maxArrayAreaMeters2: z.number().finite().optional(),
      maxSunshineHoursPerYear: z.number().finite().optional(),
      panelCapacityWatts: z.number().finite().optional(),
      wholeRoofStats: SizeSchema,
      roofSegmentStats: z.array(SegmentSchema).optional(),
    })
    .optional(),
});

type GoogleSolarResponse = z.infer<typeof GoogleSolarResponseSchema>;

export interface GoogleSolarProviderOptions {
  apiKey?: string | undefined;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Test seam; defaults to the public Solar API endpoint. */
  endpoint?: string;
}

function point(value: { latitude?: number; longitude?: number } | undefined): GeoPoint | null {
  if (!value || value.latitude === undefined || value.longitude === undefined) return null;
  return { latitude: value.latitude, longitude: value.longitude };
}

function boundingBox(
  value:
    | {
        sw?: { latitude?: number; longitude?: number };
        ne?: { latitude?: number; longitude?: number };
      }
    | undefined,
): ImageryBoundingBox | null {
  const southWest = point(value?.sw);
  const northEast = point(value?.ne);
  return southWest && northEast ? { southWest, northEast } : null;
}

function isoDate(
  value: { year?: number; month?: number; day?: number } | undefined,
): string | null {
  if (!value?.year || !value.month || !value.day) return null;
  const month = String(value.month).padStart(2, '0');
  const day = String(value.day).padStart(2, '0');
  return `${String(value.year).padStart(4, '0')}-${month}-${day}`;
}

function quality(value: string | undefined): BuildingInsightsQuality | null {
  if (!value) return null;
  const normalized = value.toUpperCase();
  return (BUILDING_INSIGHTS_QUALITIES as readonly string[]).includes(normalized)
    ? (normalized as BuildingInsightsQuality)
    : null;
}

function normalize(payload: GoogleSolarResponse): BuildingInsights {
  const solar = payload.solarPotential;
  const segments = (solar?.roofSegmentStats ?? []).map((segment) => ({
    pitchDegrees: segment.pitchDegrees ?? null,
    azimuthDegrees: segment.azimuthDegrees ?? null,
    areaM2: segment.stats?.areaMeters2 ?? null,
    groundAreaM2: segment.stats?.groundAreaMeters2 ?? null,
  }));
  return {
    provider: 'google_solar',
    providerBuildingId: payload.name ?? null,
    center: point(payload.center),
    boundingBox: boundingBox(payload.boundingBox),
    regionCode: payload.regionCode ?? null,
    postalCode: payload.postalCode ?? null,
    imageryDate: isoDate(payload.imageryDate),
    imageryProcessedDate: isoDate(payload.imageryProcessedDate),
    imageryQuality: quality(payload.imageryQuality),
    wholeRoofAreaM2: solar?.wholeRoofStats?.areaMeters2 ?? null,
    wholeRoofGroundAreaM2: solar?.wholeRoofStats?.groundAreaMeters2 ?? null,
    maxArrayAreaM2: solar?.maxArrayAreaMeters2 ?? null,
    maxSunshineHoursPerYear: solar?.maxSunshineHoursPerYear ?? null,
    panelCapacityWatts: solar?.panelCapacityWatts ?? null,
    roofSegments: segments,
    dataUse: 'structured_insight_only',
    imageryRights: 'not_granted',
    attribution: 'Google Solar API',
  };
}

export class GoogleSolarProvider implements ImageryProvider {
  readonly id = 'google_solar' as const;
  readonly displayName = 'Google Solar API';
  readonly capabilities: ImageryProviderCapabilities = {
    structuredBuildingInsights: true,
    analysisImagery: false,
    imagerySearch: false,
    contractorUpload: false,
  };

  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly endpoint: string;

  constructor(options: GoogleSolarProviderOptions = {}) {
    const key = options.apiKey?.trim();
    this.apiKey = key ? key : undefined;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  }

  status(): ImageryProviderStatus {
    return {
      id: this.id,
      displayName: this.displayName,
      state: this.apiKey ? 'configured' : 'not_configured',
      reason: this.apiKey
        ? null
        : `${GOOGLE_SOLAR_KEY_ENV} is not set; Google Solar structured insights are unavailable.`,
      capabilities: this.capabilities,
      attribution: 'Google Solar API',
    };
  }

  async findBuildingInsights(
    query: BuildingInsightsQuery,
  ): Promise<ProviderResult<BuildingInsights>> {
    if (
      !Number.isFinite(query.latitude) ||
      !Number.isFinite(query.longitude) ||
      query.latitude < -90 ||
      query.latitude > 90 ||
      query.longitude < -180 ||
      query.longitude > 180
    ) {
      return providerFailure(
        'invalid_request',
        'Latitude and longitude must be valid coordinates before Google Solar is queried.',
      );
    }
    if (!this.apiKey) {
      return providerFailure(
        'not_configured',
        `${GOOGLE_SOLAR_KEY_ENV} is not set; Google Solar structured insights are unavailable.`,
      );
    }

    const url = new URL(this.endpoint);
    url.searchParams.set('location.latitude', String(query.latitude));
    url.searchParams.set('location.longitude', String(query.longitude));
    url.searchParams.set('requiredQuality', query.requiredQuality ?? 'HIGH');

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'x-goog-api-key': this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return this.networkFailure(error);
    }

    if (!response.ok) return this.httpFailure(response.status);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return providerFailure(
        'invalid_response',
        'Google Solar returned a response that was not valid JSON.',
      );
    }
    const parsed = GoogleSolarResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return providerFailure(
        'invalid_response',
        'Google Solar returned building insights this adapter could not read.',
      );
    }
    return { ok: true, value: normalize(parsed.data) };
  }

  private networkFailure(error: unknown): ProviderFailure {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return providerFailure('timeout', 'Google Solar did not respond in time.', {
        retryable: true,
      });
    }
    return providerFailure('upstream_unavailable', 'Could not reach Google Solar.', {
      retryable: true,
    });
  }

  private httpFailure(status: number): ProviderFailure {
    if (status === 400) {
      return providerFailure(
        'invalid_request',
        'Google Solar rejected the location or requested quality.',
        { httpStatus: status },
      );
    }
    if (status === 401 || status === 403) {
      // Deliberately generic: never echo the key, project id or upstream body.
      return providerFailure(
        'unauthorized',
        `Google Solar rejected the API key or project permission. Check the server-side ${GOOGLE_SOLAR_KEY_ENV}.`,
        { httpStatus: status },
      );
    }
    if (status === 404) {
      return providerFailure(
        'not_found',
        'Google Solar has no building insights for this location.',
        {
          httpStatus: status,
        },
      );
    }
    if (status === 429) {
      return providerFailure('rate_limited', 'Google Solar rate limit reached. Retry later.', {
        retryable: true,
        httpStatus: status,
      });
    }
    if (status >= 500) {
      return providerFailure('upstream_unavailable', 'Google Solar is unavailable. Retry later.', {
        retryable: true,
        httpStatus: status,
      });
    }
    return providerFailure(
      'upstream_unavailable',
      'Google Solar returned an unexpected response.',
      {
        httpStatus: status,
      },
    );
  }
}
