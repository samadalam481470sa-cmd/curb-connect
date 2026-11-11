import { describe, expect, it } from 'vitest';
import {
  CreateRoofEstimateRequestSchema,
  CreateRoofMeasurementRequestSchema,
} from './roof-measurement-api';

const ring = [
  { lon: -96.8, lat: 32.78 },
  { lon: -96.7999, lat: 32.78 },
  { lon: -96.7999, lat: 32.7801 },
];

describe('roof measurement API contracts', () => {
  it('accepts traced rings with unknown pitch', () => {
    const r = CreateRoofMeasurementRequestSchema.parse({
      address: '100 Main St, Dallas TX',
      facets: [{ key: 'a', ring, pitchRise: null }],
    });
    expect(r.facets[0]!.pitchRise).toBeNull();
  });

  it('rejects duplicate facet keys, client-sent areas and open rings', () => {
    const base = { address: '100 Main St, Dallas TX' };
    expect(
      CreateRoofMeasurementRequestSchema.safeParse({
        ...base,
        facets: [
          { key: 'a', ring, pitchRise: 6 },
          { key: 'a', ring, pitchRise: 6 },
        ],
      }).success,
    ).toBe(false);
    expect(
      CreateRoofMeasurementRequestSchema.safeParse({
        ...base,
        facets: [{ key: 'a', ring, pitchRise: 6, planSqFt: 5000 }],
      }).success,
    ).toBe(false);
    expect(
      CreateRoofMeasurementRequestSchema.safeParse({
        ...base,
        facets: [{ key: 'a', ring: ring.slice(0, 2), pitchRise: 6 }],
      }).success,
    ).toBe(false);
  });

  it('requires integer cent prices and a stated price source', () => {
    const ok = {
      wastePercent: 10,
      wasteReason: 'Simple gable',
      prices: { shingleBundleMinor: 4298, underlaymentRollMinor: 8997 },
      priceSource: 'Retail listing',
    };
    expect(CreateRoofEstimateRequestSchema.parse(ok).redeck).toBe(false);
    expect(
      CreateRoofEstimateRequestSchema.safeParse({
        ...ok,
        prices: { ...ok.prices, shingleBundleMinor: 42.98 },
      }).success,
    ).toBe(false);
    expect(CreateRoofEstimateRequestSchema.safeParse({ ...ok, priceSource: '' }).success).toBe(
      false,
    );
  });
});
