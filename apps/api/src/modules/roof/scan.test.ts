import { describe, expect, it, vi } from 'vitest';
import {
  approxPlanAreaM2,
  pitchDegreesToRiseRun,
  runRoofScan,
} from './scan';

describe('roof scan helpers', () => {
  it('converts Solar pitch degrees to rise/run on a 12 run', () => {
    expect(pitchDegreesToRiseRun(0)).toEqual({ rise: '0', run: '12' });
    expect(pitchDegreesToRiseRun(26.565)).toEqual({ rise: '6', run: '12' }); // atan(0.5)
    expect(pitchDegreesToRiseRun(45)).toEqual({ rise: '12', run: '12' });
  });

  it('approximates plan area for a 10m x 10m square near equator', () => {
    // ~10m east/north at lat 0 ≈ 10/111320 degrees
    const d = 10 / 111_320;
    const ring: Array<[number, number]> = [
      [0, 0],
      [d, 0],
      [d, d],
      [0, d],
    ];
    const area = approxPlanAreaM2(ring);
    expect(area).toBeGreaterThan(95);
    expect(area).toBeLessThan(105);
  });
});

describe('runRoofScan', () => {
  it('builds a facet from OSM footprint and Solar pitch', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('overpass')) {
        return new Response(
          JSON.stringify({
            elements: [
              {
                type: 'way',
                id: 42,
                geometry: [
                  { lat: 30.2672, lon: -97.7431 },
                  { lat: 30.2672, lon: -97.7429 },
                  { lat: 30.2674, lon: -97.7429 },
                  { lat: 30.2674, lon: -97.7431 },
                  { lat: 30.2672, lon: -97.7431 },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('solar.googleapis.com')) {
        return new Response(
          JSON.stringify({
            center: { latitude: 30.2673, longitude: -97.743 },
            solarPotential: {
              wholeRoofStats: { areaMeters2: 180, groundAreaMeters2: 160 },
              roofSegmentStats: [
                {
                  pitchDegrees: 26.565,
                  azimuthDegrees: 180,
                  stats: { areaMeters2: 180, groundAreaMeters2: 160 },
                  center: { latitude: 30.2673, longitude: -97.743 },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch ${url} ${init?.method ?? 'GET'}`);
    }) as unknown as typeof fetch;

    const result = await runRoofScan(
      { lat: 30.2673, lng: -97.743, radiusM: 45 },
      { googleSolarApiKey: 'test-key', fetchImpl },
    );

    expect(result.reviewRequired).toBe(true);
    expect(result.footprintSource).toBe('openstreetmap');
    expect(result.pitchSource).toBe('google_solar');
    expect(result.facets).toHaveLength(1);
    expect(result.facets[0]!.pitchRise).toBe('6');
    expect(result.facets[0]!.ring.length).toBeGreaterThanOrEqual(3);
    expect(result.planAreaM2).toBe(160);
    expect(result.slopedAreaM2).toBe(180);
    expect(result.attribution.some((a) => a.includes('OpenStreetMap'))).toBe(true);
  });

  it('falls back to Solar segment boxes when OSM has no building', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('overpass')) {
        return new Response(JSON.stringify({ elements: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('solar.googleapis.com')) {
        return new Response(
          JSON.stringify({
            center: { latitude: 40.0, longitude: -105.0 },
            solarPotential: {
              wholeRoofStats: { areaMeters2: 100, groundAreaMeters2: 90 },
              roofSegmentStats: [
                {
                  pitchDegrees: 18.43,
                  azimuthDegrees: 90,
                  stats: { areaMeters2: 100, groundAreaMeters2: 90 },
                  center: { latitude: 40.0, longitude: -105.0 },
                  boundingBox: {
                    sw: { latitude: 39.9999, longitude: -105.0001 },
                    ne: { latitude: 40.0001, longitude: -104.9999 },
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const result = await runRoofScan(
      { lat: 40, lng: -105, radiusM: 45 },
      { googleSolarApiKey: 'test-key', fetchImpl },
    );
    expect(result.footprintSource).toBe('google_solar');
    expect(result.facets[0]!.source).toBe('solar_segment');
    expect(result.facets[0]!.pitchRise).toBe('4');
  });

  it('assumes 6/12 when Solar key missing but OSM footprint exists', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('overpass')) {
        return new Response(
          JSON.stringify({
            elements: [
              {
                type: 'way',
                id: 7,
                geometry: [
                  { lat: 41.0, lon: -87.0 },
                  { lat: 41.0, lon: -86.9998 },
                  { lat: 41.0002, lon: -86.9998 },
                  { lat: 41.0002, lon: -87.0 },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const result = await runRoofScan({ lat: 41, lng: -87, radiusM: 45 }, { fetchImpl });
    expect(result.pitchSource).toBe('default_assumed');
    expect(result.facets[0]!.pitchRise).toBe('6');
    expect(result.warnings.some((w) => /GOOGLE_SOLAR_API_KEY|6\/12/i.test(w))).toBe(true);
  });
});
