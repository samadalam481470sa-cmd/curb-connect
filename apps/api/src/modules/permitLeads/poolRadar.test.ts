import { describe, expect, it, vi } from 'vitest';
import type { RawPermit } from './engine';
import {
  derivePoolRadar,
  isFencePermit,
  isPoolPermit,
  poolPropertyKey,
  poolWindow,
  searchPoolRadar,
} from './poolRadar';

const now = new Date('2026-11-20T12:00:00.000Z');
const base: RawPermit = {
  source: 'austin',
  sourceName: 'City of Austin',
  permitNumber: 'P-1',
  city: 'Austin',
  address: '100 Main St',
  zip: '78701',
  description: 'New in-ground swimming pool',
  permitType: 'Swimming Pool',
  workClass: 'Alteration',
  landUse: 'Residential',
  status: 'Issued',
  issuedAt: '2026-10-26T00:00:00.000Z',
  appliedAt: null,
  value: 45000,
  units: 0,
  contractor: 'Pool Builders LLC',
  contractorPhone: '',
  url: 'https://data.austintexas.gov/d/3syk-w9eu',
};

describe('pool radar detection', () => {
  it('recognizes pool permits from type, description and work class', () => {
    expect(isPoolPermit(base)).toBe(true);
    expect(isPoolPermit({ ...base, description: 'Pool - in-ground', permitType: 'Building' })).toBe(
      true,
    );
    expect(
      isPoolPermit({ ...base, description: 'New residence', permitType: 'Swimming Pool' }),
    ).toBe(true);
    expect(
      isPoolPermit({ ...base, description: 'Poolhouse and patio', permitType: 'Accessory' }),
    ).toBe(true);
    expect(isPoolPermit({ ...base, description: 'New pools', permitType: 'Building' })).toBe(true);
  });

  it('identifies Houston pool permits from the comments field, and not without it', () => {
    const houston: RawPermit = {
      ...base,
      source: 'houston',
      sourceName: 'City of Houston',
      permitNumber: 'H-1',
      city: 'Houston',
      permitType: 'Building Pmt',
      description: 'New swimming pool, 15x30',
    };
    expect(isPoolPermit(houston)).toBe(true);
    expect(isPoolPermit({ ...houston, description: '' })).toBe(false);
  });

  it('does not count "pool" inside other words as a pool permit', () => {
    expect(
      isPoolPermit({ ...base, description: 'Sign for Liverpool Arms pub', permitType: 'Sign' }),
    ).toBe(false);
    expect(
      isPoolPermit({ ...base, description: 'Carpool lane striping', permitType: 'Street' }),
    ).toBe(false);
    expect(
      isPoolPermit({ ...base, description: 'Whirlpool tub replacement', permitType: 'Plumbing' }),
    ).toBe(false);
    expect(
      isPoolPermit({ ...base, description: 'New single family residence', permitType: 'Building' }),
    ).toBe(false);
  });

  it('recognizes fence permits and not "defence"', () => {
    const fence: RawPermit = { ...base, description: 'Fence installation', permitType: 'Fence' };
    expect(isFencePermit(fence)).toBe(true);
    expect(
      isFencePermit({ ...fence, description: 'Fencing around pool', permitType: 'Building' }),
    ).toBe(true);
    expect(
      isFencePermit({ ...fence, description: 'Defence wall repair', permitType: 'Building' }),
    ).toBe(false);
    expect(isFencePermit(base)).toBe(false);
  });

  it('keys properties by normalized address + city, expanding street suffixes', () => {
    expect(poolPropertyKey(base)).toBe('100 MAIN STREET|AUSTIN');
    expect(poolPropertyKey({ ...base, address: '100 Main Street' })).toBe(poolPropertyKey(base));
    expect(poolPropertyKey({ ...base, address: '100 main st.' })).toBe(poolPropertyKey(base));
    expect(poolPropertyKey({ ...base, city: 'Dallas' })).not.toBe(poolPropertyKey(base));
    expect(poolPropertyKey({ ...base, address: '101 Main St' })).not.toBe(poolPropertyKey(base));
    expect(poolPropertyKey({ ...base, address: '' })).toBe('');
  });
});

