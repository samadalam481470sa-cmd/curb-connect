import { describe, expect, it, vi } from 'vitest';
import { parseEpqsElevation, parseFemaFloodZone, terrainSamplePoints } from '@fieldline/contracts';
import { EPQS_URL, FEMA_NFHL_URL, lookupSiteTerrain } from './site-terrain';

describe('site terrain', () => {
  it('lays sample points from the street edge to the back edge', () => {
    const pts = terrainSamplePoints({ lat: 33, lon: -97, widthFt: 400, depthFt: 600, samples: 3 });
    expect(pts).toHaveLength(3);
    expect(pts[0]![1]!.lat).toBeLessThan(33); // street row is south of center
    expect(pts[2]![1]!.lat).toBeGreaterThan(33);
    expect(pts[1]![0]!.lon).toBeLessThan(-97);
    expect(pts[1]![1]).toEqual({ lat: 33, lon: -97 });
  });

  it('parses USGS and FEMA answers and rejects "no data"', () => {
    expect(parseEpqsElevation({ value: '512.345' })).toBe(512.35);
    expect(parseEpqsElevation({ value: -1000000 })).toBeNull();
    expect(parseEpqsElevation(null)).toBeNull();
    expect(
      parseFemaFloodZone({ features: [{ attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T' } }] }),
    ).toEqual({
      zone: 'AE',
      specialHazard: true,
    });
    expect(
      parseFemaFloodZone({ features: [{ attributes: { FLD_ZONE: 'X', SFHA_TF: 'F' } }] })
        ?.specialHazard,
    ).toBe(false);
    expect(parseFemaFloodZone({ features: [] })).toBeNull();
  });

  it('builds the grid from fixed public hosts', async () => {
    let n = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.startsWith(FEMA_NFHL_URL)) {
        return new Response(
          JSON.stringify({ features: [{ attributes: { FLD_ZONE: 'X', SFHA_TF: 'F' } }] }),
        );
      }
      expect(url.startsWith(EPQS_URL)).toBe(true);
      n += 1;
      return new Response(JSON.stringify({ value: 500 + n }));
    });
    const out = await lookupSiteTerrain(
      { lat: 32.9, lon: -96.9, widthFt: 300, depthFt: 300, samples: 3 },
      fetcher as unknown as typeof fetch,
      1_000,
    );
    expect(out.status).toBe('found');
    expect(out.grid).toHaveLength(3);
    expect(out.grid.flat().every((v) => typeof v === 'number')).toBe(true);
    expect(out.flood).toMatchObject({ zone: 'X', specialHazard: false });
    expect(out.source).toMatch(/3DEP/);
  });

  it('says so when the elevation service does not answer', async () => {
    const out = await lookupSiteTerrain(
      { lat: 10, lon: 10, widthFt: 100, depthFt: 100, samples: 3 },
      vi.fn(async () => new Response('busy', { status: 503 })) as unknown as typeof fetch,
      1_000,
    );
    expect(out.status).toBe('upstream_unavailable');
    expect(out.grid).toEqual([]);
    expect(out.flood).toBeNull();
  });
});
