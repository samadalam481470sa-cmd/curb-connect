import type { ApiClient } from '../../lib/api';

/** The slice of the API client the property components use (inject a fake in tests). */
export type PropertyApi = Pick<ApiClient, 'get' | 'post'>;

/** Esri World Imagery: VISUALIZATION ONLY (never machine analysis or caching for inference). */
export const ESRI_WORLD_IMAGERY = {
  tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community. Shown for orientation only.',
  maxzoom: 19,
} as const;
