// Contractor-upload adapter (ROOF-AI-001): contractors may supply their own photos/plans, but the
// asset enters the pipeline only after the caller records consent, licence rights and a retention
// period. This adapter has no network surface and never claims to search for imagery.
import type {
  BuildingInsights,
  BuildingInsightsQuery,
  ImageryProvider,
  ImageryProviderCapabilities,
  ImageryProviderStatus,
  ProviderResult,
} from './types';
import { providerFailure } from './types';

export class ContractorUploadProvider implements ImageryProvider {
  readonly id = 'contractor_upload' as const;
  readonly displayName = 'Contractor upload';
  readonly capabilities: ImageryProviderCapabilities = {
    structuredBuildingInsights: false,
    analysisImagery: true,
    imagerySearch: false,
    contractorUpload: true,
  };

  status(): ImageryProviderStatus {
    return {
      id: this.id,
      displayName: this.displayName,
      state: 'configured',
      reason: null,
      capabilities: this.capabilities,
      attribution: 'Contractor-supplied imagery with recorded consent',
    };
  }

  async findBuildingInsights(
    _query: BuildingInsightsQuery,
  ): Promise<ProviderResult<BuildingInsights>> {
    return providerFailure(
      'unsupported',
      'Contractor uploads are registered as imagery assets; they do not return building insights.',
    );
  }
}
