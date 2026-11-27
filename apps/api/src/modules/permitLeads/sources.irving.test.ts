// Irving historical-layer tests (audit-gaps round 2). Fixture rows are the
// real newest records returned by the live feed on 2026-11-27: both Irving
// permit tables last edited 2025-03-12, newest permit 2025-02-28. The layer
// is history only — freshness marks it stale with the historical note, and
// the funnel never turns its permits into call leads.
import { describe, expect, it } from 'vitest';
import { fetchIrving, normalizeIrving } from './sources';
import { assessFreshness } from './freshness';
import { deriveFunnelLeads } from './funnel/funnel';
import type { RawPermit } from './engine';

const now = new Date('2026-11-27T12:00:00.000Z');

// Verbatim attribute shapes from the live residential query (2026-11-27).
const RESIDENTIAL_FEATURES = [
  {
    attributes: {
      Issued_Date: 1740722400000, // 2025-02-28
      Permit__: '2025-02-1611',
      Permit_Type: 'Plumbing Standalone',
      Address: '2438 RIDGEWOOD ST, IRVING TX 75062',
      Valuation: '$1,700.00',
      Project_Description: 'Water heater replacement',
      Designation: 'Residential',
    },
  },
  {
    attributes: {
      Issued_Date: 1740722400000,
      Permit__: '2025-02-1633',
      Permit_Type: 'Electrical Standalone',
      Address: '3131 W ROYAL LN, IRVING TX 75063',
      Valuation: '$1,000.00',
      Project_Description: '',
      Designation: 'Residential',
    },
  },
];

const COMMERCIAL_FEATURES = [
  {
    attributes: {
      Issued_Date: 1740463200000, // 2025-02-25
      Permit__: '2025-02-0900',
      Permit_Type: 'Commercial Remodel',
      Address: '700 E AIRPORT FWY, IRVING TX 75062',
      Valuation: '$250,000.00',
      Project_Description: 'Interior remodel',
      Designation: 'Commercial',
      Status: 'Issued',
    },
  },
];

describe('normalizeIrving', () => {
  it('maps the published fields and splits city/zip out of the address', () => {
    const permits = normalizeIrving(RESIDENTIAL_FEATURES);
    expect(permits).toHaveLength(2);
    const p = permits[0]!;
    expect(p.source).toBe('irving');
    expect(p.sourceName).toBe('City of Irving');
    expect(p.permitNumber).toBe('2025-02-1611');
    expect(p.city).toBe('Irving');
    expect(p.address).toBe('2438 RIDGEWOOD ST');
    expect(p.zip).toBe('75062');
    expect(p.value).toBe(1700);
    expect(p.issuedAt).toBe('2025-02-28T06:00:00.000Z');
    // The tables publish no contractor — it stays empty, never guessed.
    expect(p.contractor).toBe('');
  });

  it('drops rows without a permit number', () => {
    expect(normalizeIrving([{ attributes: { Permit__: '' } }])).toEqual([]);
  });
});

function stubIrvingFetch() {
  return (async (url: string) => {
    const features = url.includes('Commercial_Permits') ? COMMERCIAL_FEATURES : RESIDENTIAL_FEATURES;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ features }),
    };
  }) as unknown as typeof fetch;
}

describe('fetchIrving', () => {
  it('merges both tables, dedupes, and filters to the window', async () => {
    const all = await fetchIrving(new Date('2025-01-01'), stubIrvingFetch());
    expect(all.map((p) => p.permitNumber).sort()).toEqual([
      '2025-02-0900',
      '2025-02-1611',
      '2025-02-1633',
    ]);
    // A current window sees nothing — the feed stopped in March 2025.
    const recent = await fetchIrving(new Date('2026-10-01'), stubIrvingFetch());
    expect(recent).toEqual([]);
  });
});

describe('irving freshness', () => {
  it('is stale with the historical note, never live', () => {
    const a = assessFreshness('irving', '2025-02-28T06:00:00.000Z', now);
    expect(a.status).toBe('stale');
    expect(a.message).toContain('Historical layer');
    expect(a.message).toContain('stopped publishing in March 2025');
  });
});

describe('funnel exclusion', () => {
  it('never turns Irving permits into call leads', () => {
    const permits = normalizeIrving([...RESIDENTIAL_FEATURES, ...COMMERCIAL_FEATURES]);
    // Even with a wide age window and "now" moved back near the permit dates,
    // Irving stays out of the funnel.
    const nearThen = new Date('2025-03-03T12:00:00.000Z');
    const derived = deriveFunnelLeads(permits, nearThen, { maxAgeDays: 365 });
    expect(derived.leads).toEqual([]);
    // Sanity: the same shape from another source does produce a lead.
    const other: RawPermit = { ...permits[0]!, source: 'denton', sourceName: 'City of Denton' };
    const withOther = deriveFunnelLeads([other], nearThen, { maxAgeDays: 365 });
    expect(withOther.leads).toHaveLength(1);
  });
});
