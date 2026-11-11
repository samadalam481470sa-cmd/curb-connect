import { describe, expect, it } from 'vitest';
import {
  CalibratePlanRequestSchema,
  ComputeEstimateRequestSchema,
  CreateRevisionRequestSchema,
  planScale,
} from './plumbing-api';

describe('PL-002 plan calibration', () => {
  it('turns a 10 ft reference measured across 500 px into 0.02 ft/px', () => {
    const scale = planScale({ referenceFeet: 10, measuredPixels: 500 });
    expect(scale.feetPerPixel).toBeCloseTo(0.02, 8);
    expect(scale.pixelsPerFoot).toBeCloseTo(50, 8);
  });

  it('refuses a zero measurement instead of dividing by it', () => {
    expect(() => planScale({ referenceFeet: 10, measuredPixels: 0 })).toThrow(/positive pixel/);
    expect(() => planScale({ referenceFeet: 0, measuredPixels: 10 })).toThrow(/positive reference/);
  });

  it('rejects a calibration payload without a positive reference', () => {
    const result = CalibratePlanRequestSchema.safeParse({
      filename: 'plan.pdf',
      referenceFeet: -1,
      measuredPixels: 500,
    });
    expect(result.success).toBe(false);
    expect(
      CalibratePlanRequestSchema.parse({ filename: 'plan.pdf', referenceFeet: 10, measuredPixels: 500 }),
    ).toMatchObject({ pageNumber: 1, referenceFeet: 10, measuredPixels: 500 });
  });
});

describe('plumbing record contracts', () => {
  it('rejects a revision whose run has a single point', () => {
    const result = CreateRevisionRequestSchema.safeParse({
      design: {
        fixtures: [],
        runs: [
          {
            id: 'r1',
            system: 'cold_water',
            material: 'pex_a',
            nominalSizeMm: 20,
            points: [{ x: 0, y: 0 }],
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a priced estimate request but not negative prices', () => {
    const body = {
      revisionId: '3f0c3f2c-4f4e-4e2b-9b0f-1c2d3e4f5a6b',
      prices: { 'cold_water|pex_a|20|pipe': 850 },
      laborRateMinorPerHour: 9500,
    };
    expect(ComputeEstimateRequestSchema.parse(body)).toMatchObject({ contingencyPercent: 5 });
    expect(
      ComputeEstimateRequestSchema.safeParse({ ...body, prices: { key: -5 } }).success,
    ).toBe(false);
  });
});
