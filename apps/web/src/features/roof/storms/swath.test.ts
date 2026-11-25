// Hail swath (web) helpers: pure-logic tests. No network, no MapLibre.
import { describe, expect, it } from 'vitest';
import { SwathSchema, type Swath } from './api';
import { swathBounds } from './swath';

function swathResponse(overrides: Partial<Swath> = {}): Swath {
  return {
    status: 'ok',
    kind: 'mrms_swath',
    source: 'NOAA MRMS MESH Max 1440min',
    checkedAt: '2026-11-24T19:00:00.000Z',
    date: '2026-11-24',
    thresholdIn: 1,
    swath: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-97.0, 32.7],
                [-96.9, 32.7],
                [-96.9, 32.8],
                [-97.0, 32.8],
                [-97.0, 32.7],
              ],
            ],
          },
          properties: { maxHailIn: 1.75 },
        },
      ],
    },
    eventCount: 3,
    message: '',
    note: 'Estimated hail size, not confirmed damage',
    ...overrides,
  };
}

describe('SwathSchema', () => {
  it('parses a measured MRMS swath response verbatim from the contract', () => {
    const parsed = SwathSchema.parse(swathResponse());
    expect(parsed.kind).toBe('mrms_swath');
    expect(parsed.note).toBe('Estimated hail size, not confirmed damage');
    expect(parsed.swath.features[0]?.properties.maxHailIn).toBe(1.75);
  });

  it('parses an approximate path from storm reports', () => {
    const parsed = SwathSchema.parse(
      swathResponse({
        kind: 'approximate_path',
        source: 'NOAA Storm Prediction Center',
        note: 'Approximate path from NOAA storm reports — not a measured swath',
        swath: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'MultiPolygon',
                coordinates: [
                  [
                    [
                      [-97.1, 32.6],
                      [-97.0, 32.6],
                      [-97.0, 32.7],
                      [-97.1, 32.7],
                      [-97.1, 32.6],
                    ],
                  ],
                ],
              },
              properties: { maxHailIn: 1 },
            },
          ],
        },
      }),
    );
    expect(parsed.kind).toBe('approximate_path');
    expect(parsed.swath.features[0]?.geometry.type).toBe('MultiPolygon');
  });

  it('accepts an unavailable response with an empty swath', () => {
    const parsed = SwathSchema.parse(
      swathResponse({
        status: 'unavailable',
        swath: { type: 'FeatureCollection', features: [] },
        message: 'MRMS feed unavailable',
      }),
    );
    expect(parsed.status).toBe('unavailable');
    expect(parsed.swath.features).toHaveLength(0);
  });

  it('rejects an unknown kind instead of rendering invented data', () => {
    expect(() =>
      SwathSchema.parse(swathResponse({ kind: 'guess' as never })),
    ).toThrow();
  });
});

describe('swathBounds', () => {
  it('bounds a Polygon swath', () => {
    expect(swathBounds(swathResponse().swath)).toEqual([
      [-97.0, 32.7],
      [-96.9, 32.8],
    ]);
  });

  it('bounds a MultiPolygon swath across all polygons', () => {
    const multi: Swath['swath'] = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [-97.1, 32.6],
                  [-97.0, 32.6],
                  [-97.0, 32.7],
                  [-97.1, 32.7],
                  [-97.1, 32.6],
                ],
              ],
              [
                [
                  [-96.5, 33.0],
                  [-96.4, 33.0],
                  [-96.4, 33.1],
                  [-96.5, 33.1],
                  [-96.5, 33.0],
                ],
              ],
            ],
          },
          properties: { maxHailIn: 1.25 },
        },
      ],
    };
    expect(swathBounds(multi)).toEqual([
      [-97.1, 32.6],
      [-96.4, 33.1],
    ]);
  });

  it('returns null for an empty swath and for null', () => {
    expect(
      swathBounds({ type: 'FeatureCollection', features: [] }),
    ).toBeNull();
    expect(swathBounds(null)).toBeNull();
    expect(swathBounds(undefined)).toBeNull();
  });

  it('skips non-finite coordinates instead of producing bad bounds', () => {
    const bad: Swath['swath'] = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [Number.NaN, 32.7],
                [-96.9, 32.7],
                [-96.9, 32.8],
                [-97.0, 32.8],
                [-97.0, 32.7],
              ],
            ],
          },
          properties: { maxHailIn: 1 },
        },
      ],
    };
    expect(swathBounds(bad)).toEqual([
      [-97.0, 32.7],
      [-96.9, 32.8],
    ]);
  });
});
