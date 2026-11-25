// Auto-detect outline (client): response shapes for POST /v1/roof/auto-detect and
// /v1/roof/measurements/:id/auto-detect/confirm, candidate GeoJSON for the map, and the
// saved-record ref the Record panel persists in localStorage.
//
// Candidates are display-only until the contractor confirms them: they never enter the
// traced-facet totals, and only accepted facets are sent to the confirm endpoint.
import type { RoofMeasurementDetail } from '@fieldline/contracts';
import { z } from 'zod';
import type { MapFacet } from './facetMath';

const LonLatSchema = z.object({ lon: z.number(), lat: z.number() });

export const AutoDetectCandidateSchema = z.object({
  id: z.string(),
  label: z.string(),
  ring: z.array(LonLatSchema).min(3),
  pitchRise: z.number().min(0).max(24).nullable(),
  confidence: z.number().min(0).max(1),
  lowConfidence: z.boolean(),
  planSqFt: z.number(),
  confirmed: z.literal(false),
});
export type AutoDetectCandidate = z.infer<typeof AutoDetectCandidateSchema>;

export const AutoDetectResponseSchema = z.object({
  status: z.enum(['found', 'not_found', 'unavailable']),
  message: z.string(),
  model: z.string().nullable(),
  imagerySource: z.string(),
  imageryDate: z.string().nullable(),
  detectedAt: z.string(),
  facets: z.array(AutoDetectCandidateSchema),
  disclaimer: z.string(),
});
export type AutoDetectResponse = z.infer<typeof AutoDetectResponseSchema>;

/** A candidate as held in the workspace: acceptance and an editable pitch guess. */
export interface WorkspaceCandidate extends AutoDetectCandidate {
  accepted: boolean;
  /** Contractor-editable pitch guess; null = not yet established. */
  pitch: number | null;
}

/** Low-confidence facets start rejected: excluded until the contractor explicitly accepts. */
export function toWorkspaceCandidate(c: AutoDetectCandidate): WorkspaceCandidate {
  return { ...c, accepted: !c.lowConfidence, pitch: c.pitchRise };
}

/** Distinct map style data: magenta dashed planes with a confidence label per facet. */
export function autoCandidatesGeoJson(candidates: readonly AutoDetectCandidate[]) {
  return {
    type: 'FeatureCollection' as const,
    features: candidates.map((c) => {
      const ring = c.ring.map((p) => [p.lon, p.lat]);
      return {
        type: 'Feature' as const,
        id: c.id,
        properties: {
          id: c.id,
          label:
            `${c.label}\n${Math.round(c.confidence * 100)}% confidence` +
            (c.lowConfidence ? ' · low — verify' : ''),
        },
        geometry: { type: 'Polygon' as const, coordinates: [[...ring, ring[0]!]] },
      };
    }),
  };
}

/** Only accepted facets are sent to confirm; rejected ones never leave the browser. */
export function confirmFacets(candidates: readonly WorkspaceCandidate[]) {
  return candidates
    .filter((c) => c.accepted)
    .map((c) => ({
      key: c.id,
      label: c.label.trim().slice(0, 80) || undefined,
      ring: c.ring,
      pitchRise: c.pitch,
      confidence: c.confidence,
    }));
}

/** Snapshot format must match RoofRecordPanel.snapshotOf, or its dirty check breaks. */
export function snapshotOfFacets(facets: readonly MapFacet[]): string {
  return JSON.stringify(
    facets.map((f) => [f.id, f.name, f.pitch, f.ring, f.source ?? 'manual']),
  );
}

/**
 * The saved-record ref RoofRecordPanel persists in localStorage (RECORD_KEY there). Read at
 * confirm time so the workspace can confirm against a record the panel saved, without
 * editing the panel. Null = no saved record yet; accepted facets are staged on the map
 * instead and saved through the panel's normal flow.
 */
const RECORD_KEY = 'fieldpro.roof.record.v1';

export function readSavedRoofRecord(): { id: string; versionNumber: number } | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(RECORD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; versionNumber?: unknown };
    if (typeof parsed.id !== 'string' || typeof parsed.versionNumber !== 'number') return null;
    return { id: parsed.id, versionNumber: parsed.versionNumber };
  } catch {
    return null;
  }
}

export function writeSavedRoofRecord(ref: {
  id: string;
  versionNumber: number;
  snapshot: string;
}): void {
  try {
    window.localStorage.setItem(RECORD_KEY, JSON.stringify(ref));
  } catch {
    // Storage unavailable: the Record panel still shows the confirmed version on reload.
  }
}

/** Map a confirmed measurement detail back to local facets, keeping the AUTO provenance. */
export function fromDetailFacets(detail: RoofMeasurementDetail): MapFacet[] {
  return detail.version.facets.map((f) => ({
    id: f.key,
    name: f.label ?? f.key,
    ring: f.ring,
    pitch: f.pitchRise,
    source: 'auto_detect' as const,
  }));
}
