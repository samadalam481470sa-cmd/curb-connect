// Typed fetch client for the Field Pro API (BE-073 conventions). The browser only talks to the web
// origin; Next.js rewrites /v1/* to the API so the httpOnly session cookie stays first-party.
//
// Every call:
//  - sends credentials (the fl_session cookie) and an X-Request-Id correlation id,
//  - adds an Idempotency-Key on POSTs the API requires one for (or one the caller supplies, so an
//    offline retry reuses the original key: PLT-018 S, BE-076),
//  - sends If-Match for optimistic concurrency when a revision is given,
//  - parses application/problem+json into an ApiError that keeps the correlation id for support,
//  - optionally validates the JSON body against a contracts zod schema.
import {
  ERROR_CODES,
  PROBLEM_CONTENT_TYPE,
  ProblemSchema,
  isErrorCode,
  type ErrorCode,
  type Problem,
} from '@fieldline/contracts';
import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * POST paths that must carry an Idempotency-Key (brief: billing/order/estimate/proposal/invoice/
 * payment POSTs), plus org creation and invitation acceptance, which must not double on a retried
 * submit (PLT-014 S, PLT-018 S). Matched against the path without the query string.
 */
const IDEMPOTENT_POST_PATTERNS: readonly RegExp[] = [
  /^\/v1\/orgs$/,
  /^\/v1\/invitations\/accept$/,
  /^\/v1\/team\/invitations$/,
  /^\/v1\/media\/uploads$/,
  /^\/v1\/billing(\/|$)/,
  /^\/v1\/roof\/orders(\/|$)/,
  /^\/v1\/supplier-orders(\/|$)/,
  /\/estimates(\/|$)/,
  /^\/v1\/proposals(\/|$)/,
  /^\/v1\/invoices(\/|$)/,
  /^\/v1\/payments(\/|$)/,
];

export function requiresIdempotencyKey(method: HttpMethod, path: string): boolean {
  if (method !== 'POST') return false;
  const bare = path.split('?')[0] ?? path;
  return IDEMPOTENT_POST_PATTERNS.some((pattern) => pattern.test(bare));
}

export function newIdempotencyKey(): string {
  return `web-${crypto.randomUUID()}`;
}

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

/** Failure kinds the UI distinguishes. `problem` carries the server's problem+json body. */
export type ApiErrorKind = 'problem' | 'network' | 'invalid_response' | 'aborted';

/**
 * Error thrown for every non-2xx response, network failure or contract mismatch. `problem` is
 * always populated (synthesized from the error code table when the server sent none) so screens
 * can show one consistent message, retry hint and correlation id.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly problem: Problem;
  readonly method: HttpMethod;
  readonly path: string;

  constructor(init: { kind: ApiErrorKind; problem: Problem; method: HttpMethod; path: string }) {
    super(init.problem.detail ?? init.problem.title);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.problem.status;
    this.problem = init.problem;
    this.method = init.method;
    this.path = init.path;
  }

  get code(): string {
    return this.problem.code;
  }

  get correlationId(): string {
    return this.problem.correlationId;
  }

  /** Whether repeating the same request (with the same Idempotency-Key) may succeed. */
  get retryable(): boolean {
    return this.kind === 'network' || this.problem.retryable;
  }

  is(code: ErrorCode): boolean {
    return this.problem.code === code;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Safe, tenant-free help text for an error (ERROR_CODES hints never contain tenant data). */
export function errorHint(error: unknown): string {
  if (isApiError(error)) {
    if (error.kind === 'network') return 'You appear to be offline or the server is unreachable.';
    if (isErrorCode(error.code)) return ERROR_CODES[error.code].hint;
    return error.problem.title;
  }
  return 'Something went wrong.';
}

function synthesize(
  code: ErrorCode,
  correlationId: string,
  overrides: Partial<Problem> = {},
): Problem {
  const def = ERROR_CODES[code];
  return {
    type: `about:blank#${code}`,
    title: def.title,
    status: def.status,
    code,
    correlationId,
    retryable: def.retryable,
    ...overrides,
  };
}

function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 412) return 'precondition_failed';
  if (status === 413) return 'payload_too_large';
  if (status === 415) return 'unsupported_media_type';
  if (status === 429) return 'rate_limited';
  if (status === 502 || status === 503 || status === 504) return 'dependency_unavailable';
  if (status >= 500) return 'internal';
  return 'bad_request';
}

export interface ApiRequestOptions<S extends z.ZodType | undefined = undefined> {
  method?: HttpMethod;
  /** JSON body (serialized here) or a raw BodyInit (FormData, Blob) sent as is. */
  body?: unknown;
  /** Validates the JSON response. Omit for 204 responses or when no contract exists yet. */
  schema?: S;
  /** Reuse this key (e.g. from the offline outbox) instead of generating one. */
  idempotencyKey?: string;
  /** Current resource revision for optimistic concurrency (sent as If-Match). */
  ifMatch?: number;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type ApiResult<S> = S extends z.ZodType ? z.output<S> : unknown;

export type AuthFailureReason = 'expired' | 'signed_out' | 'revoked' | 'workspace_required';

export interface ApiClientConfig {
  baseUrl?: string;
  fetch?: typeof fetch;
  /**
   * Called when the session is gone or the membership was revoked, so the app can move to the
   * recovery page and drop cached tenant data (PLT-011 S).
   */
  onAuthFailure?: (reason: AuthFailureReason, error: ApiError) => void;
}

function isRawBody(body: unknown): body is BodyInit {
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    body instanceof ArrayBuffer ||
    typeof body === 'string'
  );
}

