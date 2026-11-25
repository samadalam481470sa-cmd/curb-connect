// Hail-swath unit + route tests. The live NOAA feeds and any database are never hit here:
// the SPC feed is a stubbed global fetch and stored swaths are fabricated rows. The route
// itself runs on a bare Fastify instance with a stubbed session (the full app's 401 for a
// missing session is covered separately at the bottom with buildApp).
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ERROR_CODES } from '@fieldline/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unitTestConfig } from '../../../test/support/config';
import { buildApp, type App } from '../../app';
import type { AuthContext } from '../../http/auth-context';
import { HttpProblem } from '../../http/problem';
import roofStormsModule from './index';
import { clearHailCache, type HailEvent } from './storms';
import {
  APPROXIMATE_NOTE,
  APPROXIMATE_PATH_BUFFER_MILES,
  buildSwathResponse,
  clusterHailEvents,
  clusterToFeature,
  convexHull,
  MRMS_NOTE,
  MRMS_SOURCE,
  SwathResponseSchema,
  type StoredSwath,
} from './swath';

// Real shape, copied from the live 261122_rpts.csv file (verified 2026-11-24): two 1.00"
// hail rows in Arkansas, ~55 miles apart, so they must NOT cluster together.
const SPC_SAMPLE = [
  'Time,F_Scale,Location,County,State,Lat,Lon,Comments',
  '2117,UNK,1 W Prattsville,ARC053,AR,34.32,-92.56,Dispatch reports relayed to media of large trees down. (LZK)',
  'Time,Speed,Location,County,State,Lat,Lon,Comments',
  '0800,58,2 N Yukon,Canadian,OK,35.53,-97.74,(OUN)',
  'Time,Size,Location,County,State,Lat,Lon,Comments',
  '2105,100,Poyen,ARC053,AR,34.32,-92.64,Quarter size hail report from mPing near Poyen. (LZK)',
  '2257,100,1 NE Warren,ARC011,AR,33.62,-92.06,Media report of a quarter sized hail near Warren. (LZK)',
  '',
].join('\n');

const SPC_QUIET = ['Time,Size,Location,County,State,Lat,Lon,Comments', ''].join('\n');

function makeEvent(overrides: Partial<HailEvent> & { lat: number; lon: number }): HailEvent {
  return {
    id: `spc-test-${overrides.lat}-${overrides.lon}`,
    date: '2026-11-22',
    timeUtc: '21:05',
    magnitudeIn: 1,
    location: 'Test',
    county: 'Test',
    state: 'AR',
    comments: '',
    source: 'NOAA Storm Prediction Center',
    ...overrides,
  };
}

const NOW = new Date('2026-11-25T02:00:00.000Z');

function storedRow(swathDate: string, features: StoredSwath['features']): StoredSwath {
  return { swathDate, features };
}

function mrmsFeature(maxHailIn: number): StoredSwath['features'][number] {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-92.64, 34.32],
          [-92.6, 34.32],
          [-92.6, 34.36],
          [-92.64, 34.36],
          [-92.64, 34.32],
        ],
      ],
    },
    properties: { maxHailIn },
  };
}

describe('clusterHailEvents', () => {
  it('clusters nearby same-day reports and keeps far ones apart', () => {
    const near = makeEvent({ lat: 34.32, lon: -92.64 });
    const near2 = makeEvent({ lat: 34.4, lon: -92.6, timeUtc: '21:20' });
    const far = makeEvent({ lat: 33.62, lon: -92.06, timeUtc: '22:57' });
    const clusters = clusterHailEvents([near, near2, far]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.length).sort()).toEqual([1, 2]);
  });

  it('never clusters reports from different dates', () => {
    const a = makeEvent({ lat: 34.32, lon: -92.64 });
    const b = makeEvent({ lat: 34.33, lon: -92.63, date: '2026-11-23' });
    expect(clusterHailEvents([a, b])).toHaveLength(2);
  });

  it('chains reports through intermediate stops (single linkage)', () => {
    const a = makeEvent({ lat: 34.0, lon: -92.0 });
    const b = makeEvent({ lat: 34.2, lon: -92.0, timeUtc: '21:20' });
    const c = makeEvent({ lat: 34.4, lon: -92.0, timeUtc: '21:40' });
    // a-b ~14 mi, b-c ~14 mi, a-c ~28 mi: one cluster only because b bridges them.
    expect(clusterHailEvents([a, b, c])).toHaveLength(1);
  });
});

