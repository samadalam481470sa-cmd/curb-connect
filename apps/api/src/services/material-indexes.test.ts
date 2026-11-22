import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMaterialIndexes, parseFredCsv, resetMaterialIndexCache } from './material-indexes';

const bls = {
  status: 'REQUEST_SUCCEEDED',
  Results: {
    series: [
      { seriesID: 'WPUIP2311001', data: [
        { year: '2026', period: 'M10', value: '360.0', footnotes: [{ code: 'P' }] },
        { year: '2026', period: 'M09', value: '356.4', footnotes: [{}] },
        { year: '2024', period: 'M09', value: '316.0', footnotes: [{}] },
      ] },
      { seriesID: 'WPU0811', data: [{ year: '2026', period: 'M10', value: '288.5', footnotes: [{}] }] },
    ],
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('material indexes', () => {
  beforeEach(() => resetMaterialIndexCache());

  it('reads BLS once, then serves the cached values', async () => {
    const fetcher = vi.fn(async () => json(bls));
    const first = await getMaterialIndexes(undefined, fetcher as unknown as typeof fetch, 1_000);
    expect(first.status).toBe('live');
    expect(first.escalation).toEqual({ fromPeriod: '2024-09', toPeriod: '2026-10', percent: 13.92 });
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain('/publicAPI/v1/');
    const second = await getMaterialIndexes(undefined, fetcher as unknown as typeof fetch, 2_000);
    expect(second.status).toBe('cached');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses the registered v2 endpoint when a key is set', async () => {
    const fetcher = vi.fn(async () => json(bls));
    await getMaterialIndexes('key-123', fetcher as unknown as typeof fetch, 1_000);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/publicAPI/v2/');
    expect(JSON.parse(String(init.body)).registrationkey).toBe('key-123');
  });

  it('falls back to FRED, and reports unavailable without inventing values', async () => {
    const csv = 'observation_date,WPUIP2311001\n2024-09-01,316.0\n2026-10-01,.\n2026-09-01,356.4\n';
    const fred = vi.fn(async (url: string) => (String(url).includes('api.bls.gov') ? json({}, 503) : new Response(csv)));
    const viaFred = await getMaterialIndexes(undefined, fred as unknown as typeof fetch, 1_000);
    expect(viaFred.source.url).toContain('fred.stlouisfed.org');
    expect(viaFred.escalation?.toPeriod).toBe('2026-09');

    resetMaterialIndexCache();
    const down = vi.fn(async () => json({}, 503));
    const none = await getMaterialIndexes(undefined, down as unknown as typeof fetch, 1_000);
    expect(none.status).toBe('unavailable');
    expect(none.indexes).toEqual([]);
  });

  it('parses FRED CSV and skips missing values', () => {
    expect(parseFredCsv('observation_date,X\n2026-01-01,.\n2026-02-01,101.5\nbad,1\n')).toEqual([
      { period: '2026-02', value: 101.5, preliminary: false },
    ]);
  });
});
