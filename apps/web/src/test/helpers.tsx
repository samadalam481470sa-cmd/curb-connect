// Shared test helpers: a scripted fetch, a fake signed-in member and an app wrapper.
import {
  FEATURE_FLAGS,
  PROBLEM_CONTENT_TYPE,
  permissionsFor,
  problemFor,
  type ErrorCode,
  type FeatureFlagKey,
  type MeResponse,
  type MemberRole,
} from '@fieldline/contracts';
import { ToastProvider } from '@fieldline/ui';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { createApiClient } from '../lib/api';
import { AppProviders } from '../lib/session';

export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';
export const USER_ID = '33333333-3333-4333-8333-333333333333';

export function makeMe(overrides: Partial<MeResponse> & { role?: MemberRole } = {}): MeResponse {
  const role = overrides.role ?? 'owner';
  const { role: _ignored, ...rest } = overrides;
  return {
    user: { id: USER_ID, displayName: 'Dana Field', email: 'dana@example.test', locale: 'en-US' },
    activeOrgId: ORG_A,
    activeRole: role,
    permissions: permissionsFor(role),
    flags: Object.fromEntries(
      Object.entries(FEATURE_FLAGS).map(([k, d]) => [k, d.defaultEnabled]),
    ) as Record<FeatureFlagKey, boolean>,
    memberships: [
      {
        membershipId: '44444444-4444-4444-8444-444444444444',
        orgId: ORG_A,
        orgDisplayName: 'Alder Roofing',
        role,
        status: 'active',
      },
    ],
    session: {
      idleExpiresAt: '2026-10-26T12:00:00.000Z',
      absoluteExpiresAt: '2026-10-27T00:00:00.000Z',
    },
    ...rest,
  };
}

export function withFlags(
  me: MeResponse,
  flags: Partial<Record<FeatureFlagKey, boolean>>,
): MeResponse {
  return { ...me, flags: { ...me.flags, ...flags } };
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
  credentials?: RequestCredentials;
}

type Handler = (req: RecordedRequest) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function problem(code: ErrorCode, correlationId = 'corr-test', detail?: string): Response {
  const body = problemFor(code, correlationId, detail ? { detail } : {});
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: { 'Content-Type': PROBLEM_CONTENT_TYPE, 'X-Request-Id': correlationId },
  });
}

/** fetch stub keyed by "METHOD /path" (query string ignored); unmatched requests return 404. */
export function scriptedFetch(routes: Record<string, Handler | Response>) {
  const calls: RecordedRequest[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    let body: unknown = init.body;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const req: RecordedRequest = { method, url, headers, body, credentials: init.credentials };
    calls.push(req);
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const handler = routes[`${method} ${path}`];
    if (!handler) return problem('not_found');
    return typeof handler === 'function' ? handler(req) : handler.clone();
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export function renderWithApp(
  ui: ReactElement,
  { fetch: fetchImpl, queryClient }: { fetch: typeof fetch; queryClient?: QueryClient },
) {
  const client =
    queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const api = createApiClient({ fetch: fetchImpl });
  const result = render(
    <AppProviders api={api} queryClient={client}>
      <ToastProvider>{ui}</ToastProvider>
    </AppProviders>,
  );
  return { ...result, queryClient: client };
}
