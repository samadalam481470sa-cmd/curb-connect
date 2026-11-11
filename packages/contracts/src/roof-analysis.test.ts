import { describe, expect, it } from 'vitest';
import {
  IMAGERY_QUALITY_WEIGHTS,
  ROOFING_SQUARE_M2,
  RoofAnalysisOutcomeSchema,
  assessRoofAnalysis,
  evaluateImageryEligibility,
  markRoofRevisionApproved,
  rankImageryCandidates,
  recencyScore,
  roofMeasurementTotals,
  slopedAreaM2,
  type RoofImageryCandidate,
  type RoofImageryRights,
  type RoofFacetMeasurement,
  type RoofMeasurementRevision,
} from './roof-analysis';

const asOf = new Date('2026-11-11T00:00:00Z');

type CandidateOverrides = Omit<Partial<RoofImageryCandidate>, 'rights'> & {
  rights?: Partial<RoofImageryRights>;
};

function candidate(overrides: CandidateOverrides = {}): RoofImageryCandidate {
  const base: RoofImageryCandidate = {
    id: 'img-1',
    provider: 'analysis_licensed_aerial',
    sourceReference: 'vendor:abc',
    captureDate: '2026-01-01',
    processingDate: null,
    gsdM: 0.1,
    quality: 'high',
    perspective: 'nadir',
    orthorectified: true,
    sharpnessScore: 90,
    roofVisibilityPct: 95,
    shadowPct: 5,
    georefConfidence: 95,
    buildingMatchConfidence: 95,
    rights: {
      commercialUse: true,
      analysisAllowed: true,
      storageAllowed: true,
      derivativesAllowed: true,
      exportAllowed: true,
      retentionDays: 365,
    },
    attribution: 'Test imagery',
    retentionExpiresAt: null,
    warnings: [],
  };
  return { ...base, ...overrides, rights: { ...base.rights, ...(overrides.rights ?? {}) } };
}

function facet(overrides: Partial<RoofFacetMeasurement> = {}): RoofFacetMeasurement {
  return {
    facetId: 'f1',
    planAreaM2: 100,
    pitchDeg: 0,
    pitchSource: 'imagery_derived',
    confidence: 90,
    needsReview: false,
    ...overrides,
  };
}

function revision(overrides: Partial<RoofMeasurementRevision> = {}): RoofMeasurementRevision {
  return {
    id: 'rev-1',
    analysisJobId: 'job-1',
    revisionNumber: 1,
    status: 'draft',
    geometryRevision: 0,
    totalSlopedAreaM2: 120,
    approvedAt: null,
    approvedByUserId: null,
    ...overrides,
  };
}

