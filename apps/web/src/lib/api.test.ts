import { MeResponseSchema } from '@fieldline/contracts';
import { describe, expect, it, vi } from 'vitest';
import { json, makeMe, problem, scriptedFetch } from '../test/helpers';
import { ApiError, createApiClient, errorHint, requiresIdempotencyKey } from './api';

describe('api client (BE-073 conventions)', () => {
  it('BE-073-FE: sends credentials, Accept and a correlation id on every request', async () => {
    const { fetch, calls } = scriptedFetch({ 'GET /v1/me': json(makeMe()) });
    const api = createApiClient({ fetch });
    const me = await api.get('/v1/me', { schema: MeResponseSchema });
    expect(me.user.displayName).toBe('Dana Field');
    expect(calls[0]?.credentials).toBe('include');
    expect(calls[0]?.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]?.headers.get('Accept')).toContain('application/problem+json');
  });

  it('BE-073-FE: parses problem+json into ApiError with code, hint and correlation id', async () => {
    const { fetch } = scriptedFetch({
      'POST /v1/team/invitations': problem('forbidden', 'corr-123', 'Estimators cannot invite.'),
    });
    const api = createApiClient({ fetch });
    const error = await api
      .post('/v1/team/invitations', { email: 'a@b.test', role: 'reviewer' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const e = error as ApiError;
    expect(e.kind).toBe('problem');
    expect(e.status).toBe(403);
    expect(e.code).toBe('forbidden');
    expect(e.correlationId).toBe('corr-123');
    expect(e.message).toBe('Estimators cannot invite.');
    expect(e.retryable).toBe(false);
    expect(errorHint(e)).toMatch(/role does not allow/);
  });

  it('BE-073-FE: keeps the echoed correlation id when the error body is not problem+json', async () => {
    const { fetch } = scriptedFetch({
      'GET /v1/dashboard': new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html', 'X-Request-Id': 'proxy-777' },
      }),
    });
    const e = (await createApiClient({ fetch })
      .get('/v1/dashboard')
      .catch((x: unknown) => x)) as ApiError;
    expect(e.code).toBe('dependency_unavailable');
    expect(e.status).toBe(502);
    expect(e.correlationId).toBe('proxy-777');
    expect(e.retryable).toBe(true);
  });

  it('BE-073-FE: reads Retry-After into retryAfterSeconds', async () => {
    const { fetch } = scriptedFetch({
      'GET /v1/search': new Response('', { status: 429, headers: { 'Retry-After': '12' } }),
    });
    const e = (await createApiClient({ fetch })
      .get('/v1/search')
      .catch((x: unknown) => x)) as ApiError;
    expect(e.code).toBe('rate_limited');
    expect(e.problem.retryAfterSeconds).toBe(12);
  });

  it('PLT-018-FE: a network failure is a retryable ApiError of kind network', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    const e = (await createApiClient({ fetch })
      .get('/v1/me')
      .catch((x: unknown) => x)) as ApiError;
    expect(e.kind).toBe('network');
    expect(e.retryable).toBe(true);
    expect(errorHint(e)).toMatch(/offline/);
  });

  it('BE-073-FE: a 2xx body that breaks the contract is rejected, not passed through', async () => {
    const { fetch } = scriptedFetch({ 'GET /v1/me': json({ user: { id: 'nope' } }) });
    const e = (await createApiClient({ fetch })
      .get('/v1/me', { schema: MeResponseSchema })
      .catch((x: unknown) => x)) as ApiError;
    expect(e.kind).toBe('invalid_response');
  });

  it('BE-076-FE: adds an Idempotency-Key to POSTs that need one, and reuses a supplied key', async () => {
    const { fetch, calls } = scriptedFetch({
      'POST /v1/orgs': json({}, 201),
      'POST /v1/proposals': json({}, 201),
      'POST /v1/auth/logout': new Response(null, { status: 204 }),
    });
    const api = createApiClient({ fetch });
    await api.post('/v1/orgs', { a: 1 });
    await api.post('/v1/proposals', { a: 1 }, { idempotencyKey: 'web-fixed-key-1' });
    await api.post('/v1/auth/logout');
    expect(calls[0]?.headers.get('Idempotency-Key')).toMatch(/^web-[0-9a-f-]{36}$/);
    expect(calls[1]?.headers.get('Idempotency-Key')).toBe('web-fixed-key-1');
    expect(calls[2]?.headers.get('Idempotency-Key')).toBeNull();
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
  });

  it('BE-076-FE: idempotent POST matching covers billing, orders, estimates and payments only', () => {
    expect(requiresIdempotencyKey('POST', '/v1/invoices')).toBe(true);
    expect(requiresIdempotencyKey('POST', '/v1/curb/projects/abc/estimates')).toBe(true);
    expect(requiresIdempotencyKey('POST', '/v1/estimates/abc/approve')).toBe(true);
    expect(requiresIdempotencyKey('POST', '/v1/payments?x=1')).toBe(true);
    expect(requiresIdempotencyKey('GET', '/v1/invoices')).toBe(false);
    expect(requiresIdempotencyKey('POST', '/v1/session/active-org')).toBe(false);
  });

  it('BE-073-FE: sends If-Match with the revision for optimistic concurrency', async () => {
    const { fetch, calls } = scriptedFetch({ 'PATCH /v1/orgs/x': json({}) });
    await createApiClient({ fetch }).patch('/v1/orgs/x', { displayName: 'A' }, { ifMatch: 7 });
    expect(calls[0]?.headers.get('If-Match')).toBe('"7"');
  });

  it('PLT-011-FE: reports expired sessions and revoked memberships to onAuthFailure', async () => {
    const onAuthFailure = vi.fn();
    const { fetch } = scriptedFetch({
      'GET /v1/me': problem('session_expired'),
      'GET /v1/team/members': problem('membership_revoked'),
      'GET /v1/jobs': problem('forbidden'),
    });
    const api = createApiClient({ fetch, onAuthFailure });
    await api.get('/v1/me').catch(() => undefined);
    await api.get('/v1/team/members').catch(() => undefined);
    await api.get('/v1/jobs').catch(() => undefined);
    expect(onAuthFailure.mock.calls.map((c) => c[0])).toEqual(['expired', 'revoked']);
  });

  it('returns undefined for 204 responses', async () => {
    const { fetch } = scriptedFetch({
      'POST /v1/auth/logout': new Response(null, { status: 204 }),
    });
    await expect(createApiClient({ fetch }).post('/v1/auth/logout')).resolves.toBeUndefined();
  });
});
