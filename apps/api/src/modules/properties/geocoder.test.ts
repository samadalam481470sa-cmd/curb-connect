// RF-077-QA / ADD-021-QA: geocoder adapters keep honest provenance (attribution, storage rights,
// synthetic flag) and fail as dependency_unavailable instead of inventing results.
import { describe, expect, it } from 'vitest';
import { HttpProblem } from '../../http/problem';
import { EsriGeocoder, FixtureGeocoder, GoogleGeocoder } from './geocoder';

const esriBody = {
  candidates: [
    {
      address: '380 New York St, Redlands, California, 92373',
      location: { x: -117.19, y: 34.05 },
      score: 100,
      attributes: { Addr_type: 'PointAddress', StAddr: '380 New York St', City: 'Redlands', RegionAbbr: 'CA', Postal: '92373', Country: 'USA' },
    },
    { address: 'New York St, Redlands', location: { x: -117.2, y: 34.06 }, score: 80, attributes: { Addr_type: 'StreetName', City: 'Redlands', Country: 'USA' } },
  ],
};

function stub(body: unknown, capture?: (url: string, init?: RequestInit) => void): typeof fetch {
  return (async (url: URL | string, init?: RequestInit) => {
    capture?.(String(url), init);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('EsriGeocoder', () => {
  it('maps candidates with Esri attribution; without a key results are search-only (not storable)', async () => {
    let seen = '';
    const g = new EsriGeocoder(null, stub(esriBody, (u) => (seen = u)));
    const out = await g.search('380 New York St Redlands');
    expect(seen).not.toContain('forStorage');
    expect(out[0]).toMatchObject({ provider: 'esri', precision: 'rooftop', confidence: 1, storable: false, isSynthetic: false, attribution: expect.stringMatching(/Esri/) });
    expect(out[0]!.address).toMatchObject({ line1: '380 New York St', locality: 'Redlands', region: 'CA', postalCode: '92373' });
    expect(out[1]!.precision).toBe('street');
    // Stable synthetic id so the server can re-verify a picked candidate.
    expect((await g.search('380 New York St Redlands'))[0]!.placeId).toBe(out[0]!.placeId);
  });

  it('with a key requests forStorage and sends the key in a header, not the URL', async () => {
    let seen = '';
    let headers: Record<string, string> = {};
    const g = new EsriGeocoder('test-key-not-real', stub(esriBody, (u, i) => { seen = u; headers = (i?.headers ?? {}) as Record<string, string>; }));
    const out = await g.search('380 New York St');
    expect(seen).toContain('forStorage=true');
    expect(seen).not.toContain('test-key-not-real');
    expect(headers['X-Esri-Authorization']).toBe('Bearer test-key-not-real');
    expect(out[0]!.storable).toBe(true);
  });

  it('an outage is dependency_unavailable, never an invented result', async () => {
    const failing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(new EsriGeocoder(null, failing).search('x y z')).rejects.toBeInstanceOf(HttpProblem);
  });
});

describe('GoogleGeocoder and FixtureGeocoder', () => {
  it('Google results are never storable and use a documented confidence mapping', async () => {
    const g = new GoogleGeocoder('k', stub({ status: 'OK', results: [{ place_id: 'abc', formatted_address: '1 A St, B, CA', geometry: { location: { lat: 1, lng: 2 }, location_type: 'ROOFTOP' }, address_components: [{ long_name: '1', short_name: '1', types: ['street_number'] }, { long_name: 'A St', short_name: 'A St', types: ['route'] }] }] }));
    const [c] = await g.search('1 A St');
    expect(c).toMatchObject({ provider: 'google', placeId: 'google:abc', storable: false, precision: 'rooftop', confidence: 0.9 });
  });

  it('fixture results are always labeled synthetic', async () => {
    const out = await new FixtureGeocoder().search('200 Campus Loop');
    expect(out[0]).toMatchObject({ isSynthetic: true, provider: 'fixture' });
    expect(out[0]!.structures).toHaveLength(2);
    expect(await new FixtureGeocoder().search('Nowhere Lane')).toEqual([]);
  });
});
