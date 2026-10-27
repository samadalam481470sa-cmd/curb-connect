import { describe, expect, it } from 'vitest';
import {
  CreateCurbProjectRequestSchema,
  CreateInvoiceRequestSchema,
  CreateRoofOrderRequestSchema,
  ERROR_CODE_KEYS,
  EstimateRevisionSchema,
  MeasurementSchema,
  PatchRoofGeometryRequestSchema,
  PutObservationsRequestSchema,
  RoofGeometrySchema,
  slopedArea,
  validateRoofTopology,
  type RoofGeometryInput,
} from './index';

const uuid = '00000000-0000-4000-8000-000000000001';
const now = '2026-10-26T12:00:00Z';

const square: RoofGeometryInput = {
  schemaVersion: 1,
  crs: 'LOCAL_ENU_M',
  geometryRevision: 3,
  vertices: [
    { id: 'a', x: 0, y: 0, source: 'user_entered' },
    { id: 'b', x: 10, y: 0, source: 'user_entered' },
    { id: 'c', x: 10, y: 5, source: 'user_entered' },
    { id: 'd', x: 0, y: 5, source: 'user_entered' },
    { id: 'e', x: 0, y: 10, source: 'user_entered' },
    { id: 'f', x: 10, y: 10, source: 'user_entered' },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', type: 'eave', leftFacet: 'south' },
    { id: 'bc', from: 'b', to: 'c', type: 'rake', leftFacet: 'south' },
    { id: 'cd', from: 'c', to: 'd', type: 'ridge', leftFacet: 'south', rightFacet: 'north' },
    { id: 'da', from: 'd', to: 'a', type: 'rake', leftFacet: 'south' },
    { id: 'de', from: 'd', to: 'e', type: 'rake', rightFacet: 'north' },
    { id: 'ef', from: 'e', to: 'f', type: 'eave', rightFacet: 'north' },
    { id: 'fc', from: 'f', to: 'c', type: 'rake', rightFacet: 'north' },
  ],
  facets: [
    { id: 'south', vertexIds: ['a', 'b', 'c', 'd'], pitch: { rise: 6, run: 12, input: '6/12', inputUnit: 'rise_per_12', source: 'user_entered' } },
    { id: 'north', vertexIds: ['d', 'c', 'f', 'e'], pitch: { rise: 6, run: 12, input: '6/12', inputUnit: 'rise_per_12', source: 'user_entered' } },
  ],
};

describe('roof geometry (RR-025)', () => {
  it('round-trips the canonical JSON and the gable fixture validates cleanly', () => {
    const parsed = RoofGeometrySchema.parse(square);
    expect(RoofGeometrySchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(validateRoofTopology(parsed)).toEqual([]);
    expect(slopedArea(50, 6, 12)).toBeCloseTo(55.9017, 3);
  });

  it('flags clockwise rings, missing edges and unknown vertices', () => {
    const bad = RoofGeometrySchema.parse({
      ...square,
      edges: square.edges.filter((e) => e.id !== 'ab'),
      facets: [{ ...square.facets[0]!, vertexIds: ['a', 'd', 'c', 'b'] }, { ...square.facets[1]!, vertexIds: ['d', 'c', 'f', 'zz'] }],
    });
    const codes = validateRoofTopology(bad).map((i) => i.code);
    expect(codes).toContain('clockwise_ring');
    expect(codes).toContain('missing_edge');
    expect(codes).toContain('unknown_vertex');
  });

  it('accepts a geometry PATCH batch', () => {
    const ok = PatchRoofGeometryRequestSchema.safeParse({
      baseGeometryRevision: 3,
      clientOpId: 'op-12345678',
      ops: [{ op: 'move_vertex', id: 'a', x: 0.1, y: 0 }, { op: 'classify_edge', edgeId: 'ab', type: 'eave' }],
    });
    expect(ok.success).toBe(true);
  });
});

describe('measurements and money', () => {
  it('unknown is a first-class value; known needs provenance', () => {
    expect(MeasurementSchema.parse({ state: 'unknown' })).toEqual({ state: 'unknown', reason: 'not_provided' });
    expect(MeasurementSchema.safeParse({ state: 'known', value: 5.4864, unit: 'm' }).success).toBe(false);
    expect(
      MeasurementSchema.safeParse({ state: 'known', value: 5.4864, unit: 'm', source: 'field_verified', measuredAt: now, precision: 0.01 })
        .success,
    ).toBe(true);
  });

  it('estimate revision round-trips with low/base/high scenarios and gating', () => {
    const totals = {
      directMinor: 374400,
      overheadMinor: 37440,
      contingencyMinor: 0,
      marginMinor: 137280,
      subtotalMinor: 549120,
      taxMinor: 0,
      totalMinor: 549120,
      lines: [
        { code: 'CUT_LF', label: 'Saw cutting', costComponent: 'cutting', quantity: '18', unit: 'linear_ft', unitRate: '20.000000', amountMinor: 36000, quantitySource: ['cut_length'] },
      ],
    };
    const revision = {
      id: uuid,
      estimateId: uuid,
      revisionNumber: 1,
      status: 'review_required',
      priceBookRevisionId: uuid,
      currency: 'USD',
      inputs: { cut_length: { state: 'unknown', reason: 'not_provided' } },
      scenarios: { low: totals, base: totals, high: totals },
      gating: { quoteKind: 'budgetary_range', blockers: [{ code: 'unknown_subgrade', message: 'Subgrade unknown' }], warnings: [], requiredSignoffs: ['estimator'] },
      quoteKind: 'budgetary_range',
      isBinding: false,
      engineVersion: 'pricing@0.1.0',
      assumptions: ['Synthetic page-60 rates'],
      createdAt: now,
    };
    const parsed = EstimateRevisionSchema.parse(revision);
    expect(EstimateRevisionSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(parsed.scenarios.base.totalMinor).toBe(549120);
  });

  it('rejects float money', () => {
    expect(
      CreateInvoiceRequestSchema.safeParse({
        customerId: uuid,
        kind: 'standalone',
        lines: [{ description: 'Cut', quantity: '1', unit: 'each', unitPriceMinor: 10.5 }],
      }).success,
    ).toBe(false);
  });
});

describe('requests', () => {
  it('validates roof order and curb project creation', () => {
    expect(CreateRoofOrderRequestSchema.safeParse({ propertyId: uuid, mode: 'diy', structureIds: [uuid] }).success).toBe(true);
    expect(CreateRoofOrderRequestSchema.safeParse({ propertyId: uuid, mode: 'diy', structureIds: [] }).success).toBe(false);
    expect(CreateCurbProjectRequestSchema.safeParse({ propertyId: uuid, serviceCode: 'driveway_opening' }).success).toBe(true);
  });

  it('accepts unknown intake answers', () => {
    expect(
      PutObservationsRequestSchema.safeParse({ answers: [{ questionKey: 'utility_locations', answer: { state: 'unknown' } }] }).success,
    ).toBe(true);
  });

  it('exposes a stable error code taxonomy', () => {
    expect(ERROR_CODE_KEYS).toContain('invalid_transition');
    expect(new Set(ERROR_CODE_KEYS).size).toBe(ERROR_CODE_KEYS.length);
  });
});