describe('RF-022 imagery ranking', () => {
  it('uses the documented weights', () => {
    const sum = Object.values(IMAGERY_QUALITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('does not let a newer obstructed image beat an older clear one', () => {
    const olderClear = candidate({
      id: 'older-clear',
      captureDate: '2025-01-01',
      sharpnessScore: 95,
      roofVisibilityPct: 98,
    });
    const newerObstructed = candidate({
      id: 'newer-obstructed',
      captureDate: '2026-10-01',
      sharpnessScore: 45,
      roofVisibilityPct: 25,
      shadowPct: 60,
    });
    const ranking = rankImageryCandidates([newerObstructed, olderClear], { asOf });
    expect(ranking.selected?.candidate.id).toBe('older-clear');
    expect(ranking.ranked).toHaveLength(2);
  });

  it('never selects imagery without analysis rights, even if it scores best', () => {
    const viewOnly = candidate({
      id: 'view-only',
      provider: 'google_solar',
      gsdM: 0.05,
      rights: { analysisAllowed: false, derivativesAllowed: false },
    });
    const licensed = candidate({ id: 'licensed', gsdM: 0.3, sharpnessScore: 60 });
    const ranking = rankImageryCandidates([viewOnly, licensed], { asOf });
    expect(ranking.selected?.candidate.id).toBe('licensed');
    expect(ranking.excluded).toEqual([
      {
        candidateId: 'view-only',
        reasons: ['analysis_rights_missing', 'derivative_rights_missing'],
      },
    ]);
  });

  it('rejects expired retention, coarse resolution and soft images', () => {
    const expired = candidate({
      id: 'expired',
      retentionExpiresAt: '2026-01-01T00:00:00Z',
    });
    const coarse = candidate({ id: 'coarse', gsdM: 0.9 });
    const soft = candidate({ id: 'soft', sharpnessScore: 10 });
    expect(evaluateImageryEligibility(expired, asOf).reasons).toContain('rights_expired');
    expect(evaluateImageryEligibility(coarse, asOf).reasons).toContain('resolution_too_coarse');
    expect(evaluateImageryEligibility(soft, asOf).reasons).toContain('image_too_soft');
  });

  it('treats an unknown resolution as ineligible rather than assuming it is sharp', () => {
    const result = evaluateImageryEligibility(candidate({ gsdM: null }), asOf);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('resolution_unknown');
  });

  it('decays recency but never below an absent-date score', () => {
    expect(recencyScore('2026-11-11', asOf)).toBe(100);
    expect(recencyScore('2024-11-11', asOf)).toBeCloseTo(50, 0);
    expect(recencyScore(null, asOf)).toBe(40);
  });
});

describe('RR-025 facet measurement', () => {
  it('applies the slope factor to a 6/12 pitch', () => {
    const pitchDeg = (Math.atan(0.5) * 180) / Math.PI;
    const area = slopedAreaM2(facet({ planAreaM2: 100, pitchDeg }));
    expect(area).toBeCloseTo(111.803, 3);
  });

  it('returns null sloped area for unknown pitch instead of inventing one', () => {
    expect(slopedAreaM2(facet({ pitchDeg: null }))).toBeNull();
    const totals = roofMeasurementTotals([
      facet({ facetId: 'known', pitchDeg: 0 }),
      facet({ facetId: 'unknown', pitchDeg: null, needsReview: true }),
    ]);
    expect(totals.complete).toBe(false);
    expect(totals.slopedAreaM2).toBeNull();
    expect(totals.roofingSquares).toBeNull();
    expect(totals.unresolvedFacetIds).toEqual(['unknown']);
  });

  it('sums complete facets and converts to roofing squares', () => {
    const totals = roofMeasurementTotals([
      facet({ facetId: 'f1', planAreaM2: 46.45152, pitchDeg: 0 }),
      facet({ facetId: 'f2', planAreaM2: 46.45152, pitchDeg: 0 }),
    ]);
    expect(totals.planAreaM2).toBeCloseTo(92.90304, 6);
    expect(totals.roofingSquares).toBeCloseTo(10, 6);
    expect(totals.complete).toBe(true);
    expect(ROOFING_SQUARE_M2).toBe(9.290304);
  });
});

describe('AIQ-087 abstention', () => {
  it('abstains when no validated model is registered', () => {
    const result = assessRoofAnalysis({
      candidates: [candidate()],
      facets: [facet()],
      asOf,
      modelRegistered: false,
      buildingConfirmed: true,
    });
    expect(result.outcome).toBe('abstained');
    if (result.outcome === 'abstained') expect(result.reasons).toContain('model_not_registered');
  });

  it('abstains until the target building is confirmed', () => {
    const result = assessRoofAnalysis({
      candidates: [candidate()],
      facets: [facet()],
      asOf,
      modelRegistered: true,
      buildingConfirmed: false,
    });
    expect(result.outcome).toBe('abstained');
    if (result.outcome === 'abstained') expect(result.reasons).toContain('building_not_confirmed');
  });

  it('abstains when every candidate lacks analysis rights', () => {
    const result = assessRoofAnalysis({
      candidates: [candidate({ rights: { analysisAllowed: false, derivativesAllowed: false } })],
      facets: [facet()],
      asOf,
      modelRegistered: true,
      buildingConfirmed: true,
    });
    expect(result.outcome).toBe('abstained');
    if (result.outcome === 'abstained') expect(result.reasons).toContain('no_eligible_imagery');
  });

  it('produces a certified measurement only when geometry and confidence are complete', () => {
    const result = assessRoofAnalysis({
      candidates: [candidate()],
      facets: [facet()],
      asOf,
      modelRegistered: true,
      buildingConfirmed: true,
    });
    expect(RoofAnalysisOutcomeSchema.parse(result)).toEqual(result);
    expect(result.outcome).toBe('measured');
    if (result.outcome === 'measured') {
      expect(result.selectedCandidateId).toBe('img-1');
      expect(result.certified).toBe(true);
      expect(result.totals.complete).toBe(true);
    }
  });

  it('marks a result uncertified, with a warning, when a pitch is unknown', () => {
    const result = assessRoofAnalysis({
      candidates: [candidate()],
      facets: [facet({ pitchDeg: null, confidence: 40 })],
      asOf,
      modelRegistered: true,
      buildingConfirmed: true,
    });
    expect(result.outcome).toBe('measured');
    if (result.outcome === 'measured') {
      expect(result.certified).toBe(false);
      expect(result.totals.complete).toBe(false);
      expect(result.warnings.join(' ')).toMatch(/unknown pitch/i);
    }
  });
});

describe('RR-037 revision immutability', () => {
  it('freezes a draft on approval and refuses further edits', () => {
    const approved = markRoofRevisionApproved(revision(), {
      approvedByUserId: 'user-1',
      approvedAt: '2026-11-11T12:00:00.000Z',
    });
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBe('2026-11-11T12:00:00.000Z');
    expect(() =>
      markRoofRevisionApproved(approved, {
        approvedByUserId: 'user-2',
        approvedAt: '2026-11-12T12:00:00.000Z',
      }),
    ).toThrow(/create a new revision/i);
  });
});