describe('convexHull', () => {
  it('returns the outer points of a set, closed by the caller', () => {
    const hull = convexHull([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual([0.5, 0.5]);
  });
});

describe('clusterToFeature', () => {
  it('turns a lone report into a closed buffer circle with its hail size', () => {
    const feature = clusterToFeature([makeEvent({ lat: 34.32, lon: -92.64, magnitudeIn: 1.75 })]);
    expect(feature.geometry.type).toBe('Polygon');
    if (feature.geometry.type !== 'Polygon') throw new Error('expected a Polygon');
    const ring = feature.geometry.coordinates[0]!;
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring.length).toBeGreaterThanOrEqual(10);
    expect(feature.properties.maxHailIn).toBe(1.75);
    // The buffer radius is 5 miles (~0.072 deg lat): the ring must span about that far.
    const lats = ring.map((p) => p[1]!);
    expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(
      (2 * APPROXIMATE_PATH_BUFFER_MILES) / 69,
      2,
    );
  });

  it('takes the largest hail size in a multi-report cluster', () => {
    const feature = clusterToFeature([
      makeEvent({ lat: 34.32, lon: -92.64, magnitudeIn: 1 }),
      makeEvent({ lat: 34.4, lon: -92.6, magnitudeIn: 2.5 }),
    ]);
    expect(feature.properties.maxHailIn).toBe(2.5);
  });
});

describe('buildSwathResponse', () => {
  it('serves a stored MRMS swath with the estimated-size label', () => {
    const res = buildSwathResponse({
      days: 1,
      now: NOW,
      stored: [
        storedRow('2026-11-24', [mrmsFeature(1.61)]),
        storedRow('2026-11-25', [mrmsFeature(2.36), mrmsFeature(1.24)]),
      ],
      feed: null,
    });
    expect(SwathResponseSchema.parse(res)).toEqual(res);
    expect(res).toMatchObject({
      status: 'ok',
      kind: 'mrms_swath',
      source: MRMS_SOURCE,
      date: '2026-11-25',
      thresholdIn: 1,
      eventCount: 3,
      note: MRMS_NOTE,
    });
    expect(res.swath.features).toHaveLength(3);
    expect(res.message).toContain('3 hail swath segment(s)');
  });

  it('drops a stored feature that fails validation instead of breaking the map', () => {
    const bad = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    };
    const res = buildSwathResponse({
      days: 1,
      now: NOW,
      stored: [storedRow('2026-11-25', [mrmsFeature(1), bad as never])],
      feed: null,
    });
    expect(res.swath.features).toHaveLength(1);
    expect(res.eventCount).toBe(1);
  });

  it('reports a checked-but-quiet stored day as ok with an empty swath', () => {
    const res = buildSwathResponse({
      days: 1,
      now: NOW,
      stored: [storedRow('2026-11-25', [])],
      feed: null,
    });
    expect(res).toMatchObject({
      status: 'ok',
      kind: 'mrms_swath',
      eventCount: 0,
      message: 'No hail swath in the selected period.',
      note: MRMS_NOTE,
    });
    expect(res.swath.features).toEqual([]);
  });

  it('falls back to an approximate path from SPC reports when nothing is stored', () => {
    const events = [
      makeEvent({ lat: 34.32, lon: -92.64 }),
      makeEvent({ lat: 33.62, lon: -92.06, timeUtc: '22:57' }),
    ];
    const res = buildSwathResponse({
      days: 1,
      now: NOW,
      stored: [],
      feed: {
        status: 'ok',
        source: 'NOAA Storm Prediction Center',
        checkedAt: NOW.toISOString(),
        daysRequested: 1,
        daysFetched: 1,
        daysFailed: 0,
        message: '2 hail report(s) from the last 1 day(s).',
        events,
      },
    });
    expect(SwathResponseSchema.parse(res)).toEqual(res);
    expect(res).toMatchObject({
      status: 'ok',
      kind: 'approximate_path',
      source: 'NOAA Storm Prediction Center',
      date: '2026-11-22',
      thresholdIn: 1,
      eventCount: 2,
      note: APPROXIMATE_NOTE,
    });
    // Two far-apart reports: two separate path polygons, never points as a path.
    expect(res.swath.features).toHaveLength(2);
    expect(res.swath.features[0]!.geometry.type).toBe('Polygon');
    expect(res.message).toContain('5-mile buffer');
  });

  it('reports a quiet SPC period as ok with an empty swath', () => {
    const res = buildSwathResponse({
      days: 1,
      now: NOW,
      stored: [],
      feed: {
        status: 'ok',
        source: 'NOAA Storm Prediction Center',
        checkedAt: NOW.toISOString(),
        daysRequested: 1,
        daysFetched: 1,
        daysFailed: 0,
        message: '0 hail report(s) from the last 1 day(s).',
        events: [],
      },
    });
    expect(res).toMatchObject({
      status: 'ok',
      kind: 'approximate_path',
      eventCount: 0,
      message: 'No hail swath in the selected period.',
      note: APPROXIMATE_NOTE,
    });
  });

  it('is unavailable — never invented — when storage is empty and the feed is down', () => {
    const res = buildSwathResponse({
      days: 1,
      now: NOW,
      stored: [],
      feed: {
        status: 'unavailable',
        source: 'NOAA Storm Prediction Center',
        checkedAt: NOW.toISOString(),
        daysRequested: 1,
        daysFetched: 0,
        daysFailed: 1,
        message: 'The NOAA Storm Prediction Center report feed could not be reached.',
        events: [],
      },
    });
    expect(res).toMatchObject({
      status: 'unavailable',
      kind: 'approximate_path',
      eventCount: 0,
      note: APPROXIMATE_NOTE,
    });
    expect(res.swath.features).toEqual([]);
    expect(res.message).toContain('could not be reached');
  });
});

