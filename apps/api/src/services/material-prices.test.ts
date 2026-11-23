import { describe, expect, it, vi } from 'vitest';
import { lookupMaterialPrices } from './material-prices';

function okFetcher(payload: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as never;
}

describe('live material price lookup (item 16)', () => {
  it('reports no live source when no provider key is configured', async () => {
    const out = await lookupMaterialPrices('2x4 stud', 'Dallas, TX', undefined);
    expect(out.live).toBe(false);
    expect(out.offers).toEqual([]);
    expect(out.message).toMatch(/SERPAPI_API_KEY/);
    expect(out.fetchedAt).toBeUndefined();
  });

  it('stamps fetchedAt and source on live answers', async () => {
    const now = Date.parse('2026-11-22T12:00:00.000Z');
    const out = await lookupMaterialPrices(
      'osb sheathing phase d',
      'Fort Worth, TX',
      'test-key',
      okFetcher({
        shopping_results: [
          { title: 'OSB 7/16 4x8', source: 'Example Store', extracted_price: 14.5, product_link: 'https://example.com/osb' },
        ],
      }),
      now,
    );
    expect(out.live).toBe(true);
    expect(out.source).toBe('SerpApi Google Shopping');
    expect(out.fetchedAt).toBe('2026-11-22T12:00:00.000Z');
    expect(out.offers[0]?.price).toBe(14.5);
  });

  it('serves the cached answer within the hour without refetching', async () => {
    const fetcher = okFetcher({
      shopping_results: [{ title: 'Stud', source: 'Store', extracted_price: 4, link: 'https://example.com/s' }],
    });
    const t0 = Date.parse('2026-11-22T13:00:00.000Z');
    await lookupMaterialPrices('cache stud phase d', 'Dallas, TX', 'k', fetcher, t0);
    const again = await lookupMaterialPrices('cache stud phase d', 'Dallas, TX', 'k', fetcher, t0 + 30 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again.fetchedAt).toBe(new Date(t0).toISOString());
  });
});
