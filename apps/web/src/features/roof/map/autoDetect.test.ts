// Auto-detect client helpers: candidate map data, confirm payloads, saved-record ref.
import { describe, expect, it } from 'vitest';
import {
  autoCandidatesGeoJson,
  confirmFacets,
  readSavedRoofRecord,
  snapshotOfFacets,
  toWorkspaceCandidate,
  type AutoDetectCandidate,
} from './autoDetect';

const CANDIDATE: AutoDetectCandidate = {
  id: 'auto-1',
  label: 'Facet A',
  ring: [
    { lon: -97.35, lat: 32.78 },
    { lon: -97.349, lat: 32.78 },
    { lon: -97.349, lat: 32.781 },
  ],
  pitchRise: 6,
  confidence: 0.85,
  lowConfidence: false,
  planSqFt: 1200,
  confirmed: false,
};

const LOW: AutoDetectCandidate = {
  ...CANDIDATE,
  id: 'auto-2',
  label: 'Facet B',
  confidence: 0.4,
  lowConfidence: true,
};

describe('auto-detect candidates', () => {
  it('builds map GeoJSON with a confidence label per facet', () => {
    const geo = autoCandidatesGeoJson([CANDIDATE, LOW]);
    expect(geo.features).toHaveLength(2);
    expect(geo.features[0]!.properties.label).toBe('Facet A\n85% confidence');
    expect(geo.features[1]!.properties.label).toBe('Facet B\n40% confidence · low — verify');
    // Rings are closed for the map polygon.
    const coords = geo.features[0]!.geometry.coordinates[0]!;
    expect(coords[0]).toEqual(coords[coords.length - 1]);
  });

  it('starts low-confidence facets rejected and high-confidence facets accepted', () => {
    expect(toWorkspaceCandidate(CANDIDATE).accepted).toBe(true);
    expect(toWorkspaceCandidate(LOW).accepted).toBe(false);
    expect(toWorkspaceCandidate({ ...CANDIDATE, confidence: 0.5, lowConfidence: true }).pitch).toBe(6);
  });

  it('sends only accepted facets to confirm', () => {
    const accepted = toWorkspaceCandidate(CANDIDATE);
    const rejected = toWorkspaceCandidate(LOW);
    expect(confirmFacets([accepted, rejected])).toEqual([
      {
        key: 'auto-1',
        label: 'Facet A',
        ring: CANDIDATE.ring,
        pitchRise: 6,
        confidence: 0.85,
      },
    ]);
    expect(confirmFacets([rejected])).toEqual([]);
  });

  it('matches the Record panel snapshot format', () => {
    expect(
      snapshotOfFacets([
        { id: 'f-1', name: 'Facet A', ring: CANDIDATE.ring, pitch: 6 },
        { id: 'f-2', name: 'Facet B', ring: CANDIDATE.ring, pitch: null, source: 'auto_detect' },
      ]),
    ).toBe(
      JSON.stringify([
        ['f-1', 'Facet A', 6, CANDIDATE.ring, 'manual'],
        ['f-2', 'Facet B', null, CANDIDATE.ring, 'auto_detect'],
      ]),
    );
  });

  it('returns null for the saved record when nothing is stored', () => {
    window.localStorage.clear();
    expect(readSavedRoofRecord()).toBeNull();
    window.localStorage.setItem(
      'fieldpro.roof.record.v1',
      JSON.stringify({ id: 'x', versionNumber: 2, snapshot: '[]' }),
    );
    expect(readSavedRoofRecord()).toEqual({ id: 'x', versionNumber: 2 });
    window.localStorage.clear();
  });
});
