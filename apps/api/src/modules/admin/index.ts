// `admin` module (skeleton): platform support tools for staff listed in PLATFORM_ADMIN_USER_IDS.
// Read-only for now: queue health and the dead-letter view (BE-076 B). Anyone else gets a 404 so the
// surface is not discoverable. Impersonation, tenant suspension and support notes are deferred.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { platformTx, requireUser } from '../../http/context';
import { problem } from '../../http/problem';

const DeadLetterSchema = z.object({
  id: z.string(),
  task: z.string(),
  orgId: z.string().nullable(),
  eventId: z.string().nullable(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});

const adminModule: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', async (request) => {
    const auth = requireUser(request);
    if (!app.config.auth.platformAdminUserIds.includes(auth.userId)) throw problem('not_found');
  });

  app.get(
    '/admin/queue',
    {
      config: { auth: 'user' },
      schema: {
        tags: ['admin'],
        summary: 'Platform staff: job queue depth and dead letters',
        response: {
          200: z.object({
            pending: z.number().int(),
            locked: z.number().int(),
            deadLetters: z.array(DeadLetterSchema),
          }),
        },
      },
    },
    async (request) =>
      platformTx(request, 'admin.read', async (tx) => {
        const [counts] = (await tx.execute(sql`
          select count(*) filter (where attempts < max_attempts and locked_at is null)::int as pending,
                 count(*) filter (where locked_at is not null)::int as locked
          from graphile_worker._private_jobs`)) as unknown as { pending: number; locked: number }[];
        const dead = (await tx.execute(sql`
          select id::text, task, org_id, event_id, attempts, max_attempts, last_error, created_at
          from fieldline_job_dead_letters order by created_at desc limit 100`)) as unknown as {
          id: string;
          task: string;
          org_id: string | null;
          event_id: string | null;
          attempts: number;
          max_attempts: number;
          last_error: string | null;
          created_at: Date;
        }[];
        return {
          pending: counts?.pending ?? 0,
          locked: counts?.locked ?? 0,
          deadLetters: dead.map((d) => ({
            id: d.id,
            task: d.task,
            orgId: d.org_id,
            eventId: d.event_id,
            attempts: d.attempts,
            maxAttempts: d.max_attempts,
            lastError: d.last_error,
            createdAt: new Date(d.created_at).toISOString(),
          })),
        };
      }),
  );
};

export default adminModule;
