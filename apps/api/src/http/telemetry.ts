// AIQ-088 R: OpenTelemetry span per request through the vendor-neutral API. Without an SDK
// registered (no OTEL exporter configured) the API is a no-op, so this costs nothing locally.
// Span attributes are tenant-safe: route template, method, status, correlation id, org id — never
// raw URLs (they may hold signed capabilities), user names, emails or photo data.
import { context, type Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';
import { API_VERSION } from '../version';

export const tracer = trace.getTracer('@fieldline/api', API_VERSION);

declare module 'fastify' {
  interface FastifyRequest {
    otelSpan?: Span;
  }
}

/** Runs fn inside a child span (use around external calls: OIDC, storage, vision, mail). */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.name : 'error' });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function registerTelemetryHooks(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    const route = request.routeOptions.url ?? 'unmatched';
    request.otelSpan = tracer.startSpan(
      `${request.method} ${route}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': request.method,
          'http.route': route,
          'fieldline.correlation_id': request.id,
        },
      },
      context.active(),
    );
  });
  app.addHook('onResponse', async (request, reply) => {
    const span = request.otelSpan;
    if (!span) return;
    span.setAttribute('http.response.status_code', reply.statusCode);
    const orgId = request.auth?.org?.orgId;
    if (orgId) span.setAttribute('fieldline.org_id', orgId);
    if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  });
}
