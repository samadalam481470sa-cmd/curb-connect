import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SOURCE_LICENCES } from '@fieldline/us-buildings';
import { IngestRefused, summarizeStateFootprints } from './footprint-loader';

const featureCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[-97.0, 30.0], [-96.9999, 30.0], [-96.9999, 30.0001], [-97.0, 30.0001], [-97.0, 30.0]]] },
  }],
};

function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('summarizeStateFootprints gates', () => {
  // Test-only: pretend a person verified the permissive source, so the later gates are exercised.
  const entry = SOURCE_LICENCES.find((s) => s.id === 'overture-buildings') as { verifiedOn: string | null };
  const before = entry.verifiedOn;
  beforeAll(() => { entry.verifiedOn = '2026-11-19'; });
  afterAll(() => { entry.verifiedOn = before; });

  it('refuses an ODbL source for storage, however complete its URL', async () => {
    await expect(summarizeStateFootprints({
      sourceId: 'openstreetmap-odbl', urlTemplate: 'https://example.org/{abbr}.geojson', abbr: 'TX',
    })).rejects.toThrow(/cannot be used to store/);
  });

  it('refuses a permissive source until a person has verified its terms', async () => {
    entry.verifiedOn = null;
    try { await expect(summarizeStateFootprints({
      sourceId: 'overture-buildings', urlTemplate: 'https://example.org/{abbr}.geojson', abbr: 'TX',
    })).rejects.toThrow(IngestRefused); } finally { entry.verifiedOn = '2026-11-19'; }
  });

  it('refuses states outside the launch region even with a verified source', async () => {
    await expect(summarizeStateFootprints({
      sourceId: 'overture-buildings', urlTemplate: 'https://example.org/{abbr}.geojson', abbr: 'CA',
      fetchImpl: fakeFetch(featureCollection).fn,
    })).rejects.toThrow(/launch region/);
  });

  it('refuses when no download location is configured', async () => {
    await expect(summarizeStateFootprints({ sourceId: 'overture-buildings', urlTemplate: null, abbr: 'TX' }))
      .rejects.toThrow(/No download location/);
  });
});

describe('summarizeStateFootprints success path', () => {
  it('summarises a launch-state file from a verified permissive source', async () => {
    const entry = SOURCE_LICENCES.find((s) => s.id === 'overture-buildings') as { verifiedOn: string | null };
    const before = entry.verifiedOn;
    entry.verifiedOn = '2026-11-19';
    try {
      const { fn, calls } = fakeFetch(featureCollection);
      const summary = await summarizeStateFootprints({
        sourceId: 'overture-buildings', urlTemplate: 'https://example.org/{abbr}.geojson', abbr: 'tx', fetchImpl: fn,
      });
      expect(calls).toEqual(['https://example.org/TX.geojson']);
      expect(summary.state).toBe('TX');
      expect(summary.buildings).toBe(1);
      expect(summary.totalSqFt).toBeGreaterThan(0);
    } finally {
      entry.verifiedOn = before;
    }
  });
});
