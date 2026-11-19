import {
  HealthResponseSchema,
  ReadinessResponseSchema,
  type ReadinessResponse,
} from '@fieldline/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { safeReturnTo } from '../modules/auth/index';
import { API_VERSION } from '../version';

/** Liveness and readiness endpoints. Public, unauthenticated, and free of tenant data. */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  // Wake-up hop for hosts that put a sleeping API behind a browser check (Render free plan).
  // While the API sleeps, the web server's /v1 proxy gets a Cloudflare "Just a moment..." 429
  // instead of waking it, so sign-in failed with "Too many requests". The web app now sends the
  // browser itself here as a full-page navigation: the host shows its "waking up" page, starts the
  // API, reloads this URL, and this route sends the browser straight back. `to` is limited to the
  // web app (same allowlist as sign-in returnTo), so this is not an open redirect.
  app.get(
    '/health/wake',
    {
      config: { auth: 'none' },
      schema: {
        tags: ['system'],
        summary: 'Wake the API from a browser, then return to the web app',
        querystring: z.object({ to: z.string().max(1000).optional() }),
      },
    },
    async (request, reply) => {
      const path = safeReturnTo(
        request.query.to,
        app.config.appOrigin,
        app.config.auth.returnToOrigins,
      );
      reply.header('cache-control', 'no-store');
      return reply.redirect(`${app.config.appOrigin}${path}`, 302);
    },
  );

  app.get(
    '/health',
    {
      config: { auth: 'none' },
      schema: {
        tags: ['system'],
        summary: 'Liveness probe',
        response: { 200: HealthResponseSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: 'api',
      version: API_VERSION,
      time: new Date().toISOString(),
    }),
  );

  app.get(
    '/health/ready',
    {
      config: { auth: 'none' },
      schema: {
        tags: ['system'],
        summary: 'Readiness probe (database reachable)',
        response: { 200: ReadinessResponseSchema, 503: ReadinessResponseSchema },
      },
    },
    async (request, reply) => {
      let database: ReadinessResponse['checks'][string] = 'not_configured';
      if (app.hasDatabase) {
        try {
          await app.db.execute(sql`select 1`);
          database = 'ok';
        } catch (error) {
          request.log.warn({ err: error }, 'readiness: database check failed');
          database = 'failed';
        }
      }
      const ready = database === 'ok';
      return reply.status(ready ? 200 : 503).send({
        status: ready ? 'ready' : 'not_ready',
        checks: { database },
      });
    },
  );
};
