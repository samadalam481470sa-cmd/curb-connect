import { describe, expect, it, vi } from 'vitest';
import type { RawPermit } from './engine';
import { parsePlainRule, stageOf, tradeEvidence } from './signals';
import { fetchDenton, fetchFortWorth, normalizeDenton, normalizeFortWorth } from './sources';

const base: RawPermit = {
  source: 'fortworth', sourceName: 'City of Fort Worth', permitNumber: '26-01',
  city: 'Fort Worth', address: '200 Elm St', zip: '76102',
  description: 'New commercial warehouse construction', permitType: 'Building',
  workClass: 'New', landUse: 'Commercial', status: 'Issued',
  issuedAt: '2026-11-20T00:00:00.000Z', appliedAt: '2026-11-15T00:00:00.000Z',
  value: 2_000_000, units: 0, contractor: 'General Builder',
  contractorPhone: '', url: 'https://www.fortworthtexas.gov',
};

describe('public construction intelligence signals', () => {
  it('distinguishes applications, permits, and planning without forecasting dates', () => {
    expect(stageOf(base)).toBe('permitted');
    expect(stageOf({ ...base, status: 'Under review', issuedAt: null })).toBe('application');
    expect(stageOf({ ...base, permitType: 'Site Plan Review', issuedAt: null })).toBe('planning');
    expect(stageOf({ ...base, status: 'Finaled' })).toBe('completed');
  });

  it('does not equate absent trade permit with an unassigned subcontractor', () => {
    expect(tradeEvidence(base, 'electrical', [base])).toBe('not_observed');
    expect(tradeEvidence(base, 'electrical', [
      base, { ...base, permitNumber: 'E2', permitType: 'Electrical' },
    ])).toBe('recorded');
    expect(tradeEvidence({ ...base, address: '' }, 'electrical', [base])).toBe('unknown');
    expect(tradeEvidence(base, 'concrete', [base])).toBe('not_applicable');
  });

  it('parses only supported plain-English constraints, never executable SQL', () => {
    expect(parsePlainRule('Only commercial projects over $1.5M')).toMatchObject({
      minimumValue: 1_500_000, projectTypes: ['commercial'],
    });
    expect(parsePlainRule('multifamily over 500k')).toMatchObject({
      minimumValue: 500_000, projectTypes: ['multifamily'],
    });
    expect(parsePlainRule('DELETE FROM permits')).toMatchObject({
      minimumValue: 0, projectTypes: [],
    });
  });

  it('normalizes official Fort Worth attributes without calling owner a GC', () => {
    const [row] = normalizeFortWorth([{
      Permit_No: 'FW-1', Full_Street_Address: '300 MAIN ST',
      B1_WORK_DESC: 'New commercial shell', Permit_Type: 'Building',
      File_Date: Date.parse('2026-11-15T00:00:00Z'), Status_Date: Date.parse('2026-11-20T00:00:00Z'),
      Current_Status: 'Issued', JobValue: '$1,250,000', Owner_Full_Name: 'Parcel Owner LLC',
    }]);
    expect(row).toMatchObject({
      permitNumber: 'FW-1', city: 'Fort Worth', contractor: '', value: 1250000,
      issuedAt: '2026-11-20T00:00:00.000Z',
    });
  });

  it('preserves Denton recorded contractor and source map coordinate', () => {
    const [record] = normalizeDenton([{
      attributes: {
        PERMIT_NO: 'DE-123', SITE_ADDR: '100 W OAK',
        PermitType: 'Building', STATUS: 'Review',
        APPLIED: Date.parse('2026-11-18T00:00:00Z'),
        JOBVALUE: 2800000, CONTRACTOR_NAME: 'Test Contractor LLC',
      },
      geometry: { x: -97.1331, y: 33.2148 },
    }]);
    expect(record).toMatchObject({
      permitNumber: 'DE-123', city: 'Denton',
      contractor: 'Test Contractor LLC', value: 2800000,
      latitude: 33.2148, longitude: -97.1331,
    });
  });

  it('reads bounded pages of Denton ArcGIS records', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get('outSR')).toBe('4326');
      return new Response(JSON.stringify({
        features: [{ attributes: { PERMIT_NO: 'DE-456', APPLIED: Date.parse('2026-11-19T00:00:00Z') } }],
      }));
    });
    const list = await fetchDenton(new Date('2026-11-01'), fetcher as unknown as typeof fetch);
    expect(list).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('paginates ArcGIS JSON and rejects response errors', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const u = new URL(url);
      expect(u.hostname).toBe('services5.arcgis.com');
      expect(u.searchParams.get('f')).toBe('json');
      return new Response(JSON.stringify({ features: [
        { attributes: {
          Permit_No: 'FW-2', Full_Street_Address: '300 MAIN',
          File_Date: Date.parse('2026-11-20T00:00:00Z'),
          Current_Status: 'Pending',
        } },
      ] }));
    });
    const list = await fetchFortWorth(new Date('2026-11-01'), fetcher as unknown as typeof fetch);
    expect(list).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(list[0]?.appliedAt).toBe('2026-11-20T00:00:00.000Z');
  });
});
