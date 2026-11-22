import { describe, expect, it, vi } from 'vitest';
import { lookupNearbyTrades } from './nearby-trades';

const overpass = {
  elements: [
    { type: 'node', id: 1, lat: 32.95, lon: -96.89, tags: { name: 'Acme Roofing', craft: 'roofer', phone: '+1 972-555-0100' } },
    { type: 'way', id: 2, center: { lat: 33.0, lon: -96.9 }, tags: { name: 'Big Box Hardware', shop: 'doityourself', website: 'example.com' } },
    { type: 'node', id: 3, lat: 32.95, lon: -96.89, tags: { craft: 'plumber' } },
    { type: 'node', id: 4, lat: 32.951, lon: -96.891, tags: { name: 'Acme Roofing', craft: 'roofer' } },
  ],
};

describe('nearby trades', () => {
  it('reads, deduplicates and sorts mapped companies, and caches the answer', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(overpass), { status: 200 }));
    const point = { lat: 32.95, lon: -96.89, radiusKm: 25 };
    const res = await lookupNearbyTrades(point, fetcher as unknown as typeof fetch, 1);
    expect(res.status).toBe('found');
    expect(res.companies.map((c) => c.name)).toEqual(['Acme Roofing', 'Big Box Hardware']);
    expect(res.companies[0]).toMatchObject({ trade: 'roofer', phone: '+1 972-555-0100', distanceKm: 0 });
    expect(res.companies[1]).toMatchObject({ trade: 'hardware_store', website: 'https://example.com/' });
    await lookupNearbyTrades(point, fetcher as unknown as typeof fetch, 2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('says so when the map service fails', async () => {
    const fetcher = vi.fn(async () => new Response('busy', { status: 429 }));
    const res = await lookupNearbyTrades({ lat: 10, lon: 10, radiusKm: 5 }, fetcher as unknown as typeof fetch);
    expect(res.status).toBe('upstream_unavailable');
    expect(res.companies).toEqual([]);
  });
});

describe('Google Places merge (optional key)', () => {
  it('adds Google firms for the chosen trade, skipping names already found on the map', async () => {
    const { lookupNearbyTradesAll } = await import('./nearby-trades');
    const google = {
      places: [
        { id: 'a', displayName: { text: 'Small Town Roofing LLC' }, formattedAddress: '1 Main St', nationalPhoneNumber: '(214) 555-0101', websiteUri: 'https://example.com', location: { latitude: 32.951, longitude: -96.891 } },
        { id: 'b', displayName: { text: 'Bad Site' }, websiteUri: 'javascript:alert(1)', location: { latitude: 32.952, longitude: -96.892 } },
      ],
    };
    const fetcher = vi.fn(async (url: string | URL) =>
      String(url).includes('googleapis') ? new Response(JSON.stringify(google)) : new Response(JSON.stringify({ elements: [] })),
    );
    const r = await lookupNearbyTradesAll({ lat: 32.95, lon: -96.89, radiusKm: 25, trade: 'roofer' }, 'key', fetcher as unknown as typeof fetch, 1e12);
    expect(r.companies.map((c) => c.name)).toContain('Small Town Roofing LLC');
    expect(r.companies.find((c) => c.name === 'Bad Site')?.website).toBeNull();
    expect(r.attribution).toMatch(/Google/);
    const noKey = await lookupNearbyTradesAll({ lat: 32.95, lon: -96.89, radiusKm: 25, trade: 'roofer' }, undefined, fetcher as unknown as typeof fetch, 2e12);
    expect(noKey.companies.some((c) => c.id.startsWith('g-'))).toBe(false);
  });
});
