import { describe, expect, it, vi } from 'vitest';
import { lookupMaterialPrices } from './material-prices';

function okFetcher(payload: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as never;
}

describe('Home Depot live material price lookup (item 16)', () => {
  it('reports no live source when the Home Depot provider key is not configured', async () => {
    const out = await lookupMaterialPrices('2x4 stud', 'Dallas, TX', undefined);
    expect(out.live).toBe(false);
    expect(out.offers).toEqual([]);
    expect(out.message).toMatch(/SERPAPI_API_KEY/);
    expect(out.message).toMatch(/Home Depot/i);
    expect(out.fetchedAt).toBeUndefined();
  });

  it('restricts the query to Home Depot and filters out other retailers', async () => {
    const requestedUrl: { value: URL | null } = { value: null };
    const fetcher = vi.fn(async (input: URL) => {
      requestedUrl.value = new URL(input.toString());
      return new Response(JSON.stringify({
        shopping_results: [
          {
            title: 'OSB 7/16 4x8 Home Depot',
            source: 'The Home Depot',
            extracted_price: 14.5,
            product_link: 'https://www.homedepot.com/p/osb',
          },
          {
            title: 'Cheaper OSB at another store',
            source: "Lowe's",
            extracted_price: 10,
            product_link: 'https://www.lowes.com/pd/osb',
          },
          {
            title: 'Unverified marketplace listing',
            source: 'Other seller',
            extracted_price: 1,
            product_link: 'https://example.com/osb',
          },
        ],
      }), { status: 200 });
    }) as never;
    const now = Date.parse('2026-11-24T12:00:00.000Z');
    const out = await lookupMaterialPrices('osb sheathing phase d', 'Fort Worth, TX', 'test-key', fetcher, now);
    expect(out.live).toBe(true);
    expect(out.source).toBe('Home Depot listings via Google Shopping');
    expect(out.fetchedAt).toBe('2026-11-24T12:00:00.000Z');
    expect(out.offers).toHaveLength(1);
    expect(out.offers[0]).toMatchObject({
      title: 'OSB 7/16 4x8 Home Depot',
      seller: 'Home Depot',
      price: 14.5,
      link: 'https://www.homedepot.com/p/osb',
    });
    expect(requestedUrl.value?.searchParams.get('q')).toBe('site:homedepot.com osb sheathing phase d');
    expect(requestedUrl.value?.searchParams.get('location')).toBe('Fort Worth, TX');
  });

  it('serves the cached Home Depot answer within the hour without refetching', async () => {
    const fetcher = okFetcher({
      shopping_results: [{
        title: 'Stud',
        source: 'The Home Depot',
        extracted_price: 4,
        link: 'https://www.homedepot.com/p/stud',
      }],
    });
    const t0 = Date.parse('2026-11-24T13:00:00.000Z');
    await lookupMaterialPrices('cache stud phase d', 'Dallas, TX', 'k', fetcher, t0);
    const again = await lookupMaterialPrices('cache stud phase d', 'Dallas, TX', 'k', fetcher, t0 + 30 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again.fetchedAt).toBe(new Date(t0).toISOString());
    expect(again.offers[0]?.seller).toBe('Home Depot');
  });
});
