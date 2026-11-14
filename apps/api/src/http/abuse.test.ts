// Automated-enumeration defenses (FBI FLASH, ARTEX agentic intrusion frameworks).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unitTestConfig } from '../../test/support/config';
import { type App, buildApp } from '../app';
import { AbuseGuard } from './abuse';

describe('AbuseGuard', () => {
  it('blocks an actor after the failure threshold and releases it after the block', () => {
    let now = 0;
    const guard = new AbuseGuard({
      failureThreshold: 3,
      readAlertThreshold: 100,
      blockMinutes: 1,
      now: () => now,
    });
    expect(guard.recordFailure('a')).toBe('counted');
    expect(guard.recordFailure('a')).toBe('counted');
    expect(guard.recordFailure('a')).toBe('blocked');
    expect(guard.blockedFor('a')).toBe(60);
    expect(guard.blockedFor('b')).toBe(0);
    now = 61_000;
    expect(guard.blockedFor('a')).toBe(0);
  });

  it('resets the failure count each minute', () => {
    let now = 0;
    const guard = new AbuseGuard({
      failureThreshold: 3,
      readAlertThreshold: 100,
      blockMinutes: 1,
      now: () => now,
    });
    guard.recordFailure('a');
    guard.recordFailure('a');
    now = 60_000;
    expect(guard.recordFailure('a')).toBe('counted');
  });

  it('alerts once when distinct record reads cross the threshold', () => {
    const guard = new AbuseGuard({ failureThreshold: 100, readAlertThreshold: 3, blockMinutes: 1 });
    expect(guard.recordRead('a', 'r1')).toBe('counted');
    expect(guard.recordRead('a', 'r1')).toBe('counted');
    expect(guard.recordRead('a', 'r2')).toBe('counted');
    expect(guard.recordRead('a', 'r3')).toBe('alert');
    expect(guard.recordRead('a', 'r4')).toBe('counted');
  });
});

describe('enumeration through the HTTP stack', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({
      config: unitTestConfig({ ABUSE_FAILURE_THRESHOLD: '5', ABUSE_BLOCK_MINUTES: '1' }),
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 after repeated not-found probes from one client', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({ method: 'GET', url: `/v1/no-such-route/${i}` });
      expect(res.statusCode).toBe(404);
    }
    const blocked = await app.inject({ method: 'GET', url: '/v1/no-such-route/6' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.json()).toMatchObject({ code: 'rate_limited' });
  });

  it('never blocks health probes', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
  });

  it('keeps other clients unaffected', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/no-such-route/x',
      remoteAddress: '203.0.113.9',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('API docs exposure', () => {
  it('hides /v1/docs and /v1/openapi.json when EXPOSE_API_DOCS=false', async () => {
    const app = await buildApp({
      config: unitTestConfig({ EXPOSE_API_DOCS: 'false' }),
      logger: false,
    });
    await app.ready();
    const spec = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    const docs = await app.inject({ method: 'GET', url: '/v1/docs/' });
    expect(spec.statusCode).toBe(404);
    expect(docs.statusCode).toBe(404);
    await app.close();
  });
});