// ---------------------------------------------------------------------------
// Route: GET /v1/roof-storms/swath (mocked storage + mocked SPC feed)
// ---------------------------------------------------------------------------

function stubFetch(csv: string) {
  return vi.fn(
    async () => new Response(csv, { status: 200, headers: { 'content-type': 'text/csv' } }),
  );
}

async function buildSwathRouteApp(authenticated: boolean) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // The full app maps HttpProblem to problem+json; mirror just enough of that here so a
  // missing session surfaces as its taxonomy status instead of a bare 500.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpProblem) {
      const status = ERROR_CODES[error.init.code]?.status ?? 500;
      reply.status(status).send({ code: error.init.code, detail: error.message });
      return;
    }
    reply.send(error);
  });
  if (authenticated) {
    app.addHook('onRequest', async (request) => {
      request.auth = {
        sessionId: 'test-session',
        userId: 'test-user',
        user: { id: 'test-user', displayName: 'Test', email: null, locale: 'en' },
        session: {
          idleExpiresAt: new Date(),
          absoluteExpiresAt: new Date(),
          activeOrgId: 'test-org',
        },
        org: {
          orgId: 'test-org',
          orgDisplayName: 'Test Org',
          membershipId: 'test-membership',
          role: 'owner',
          permissions: new Set(['roof_order:read']),
          access: 'trial',
          trialDaysLeft: 7,
        },
        orgUnavailableReason: null,
      } as unknown as AuthContext;
    });
  }
  await app.register(roofStormsModule, { prefix: '/v1' });
  await app.ready();
  return app;
}

describe('GET /v1/roof-storms/swath (mocked storage, mocked SPC feed)', () => {
  beforeEach(() => {
    clearHailCache();
  });

  afterEach(() => {
    clearHailCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to the approximate path when no swath is stored', async () => {
    vi.stubGlobal('fetch', stubFetch(SPC_SAMPLE));
    const app = await buildSwathRouteApp(true);
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/roof-storms/swath?days=1' });
      expect(res.statusCode).toBe(200);
      const body = SwathResponseSchema.parse(res.json());
      expect(body).toMatchObject({
        status: 'ok',
        kind: 'approximate_path',
        source: 'NOAA Storm Prediction Center',
        thresholdIn: 1,
        eventCount: 2,
        note: APPROXIMATE_NOTE,
      });
      expect(body.swath.features).toHaveLength(2);
      expect(body.message).toContain('Approximate hail path');
    } finally {
      await app.close();
    }
  });

  it('defaults to days=1 and answers a quiet day with an empty swath', async () => {
    vi.stubGlobal('fetch', stubFetch(SPC_QUIET));
    const app = await buildSwathRouteApp(true);
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/roof-storms/swath' });
      expect(res.statusCode).toBe(200);
      const body = SwathResponseSchema.parse(res.json());
      expect(body).toMatchObject({
        status: 'ok',
        kind: 'approximate_path',
        eventCount: 0,
        message: 'No hail swath in the selected period.',
      });
      expect(body.swath.features).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('is unavailable when the SPC feed is down and nothing is stored', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 500 })),
    );
    const app = await buildSwathRouteApp(true);
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/roof-storms/swath?days=1' });
      expect(res.statusCode).toBe(200);
      const body = SwathResponseSchema.parse(res.json());
      expect(body.status).toBe('unavailable');
      expect(body.swath.features).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('rejects days outside 1-7', async () => {
    vi.stubGlobal('fetch', stubFetch(SPC_SAMPLE));
    const app = await buildSwathRouteApp(true);
    try {
      expect(
        (await app.inject({ method: 'GET', url: '/v1/roof-storms/swath?days=0' })).statusCode,
      ).toBe(400);
      expect(
        (await app.inject({ method: 'GET', url: '/v1/roof-storms/swath?days=8' })).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('refuses without a session', async () => {
    vi.stubGlobal('fetch', stubFetch(SPC_SAMPLE));
    const app = await buildSwathRouteApp(false);
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/roof-storms/swath?days=1' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('GET /v1/roof-storms/swath in the full app (no database)', () => {
  let app: App;

  beforeEach(async () => {
    app = await buildApp({ config: unitTestConfig(), logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('refuses without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/roof-storms/swath?days=1' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects days outside 1-7 before auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/roof-storms/swath?days=8' });
    expect(res.statusCode).toBe(400);
  });
});
