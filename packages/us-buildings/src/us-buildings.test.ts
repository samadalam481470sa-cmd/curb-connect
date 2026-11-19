import { describe, expect, it } from 'vitest';
import {
  findUsState,
  parseFootprints,
  polygonAreaSqM,
  refreshPlanFor,
  requireUsState,
  ringAreaSqM,
  stateUrl,
  summarizeState,
  US_STATES,
} from './index';

// A ~10 m x 10 m square near Dallas (0.0001° lat ≈ 11.1 m; lon scaled by cos(lat)).
const LAT = 32.78;
const DLAT = 10 / 111_195;
const DLON = 10 / (111_195 * Math.cos((LAT * Math.PI) / 180));
const SQUARE: [number, number][] = [
  [-96.8, LAT],
  [-96.8 + DLON, LAT],
  [-96.8 + DLON, LAT + DLAT],
  [-96.8, LAT + DLAT],
  [-96.8, LAT],
];

describe('US states', () => {
  it('lists exactly the 50 states with unique abbreviations and FIPS codes', () => {
    expect(US_STATES).toHaveLength(50);
    expect(new Set(US_STATES.map((s) => s.abbr)).size).toBe(50);
    expect(new Set(US_STATES.map((s) => s.fips)).size).toBe(50);
    expect(US_STATES.every((s) => /^\d{2}$/.test(s.fips))).toBe(true);
  });

  it('looks states up case-insensitively and rejects non-states', () => {
    expect(findUsState(' tx ')?.name).toBe('Texas');
    expect(findUsState('DC')).toBeNull();
    expect(findUsState('ON')).toBeNull(); // Ontario, not a US state
    expect(() => requireUsState('Mexico')).toThrow(/50 US states/);
    expect(requireUsState('ak').fips).toBe('02');
  });
});

describe('footprint area', () => {
  it('computes a ~10 m square as about 100 sq m within 1%', () => {
    const area = ringAreaSqM(SQUARE);
    expect(area).toBeGreaterThan(99);
    expect(area).toBeLessThan(101);
  });

  it('subtracts holes from the outer ring', () => {
    const outer = SQUARE;
    const hole = [
      [-96.8 + DLON * 0.25, LAT + DLAT * 0.25],
      [-96.8 + DLON * 0.75, LAT + DLAT * 0.25],
      [-96.8 + DLON * 0.75, LAT + DLAT * 0.75],
      [-96.8 + DLON * 0.25, LAT + DLAT * 0.75],
      [-96.8 + DLON * 0.25, LAT + DLAT * 0.25],
    ] as [number, number][];
    expect(polygonAreaSqM([outer, hole])).toBeCloseTo(ringAreaSqM(outer) - ringAreaSqM(hole), 6);
    expect(polygonAreaSqM([])).toBe(0);
  });

  it('is independent of ring winding direction', () => {
    expect(ringAreaSqM([...SQUARE].reverse())).toBeCloseTo(ringAreaSqM(SQUARE), 6);
  });
});

describe('parseFootprints', () => {
  const collection = (geometry: unknown) => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry, properties: { source: 'test' } }],
  });

  it('parses Polygon and MultiPolygon features into sq ft with a centroid', () => {
    const [poly] = parseFootprints(collection({ type: 'Polygon', coordinates: [SQUARE] }));
    expect(poly!.areaSqFt).toBeGreaterThan(1070);
    expect(poly!.areaSqFt).toBeLessThan(1090);
    expect(poly!.centroid.lat).toBeCloseTo(LAT + DLAT / 2, 3);
    expect(poly!.properties).toEqual({ source: 'test' });

    const [multi] = parseFootprints(collection({ type: 'MultiPolygon', coordinates: [[SQUARE], [SQUARE]] }));
    expect(multi!.areaSqFt).toBeCloseTo(poly!.areaSqFt * 2, 0);
  });

  it('rejects malformed JSON, non-finite coordinates and points outside the US', () => {
    expect(() => parseFootprints({ type: 'Nope' })).toThrow();
    expect(() => parseFootprints(collection({ type: 'Polygon', coordinates: [[[NaN, 1], [1, 1], [1, 2], [NaN, 1]]] }))).toThrow();
    const london = [[-0.1, 51.5], [-0.09, 51.5], [-0.09, 51.51], [-0.1, 51.5]];
    expect(() => parseFootprints(collection({ type: 'Polygon', coordinates: [london] }))).toThrow(/outside the United States/);
    expect(() => parseFootprints(collection({ type: 'Polygon', coordinates: [[[-96, 32], [-96, 32]]] }))).toThrow();
  });

  it('accepts an empty collection', () => {
    expect(parseFootprints({ type: 'FeatureCollection', features: [] })).toEqual([]);
  });
});

describe('summaries and refresh plan', () => {
  const fp = (areaSqFt: number) => ({ areaSqFt, centroid: { lat: 0, lon: 0 }, properties: {} });

  it('summarizes buildings, totals and medians (odd and even counts)', () => {
    const tx = requireUsState('TX');
    expect(summarizeState(tx, [fp(100), fp(300), fp(200)])).toEqual({ state: 'TX', buildings: 3, totalSqFt: 600, medianSqFt: 200 });
    expect(summarizeState(tx, [fp(100), fp(300)]).medianSqFt).toBe(200);
    expect(summarizeState(tx, [])).toEqual({ state: 'TX', buildings: 0, totalSqFt: 0, medianSqFt: null });
  });

  it('covers every state exactly once within the cycle', () => {
    const seen = new Set<string>();
    for (let d = 0; d < 10; d += 1) {
      for (const s of refreshPlanFor(new Date(Date.UTC(2026, 10, 19 + d)), 10)) {
        expect(seen.has(s.abbr)).toBe(false);
        seen.add(s.abbr);
      }
    }
    expect(seen.size).toBe(50);
  });

  it('rejects an invalid cycle length', () => {
    expect(() => refreshPlanFor(new Date(), 0)).toThrow(RangeError);
    expect(() => refreshPlanFor(new Date(), 51)).toThrow(RangeError);
    expect(() => refreshPlanFor(new Date(), 2.5)).toThrow(RangeError);
  });
});

describe('source URLs', () => {
  it('builds an https URL for a state and refuses unsafe templates', () => {
    const src = { id: 'x', licence: 'ODbL-1.0', attribution: 'x', urlTemplate: 'https://data.example.org/{abbr}.geojson' };
    expect(stateUrl(src, 'TX')).toBe('https://data.example.org/TX.geojson');
    expect(() => stateUrl({ ...src, urlTemplate: 'http://x/{abbr}' }, 'TX')).toThrow(/https/);
    expect(() => stateUrl({ ...src, urlTemplate: 'https://x/static' }, 'TX')).toThrow(/{abbr}/);
    expect(() => stateUrl(src, 'Texas')).toThrow(/two-letter/);
  });
});
