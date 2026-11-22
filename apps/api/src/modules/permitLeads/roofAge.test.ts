import { describe, expect, it, vi } from 'vitest';
import type { RawPermit } from './engine';
import { deriveRoofAge, isRoofingPermit, propertyKey, searchRoofAge } from './roofAge';

const now = new Date('2026-11-20T12:00:00.000Z');
const base: RawPermit = {
  source: 'austin',
  sourceName: 'City of Austin',
  permitNumber: 'R-1',
  city: 'Austin',
  address: '100 Main St',
  zip: '78701',
  description: 'Re-roof, architectural shingles',
  permitType: 'Roofing Permit',
  workClass: 'Alteration',
  landUse: 'Residential',
  status: 'Final',
  issuedAt: '2009-05-01T00:00:00.000Z',
  appliedAt: null,
  value: 12_000,
  units: 0,
  contractor: 'Old Roof Co',
  contractorPhone: '',
  url: 'https://data.austintexas.gov/d/3syk-w9eu',
};

describe('roof-age leads', () => {
  it('recognizes roofing permits and keys properties by published address', () => {
    expect(isRoofingPermit(base)).toBe(true);
    expect(isRoofingPermit({ ...base, description: 'Kitchen remodel', permitType: 'Building' })).toBe(false);
    expect(propertyKey(base)).toBe('100 MAIN ST|AUSTIN|78701');
    expect(propertyKey({ ...base, address: '' })).toBe('');
  });

  it('flags properties whose newest roofing permit is past the threshold, oldest first', () => {
    const out = deriveRoofAge(
      [
        base, // 2009 re-roof at 100 Main
        { ...base, permitNumber: 'R-2', issuedAt: '2005-01-15T00:00:00.000Z' }, // older, same property
        {
          ...base,
          permitNumber: 'R-3',
          address: '200 Oak Ave',
          issuedAt: '2024-03-01T00:00:00.000Z', // recent roof: not flagged
        },
        {
          ...base,
          permitNumber: 'R-4',
          address: '300 Pine Rd',
          issuedAt: '2008-06-01T00:00:00.000Z', // older than 100 Main's newest
        },
        { ...base, permitNumber: 'R-5', description: 'New fence', permitType: 'Fence' },
        { ...base, permitNumber: 'R-6', address: '', issuedAt: '2001-01-01T00:00:00.000Z' },
        { ...base, permitNumber: 'R-7', address: '400 Elm St', issuedAt: null, appliedAt: null },
      ],
      now,
      15,
    );
    expect(out.leads.map((l) => l.address)).toEqual(['300 Pine Rd', '100 Main St']);
    expect(out.leads[1]!.roofingPermitCount).toBe(2);
    expect(out.leads[1]!.newestRoofingPermitAt).toBe('2009-05-01T00:00:00.000Z');
    expect(out.leads[1]!.ageYears).toBeGreaterThan(17);
    expect(out.propertiesWithRoofingPermit).toBe(3);
    expect(out.propertiesWithoutAddress).toBe(1);
    expect(out.roofingPermitsWithoutDate).toBe(1);
  });

  it('respects a configurable threshold', () => {
    const out = deriveRoofAge([base], now, 20);
    expect(out.leads).toHaveLength(0);
    expect(deriveRoofAge([base], now, 10).leads).toHaveLength(1);
  });

  it('searches roofing history through the live-feed pattern with a mock fetcher', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain('data.austintexas.gov');
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              permit_number: 'R-OLD',
              original_city: 'Austin',
              permit_location: '100 Main St',
              original_zip: '78701',
              description: 'Re-roof shingles',
              permit_type_desc: 'Roofing Permit',
              work_class: 'Alteration',
              status_current: 'Final',
              issue_date: '2008-04-01T00:00:00.000',
              total_job_valuation: '9000',
              contractor_company_name: 'Old Roof Co',
            },
            {
              permit_number: 'R-NEW',
              original_city: 'Austin',
              permit_location: '200 Oak Ave',
              original_zip: '78702',
              description: 'New roof',
              permit_type_desc: 'Roofing Permit',
              work_class: 'Alteration',
              status_current: 'Final',
              issue_date: '2025-04-01T00:00:00.000',
              total_job_valuation: '15000',
              contractor_company_name: 'New Roof Co',
            },
          ]),
      } as Response;
    });
    const out = await searchRoofAge(
      { cities: ['Austin'], thresholdYears: 15, customFeeds: [] },
      { fetcher: fetcher as unknown as typeof fetch, now },
    );
    expect(out.summary.roofingPermitsScanned).toBe(2);
    expect(out.leads).toHaveLength(1);
    expect(out.leads[0]!.address).toBe('100 Main St');
    expect(out.caveats.join(' ')).toMatch(/not a damage/);
  });
});
