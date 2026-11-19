// Provider-independent imagery adapter contract (ROOF-AI-001 Part D). Adapters return either a
// normalized result or a typed failure. "Not configured" is a first-class state: an adapter never
// invents data, fabricates coverage or silently substitutes another provider.
//
// Google Solar is deliberately structured-insight-only. Its building insights (pitch, segments,
// areas, imagery date/quality) may inform a human review, but they are not licensed measurement
// imagery, so `imageryRights` stays `not_granted` and no pixels enter the CV pipeline.
import type { AnalysisImageryProvider } from '@fieldline/contracts';

export type FetchLike = (input: URL | string, init?: RequestInit) => Promise<Response>;

export const BUILDING_INSIGHTS_QUALITIES = ['HIGH', 'MEDIUM', 'LOW', 'BASE'] as const;
export type BuildingInsightsQuality = (typeof BUILDING_INSIGHTS_QUALITIES)[number];

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface ImageryBoundingBox {
  southWest: GeoPoint;
  northEast: GeoPoint;
}

/** One roof plane reported by the provider. Missing values stay null, never zero. */
export interface RoofSegmentInsight {
  pitchDegrees: number | null;
  azimuthDegrees: number | null;
  areaM2: number | null;
  groundAreaM2: number | null;
}

/** Normalized building insights. Only fields the provider actually returned are populated. */
export interface BuildingInsights {
  provider: 'google_solar';
  providerBuildingId: string | null;
  center: GeoPoint | null;
  boundingBox: ImageryBoundingBox | null;
  regionCode: string | null;
  postalCode: string | null;
  imageryDate: string | null;
  imageryProcessedDate: string | null;
  imageryQuality: BuildingInsightsQuality | null;
  wholeRoofAreaM2: number | null;
  wholeRoofGroundAreaM2: number | null;
  maxArrayAreaM2: number | null;
  maxSunshineHoursPerYear: number | null;
  panelCapacityWatts: number | null;
  roofSegments: RoofSegmentInsight[];
  /** Structured insights can inform review; they are never a measurement source. */
  dataUse: 'structured_insight_only';
  imageryRights: 'not_granted';
  attribution: string;
}

export type ProviderErrorCode =
  | 'not_configured'
  | 'invalid_request'
  | 'not_found'
  | 'unauthorized'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'invalid_response'
  | 'unsupported';

export interface ProviderFailure {
  ok: false;
  code: ProviderErrorCode;
  /** User-safe explanation. Never contains the API key, request URL or upstream response body. */
  message: string;
  retryable: boolean;
  httpStatus?: number;
}

export type ProviderResult<T> = { ok: true; value: T } | ProviderFailure;

export function providerFailure(
  code: ProviderErrorCode,
  message: string,
  options: { retryable?: boolean; httpStatus?: number } = {},
): ProviderFailure {
  return {
    ok: false,
    code,
    message,
    retryable: options.retryable ?? false,
    ...(options.httpStatus !== undefined && { httpStatus: options.httpStatus }),
  };
}

export interface ImageryProviderCapabilities {
  /** Structured building/roof insights (no pixels). */
  structuredBuildingInsights: boolean;
  /** Licensed pixels that may be analysed by the measurement pipeline. */
  analysisImagery: boolean;
  /** Searchable historical imagery for this location. */
  imagerySearch: boolean;
  /** Contractor-uploaded photos/documents with recorded consent. */
  contractorUpload: boolean;
}

export type ImageryProviderState = 'configured' | 'not_configured';

export interface ImageryProviderStatus {
  id: AnalysisImageryProvider;
  displayName: string;
  state: ImageryProviderState;
  /** Why the provider is unavailable; null when configured. Never contains a credential. */
  reason: string | null;
  capabilities: ImageryProviderCapabilities;
  attribution: string | null;
}

export interface BuildingInsightsQuery {
  latitude: number;
  longitude: number;
  /** Minimum imagery quality Google may return; defaults to HIGH. */
  requiredQuality?: BuildingInsightsQuality;
}

export interface ImageryProvider {
  readonly id: AnalysisImageryProvider;
  readonly displayName: string;
  readonly capabilities: ImageryProviderCapabilities;
  status(): ImageryProviderStatus;
  findBuildingInsights(query: BuildingInsightsQuery): Promise<ProviderResult<BuildingInsights>>;
}
