// Provider registry for the imagery module. Only adapters that actually exist are listed; the
// status route reports each one's real configuration state. Adding an analysis-licensed aerial
// provider (D-03) means adding an adapter here, not switching imagery on in the UI.
import type { AppConfig } from '../../../config';
import { ContractorUploadProvider } from './contractor-upload';
import { GoogleSolarProvider } from './google-solar';
import type { FetchLike, ImageryProvider } from './types';

export * from './types';
export { GoogleSolarProvider, GOOGLE_SOLAR_KEY_ENV } from './google-solar';
export { ContractorUploadProvider } from './contractor-upload';

export function createImageryProviders(
  config: AppConfig,
  overrides: { fetch?: FetchLike } = {},
): ImageryProvider[] {
  return [
    new GoogleSolarProvider({
      apiKey: config.imagery.googleSolarApiKey,
      ...(overrides.fetch !== undefined && { fetch: overrides.fetch }),
    }),
    new ContractorUploadProvider(),
  ];
}
