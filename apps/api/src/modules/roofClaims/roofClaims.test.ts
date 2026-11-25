// Roof claims + agent activity: pure-logic tests. No database, no network.
import { describe, expect, it } from 'vitest';
import {
  AgentActivityTotalsSchema,
  computeAgentHours,
  LogAgentActivitySchema,
  minutesToHours,
} from './activity';
import {
  AttachClaimDocumentSchema,
  canTransitionClaim,
  CLAIM_STATUSES,
  claimDto,
  claimStatusLabel,
  type ClaimStatus,
  CreateRoofClaimSchema,
  nextClaimStatuses,
  RoofClaimSchema,
  UpdateRoofClaimStatusSchema,
} from './claims';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM_ID = '22222222-2222-4222-8222-222222222222';

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CLAIM_ID,
    roofOrderId: ORDER_ID,
    carrier: 'Acme Mutual',
    adjusterName: 'Pat Adjuster',
    adjusterContact: 'pat@example.test',
    claimNumber: 'CLM-100',
    status: 'filed',
    note: null,
    createdAt: new Date('2026-11-24T12:00:00.000Z'),
    updatedAt: new Date('2026-11-24T12:00:00.000Z'),
    ...overrides,
  };
}

describe('claim status machine', () => {
  it('walks the full happy path filed -> settled', () => {
    const path = [
      'adjuster_assigned',
      'inspection_scheduled',
      'estimate_submitted',
      'approved',
      'settled',
    ] as const;
    let current: ClaimStatus = 'filed';
    for (const next of path) {
      expect(canTransitionClaim(current, next)).toBe(true);
      current = next;
    }
    expect(current).toBe('settled');
    expect(nextClaimStatuses('settled')).toEqual([]);
  });

  it('allows estimate_submitted -> denied, and denied is terminal', () => {
    expect(canTransitionClaim('estimate_submitted', 'denied')).toBe(true);
    expect(nextClaimStatuses('denied')).toEqual([]);
  });

  it('rejects skips, backwards moves and self-transitions', () => {
    expect(canTransitionClaim('filed', 'approved')).toBe(false);
    expect(canTransitionClaim('approved', 'filed')).toBe(false);
    expect(canTransitionClaim('filed', 'filed')).toBe(false);
    expect(canTransitionClaim('estimate_submitted', 'settled')).toBe(false);
  });

  it('labels every status', () => {
    for (const status of CLAIM_STATUSES) expect(claimStatusLabel(status).length).toBeGreaterThan(0);
    expect(claimStatusLabel('adjuster_assigned')).toBe('Adjuster assigned');
  });
});

describe('claim schemas', () => {
  it('accepts a minimal create (carrier + roof order only)', () => {
    const parsed = CreateRoofClaimSchema.parse({ roofOrderId: ORDER_ID, carrier: 'Acme Mutual' });
    expect(parsed.carrier).toBe('Acme Mutual');
    expect(parsed.adjusterName).toBeUndefined();
  });

  it('rejects a blank carrier and a non-uuid roof order id', () => {
    expect(CreateRoofClaimSchema.safeParse({ roofOrderId: ORDER_ID, carrier: '  ' }).success).toBe(
      false,
    );
    expect(
      CreateRoofClaimSchema.safeParse({ roofOrderId: 'not-a-uuid', carrier: 'Acme' }).success,
    ).toBe(false);
  });

  it('rejects unknown statuses on update', () => {
    expect(UpdateRoofClaimStatusSchema.safeParse({ status: 'paid' }).success).toBe(false);
    expect(UpdateRoofClaimStatusSchema.parse({ status: 'approved' }).status).toBe('approved');
  });

  it('requires a reference when attaching a document', () => {
    const media = '33333333-3333-4333-8333-333333333333';
    expect(
      AttachClaimDocumentSchema.parse({ mediaAssetId: media, kind: 'photo' }).mediaAssetId,
    ).toBe(media);
    expect(
      AttachClaimDocumentSchema.parse({
        inspectionReportId: 'inspection-abc',
        kind: 'inspection_report',
      }).inspectionReportId,
    ).toBe('inspection-abc');
    expect(AttachClaimDocumentSchema.safeParse({ kind: 'photo' }).success).toBe(false);
  });

  it('maps a row + documents to a schema-valid claim', () => {
    const claim = claimDto(claimRow(), [
      {
        id: '44444444-4444-4444-8444-444444444444',
        claimId: CLAIM_ID,
        mediaAssetId: null,
        inspectionReportId: 'inspection-abc',
        kind: 'inspection_report',
        label: 'Photo inspection report',
        createdAt: new Date('2026-11-24T12:00:00.000Z'),
      },
    ]);
    expect(RoofClaimSchema.parse(claim).documents).toHaveLength(1);
    expect(claim.documents[0]?.inspectionReportId).toBe('inspection-abc');
    expect(claim.status).toBe('filed');
  });

  it('falls back to "other" for an unknown stored document kind', () => {
    const claim = claimDto(claimRow(), [
      {
        id: '44444444-4444-4444-8444-444444444444',
        claimId: CLAIM_ID,
        mediaAssetId: null,
        inspectionReportId: 'inspection-abc',
        kind: 'fax',
        label: null,
        createdAt: new Date('2026-11-24T12:00:00.000Z'),
      },
    ]);
    expect(claim.documents[0]?.kind).toBe('other');
  });
});

