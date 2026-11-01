import { getDraftStore } from '../../lib/offline/drafts';
import { isApiError, newIdempotencyKey } from '../../lib/api';
import type { Endpoints } from '../../lib/endpoints';
import type { MapOpening } from '../map';
import type { DepthMode } from './calc';

export const CURB_DRAFT_SCHEMA = 1;

export interface CurbSafetyChecks {
  readonly unknownDeck: boolean;
  readonly utilitiesUnknown: boolean;
  readonly fieldVerificationRequired: boolean;
}

export interface CurbDraftState {
  readonly addressLabel: string | null;
  readonly openings: MapOpening[];
  readonly depthMode: DepthMode;
  readonly depthIn: string;
  readonly depthLowIn: string;
  readonly depthBaseIn: string;
  readonly depthHighIn: string;
  readonly sawPasses: string;
  readonly removalWidthFt: string;
  readonly crossSectionFt2: string;
  readonly overheadPercent: string;
  readonly marginPercent: string;
  readonly safety: CurbSafetyChecks;
  readonly placeWidthFt: string;
  readonly placeLengthFt: string;
  readonly placeEquipment: MapOpening['equipment'];
}

export const EMPTY_CURB_DRAFT: CurbDraftState = {
  addressLabel: null,
  openings: [],
  depthMode: 'bounded',
  depthIn: '6',
  depthLowIn: '6',
  depthBaseIn: '7',
  depthHighIn: '9',
  sawPasses: '2',
  removalWidthFt: '2',
  crossSectionFt2: '1.5',
  overheadPercent: '10',
  marginPercent: '25',
  safety: {
    unknownDeck: true,
    utilitiesUnknown: true,
    fieldVerificationRequired: true,
  },
  placeWidthFt: '4',
  placeLengthFt: '4',
  placeEquipment: 'hvac',
};

function storageKey(projectId: string | null): string {
  return projectId ? `curb-project:${projectId}` : 'curb-draft:new';
}

export async function loadCurbDraft(
  userId: string,
  orgId: string,
  projectId: string | null,
): Promise<CurbDraftState | null> {
  const draft = await getDraftStore().load<CurbDraftState>(
    { userId, orgId },
    storageKey(projectId),
    CURB_DRAFT_SCHEMA,
  );
  return draft?.value ?? null;
}

export async function saveCurbDraftLocal(
  userId: string,
  orgId: string,
  projectId: string | null,
  value: CurbDraftState,
): Promise<void> {
  await getDraftStore().save({ userId, orgId }, storageKey(projectId), value, CURB_DRAFT_SCHEMA);
}

export async function saveCurbDraftRemote(
  endpoints: Endpoints,
  projectId: string | null,
  value: CurbDraftState,
): Promise<'saved' | 'unavailable' | 'error'> {
  try {
    await endpoints.saveCurbProjectDraft(
      projectId,
      { draft: value, kind: 'curb_measurement_draft' },
      newIdempotencyKey(),
    );
    return 'saved';
  } catch (error) {
    if (
      isApiError(error) &&
      (error.is('not_found') ||
        error.is('feature_unavailable') ||
        error.is('method_not_allowed') ||
        error.status === 404 ||
        error.status === 501)
    ) {
      return 'unavailable';
    }
    return 'error';
  }
}

export function safetyBlocksFirmQuote(safety: CurbSafetyChecks): boolean {
  return safety.unknownDeck || safety.utilitiesUnknown || safety.fieldVerificationRequired;
}
