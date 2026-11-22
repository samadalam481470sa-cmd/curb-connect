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