describe('agent activity logging', () => {
  it('accepts a log entry with no measured minutes (not measured, not zero)', () => {
    const parsed = LogAgentActivitySchema.parse({ agent: 'claims', action: 'Filed claim CLM-100' });
    expect(parsed.minutesSaved).toBeUndefined();
  });

  it('rejects unknown agents and negative minutes', () => {
    expect(
      LogAgentActivitySchema.safeParse({ agent: 'roofer', action: 'Did a thing' }).success,
    ).toBe(false);
    expect(
      LogAgentActivitySchema.safeParse({ agent: 'claims', action: 'Filed', minutesSaved: -5 })
        .success,
    ).toBe(false);
  });
});

describe('computeAgentHours', () => {
  it('sums only measured minutes and rounds hours to one decimal', () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(100)).toBe(1.7);
    const totals = computeAgentHours([
      { agent: 'claims', minutesSaved: 60 },
      { agent: 'claims', minutesSaved: 30 },
      { agent: 'claims', minutesSaved: null },
      { agent: 'estimator', minutesSaved: null },
    ]);
    expect(AgentActivityTotalsSchema.parse(totals).measured).toBe(true);
    const claims = totals.agents.find((a) => a.agent === 'claims')!;
    expect(claims.actions).toBe(3);
    expect(claims.measuredActions).toBe(2);
    expect(claims.minutesSaved).toBe(90);
    expect(claims.hoursSaved).toBe(1.5);
    expect(claims.measured).toBe(true);
    const estimator = totals.agents.find((a) => a.agent === 'estimator')!;
    expect(estimator.actions).toBe(1);
    expect(estimator.measured).toBe(false);
    expect(estimator.hoursSaved).toBeNull();
    expect(totals.totalHoursSaved).toBe(1.5);
  });

  it('reports every known agent, unmeasured ones as not measured yet — never 0 as measured', () => {
    const totals = computeAgentHours([]);
    expect(totals.agents).toHaveLength(6);
    expect(totals.measured).toBe(false);
    expect(totals.totalHoursSaved).toBeNull();
    for (const agent of totals.agents) {
      expect(agent.measured).toBe(false);
      expect(agent.hoursSaved).toBeNull();
      expect(agent.minutesSaved).toBeNull();
    }
    expect(totals.note).toMatch(/not measured yet/i);
  });

  it('ignores rows from unknown agent names instead of inventing a label', () => {
    const totals = computeAgentHours([
      { agent: 'roofer', minutesSaved: 600 },
      { agent: 'storms', minutesSaved: 30 },
    ]);
    expect(totals.totalHoursSaved).toBe(0.5);
    expect(totals.agents.find((a) => a.agent === 'storms')?.hoursSaved).toBe(0.5);
  });
});
