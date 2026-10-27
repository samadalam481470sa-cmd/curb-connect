// BE-073-QA / AIQ-088-QA / LCH-091-QA request pipeline: correlation ids, problem+json mapping,
// same-origin enforcement for unsafe methods, auth rate limiting, log redaction (no tokens, codes,
// signed URLs or cookies), OpenTelemetry spans with tenant-safe attributes, and the OpenAPI document
// covering every platform endpoint.
import { Writable } from 'node:stream';
import { ProblemSchema } from '@fieldline/contracts';
import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { createDatabase } from '../../src/db/client';
import { loggerOptions } from '../../src/logger';
import { NoopScanner } from '../../src/modules/media/processing';
import { call, createCompany, createTestContext, RecordingMail, type TestContext, testConfig } from '../helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx?.close());

describe('BE-073-QA problem+json and correlation ids', () => {
  it('validation errors list field paths and carry the correlation id', async () => {
    const a = await createCompany(ctx);
    const res = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body: { email: 'not-an-email', role: 'wizard' },
      headers: { 'x-request-id': 'corr-validation-0001' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = ProblemSchema.parse(res.json());
    expect(body).toMatchObject({ code: 'validation_failed', correlationId: 'corr-validation-0001', retryable: false });
    expect(body.errors?.map((e) => e.path).sort()).toEqual(['body.email', 'body.role']);
    expect(res.headers['x-request-id']).toBe('corr-validation-0001');
  });

  it('unauthenticated, forbidden and not-found responses use stable codes', async () => {
    const a = await createCompany(ctx, { roles: ['estimator'] });
    expect((await call(ctx, 'GET', '/v1/team/members')).json().code).toBe('unauthenticated');
    expect((await call(ctx, 'GET', '/v1/audit-events', { as: a.as('estimator') })).json().code).toBe('forbidden');
    expect((await call(ctx, 'GET', `/v1/team/members/${crypto.randomUUID()}`, { as: a.owner })).json().code).toBe('not_found');
    const malformed = await call(ctx, 'GET', '/v1/team/members/not-a-uuid', { as: a.owner });
    expect(malformed.statusCode).toBe(400);
    const cursor = await call(ctx, 'GET', '/v1/team/members?cursor=garbage', { as: a.owner });
    expect(cursor.statusCode).toBe(400);
    expect(cursor.json().code).toBe('validation_failed');
  });

  it('paginates with opaque cursors and no duplicates', async () => {
    const a = await createCompany(ctx, { roles: ['estimator', 'reviewer', 'finance', 'read_only'] });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = await call(ctx, 'GET', `/v1/team/members?limit=2${query}`, { as: a.owner });
      expect(page.statusCode).toBe(200);
      seen.push(...(page.json().items as { id: string }[]).map((m) => m.id));
      cursor = page.json().nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});

describe('LCH-091-QA same-origin check for unsafe methods', () => {
  it('rejects a cross-origin POST even with a valid session (CSRF defense in depth)', async () => {
    const a = await createCompany(ctx);
    const evil = await call(ctx, 'POST', '/v1/auth/logout', { as: a.owner, headers: { origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().code).toBe('origin_rejected');
    const site = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body: { email: 'csrf@example.test', role: 'estimator' },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(site.statusCode).toBe(403);
    // The session survived the forged logout.
    expect((await call(ctx, 'GET', '/v1/me', { as: a.owner })).statusCode).toBe(200);
    const ok = await call(ctx, 'POST', '/v1/auth/logout', { as: a.owner, headers: { origin: 'http://localhost:3000' } });
    expect(ok.statusCode).toBe(204);
  });

  it('safe methods are not origin-checked', async () => {
    const res = await call(ctx, 'GET', '/v1/auth/providers', { headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(200);
  });
});

describe('PLT-013-QA rate limiting on auth endpoints', () => {
  it('returns 429 rate_limited with Retry-After once the per-IP budget is spent', async () => {
    const limited = await createTestContext({ env: { AUTH_RATE_LIMIT_PER_MINUTE: '3' } });
    try {
      const codes: number[] = [];
      let last;
      for (let i = 0; i < 5; i += 1) {
        last = await call(limited, 'GET', '/v1/auth/providers');
        codes.push(last.statusCode);
      }
      expect(codes).toEqual([200, 200, 200, 429, 429]);
      expect(last!.headers['content-type']).toContain('application/problem+json');
      expect(last!.json()).toMatchObject({ code: 'rate_limited', retryable: true });
      expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
      // Non-auth routes are not throttled by the auth budget.
      expect((await call(limited, 'GET', '/v1/health')).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('AIQ-088-QA logs never carry tokens, codes, signed URLs or cookies', () => {
  it('redacts query secrets and capability path segments', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const config = testConfig({ LOG_LEVEL: 'info' });
    const db = createDatabase(process.env.TEST_APP_DATABASE_URL as string, { max: 1 });
    const app = await buildApp({
      config,
      database: db,
      logger: { ...(loggerOptions(config) as object), stream },
      mail: new RecordingMail(),
      scanner: new NoopScanner(),
    });
    try {
      await app.ready();
      await app.inject({ method: 'GET', url: '/v1/auth/callback/dev?code=SECRET-CODE-123&state=SECRET-STATE-456' });
      await app.inject({ method: 'GET', url: '/v1/storage/object/SECRET-CAPABILITY-TOKEN.signature' });
      await app.inject({
        method: 'GET',
        url: '/v1/me?email=someone%40example.test',
        headers: { cookie: 'fl_session=SECRET-SESSION-TOKEN', authorization: 'Bearer SECRET-BEARER' },
      });
    } finally {
      await app.close();
      await db.close();
    }
    const all = lines.join('\n');
    expect(lines.length).toBeGreaterThan(3);
    for (const secret of ['SECRET-CODE-123', 'SECRET-STATE-456', 'SECRET-CAPABILITY-TOKEN', 'SECRET-SESSION-TOKEN', 'SECRET-BEARER', 'someone']) {
      expect(all).not.toContain(secret);
    }
    expect(all).toContain('/v1/storage/object/[redacted]');
    expect(all).toContain('code=[redacted]');
    expect(all).toContain('"correlationId"');
  });
});

describe('AIQ-088-QA OpenTelemetry spans', () => {
  it('emits one server span per request with route template, status and org id only', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    provider.register();
    try {
      const a = await createCompany(ctx);
      const res = await call(ctx, 'GET', `/v1/team/members/${a.owner.membershipId}`, {
        as: a.owner,
        headers: { 'x-request-id': 'span-test-0001' },
      });
      expect(res.statusCode).toBe(200);
      const span = exporter.getFinishedSpans().find((s) => s.attributes['fieldline.correlation_id'] === 'span-test-0001');
      expect(span?.name).toBe('GET /v1/team/members/:id');
      expect(span?.attributes).toMatchObject({
        'http.route': '/v1/team/members/:id',
        'http.response.status_code': 200,
        'fieldline.org_id': a.orgId,
      });
      expect(JSON.stringify(span?.attributes)).not.toContain(a.owner.membershipId);
    } finally {
      await provider.shutdown();
      trace.disable();
    }
  });
});

describe('BE-073-QA OpenAPI documents every platform endpoint', () => {
  const EXPECTED: [string, string][] = [
    ['get', '/v1/auth/providers'],
    ['get', '/v1/auth/login/{provider}'],
    ['get', '/v1/auth/link/{provider}'],
    ['get', '/v1/auth/callback/{provider}'],
    ['post', '/v1/auth/logout'],
    ['get', '/v1/me'],
    ['post', '/v1/session/active-org'],
    ['post', '/v1/orgs'],
    ['get', '/v1/orgs'],
    ['get', '/v1/orgs/current'],
    ['patch', '/v1/orgs/current'],
    ['get', '/v1/orgs/current/settings'],
    ['put', '/v1/orgs/current/settings/{section}'],
    ['get', '/v1/orgs/current/settings/revisions'],
    ['get', '/v1/team/members'],
    ['get', '/v1/team/members/{id}'],
    ['patch', '/v1/team/members/{id}'],
    ['post', '/v1/team/members/{id}/deactivate'],
    ['post', '/v1/team/transfer-ownership'],
    ['post', '/v1/team/invitations'],
    ['get', '/v1/team/invitations'],
    ['post', '/v1/team/invitations/{id}/revoke'],
    ['post', '/v1/team/invitations/{id}/resend'],
    ['post', '/v1/invitations/accept'],
    ['get', '/v1/team/delegations'],
    ['post', '/v1/team/delegations'],
    ['post', '/v1/team/delegations/{id}/revoke'],
    ['get', '/v1/flags'],
    ['put', '/v1/flags/{key}'],
    ['get', '/v1/audit-events'],
    ['post', '/v1/media/uploads'],
    ['post', '/v1/media/uploads/{uploadId}/complete'],
    ['get', '/v1/media/{id}'],
    ['get', '/v1/media'],
    ['get', '/v1/media/{id}/content'],
    ['put', '/v1/storage/upload/{token}'],
    ['get', '/v1/storage/object/{token}'],
    ['get', '/v1/notifications'],
    ['post', '/v1/notifications/{id}/read'],
    ['post', '/v1/notifications/read-all'],
    ['get', '/v1/notifications/preferences'],
    ['put', '/v1/notifications/preferences'],
    ['get', '/v1/notifications/delivery-failures'],
    ['post', '/v1/notifications/delivery-failures/{id}/retry'],
    ['get', '/v1/admin/queue'],
    ['get', '/v1/health'],
    ['get', '/v1/health/ready'],
  ];

  it('has a summary, a tag and (for JSON endpoints) a typed 2xx response for each', async () => {
    const res = await call(ctx, 'GET', '/v1/openapi.json');
    const doc = res.json() as {
      paths: Record<string, Record<string, { summary?: string; tags?: string[]; responses?: Record<string, unknown> }>>;
    };
    const binary = new Set(['/v1/media/{id}/content', '/v1/storage/object/{token}', '/v1/auth/login/{provider}', '/v1/auth/link/{provider}', '/v1/auth/callback/{provider}']);
    for (const [method, path] of EXPECTED) {
      const op = doc.paths[path]?.[method];
      expect(op, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(op?.summary, `${method} ${path} summary`).toBeTruthy();
      expect(op?.tags?.length, `${method} ${path} tags`).toBeGreaterThan(0);
      if (!binary.has(path)) {
        const codes = Object.keys(op?.responses ?? {});
        expect(codes.some((c) => c.startsWith('2')), `${method} ${path} 2xx schema`).toBe(true);
      }
    }
  });
});

describe('BE-078-QA platform admin skeleton is invisible to everyone else', () => {
  it('returns 404 to a company owner', async () => {
    const a = await createCompany(ctx);
    const res = await call(ctx, 'GET', '/v1/admin/queue', { as: a.owner });
    expect(res.statusCode).toBe(404);
  });

  it('serves queue depth and dead letters to listed platform staff', async () => {
    const a = await createCompany(ctx);
    const staff = await createTestContext({ env: { PLATFORM_ADMIN_USER_IDS: a.owner.userId } });
    try {
      const res = await call(staff, 'GET', '/v1/admin/queue', { as: a.owner });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ pending: expect.any(Number), locked: expect.any(Number), deadLetters: expect.any(Array) });
    } finally {
      await staff.close();
    }
  });
});
