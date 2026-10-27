// BE-073-API: every error leaves the API as application/problem+json with a stable `code` from the
// contracts error taxonomy, the correlation id, and a retry hint. Zod, Postgres and domain errors
// (GeometryError, PricingError) are mapped here so handlers can simply throw.
import { STATUS_CODES } from 'node:http';
import {
  ERROR_CODES,
  type ErrorCode,
  isErrorCode,
  PROBLEM_CONTENT_TYPE,
  type Problem,
  type ProblemFieldError,
  problemTypeFor,
} from '@fieldline/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';

export interface HttpProblemInit {
  /** Defaults to the taxonomy status for `code`. */
  status?: number;
  code: ErrorCode;
  detail?: string;
  title?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  errors?: ProblemFieldError[];
}

/**
 * Throw from any route or service to return a problem+json response with a stable `code`.
 * The detail is shown to users: never put secrets or another tenant's data in it.
 */
export class HttpProblem extends Error {
  readonly init: HttpProblemInit;

  constructor(init: HttpProblemInit) {
    super(init.detail ?? init.title ?? init.code);
    this.name = 'HttpProblem';
    this.init = init;
  }
}

/** Shorthand: throw problem('not_found'). */
export function problem(code: ErrorCode, detail?: string, extra: Omit<HttpProblemInit, 'code' | 'detail'> = {}) {
  return new HttpProblem({ code, ...(detail !== undefined && { detail }), ...extra });
}

export function buildProblem(request: FastifyRequest, init: HttpProblemInit): Problem {
  const def = ERROR_CODES[init.code];
  const status = init.status ?? def.status;
  return {
    type: problemTypeFor(init.code),
    title: init.title ?? def.title ?? STATUS_CODES[status] ?? 'Error',
    status,
    detail: init.detail ?? def.hint,
    code: init.code,
    correlationId: request.id,
    retryable: init.retryable ?? def.retryable,
    ...(init.retryAfterSeconds !== undefined && { retryAfterSeconds: init.retryAfterSeconds }),
    ...(init.errors !== undefined && { errors: init.errors }),
  };
}

export function sendProblem(request: FastifyRequest, reply: FastifyReply, init: HttpProblemInit) {
  if (init.retryAfterSeconds !== undefined) {
    reply.header('retry-after', String(init.retryAfterSeconds));
  }
  const body = buildProblem(request, init);
  return reply.status(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

interface PgLikeError {
  code: string;
  constraint_name?: string;
  constraint?: string;
}

/** postgres.js errors carry a SQLSTATE `code`; Drizzle wraps them in `cause`. */
export function findPgError(error: unknown): PgLikeError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      typeof current === 'object' &&
      current !== null &&
      'code' in current &&
      typeof (current as { code: unknown }).code === 'string' &&
      /^[0-9A-Z]{5}$/.test((current as { code: string }).code) &&
      ('severity' in current || 'routine' in current || 'severity_local' in current)
    ) {
      return current as PgLikeError;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** SQLSTATE -> taxonomy code (from the schema agent's contract notes). */
export function mapPgError(error: PgLikeError): HttpProblemInit | null {
  switch (error.code) {
    case 'FL001':
    case 'FL002':
      return { code: 'immutable_record' };
    case '23505':
      return { code: 'duplicate' };
    // A missing or cross-tenant reference: report it like a missing record so the response
    // never confirms that another tenant's id exists (BE-078 G).
    case '23503':
      return { code: 'not_found', detail: 'A referenced record does not exist.' };
    case '23514':
    case '23502':
    case '22P02':
      return { code: 'validation_failed', detail: 'A value violates a data rule.' };
    case '42501':
      return { code: 'not_found' };
    case '40001':
    case '40P01':
      return { code: 'conflict', retryable: true, retryAfterSeconds: 1 };
    default:
      return null;
  }
}

/** GeometryError / PricingError (packages) carry a string `.code`. */
function mapDomainError(error: unknown): HttpProblemInit | null {
  if (!(error instanceof Error)) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  if (error.name === 'GeometryError') {
    return { code: 'geometry_invalid', detail: error.message };
  }
  if (error.name === 'PricingError') {
    return {
      code: isErrorCode(code) ? code : 'price_unavailable',
      detail: error.message,
    };
  }
  return null;
}

function zodIssues(error: ZodError, prefix: string): ProblemFieldError[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/** Installs problem+json error and not-found handlers on the root instance. */
export function registerProblemHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, {
      code: 'not_found',
      detail: `No route for ${request.method} ${request.url.split('?')[0]}`,
    }),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpProblem) {
      return sendProblem(request, reply, error.init);
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const context = error.validationContext ?? 'request';
      return sendProblem(request, reply, {
        code: 'validation_failed',
        detail: 'The request does not match the expected schema.',
        errors: error.validation.map((issue) => ({
          path: [context, ...issue.instancePath.split('/').filter(Boolean)].join('.'),
          message: issue.message ?? 'invalid',
          code: issue.keyword,
        })),
      });
    }
    if (error instanceof ZodError) {
      return sendProblem(request, reply, {
        code: 'validation_failed',
        errors: zodIssues(error, 'body'),
      });
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'response failed its own schema');
      return sendProblem(request, reply, { code: 'internal' });
    }
    const pg = findPgError(error);
    if (pg) {
      const mapped = mapPgError(pg);
      if (mapped) {
        request.log.warn({ sqlstate: pg.code, constraint: pg.constraint_name }, 'database rule rejected the request');
        return sendProblem(request, reply, mapped);
      }
    }
    const domain = mapDomainError(error);
    if (domain) return sendProblem(request, reply, domain);

    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      // Details stay in the log (correlated by request id); clients get a generic message.
      request.log.error({ err: error }, 'unhandled error');
      return sendProblem(request, reply, { code: 'internal', status });
    }
    if (status === 429) {
      const retryAfter = Number(reply.getHeader('retry-after'));
      return sendProblem(request, reply, {
        code: 'rate_limited',
        ...(Number.isFinite(retryAfter) && retryAfter > 0 && { retryAfterSeconds: retryAfter }),
      });
    }
    const code: ErrorCode =
      status === 413
        ? 'payload_too_large'
        : status === 415
          ? 'unsupported_media_type'
          : status === 404
            ? 'not_found'
            : status === 405
              ? 'method_not_allowed'
              : 'bad_request';
    return sendProblem(request, reply, { code, status, detail: error.message });
  });
}