describe('pool follow-up windows', () => {
  it('flags the estimated windows at the exact boundary days', () => {
    expect(poolWindow(0)).toBe('before_window');
    expect(poolWindow(20)).toBe('before_window');
    expect(poolWindow(21)).toBe('in_window');
    expect(poolWindow(28)).toBe('in_window');
    expect(poolWindow(35)).toBe('in_window');
    expect(poolWindow(36)).toBe('window_closing');
    expect(poolWindow(50)).toBe('window_closing');
    expect(poolWindow(51)).toBe('past_window');
    expect(poolWindow(200)).toBe('past_window');
    expect(poolWindow(null)).toBe('no_date');
  });
});

describe('pool radar derivation', () => {
  const fenceAt = (over: Partial<RawPermit>): RawPermit => ({
    ...base,
    permitNumber: 'F-1',
    description: 'Fence installation',
    permitType: 'Fence',
    workClass: '',
    issuedAt: '2026-11-15T00:00:00.000Z',
    value: 8000,
    contractor: 'Fence Co',
    ...over,
  });

  it('matches a later fence permit at the same address and reports the observed lag', () => {
    const out = derivePoolRadar([base, fenceAt({})], now);
    expect(out.leads).toHaveLength(1);
    expect(out.leads[0]!.window).toBe('in_window');
    expect(out.leads[0]!.daysSinceIssue).toBe(25);
    expect(out.leads[0]!.fencePermit?.permitNumber).toBe('F-1');
    expect(out.leads[0]!.fencePermit?.lagDays).toBe(20);
    expect(out.matched).toBe(1);
    expect(out.observedFenceTiming).toEqual({
      matchedCount: 1,
      medianLagDays: 20,
      minLagDays: 20,
      maxLagDays: 20,
    });
  });

  it('does not match a fence filed before the pool, at another address, or in another city', () => {
    const out = derivePoolRadar(
      [
        base,
        fenceAt({ permitNumber: 'F-EARLY', issuedAt: '2026-10-01T00:00:00.000Z' }),
        fenceAt({ permitNumber: 'F-OTHER-ADDR', address: '200 Oak Ave' }),
        fenceAt({ permitNumber: 'F-OTHER-CITY', city: 'Dallas' }),
      ],
      now,
    );
    expect(out.leads[0]!.fencePermit).toBeNull();
    expect(out.matched).toBe(0);
    expect(out.observedFenceTiming).toBeNull();
  });

  it('does not match an undated fence permit or an undated pool permit', () => {
    const out = derivePoolRadar(
      [{ ...base, issuedAt: null, appliedAt: null }, fenceAt({ issuedAt: null })],
      now,
    );
    expect(out.leads[0]!.window).toBe('no_date');
    expect(out.leads[0]!.fencePermit).toBeNull();
    expect(out.noDate).toBe(1);
  });

  it('picks the earliest fence on/after the pool when several were filed', () => {
    const out = derivePoolRadar(
      [
        base,
        fenceAt({ permitNumber: 'F-LATE', issuedAt: '2026-11-18T00:00:00.000Z' }),
        fenceAt({ permitNumber: 'F-EARLY', issuedAt: '2026-11-05T00:00:00.000Z' }),
      ],
      now,
    );
    expect(out.leads[0]!.fencePermit?.permitNumber).toBe('F-EARLY');
    expect(out.leads[0]!.fencePermit?.lagDays).toBe(10);
  });

  it('matches across street-suffix spellings and counts the median lag across matches', () => {
    const secondPool: RawPermit = {
      ...base,
      permitNumber: 'P-2',
      address: '200 Oak Ave',
      issuedAt: '2026-09-21T00:00:00.000Z', // 60 days ago: past window
    };
    const out = derivePoolRadar(
      [
        base,
        fenceAt({}),
        secondPool,
        fenceAt({
          permitNumber: 'F-2',
          address: '200 Oak Avenue',
          issuedAt: '2026-10-21T00:00:00.000Z',
        }),
      ],
      now,
    );
    expect(out.matched).toBe(2);
    expect(out.leads.map((l) => l.permitNumber).sort()).toEqual(['P-1', 'P-2']);
    // Lags 20 and 30 days: median 25.
    expect(out.observedFenceTiming).toEqual({
      matchedCount: 2,
      medianLagDays: 25,
      minLagDays: 20,
      maxLagDays: 30,
    });
  });

  it('sorts unmatched in-window leads before past-window and fence-filed leads', () => {
    const pastPool: RawPermit = {
      ...base,
      permitNumber: 'P-PAST',
      address: '300 Pine Rd',
      issuedAt: '2026-09-01T00:00:00.000Z',
    };
    const out = derivePoolRadar([pastPool, base, fenceAt({})], now);
    // base is in-window and matched (fence filed) so it sorts after the unmatched past-window pool.
    expect(out.leads.map((l) => l.permitNumber)).toEqual(['P-PAST', 'P-1']);
  });
});

