// Auto-detect unit tests. The vision hook is always mocked here: no test hits a live model
// or a live imagery server. The estimate gate is tested at the schema boundary: candidate
// output carries confirmed:false and cannot pass the confirm schema without an explicit
// contractorConfirmed:true, so unconfirmed output can never become a revision (and
// estimates price approved versions only).
import { describe, expect, it } from 'vitest';
import {
  AUTO_DETECT_UNAVAILABLE_MESSAGE,
  AutoDetectConfirmRequestSchema,
  AutoDetectResponseSchema,
  autoDetectResponse,
  candidatePlanSqFt,
  detectRoofOutline,
  imageBboxFor,
  parseAutoDetectReply,
  SatelliteImageUnavailable,
  AutoDetectUnavailable,
} from './autoDetect';

const CENTER = { lon: -96.797, lat: 32.7767 };
const BBOX = imageBboxFor(CENTER);

const reply = (facets: unknown) => JSON.stringify({ facets });

function mockFetch(visionReply: string, imageOk = true): typeof fetch {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return (async (url: string) => {
    if (url.includes('arcgisonline.com')) {
      if (!imageOk) return new Response('nope', { status: 503 });
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    }
    if (url.includes('/chat/completions')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: visionReply } }] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

const HOME = { baseUrl: 'http://localhost:11434/v1', apiKey: undefined, model: 'qwen2.5-vl' };

describe('parseAutoDetectReply', () => {
  it('denormalizes 0-1000 image points into lon/lat inside the image bbox', () => {
    const out = parseAutoDetectReply(
      reply([
        {
          label: 'Facet A',
          points: [
            [0, 0],
            [1000, 0],
            [1000, 1000],
            [0, 1000],
          ],
          pitchRise: 6,
          confidence: 0.9,
        },
      ]),
      BBOX,
    );
    expect(out.readable).toBe(true);
    expect(out.facets).toHaveLength(1);
    const f = out.facets[0]!;
    // Top-left image corner maps to the north-west bbox corner.
    expect(f.ring[0]!.lon).toBeCloseTo(BBOX.minLon, 6);
    expect(f.ring[0]!.lat).toBeCloseTo(BBOX.maxLat, 6);
    expect(f.ring[2]!.lon).toBeCloseTo(BBOX.maxLon, 6);
    expect(f.ring[2]!.lat).toBeCloseTo(BBOX.minLat, 6);
    expect(f.pitchRise).toBe(6);
    expect(f.confidence).toBe(0.9);
    expect(f.lowConfidence).toBe(false);
    expect(f.confirmed).toBe(false);
    expect(f.planSqFt).toBeGreaterThan(0);
  });

  it('flags low-confidence facets and defaults a missing confidence to 0.5 (low)', () => {
    const out = parseAutoDetectReply(
      reply([
        { label: 'Shady', points: [[100, 100], [500, 100], [500, 500], [100, 500]], confidence: 0.4 },
        { label: 'Clear', points: [[600, 100], [900, 100], [900, 500], [600, 500]], confidence: 0.8 },
        { label: 'NoScore', points: [[100, 600], [400, 600], [400, 900], [100, 900]] },
      ]),
      BBOX,
    );
    expect(out.facets.map((f) => [f.label, f.lowConfidence, f.confidence])).toEqual([
      ['Shady', true, 0.4],
      ['Clear', false, 0.8],
      ['NoScore', true, 0.5],
    ]);
  });

  it('keeps a null pitch guess instead of inventing one', () => {
    const out = parseAutoDetectReply(
      reply([{ points: [[100, 100], [500, 100], [500, 500]], pitchRise: null, confidence: 0.7 }]),
      BBOX,
    );
    expect(out.facets[0]!.pitchRise).toBeNull();
  });

  it('drops facets with fewer than 3 distinct corners and warns', () => {
    const out = parseAutoDetectReply(
      reply([
        { points: [[100, 100], [100, 100], [100, 100]], confidence: 0.9 },
        { points: [[100, 100], [500, 100], [500, 500]], confidence: 0.9 },
      ]),
      BBOX,
    );
    expect(out.facets).toHaveLength(1);
    expect(out.warnings.join(' ')).toMatch(/dropped/);
  });

  it('reports an unreadable model reply instead of inventing facets', () => {
    const out = parseAutoDetectReply('not json at all', BBOX);
    expect(out.readable).toBe(false);
    expect(out.facets).toEqual([]);
    const wrongShape = parseAutoDetectReply(JSON.stringify({ nope: true }), BBOX);
    expect(wrongShape.readable).toBe(false);
    expect(wrongShape.facets).toEqual([]);
  });
});

describe('candidatePlanSqFt', () => {
  it('measures a 20 m square ring at about 4306 sq ft (within tangent-plane error)', () => {
    const dLat = 10 / 111_320;
    const dLon = 10 / (111_320 * Math.cos((32.7767 * Math.PI) / 180));
    const got = candidatePlanSqFt([
      { lon: CENTER.lon - dLon, lat: CENTER.lat - dLat },
      { lon: CENTER.lon + dLon, lat: CENTER.lat - dLat },
      { lon: CENTER.lon + dLon, lat: CENTER.lat + dLat },
      { lon: CENTER.lon - dLon, lat: CENTER.lat + dLat },
    ]);
    // 20 m × 20 m = 400 m² ≈ 4305.6 sq ft; the tangent-plane projection is within 1%.
    expect(Math.abs(got - 4305.6) / 4305.6).toBeLessThan(0.01);
  });
});

describe('unconfirmed candidates cannot produce an estimate', () => {
  it('candidate output is always confirmed:false and carries no measurement id', () => {
    const out = parseAutoDetectReply(
      reply([{ points: [[100, 100], [500, 100], [500, 500]], confidence: 0.9 }]),
      BBOX,
    );
    const response = autoDetectResponse({
      available: true,
      model: 'qwen2.5-vl',
      facets: out.facets,
      warnings: [],
      readable: true,
    });
    const parsed = AutoDetectResponseSchema.parse(response);
    expect(parsed.facets.every((f) => f.confirmed === false)).toBe(true);
    expect('measurementId' in parsed).toBe(false);
    expect('versionNumber' in parsed).toBe(false);
  });

  it('the confirm schema rejects candidate facets without contractorConfirmed:true', () => {
    const facets = [
      {
        key: 'auto-1',
        ring: [
          { lon: -96.797, lat: 32.777 },
          { lon: -96.796, lat: 32.777 },
          { lon: -96.796, lat: 32.776 },
        ],
        pitchRise: 6,
        confidence: 0.9,
      },
    ];
    expect(
      AutoDetectConfirmRequestSchema.safeParse({ baseVersionNumber: 1, facets }).success,
    ).toBe(false);
    expect(
      AutoDetectConfirmRequestSchema.safeParse({
        baseVersionNumber: 1,
        facets,
        contractorConfirmed: true,
      }).success,
    ).toBe(true);
    // contractorConfirmed:false is not confirmation either.
    expect(
      AutoDetectConfirmRequestSchema.safeParse({
        baseVersionNumber: 1,
        facets,
        contractorConfirmed: false,
      }).success,
    ).toBe(false);
  });
});

describe('detectRoofOutline (mocked fetch)', () => {
  it('reports unavailable when no AI server is configured, without fetching anything', async () => {
    const calls: string[] = [];
    const spy = (async (url: string) => {
      calls.push(url);
      throw new Error('must not fetch');
    }) as typeof fetch;
    const out = await detectRoofOutline({ homeAi: null, openModel: null }, CENTER, spy);
    expect(out.available).toBe(false);
    expect(calls).toEqual([]);
    expect(autoDetectResponse(out).status).toBe('unavailable');
    expect(autoDetectResponse(out).message).toBe(AUTO_DETECT_UNAVAILABLE_MESSAGE);
  });

  it('returns candidate facets from a mocked vision reply', async () => {
    const out = await detectRoofOutline(
      { homeAi: HOME, openModel: null },
      CENTER,
      mockFetch(
        reply([
          {
            label: 'Facet A',
            points: [[100, 100], [900, 100], [900, 900], [100, 900]],
            pitchRise: 6,
            confidence: 0.85,
          },
        ]),
      ),
    );
    expect(out.available).toBe(true);
    expect(out.model).toBe('qwen2.5-vl');
    expect(out.facets).toHaveLength(1);
    expect(out.facets[0]!.label).toBe('Facet A');
    const response = autoDetectResponse(out);
    expect(response.status).toBe('found');
    expect(response.facets[0]!.planSqFt).toBeGreaterThan(100_000);
  });

  it('returns not_found when the model reads the image but finds no roof', async () => {
    const out = await detectRoofOutline(
      { homeAi: HOME, openModel: null },
      CENTER,
      mockFetch(reply([])),
    );
    expect(autoDetectResponse(out).status).toBe('not_found');
    expect(autoDetectResponse(out).facets).toEqual([]);
  });

  it('throws honestly when satellite imagery cannot be fetched', async () => {
    await expect(
      detectRoofOutline({ homeAi: HOME, openModel: null }, CENTER, mockFetch(reply([]), false)),
    ).rejects.toBeInstanceOf(SatelliteImageUnavailable);
  });

  it('throws honestly when the vision model cannot be reached', async () => {
    const failing = (async (url: string) => {
      if (url.includes('arcgisonline.com')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('down', { status: 500 });
    }) as typeof fetch;
    await expect(
      detectRoofOutline({ homeAi: HOME, openModel: null }, CENTER, failing),
    ).rejects.toBeInstanceOf(AutoDetectUnavailable);
  });
});
