import { CreateRoofEstimateRequestSchema, type TracedFacetInput } from '@fieldline/contracts';
import { describe, expect, it } from 'vitest';
import { computeRoofEstimate } from './roof-estimate';
import { measureTrace, SQFT_PER_M2, traceView } from './roof-trace';

// A 20 m x 10 m rectangle near Dallas (200 m² plan), traced clockwise on purpose.
const LAT = 32.78;
const M_PER_DEG_LAT = 110_950;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);
function rect(x0: number, y0: number, w: number, h: number) {
  const p = (x: number, y: number) => ({
    lon: -96.8 + x / M_PER_DEG_LON,
    lat: LAT + y / M_PER_DEG_LAT,
  });
  return [p(x0, y0), p(x0, y0 + h), p(x0 + w, y0 + h), p(x0 + w, y0)];
}
const facets: TracedFacetInput[] = [
  { key: 'a', label: 'Front', ring: rect(0, 0, 20, 5), pitchRise: 6 },
  { key: 'b', label: 'Back', ring: rect(0, 5, 20, 5), pitchRise: 6 },
];

describe('measureTrace', () => {
  it('measures plan and sloped areas on the server in one shared tangent plane', () => {
    const m = measureTrace(facets);
    expect(m.totals.planAreaM2).toBeGreaterThan(199);
    expect(m.totals.planAreaM2).toBeLessThan(201);
    expect(m.totals.slopedAreaM2! / m.totals.planAreaM2).toBeCloseTo(Math.sqrt(1.25), 9);
    expect(m.totals.complete).toBe(true);
    // Canonical geometry: counter-clockwise rings, one edge per ring side, georeferenced.
    expect(m.geometry.facets).toHaveLength(2);
    expect(m.geometry.edges).toHaveLength(8);
    expect(m.geometry.georef?.origin[0]).toBeCloseTo(-96.8 + 10 / M_PER_DEG_LON, 6);
  });

  it('keeps sloped area unknown while any pitch is missing', () => {
    const m = measureTrace([facets[0]!, { ...facets[1]!, pitchRise: null }]);
    expect(m.totals.complete).toBe(false);
    expect(m.totals.slopedAreaM2).toBeNull();
    expect(m.totals.roofingSquares).toBeNull();
    expect(m.totals.unresolvedFacetKeys).toEqual(['b']);
    expect(m.geometry.facets[1]!.needsReview).toBe(true);
  });

  it('rejects self-intersecting and sliver rings', () => {
    const r = rect(0, 0, 10, 10);
    const bowtie = [r[0]!, r[2]!, r[1]!, r[3]!];
    expect(() => measureTrace([{ key: 'x', ring: bowtie, pitchRise: 4 }])).toThrow();
    expect(() => measureTrace([{ key: 'x', ring: rect(0, 0, 0.5, 0.5), pitchRise: 4 }])).toThrow(
      /too small/,
    );
  });

  it('round-trips stored geometry back to the traced lon/lat corners', () => {
    const m = measureTrace(facets);
    const view = traceView(JSON.parse(JSON.stringify(m.geometry)), m.totals);
    const traced = facets[0]!.ring;
    for (const corner of traced) {
      const hit = view.facets[0]!.ring.some(
        (p) => Math.abs(p.lon - corner.lon) < 1e-8 && Math.abs(p.lat - corner.lat) < 1e-8,
      );
      expect(hit).toBe(true);
    }
    expect(view.totals.planSqFt).toBeCloseTo(m.totals.planAreaM2 * SQFT_PER_M2, 0);
  });
});

describe('computeRoofEstimate', () => {
  const input = CreateRoofEstimateRequestSchema.parse({
    wastePercent: 10,
    wasteReason: 'Simple gable',
    prices: { shingleBundleMinor: 4_298, underlaymentRollMinor: 8_997 },
    priceSource: 'Test listing',
  });

  it('prices packs from sloped area with waste applied once, in exact cents', () => {
    const m = measureTrace(facets);
    const c = computeRoofEstimate(m.totals, input, {
      priceRevisionLabel: 'pb-1',
      actorUserId: 'u',
    });
    const slopedSqFt = m.totals.slopedAreaM2! * SQFT_PER_M2;
    const bundles = Math.ceil((slopedSqFt * 1.1) / (100 / 3));
    const rolls = Math.ceil((slopedSqFt * 1.1) / 1000);
    expect(c.result.status).toBe('priced');
    expect(c.subtotalMinor).toBe(bundles * 4_298 + rolls * 8_997);
    expect(c.taxMinor).toBe(0);
    expect(c.totalMinor).toBe(c.subtotalMinor);
    expect(c.lowTotalMinor).toBe(c.totalMinor);
    expect(c.priceItems.map((p) => p.code)).toEqual(['shingle_bundle', 'underlayment_roll']);
  });

  it('adds labor per square, target margin and tax on the taxable share', () => {
    const m = measureTrace(facets);
    const c = computeRoofEstimate(
      m.totals,
      CreateRoofEstimateRequestSchema.parse({
        ...input,
        laborPerSquareMinor: 9_000,
        marginPercent: 20,
        taxPercent: 8.25,
      }),
      { priceRevisionLabel: 'pb-1', actorUserId: 'u' },
    );
    expect(c.result.status).toBe('priced');
    expect(c.totalMinor).toBeGreaterThan(c.subtotalMinor);
    expect(c.subtotalMinor + c.taxMinor).toBe(c.totalMinor);
    expect(c.priceItems.at(-1)).toMatchObject({ code: 'install_labor', unit: 'roofing_square' });
  });
});