describe('pool radar search wiring', () => {
  it('searches the live-feed pattern with a mock fetcher and returns pool leads only', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain('data.austintexas.gov');
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              permit_number: 'P-1',
              original_city: 'Austin',
              permit_location: '100 Main St',
              original_zip: '78701',
              description: 'New in-ground swimming pool',
              permit_type_desc: 'Swimming Pool',
              work_class: 'Alteration',
              status_current: 'Issued',
              issue_date: '2026-10-26T00:00:00.000',
              total_job_valuation: '45000',
              contractor_company_name: 'Pool Builders LLC',
            },
            {
              permit_number: 'P-1',
              original_city: 'Austin',
              permit_location: '100 Main St',
              original_zip: '78701',
              description: 'New in-ground swimming pool',
              permit_type_desc: 'Swimming Pool',
              work_class: 'Alteration',
              status_current: 'Issued',
              issue_date: '2026-10-26T00:00:00.000',
              total_job_valuation: '45000',
              contractor_company_name: 'Pool Builders LLC',
            },
            {
              permit_number: 'F-1',
              original_city: 'Austin',
              permit_location: '100 Main St',
              original_zip: '78701',
              description: 'Fence installation',
              permit_type_desc: 'Fence',
              work_class: 'Alteration',
              status_current: 'Issued',
              issue_date: '2026-11-15T00:00:00.000',
              total_job_valuation: '8000',
              contractor_company_name: 'Fence Co',
            },
            {
              permit_number: 'B-1',
              original_city: 'Austin',
              permit_location: '500 Cedar St',
              original_zip: '78702',
              description: 'New single family residence',
              permit_type_desc: 'Building',
              work_class: 'New',
              status_current: 'Issued',
              issue_date: '2026-11-10T00:00:00.000',
              total_job_valuation: '300000',
              contractor_company_name: 'Builder Inc',
            },
          ]),
      } as Response;
    });
    const out = await searchPoolRadar(
      { cities: ['Austin'], days: 90, customFeeds: [] },
      { fetcher: fetcher as unknown as typeof fetch, now },
    );
    // Duplicate pool row deduped; the non-pool building permit is not a lead.
    expect(out.summary.permitsScanned).toBe(3);
    expect(out.summary.poolPermits).toBe(1);
    expect(out.leads).toHaveLength(1);
    expect(out.leads[0]!.address).toBe('100 Main St');
    expect(out.leads[0]!.window).toBe('in_window');
    expect(out.leads[0]!.fencePermit?.permitNumber).toBe('F-1');
    expect(out.feeds).toHaveLength(1);
    expect(out.feeds[0]!.id).toBe('austin');
    expect(out.feeds[0]!.poolPermits).toBe(1);
    expect(out.observedFenceTiming?.medianLagDays).toBe(20);
    expect(out.caveats.join(' ')).toMatch(/estimates for when to call/);
    expect(out.caveats.join(' ')).toMatch(/Florida-only/);
    expect(out.caveats.join(' ')).not.toMatch(/3x more likely/);
  });

  it('returns no feeds for a city with no live source', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const out = await searchPoolRadar(
      { cities: ['Garland'], days: 90, customFeeds: [] },
      { fetcher: fetcher as unknown as typeof fetch, now },
    );
    expect(out.feeds).toHaveLength(0);
    expect(out.leads).toHaveLength(0);
    expect(out.summary.permitsScanned).toBe(0);
  });
});
