import { BRAND, HealthResponseSchema, ProblemSchema } from '@fieldline/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unitTestConfig } from '../test/support/config';
import { type App, buildApp } from './app';
import { apiModules } from './modules/registry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('buildApp (no database)', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ config: unitTestConfig(), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health returns a schema-valid liveness payload', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(res.json()).status).toBe('ok');
  });

  it('BE-073-API: generates a correlation id and echoes it as X-Request-Id', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('keeps a well-formed caller X-Request-Id but replaces an unsafe one', async () => {
    const kept = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'client-req-0001' },
    });
    expect(kept.headers['x-request-id']).toBe('client-req-0001');

    const replaced = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'bad id\twith spaces' },
    });
    expect(replaced.headers['x-request-id']).toMatch(UUID);
  });

  it('BE-073-API: serves an OpenAPI 3.1 document that includes the health route', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as { openapi: string; info: { title: string }; paths: object };
    expect(doc.openapi).toMatch(/^3\.1\./);
    expect(doc.info.title).toContain(BRAND.name);
    expect(Object.keys(doc.paths)).toContain('/v1/health');
  });

  it('serves the interactive API docs under /v1/docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('BE-073-API: answers unknown routes with problem+json carrying the correlation id', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const problem = ProblemSchema.parse(res.json());
    expect(problem.code).toBe('not_found');
    expect(problem.correlationId).toBe(res.headers['x-request-id']);
    expect(problem.retryable).toBe(false);
  });

  it('reports not_ready (503) when no database is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', checks: { database: 'not_configured' } });
  });

  it('sets baseline security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('registers every module exactly once', () => {
    const names = apiModules.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['auth', 'orgs', 'roof', 'curb', 'admin']));
    expect(names).toHaveLength(31);
  });
});
