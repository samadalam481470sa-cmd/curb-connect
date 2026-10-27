import {
  HealthResponseSchema,
  ReadinessResponseSchema,
  type ReadinessResponse,
} from '@fieldline/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { API_VERSION } from '../version';

/** Liveness and readiness endpoints. Public, unauthenticated, and free of tenant data. */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
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
