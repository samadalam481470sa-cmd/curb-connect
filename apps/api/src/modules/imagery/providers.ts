// Imagery provider adapters (RF-022 R, RR-031, COS-202, COS-214, ADD-022, ADD-038). Each adapter
// returns provider image id, georeference, ground sample distance, capture date, attribution and
// the license rights the rights engine enforces.
//
//   fixture            synthetic deterministic imagery for tests/demo, FULL rights, isSynthetic.
//   esri_world_imagery visualization only (basemap tiles; no analysis, caching or export).
//   google_map_tiles   visualization only, and only when GOOGLE_MAPS_API_KEY is configured.
// No adapter here calls a vendor: the Esri/Google entries describe tile layers the web client
// renders directly. Licensed measurement imagery vendors are blocked_vendor (not built).
import { createHash } from 'node:crypto';
import type { ImageryLicense, ImageryProvider } from '@fieldline/contracts';

export interface ImageryCandidateInput {
  provider: ImageryProvider;
  providerImageId: string;
  kind: 'orthophoto' | 'oblique';
  rights: ImageryLicense;
  attribution: string;
  gsdM: number | null;
  captureDate: string | null;
  georef: Record<string, unknown> | null;
  widthPx: number | null;
  heightPx: number | null;
}

export interface ImageryProviderAdapter {
  readonly id: ImageryProvider;
  /** Visualization-only adapters are never offered for measurement. */
  readonly visualizationOnly: boolean;
  candidates(point: { lon: number; lat: number }): Promise<ImageryCandidateInput[]>;
}

const VIS_ONLY: Omit<ImageryLicense, 'attributionRequired' | 'licenseRef'> = {
  rightsVersion: 1,
  visualize: true,
  analyze: false,
  cache: false,
  embedInExports: false,
  redistribute: false,
  expiresAt: null,
  assertedBy: null,
  isSynthetic: false,
};

export const fixtureProvider: ImageryProviderAdapter = {
  id: 'fixture',
  visualizationOnly: false,
  async candidates(point) {
    const id = createHash('sha256').update(`fixture-imagery:${point.lon.toFixed(6)},${point.lat.toFixed(6)}`).digest('hex').slice(0, 20);
    return [
      {
        provider: 'fixture',
        providerImageId: `fixture-${id}`,
        kind: 'orthophoto',
        rights: { ...VIS_ONLY, analyze: true, cache: true, embedInExports: true, redistribute: true, attributionRequired: true, licenseRef: 'synthetic-test-license', isSynthetic: true },
        attribution: 'Synthetic fixture imagery (Field Pro test data, not a real capture)',
        gsdM: 0.075,
        captureDate: '2026-01-15',
        // Local ENU origin at the property point, north-up, 7.5 cm/pixel.
        georef: { kind: 'affine', origin: [point.lon, point.lat], rotationDeg: 0, metersPerPixel: 0.075, crs: 'EPSG:4326' },
        widthPx: 1024,
        heightPx: 1024,
      },
    ];
  },
};

export const esriProvider: ImageryProviderAdapter = {
  id: 'esri_world_imagery',
  visualizationOnly: true,
  async candidates(point) {
    return [
      {
        provider: 'esri_world_imagery',
        providerImageId: `esri-world-imagery@${point.lon.toFixed(5)},${point.lat.toFixed(5)}`,
        kind: 'orthophoto',
        rights: { ...VIS_ONLY, attributionRequired: true, licenseRef: 'esri-basemap-terms' },
        attribution: 'Esri World Imagery basemap (visualization only)',
        gsdM: null,
        captureDate: null, // mosaic: no single capture date is known
        georef: null,
        widthPx: null,
        heightPx: null,
      },
    ];
  },
};

export function googleProvider(apiKeyPresent: boolean): ImageryProviderAdapter {
  return {
    id: 'google_map_tiles',
    visualizationOnly: true,
    async candidates(point) {
      if (!apiKeyPresent) return [];
      return [
        {
          provider: 'google_map_tiles',
          providerImageId: `google-2d-satellite@${point.lon.toFixed(5)},${point.lat.toFixed(5)}`,
          kind: 'orthophoto',
          rights: { ...VIS_ONLY, attributionRequired: true, licenseRef: 'google-map-tiles-policies' },
          attribution: 'Google Map Tiles (visualization only)',
          gsdM: null,
          captureDate: null,
          georef: null,
          widthPx: null,
          heightPx: null,
        },
      ];
    },
  };
}

export function imageryProviders(env: NodeJS.ProcessEnv = process.env): ImageryProviderAdapter[] {
  const list: ImageryProviderAdapter[] = [esriProvider, googleProvider(Boolean(env.GOOGLE_MAPS_API_KEY))];
  // The synthetic provider is never offered in production (it must not look like a real capture).
  if (env.NODE_ENV !== 'production') list.unshift(fixtureProvider);
  return list;
}