function buildUrl(baseUrl: string, path: string, query?: ApiRequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${baseUrl}${path}${qs ? (path.includes('?') ? '&' : '?') + qs : ''}`;
}

export function authFailureReason(error: ApiError): AuthFailureReason | null {
  if (error.kind !== 'problem') return null;
  if (error.is('session_expired')) return 'expired';
  if (error.is('unauthenticated')) return 'signed_out';
  if (error.is('membership_revoked')) return 'revoked';
  if (error.is('workspace_required')) return 'workspace_required';
  return null;
}

export function createApiClient(config: ApiClientConfig = {}) {
  const baseUrl = config.baseUrl ?? '';

  async function request<S extends z.ZodType | undefined = undefined>(
    path: string,
    options: ApiRequestOptions<S> = {},
  ): Promise<ApiResult<S>> {
    const method = options.method ?? 'GET';
    const correlationId = newCorrelationId();
    const headers: Record<string, string> = {
      Accept: `application/json, ${PROBLEM_CONTENT_TYPE}`,
      'X-Request-Id': correlationId,
      ...options.headers,
    };
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      if (isRawBody(options.body)) {
        body = options.body;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.body);
      }
    }
    const idempotencyKey =
      options.idempotencyKey ??
      (requiresIdempotencyKey(method, path) ? newIdempotencyKey() : undefined);
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (options.ifMatch !== undefined) headers['If-Match'] = `"${options.ifMatch}"`;

    const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    let response: Response;
    try {
      response = await fetchImpl(buildUrl(baseUrl, path, options.query), {
        method,
        headers,
        body,
        credentials: 'include',
        cache: 'no-store',
        signal: options.signal,
      });
    } catch (cause) {
      const aborted = cause instanceof DOMException && cause.name === 'AbortError';
      throw new ApiError({
        kind: aborted ? 'aborted' : 'network',
        method,
        path,
        problem: synthesize('dependency_unavailable', correlationId, {
          title: aborted ? 'Request cancelled' : 'Network unavailable',
          detail: aborted ? undefined : 'The request did not reach the server.',
          status: 503,
          retryable: !aborted,
        }),
      });
    }

    const echoedId = response.headers.get('X-Request-Id') ?? correlationId;
    const contentType = response.headers.get('Content-Type') ?? '';

    if (!response.ok) {
      const error = await toApiError(response, contentType, echoedId, method, path);
      const reason = authFailureReason(error);
      if (reason) config.onAuthFailure?.(reason, error);
      throw error;
    }

    if (response.status === 204 || response.status === 205) return undefined as ApiResult<S>;
    if (!contentType.includes('json')) {
      if (options.schema) {
        throw invalidResponse(echoedId, method, path, 'Expected a JSON response.');
      }
      return (await response.text()) as ApiResult<S>;
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw invalidResponse(echoedId, method, path, 'The response was not valid JSON.');
    }
    if (!options.schema) return json as ApiResult<S>;
    const parsed = options.schema.safeParse(json);
    if (!parsed.success) {
      throw invalidResponse(
        echoedId,
        method,
        path,
        'The server response did not match the expected contract.',
      );
    }
    return parsed.data as ApiResult<S>;
  }

  return {
    request,
    get: <S extends z.ZodType | undefined = undefined>(
      path: string,
      options: Omit<ApiRequestOptions<S>, 'method' | 'body'> = {},
    ) => request(path, { ...options, method: 'GET' }),
    post: <S extends z.ZodType | undefined = undefined>(
      path: string,
      body?: unknown,
      options: Omit<ApiRequestOptions<S>, 'method' | 'body'> = {},
    ) => request(path, { ...options, method: 'POST', body }),
    put: <S extends z.ZodType | undefined = undefined>(
      path: string,
      body?: unknown,
      options: Omit<ApiRequestOptions<S>, 'method' | 'body'> = {},
    ) => request(path, { ...options, method: 'PUT', body }),
    patch: <S extends z.ZodType | undefined = undefined>(
      path: string,
      body?: unknown,
      options: Omit<ApiRequestOptions<S>, 'method' | 'body'> = {},
    ) => request(path, { ...options, method: 'PATCH', body }),
    delete: <S extends z.ZodType | undefined = undefined>(
      path: string,
      options: Omit<ApiRequestOptions<S>, 'method' | 'body'> = {},
    ) => request(path, { ...options, method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function invalidResponse(
  correlationId: string,
  method: HttpMethod,
  path: string,
  detail: string,
): ApiError {
  return new ApiError({
    kind: 'invalid_response',
    method,
    path,
    problem: synthesize('internal', correlationId, { title: 'Unexpected response', detail }),
  });
}

async function toApiError(
  response: Response,
  contentType: string,
  correlationId: string,
  method: HttpMethod,
  path: string,
): Promise<ApiError> {
  let problem: Problem | null = null;
  if (contentType.includes('json')) {
    try {
      const parsed = ProblemSchema.safeParse(await response.json());
      if (parsed.success) problem = parsed.data;
    } catch {
      problem = null;
    }
  }
  if (!problem) {
    // A proxy error page, an empty body or a body outside the contract: keep the HTTP status
    // and the correlation id so support can still trace it.
    const code = codeForStatus(response.status);
    problem = synthesize(code, correlationId, { status: response.status });
  } else if (!problem.correlationId) {
    problem = { ...problem, correlationId };
  }
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter && problem.retryAfterSeconds === undefined && /^\d+$/.test(retryAfter)) {
    problem = { ...problem, retryAfterSeconds: Number(retryAfter) };
  }
  return new ApiError({ kind: 'problem', problem, method, path });
}
