// Audit-status rows must reflect the run's real state: a live source is only
// "verified" when it actually answered, and everything typed in stays
// contractor-entered. These tests pin that wording to the facts.
import { describe, expect, it } from 'vitest';
import {
  AUDIT_STATUS_LABEL,
  feasibilityAuditStatus,
  type FeasibilityAuditFacts,
} from './auditStatus';

const emptyRun: FeasibilityAuditFacts = {
  terrainSource: null,
  floodZone: null,
  floodSource: null,
  streamsAnswered: false,
  streamsSource: null,
  streamsCheckedAt: null,
  parcelImported: false,
  parcelImportName: null,
  costLinesWithSource: 0,
  costLinesTotal: 0,
  sewerDepthEntered: false,
  decisionZonesPainted: 0,
};

const row = (facts: FeasibilityAuditFacts, factor: string) =>
  feasibilityAuditStatus(facts).find((r) => r.factor === factor)!;

describe('feasibilityAuditStatus', () => {
  it('marks nothing verified on a run with no live data pulled', () => {
    const rows = feasibilityAuditStatus(emptyRun);
    expect(rows.some((r) => r.status === 'verified')).toBe(false);
    expect(row(emptyRun, 'Ground heights (terrain)').status).toBe('contractor_entered');
    expect(row(emptyRun, 'Flood zone').status).toBe('missing');
    expect(row(emptyRun, 'Streams & crossings').status).toBe('missing');
    expect(row(emptyRun, 'Comparable sales').status).toBe('missing');
    expect(row(emptyRun, 'Sewer depth').status).toBe('missing');
  });

  it('marks terrain, flood and streams verified only with their real sources', () => {
    const facts: FeasibilityAuditFacts = {
      ...emptyRun,
      terrainSource: 'USGS 3DEP (https://example.test/3dep)',
      floodZone: 'X',
      floodSource: 'FEMA NFHL (https://example.test/nfhl)',
      streamsAnswered: true,
      streamsSource: 'USGS NHD',
      streamsCheckedAt: '2026-11-27T12:00:00.000Z',
    };
    const terrain = row(facts, 'Ground heights (terrain)');
    expect(terrain.status).toBe('verified');
    expect(terrain.detail).toContain('USGS 3DEP');
    const flood = row(facts, 'Flood zone');
    expect(flood.status).toBe('verified');
    expect(flood.detail).toContain('Zone X');
    expect(flood.detail).toContain('FEMA NFHL');
    const streams = row(facts, 'Streams & crossings');
    expect(streams.status).toBe('verified');
    expect(streams.detail).toContain('USGS NHD');
    expect(streams.detail).toContain('2026-11-27');
  });

  it('keeps zoning, prices and ratios contractor-entered — no source is claimed', () => {
    expect(row(emptyRun, 'Zoning rules').status).toBe('contractor_entered');
    expect(row(emptyRun, 'Zoning rules').detail).toContain('no public Texas bulk zoning source');
    expect(row(emptyRun, 'Land price').status).toBe('contractor_entered');
    expect(row(emptyRun, 'Sale prices & revenue').status).toBe('contractor_entered');
  });

  it('reports cost-line source notes and the imported outline honestly', () => {
    const facts: FeasibilityAuditFacts = {
      ...emptyRun,
      costLinesWithSource: 3,
      costLinesTotal: 9,
      parcelImported: true,
      parcelImportName: 'parcel.geojson',
      sewerDepthEntered: true,
      decisionZonesPainted: 2,
    };
    expect(row(facts, 'Development cost lines').detail).toContain('3 of 9');
    const parcel = row(facts, 'Parcel outline & dimensions');
    expect(parcel.status).toBe('contractor_entered');
    expect(parcel.detail).toContain('parcel.geojson');
    expect(parcel.detail).toContain('not a live source');
    expect(row(facts, 'Sewer depth').status).toBe('contractor_entered');
    expect(row(facts, 'Land decision classes').detail).toContain('2 zones painted');
  });

  it('labels computed outputs as estimates', () => {
    expect(row(emptyRun, 'Slope, grading & trench depth').status).toBe('estimated');
    expect(row(emptyRun, 'Lot layout & buildable area').status).toBe('estimated');
    expect(row(emptyRun, 'Underwriting & scenario outputs').status).toBe('estimated');
    expect(AUDIT_STATUS_LABEL.verified).toContain('live source');
  });
});
