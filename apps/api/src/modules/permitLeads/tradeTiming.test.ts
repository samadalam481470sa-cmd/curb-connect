import { describe, expect, it } from 'vitest';
import type { RawPermit } from './engine';
import { permitTradeOf } from './signals';
import { deriveTradeTiming, MIN_OBSERVED_SAMPLES } from './tradeTiming';

const NOW = new Date('2026-11-25T12:00:00.000Z');

const base: RawPermit = {
  source: 'dallas', sourceName: 'City of Dallas', permitNumber: '26-0101',
  city: 'Dallas', address: '300 Crescent Ct', zip: '75201',
  description: 'Tenant improvement: interior finish out of office suite',
  permitType: 'Building', workClass: 'Alteration', landUse: 'Commercial',
  status: 'Issued', issuedAt: '2026-11-01T00:00:00.000Z', appliedAt: '2026-11-01T00:00:00.000Z',
  value: 0, units: 0, contractor: '', contractorPhone: '',
  url: 'https://example.test/permit',
};

const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString();

function parent(n: number, appliedDay: number): RawPermit {
  return {
    ...base,
    permitNumber: `P-${n}`,
    address: `${100 + n} Main St`,
    appliedAt: day(appliedDay),
    issuedAt: day(appliedDay),
  };
}

function tradePermit(n: number, address: string, permitType: string, appliedDay: number): RawPermit {
  return {
    ...base,
    permitNumber: `T-${n}`,
    address,
    description: `${permitType} work`,
    permitType,
    workClass: permitType,
    appliedAt: day(appliedDay),
    issuedAt: day(appliedDay),
  };
}

describe('permitTradeOf', () => {
  it('classifies trades from published type/work class only', () => {
    expect(permitTradeOf({ ...base, permitType: 'Electrical' })).toBe('electrical');
    expect(permitTradeOf({ ...base, permitType: 'Plumbing', workClass: 'Plumbing' })).toBe('plumbing');
    expect(permitTradeOf({ ...base, permitType: 'Mechanical' })).toBe('hvac');
    expect(permitTradeOf({ ...base, permitType: 'Roofing' })).toBe('roofing');
    expect(permitTradeOf(base)).toBeNull();
  });
});

describe('deriveTradeTiming', () => {
  it('reports insufficient data below the sample threshold and claims no timing', () => {
    const permits = [
      parent(1, 0),
      tradePermit(1, '101 Main St', 'Electrical', 10),
      parent(2, 0),
      tradePermit(2, '102 Main St', 'Electrical', 20),
    ];
    const r = deriveTradeTiming(permits, NOW);
    const electrical = r.windows.find((w) => w.trade === 'electrical')!;
    expect(electrical.basis).toBe('insufficient_data');
    expect(electrical.samples).toBe(2);
    expect(electrical.medianLagDays).toBeNull();
    expect(electrical.minLagDays).toBeNull();
    expect(electrical.maxLagDays).toBeNull();
    expect(electrical.note).toContain('insufficient data');
    expect(r.parentsConsidered).toBe(2);
    expect(r.addressesWithSequences).toBe(2);
  });

  it('computes an observed median/min/max once enough sequences exist', () => {
    const permits: RawPermit[] = [];
    const lags = [5, 10, 15, 20, 25, 30];
    lags.forEach((lag, i) => {
      permits.push(parent(i + 1, 0));
      permits.push(tradePermit(i + 1, `${101 + i} Main St`, 'Electrical', lag));
    });
    const r = deriveTradeTiming(permits, NOW);
    const electrical = r.windows.find((w) => w.trade === 'electrical')!;
    expect(electrical.basis).toBe('observed');
    expect(electrical.samples).toBe(6);
    expect(electrical.medianLagDays).toBe(17.5);
    expect(electrical.minLagDays).toBe(5);
    expect(electrical.maxLagDays).toBe(30);
    expect(electrical.note).toContain('Observed');
    // Other trades stay insufficient with zero samples.
    const plumbing = r.windows.find((w) => w.trade === 'plumbing')!;
    expect(plumbing.basis).toBe('insufficient_data');
    expect(plumbing.samples).toBe(0);
    expect(plumbing.medianLagDays).toBeNull();
  });

  it('uses the first later trade permit per parent and never counts the parent itself', () => {
    const permits: RawPermit[] = [];
    for (let i = 0; i < MIN_OBSERVED_SAMPLES; i += 1) {
      permits.push(parent(i + 1, 0));
      // Two electrical permits: the earlier one (lag 7) must win.
      permits.push(tradePermit(100 + i, `${101 + i} Main St`, 'Electrical', 7));
      permits.push(tradePermit(200 + i, `${101 + i} Main St`, 'Electrical', 40));
    }
    const r = deriveTradeTiming(permits, NOW);
    const electrical = r.windows.find((w) => w.trade === 'electrical')!;
    expect(electrical.samples).toBe(MIN_OBSERVED_SAMPLES);
    expect(electrical.medianLagDays).toBe(7);
    expect(electrical.maxLagDays).toBe(7);
  });

  it('ignores trade permits filed before the parent and other addresses', () => {
    const permits: RawPermit[] = [];
    for (let i = 0; i < MIN_OBSERVED_SAMPLES; i += 1) {
      permits.push(parent(i + 1, 20));
      // Electrical permit 10 days BEFORE the parent: not a sequence.
      permits.push(tradePermit(100 + i, `${101 + i} Main St`, 'Electrical', 10));
      // Electrical permit at a different address: not a sequence either.
      permits.push(tradePermit(200 + i, `${900 + i} Other Rd`, 'Electrical', 30));
    }
    const r = deriveTradeTiming(permits, NOW);
    const electrical = r.windows.find((w) => w.trade === 'electrical')!;
    expect(electrical.samples).toBe(0);
    expect(electrical.basis).toBe('insufficient_data');
    expect(r.addressesWithSequences).toBe(0);
  });

  it('builds ordered address sequences with parent and trade labels', () => {
    const permits = [
      parent(1, 0),
      tradePermit(1, '101 Main St', 'Plumbing', 12),
      tradePermit(2, '101 Main St', 'Electrical', 5),
    ];
    const r = deriveTradeTiming(permits, NOW);
    expect(r.sequences).toHaveLength(1);
    const seq = r.sequences[0]!;
    expect(seq.address).toBe('101 Main St');
    expect(seq.events.map((e) => e.permitNumber)).toEqual(['P-1', 'T-2', 'T-1']);
    expect(seq.events[0]?.isParent).toBe(true);
    expect(seq.events[0]?.label).toBe('Finish-out / tenant improvement');
    expect(seq.events[1]?.label).toBe('Electrical');
    expect(seq.events[2]?.label).toBe('Plumbing');
  });

  it('skips permits without dates or usable addresses', () => {
    const noDate = { ...parent(1, 0), appliedAt: null, issuedAt: null };
    const noAddress = { ...parent(2, 0), address: '' };
    const r = deriveTradeTiming([noDate, noAddress], NOW);
    expect(r.parentsConsidered).toBe(0);
    expect(r.sequences).toEqual([]);
    expect(r.windows.every((w) => w.basis === 'insufficient_data')).toBe(true);
  });
});
