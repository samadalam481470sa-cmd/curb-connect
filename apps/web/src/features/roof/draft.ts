// Autosave roof measurement drafts to localStorage + optional API.
import { getDraftStore } from '../../lib/offline/drafts';
import { newIdempotencyKey, isApiError } from '../../lib/api';
import type { Endpoints } from '../../lib/endpoints';
import type { EdgeClass, MapPolygonFacet } from '../map';

export const ROOF_DRAFT_SCHEMA = 1;

export interface RoofEdgeRow {
  readonly id: string;
  readonly facetId: string;
  readonly edgeIndex: number;
  readonly classification: EdgeClass;
  readonly lengthFt: string;
}

export interface RoofDraftState {
  readonly addressLabel: string | null;
  readonly center: [number, number] | null;
  readonly facets: MapPolygonFacet[];
  readonly edges: RoofEdgeRow[];
  readonly wastePercent: string;
  readonly laborRate: string;
  readonly overheadPercent: string;
  readonly markupPercent: string;
  readonly areaUnit: 'ft2' | 'm2';
}

export const EMPTY_ROOF_DRAFT: RoofDraftState = {
  addressLabel: null,
  center: null,
  facets: [],
  edges: [],
  wastePercent: '10',
  laborRate: '95',
  overheadPercent: '10',
  markupPercent: '30',
  areaUnit: 'ft2',
};

function storageKey(orderId: string | null): string {
  return orderId ? `roof-order:${orderId}` : 'roof-draft:new';
}

export async function loadRoofDraft(
  userId: string,
  orgId: string,
  orderId: string | null,
): Promise<RoofDraftState | null> {
  const draft = await getDraftStore().load<RoofDraftState>(
    { userId, orgId },
    storageKey(orderId),
    ROOF_DRAFT_SCHEMA,
  );
  return draft?.value ?? null;
}

export async function saveRoofDraftLocal(
  userId: string,
  orgId: string,
  orderId: string | null,
  value: RoofDraftState,
): Promise<void> {
  await getDraftStore().save({ userId, orgId }, storageKey(orderId), value, ROOF_DRAFT_SCHEMA);
}

/** Best-effort API persist; returns false when the endpoint is missing/unavailable. */
export async function saveRoofDraftRemote(
  endpoints: Endpoints,
  orderId: string | null,
  value: RoofDraftState,
): Promise<'saved' | 'unavailable' | 'error'> {
  try {
    await endpoints.saveRoofOrderDraft(orderId, { draft: value, kind: 'measurement_draft' }, newIdempotencyKey());
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
