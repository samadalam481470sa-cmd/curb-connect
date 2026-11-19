import { describe, expect, it } from 'vitest';
import { GoogleSolarProvider } from './google-solar';
import type { FetchLike } from './types';

const SUCCESS_BODY = {
  name: 'buildings/test-place',
  center: { latitude: 32.7767, longitude: -96.797 },
  boundingBox: {
    sw: { latitude: 32.77, longitude: -96.8 },
    ne: { latitude: 32.78, longitude: -96.79 },
  },
  imageryDate: { year: 2025, month: 3, day: 9 },
  imageryProcessedDate: { year: 2025, month: 4, day: 1 },
  regionCode: 'US',
  postalCode: '75201',
  imageryQuality: 'HIGH',
  solarPotential: {
    maxArrayAreaMeters2: 80.5,
    maxSunshineHoursPerYear: 1500,
    panelCapacityWatts: 400,
    wholeRoofStats: { areaMeters2: 200.25, groundAreaMeters2: 180.5 },
    roofSegmentStats: [
      {
        pitchDegrees: 26.5,
        azimuthDegrees: 180,
        stats: { areaMeters2: 120.5, groundAreaMeters2: 100.25 },
      },
      { pitchDegrees: 20, azimuthDegrees: 90, stats: { areaMeters2: 40 } },
    ],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GoogleSolarProvider', () => {
  it('reports not_configured without a key and never calls the network', async () => {
    let called = false;
    const provider = new GoogleSolarProvider({
      apiKey: '',
      fetch: async () => {
        called = true;
        return jsonResponse({});
      },
    });

    expect(provider.status()).toEqual({
      id: 'google_solar',
      displayName: 'Google Solar API',
      state: 'not_configured',
      reason: 'GOOGLE_SOLAR_API_KEY is not set; Google Solar structured insights are unavailable.',
      capabilities: {
        structuredBuildingInsights: true,
        analysisImagery: false,
        imagerySearch: false,
        contractorUpload: false,
      },
      attribution: 'Google Solar API',
    });

    const result = await provider.findBuildingInsights({ latitude: 32.7767, longitude: -96.797 });
    expect(result).toMatchObject({ ok: false, code: 'not_configured' });
    expect(called).toBe(false);
  });

  it('reports configured and sends the key in a header, never the URL', async () => {
    const calls: { url: URL; init: RequestInit | undefined }[] = [];
    const provider = new GoogleSolarProvider({
      apiKey: 'test-solar-key',
      fetch: async (input, init) => {
        calls.push({ url: new URL(String(input)), init });
        return jsonResponse(SUCCESS_BODY);
      },
    });

    expect(provider.status().state).toBe('configured');
    const result = await provider.findBuildingInsights({
      latitude: 32.7767,
      longitude: -96.797,
    });
    expect(result.ok).toBe(true);

    expect(calls).toHaveLength(1);
    const request = calls[0]!;
    expect(request.url.origin + request.url.pathname).toBe(
      'https://solar.googleapis.com/v1/buildingInsights:findClosest',
    );
    expect(request.url.searchParams.get('location.latitude')).toBe('32.7767');
    expect(request.url.searchParams.get('location.longitude')).toBe('-96.797');
    expect(request.url.searchParams.get('requiredQuality')).toBe('HIGH');
    expect(request.url.toString()).not.toContain('test-solar-key');
    expect((request.init?.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'test-solar-key',
    );
  });

  it('normalizes only the structured insights Google actually returned', async () => {
    const provider = new GoogleSolarProvider({
      apiKey: 'test-solar-key',
      fetch: async () => jsonResponse(SUCCESS_BODY),
    });
    const result = await provider.findBuildingInsights({
      latitude: 32.7767,
      longitude: -96.797,
      requiredQuality: 'MEDIUM',
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toEqual({
      provider: 'google_solar',
      providerBuildingId: 'buildings/test-place',
      center: { latitude: 32.7767, longitude: -96.797 },
      boundingBox: {
        southWest: { latitude: 32.77, longitude: -96.8 },
        northEast: { latitude: 32.78, longitude: -96.79 },
      },
      regionCode: 'US',
      postalCode: '75201',
      imageryDate: '2025-03-09',
      imageryProcessedDate: '2025-04-01',
      imageryQuality: 'HIGH',
      wholeRoofAreaM2: 200.25,
      wholeRoofGroundAreaM2: 180.5,
      maxArrayAreaM2: 80.5,
      maxSunshineHoursPerYear: 1500,
      panelCapacityWatts: 400,
      roofSegments: [
        { pitchDegrees: 26.5, azimuthDegrees: 180, areaM2: 120.5, groundAreaM2: 100.25 },
        { pitchDegrees: 20, azimuthDegrees: 90, areaM2: 40, groundAreaM2: null },
      ],
      dataUse: 'structured_insight_only',
      imageryRights: 'not_granted',
      attribution: 'Google Solar API',
    });
  });

  it('keeps missing optional fields null instead of inventing values', async () => {
    const provider = new GoogleSolarProvider({
      apiKey: 'test-solar-key',
      fetch: async () => jsonResponse({ name: 'buildings/minimal' }),
    });
    const result = await provider.findBuildingInsights({ latitude: 0, longitude: 0 });
    if (!result.ok) throw new Error(result.message);
    expect(result.value.center).toBeNull();
    expect(result.value.imageryDate).toBeNull();
    expect(result.value.imageryQuality).toBeNull();
    expect(result.value.wholeRoofAreaM2).toBeNull();
    expect(result.value.roofSegments).toEqual([]);
    expect(result.value.imageryRights).toBe('not_granted');
  });

  it('rejects invalid coordinates before spending a request', async () => {
    let called = false;
    const provider = new GoogleSolarProvider({
      apiKey: 'test-solar-key',
      fetch: async () => {
        called = true;
        return jsonResponse(SUCCESS_BODY);
      },
    });
    const result = await provider.findBuildingInsights({ latitude: 91, longitude: 0 });
    expect(result).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(called).toBe(false);
  });

  it.each([
    [400, 'invalid_request', false],
    [401, 'unauthorized', false],
    [403, 'unauthorized', false],
    [404, 'not_found', false],
    [429, 'rate_limited', true],
    [500, 'upstream_unavailable', true],
    [503, 'upstream_unavailable', true],
  ] as const)('maps HTTP %i to %s', async (status, code, retryable) => {
    const key = 'super-secret-solar-key';
    const provider = new GoogleSolarProvider({
      apiKey: key,
      fetch: async () => new Response('upstream error body', { status }),
    });
    const result = await provider.findBuildingInsights({ latitude: 1, longitude: 2 });
    expect(result).toMatchObject({ ok: false, code, retryable });
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it('rejects a non-JSON response without exposing its body', async () => {
    const provider = new GoogleSolarProvider({
      apiKey: 'test-solar-key',
      fetch: async () => new Response('<html>error</html>', { status: 200 }),
    });
    const result = await provider.findBuildingInsights({ latitude: 1, longitude: 2 });
    expect(result).toMatchObject({ ok: false, code: 'invalid_response' });
    expect(JSON.stringify(result)).not.toContain('<html>');
  });

  it('rejects insights in an unexpected shape', async () => {
    const provider = new GoogleSolarProvider({
      apiKey: 'test-solar-key',
      fetch: async () => jsonResponse({ center: { latitude: 'north', longitude: -96.7 } }),
    });
    const result = await provider.findBuildingInsights({ latitude: 1, longitude: 2 });
    expect(result).toMatchObject({ ok: false, code: 'invalid_response' });
  });

  it('maps timeouts and network failures to retryable failures', async () => {
    const timeout = new GoogleSolarProvider({
      apiKey: 'test-solar-key',
      fetch: async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      },
    });
    expect(await timeout.findBuildingInsights({ latitude: 1, longitude: 2 })).toMatchObject({
      ok: false,
      code: 'timeout',
      retryable: true,
    });

    const offline = new GoogleSolarProvider({
      apiKey: 'test-solar-key',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as FetchLike,
    });
    expect(await offline.findBuildingInsights({ latitude: 1, longitude: 2 })).toMatchObject({
      ok: false,
      code: 'upstream_unavailable',
      retryable: true,
    });
  });
});
