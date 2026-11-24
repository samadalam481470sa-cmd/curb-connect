import { describe, expect, it, vi } from 'vitest';
import { lookupMaterialPrices, parseShoppingResults, sanitizeQuery } from './material-prices';
import { lookupSiteContext, siteContextQuery } from './site-context';

describe('site context', () => {
  it('asks a fixed host with only numeric input and parses the answer', async () => {
    const anchor = { lat: 32.95, lon: -96.89, radiusM: 150 };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      elements: [{ type: 'way', id: 7, tags: { highway: 'residential' }, geometry: [{ lat: 32.95, lon: -96.89 }, { lat: 32.95, lon: -96.889 }] }],
    })));
    const out = await lookupSiteContext(anchor, fetcher as unknown as typeof fetch, 1_000);
    expect(out.status).toBe('found');
    expect(out.roads).toHaveLength(1);
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(siteContextQuery(32.95, -96.89, 150)).toContain('around:150,32.950000,-96.890000');
  });

  it('reports an unavailable map service instead of failing', async () => {
    const out = await lookupSiteContext({ lat: 10, lon: 10, radiusM: 100 }, vi.fn(async () => new Response('x', { status: 504 })) as unknown as typeof fetch, 1_000);
    expect(out.status).toBe('upstream_unavailable');
  });
});

describe('Home Depot price lookup', () => {
  it('says plainly when no provider key is set', async () => {
    const out = await lookupMaterialPrices('2x4 stud', 'Dallas, TX', undefined);
    expect(out.live).toBe(false);
    expect(out.message).toMatch(/SERPAPI_API_KEY/);
    expect(out.message).toMatch(/Home Depot/i);
  });

  it('keeps only Home Depot offers and safe Home Depot product links', () => {
    expect(sanitizeQuery('  2x4\u0007 stud  ')).toBe('2x4 stud');
    expect(sanitizeQuery('x')).toBeNull();
    const offers = parseShoppingResults({ shopping_results: [
      {
        title: 'Stud with safe Home Depot link',
        source: 'The Home Depot',
        extracted_price: 4.5,
        product_link: 'javascript:alert(1)',
        link: 'https://www.homedepot.com/p/stud',
      },
      {
        title: 'Home Depot item with insecure link',
        source: 'The Home Depot',
        price: '$3.10',
        link: 'http://www.homedepot.com/p/insecure',
      },
      {
        title: 'Other retailer',
        source: 'Other',
        price: '$1.00',
        link: 'https://other.example/stud',
      },
    ] });
    expect(offers.map((o) => [o.price, o.link])).toEqual([
      [3.1, null],
      [4.5, 'https://www.homedepot.com/p/stud'],
    ]);
  });
});
