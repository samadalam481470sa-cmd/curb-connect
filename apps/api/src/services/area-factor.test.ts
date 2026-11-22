import { areaFactorFromWages, oewsWageSeries, stateFips } from '@fieldline/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupAreaFactor, parseCensusGeographies, resetAreaFactorCache } from './area-factor';

const census = {
  result: {
    geographies: {
      States: [{ STATE: '48', NAME: 'Texas' }],
      'Metropolitan Statistical Areas': [{ CBSA: '19100', NAME: 'Dallas-Fort Worth-Arlington, TX Metro Area' }],
    },
  },
};
const bls = (rows: Record<string, number>) => ({
  status: 'REQUEST_SUCCEEDED',
  Results: { series: Object.entries(rows).map(([id, v]) => ({ seriesID: id, data: [{ year: '2025', period: 'A01', value: String(v) }, { year: '2024', period: 'A01', value: '1.00' }] })) },
});
const N = oewsWageSeries('N', '0000000');
const S = oewsWageSeries('S', '4800000');
const M = oewsWageSeries('M', '0019100');

describe('area cost factor', () => {
  beforeEach(() => resetAreaFactorCache());

  it('builds 25-character OEWS series ids and the wage-weighted factor', () => {
    expect(N).toBe('OEUN000000000000047000003');
    expect(M).toHaveLength(25);
    expect(areaFactorFromWages(30, 30)).toBe(1);
    expect(areaFactorFromWages(24, 30)).toBe(0.9); // wages 20% lower -> labor half -> 10% lower
    expect(stateFips('Texas')).toBe('48');
    expect(stateFips('tx')).toBe('48');
  });

  it('reads the state and metro area from the Census answer', () => {
    expect(parseCensusGeographies(census)).toMatchObject({ stateFips: '48', cbsa: '19100' });
    expect(parseCensusGeographies({})).toMatchObject({ stateFips: null, cbsa: null });
  });

  it('uses metro wages when published, else the state', async () => {
    const fetcher = vi.fn(async (url: string | URL) =>
      String(url).includes('census') ? new Response(JSON.stringify(census)) : new Response(JSON.stringify(bls({ [N]: 32, [S]: 28.8, [M]: 30.4 }))),
    );
    const r = await lookupAreaFactor({ lat: 32.95, lon: -96.89 }, undefined, fetcher as unknown as typeof fetch);
    expect(r).toMatchObject({ status: 'found', level: 'metro', factor: 0.98, localWage: 30.4, year: '2025' });

    resetAreaFactorCache();
    const stateOnly = vi.fn(async (url: string | URL) =>
      String(url).includes('census') ? new Response('down', { status: 503 }) : new Response(JSON.stringify(bls({ [N]: 32, [S]: 28.8 }))),
    );
    const s = await lookupAreaFactor({ lat: 32.95, lon: -96.89, state: 'Texas' }, undefined, stateOnly as unknown as typeof fetch);
    expect(s).toMatchObject({ status: 'found', level: 'state', factor: 0.95 });
  });

  it('never invents a factor when data is missing', async () => {
    const down = vi.fn(async () => new Response('x', { status: 500 }));
    const r = await lookupAreaFactor({ lat: 10, lon: 10 }, undefined, down as unknown as typeof fetch);
    expect(r.factor).toBeNull();
    expect(r.status).toBe('not_found');
  });
});
