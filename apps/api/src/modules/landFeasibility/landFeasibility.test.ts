// Saved feasibility projects: pure-logic tests. No database, no network — the route handlers
// are thin wrappers over tenantTx/auditRequest (same pattern as the Land Scout buy boxes),
// so what is tested here is the contract: request validation and the row -> DTO mapping,
// including the 'client-computed' summary label.
import { describe, expect, it } from 'vitest';
import {
  ConceptPlanRequestSchema,
  ConceptPlanResponseSchema,
  LandFeasibilityInputsSchema,
  SaveLandFeasibilityProjectRequestSchema,
  SavedLandFeasibilityProjectSchema,
} from '@fieldline/contracts';
import { projectDto } from './projects';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

function validInputs() {
  return {
    parcel: { widthFt: 400, depthFt: 320 },
    rules: {
      minLotSqft: 8000,
      minLotWidthFt: 60,
      frontSetbackFt: 25,
      sideSetbackFt: 5,
      rearSetbackFt: 15,
      maxBuildSlopePct: 25,
      maxCoveragePct: 45,
      roadWidthFt: 50,
      source: 'Example rules',
    },
    terrain: {
      grid: [
        [500, 500],
        [500, 500],
      ],
      source: 'Flat ground (no heights entered)',
    },
    treeCoverPct: 40,
    flood: null,
    home: { widthFt: 40, depthFt: 50, buildCost: 300_000 },
    landPrice: 500_000,
    costs: [
      { id: 'mainLine', label: 'Water and sewer main extension', unit: 'lf', unitCost: 120, source: 'Starting value' },
      { id: 'services', label: 'Water and sewer taps + service per lot', unit: 'lot', unitCost: 6500, source: 'Starting value' },
    ],
    layout: 'new_road',
    plan: 'sell_pads',
    revenue: {
      padPrice: 120_000,
      homePrice: 450_000,
      monthlyRent: 2800,
      rentExpensePct: 35,
      capRatePct: 6,
      sellingCostPct: 5,
    },
    timeline: {
      approvalMonths: 6,
      siteWorkMonths: 6,
      buildMonths: 8,
      absorptionPerMonth: 1,
      interestPct: 9,
    },
  };
}

describe('save request validation', () => {
  it('accepts a full run snapshot with a sewer-depth input', () => {
    const parsed = SaveLandFeasibilityProjectRequestSchema.parse({
      name: 'Oak St 12 acres',
      inputs: { ...validInputs(), sewerDepth: { depthFt: 6, extraCostPerFtPerLf: 2 } },
      summary: { acres: 2.94, lotCount: 12, profit: 210_000 },
    });
    expect(parsed.name).toBe('Oak St 12 acres');
    expect(parsed.inputs.sewerDepth).toEqual({ depthFt: 6, extraCostPerFtPerLf: 2 });
    expect(parsed.summary.profit).toBe(210_000);
  });

  it('accepts inputs with no sewer depth (blank = no effect)', () => {
    const parsed = LandFeasibilityInputsSchema.parse(validInputs());
    expect(parsed.sewerDepth).toBeUndefined();
  });

  it('rejects an empty name, a name over 120 chars, and a missing profit', () => {
    const base = {
      name: 'Oak St',
      inputs: validInputs(),
      summary: { acres: 2.94, lotCount: 12, profit: 210_000 },
    };
    expect(() => SaveLandFeasibilityProjectRequestSchema.parse({ ...base, name: '  ' })).toThrow();
    expect(() =>
      SaveLandFeasibilityProjectRequestSchema.parse({ ...base, name: 'x'.repeat(121) }),
    ).toThrow();
    expect(() =>
      SaveLandFeasibilityProjectRequestSchema.parse({
        ...base,
        summary: { acres: 2.94, lotCount: 12 },
      }),
    ).toThrow();
  });

  it('rejects a negative sewer depth and a parcel that is too small', () => {
    expect(() =>
      LandFeasibilityInputsSchema.parse({
        ...validInputs(),
        sewerDepth: { depthFt: -1, extraCostPerFtPerLf: 2 },
      }),
    ).toThrow();
    expect(() =>
      LandFeasibilityInputsSchema.parse({
        ...validInputs(),
        parcel: { widthFt: 0, depthFt: 320 },
      }),
    ).toThrow();
  });
});

describe('projectDto', () => {
  it('maps a row, keeps the client-computed summary verbatim, and labels it', () => {
    const dto = projectDto({
      id: PROJECT_ID,
      orgId: '44444444-4444-4444-8444-444444444444',
      name: 'Oak St 12 acres',
      inputs: validInputs(),
      summary: { acres: 2.94, lotCount: 12, profit: 210_000 },
      communityId: null,
      createdByUserId: '55555555-5555-4555-8555-555555555555',
      revision: 1,
      createdAt: new Date('2026-11-24T12:00:00.000Z'),
      updatedAt: new Date('2026-11-24T12:00:00.000Z'),
    });
    expect(dto.id).toBe(PROJECT_ID);
    expect(dto.summary).toEqual({ acres: 2.94, lotCount: 12, profit: 210_000 });
    expect(dto.summarySource).toBe('client-computed');
    expect(dto.communityId).toBeNull();
    expect(dto.createdAt).toBe('2026-11-24T12:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-11-24T12:00:00.000Z');
    // The DTO itself validates against the response schema.
    expect(() => SavedLandFeasibilityProjectSchema.parse(dto)).not.toThrow();
  });
});

describe('concept plan contract', () => {
  const valid = {
    projectName: 'Oak St 12 acres',
    organizationName: 'Sample Builders LLC',
    parcelWidthFt: 400,
    parcelDepthFt: 320,
    acres: 2.94,
    road: null,
    lots: [
      {
        number: 1,
        rect: { x0: 0, x1: 100, z0: 0, z1: 320 },
        areaSqft: 32_000,
        home: { x0: 30, x1: 70, z0: 25, z1: 75 },
        passes: true,
        hasIssues: false,
      },
    ],
    homeFootprint: { widthFt: 40, depthFt: 50 },
    exitPlanLabel: 'Sell finished pads',
    summaryLines: [{ label: 'All-in cost', value: '$750,000' }],
    assumptions: ['One row of lots on the existing street.'],
  };

  it('accepts a client-computed concept plan request', () => {
    expect(() => ConceptPlanRequestSchema.parse(valid)).not.toThrow();
    expect(() =>
      ConceptPlanResponseSchema.parse({
        filename: 'CONCEPT-2026-11-25-1234.pdf',
        contentBase64: 'JVBERi0=',
        sha256Hex: 'a'.repeat(64),
        pages: 2,
      }),
    ).not.toThrow();
  });

  it('rejects a request with no organization name or an oversized lot list', () => {
    expect(() => ConceptPlanRequestSchema.parse({ ...valid, organizationName: '  ' })).toThrow();
    expect(() =>
      ConceptPlanRequestSchema.parse({
        ...valid,
        lots: Array.from({ length: 2_001 }, (_, i) => ({ ...valid.lots[0]!, number: i + 1 })),
      }),
    ).toThrow();
  });
});
