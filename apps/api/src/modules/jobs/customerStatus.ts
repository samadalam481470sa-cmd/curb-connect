// Owner side of customer job-status links: post customer-visible updates (optionally moving the
// stage), share a secret link with the customer, list and revoke links. The customer side is
// POST /v1/portal/job-status in the portal module.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { jobCustomerUpdates, jobEvents, jobs, portalTokens } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import {
  JOB_STAGES,
  JOB_STATUS_LINK_DEFAULT_DAYS,
  JOB_STATUS_LINK_MAX_DAYS,
  customerStageLabel,
  jobStatusTokenHash,
  jobStatusUrl,
  newJobStatusToken,
  type JobStage,
} from '../portal/jobStatus';
import { sealSecret } from '../team/service';

const UUID = z.uuid();
const JobParams = z.object({ id: UUID });
const LinkParams = z.object({ id: UUID, linkId: UUID });
const Stage = z.enum(JOB_STAGES);

const UpdateInput = z.object({
  message: z.string().trim().min(1).max(2000),
  stage: Stage.optional(),
  notifyCustomer: z.boolean().default(true),
});
const LinkInput = z.object({
  recipientName: z.string().trim().max(120).optional(),
  recipientEmail: z.email().max(254).optional(),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(JOB_STATUS_LINK_MAX_DAYS)
    .default(JOB_STATUS_LINK_DEFAULT_DAYS),
  sendEmail: z.boolean().default(true),
});

type JobRow = typeof jobs.$inferSelect;
type LinkRow = typeof portalTokens.$inferSelect;
type UpdateRow = typeof jobCustomerUpdates.$inferSelect;

const updateDto = (u: UpdateRow) => ({
  id: u.id,
  stage: u.stage,
  stageLabel: customerStageLabel(u.stage),
  message: u.message,
  createdAt: u.createdAt.toISOString(),
});

function linkDto(l: LinkRow, now = new Date()) {
  const state = l.revokedAt ? 'revoked' : l.expiresAt <= now ? 'expired' : 'active';
  return {
    id: l.id,
    recipientName: l.recipientName,
    recipientEmail: l.recipientEmail,
    state,
    createdAt: l.createdAt.toISOString(),
    expiresAt: l.expiresAt.toISOString(),
    revokedAt: l.revokedAt?.toISOString() ?? null,
    lastViewedAt: l.lastUsedAt?.toISOString() ?? null,
    viewCount: l.useCount,
  };
}

const jobSummary = (j: JobRow) => ({
  id: j.id,
  number: j.number,
  title: j.title,
  stage: j.stageKey,
  stageLabel: customerStageLabel(j.stageKey),
  status: j.status,
});

async function loadJob(tx: Tx, orgId: string, jobId: string, lock = false): Promise<JobRow> {
  const query = tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)));
  const [row] = lock ? await query.for('update') : await query;
  if (!row || row.deletedAt) throw problem('not_found');
  return row;
}

/** Moves a job's stage with its job_event and audit row; returns the job unchanged when same. */
export async function moveJobStage(
  request: FastifyRequest,
  tx: Tx,
  current: JobRow,
  stage: JobStage,
): Promise<JobRow> {
  const { orgId, userId } = requireOrg(request);
  if (current.status === 'cancelled') throw problem('conflict', 'Cancelled jobs cannot be moved.');
  if (current.stageKey === stage) return current;
  const enteredAt = new Date();
  const [updated] = await tx
    .update(jobs)
    .set({
      stageKey: stage,
      stageEnteredAt: enteredAt,
      status: stage === 'completed' ? 'closed' : 'open',
      closedAt: stage === 'completed' ? enteredAt : null,
      revision: sql`${jobs.revision}+1`,
    })
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, current.id)))
    .returning();
  await tx.insert(jobEvents).values({
    orgId,
    jobId: current.id,
    eventType: 'stage_changed',
    fromStage: current.stageKey,
    toStage: stage,
    actorType: 'user',
    actorUserId: userId,
    correlationId: request.id,
  });
  await auditRequest(request, tx, {
    orgId,
    action: 'job.stage_changed',
    resourceType: 'job',
    resourceId: current.id,
    before: { stage: current.stageKey },
    after: { stage },
  });
  return updated!;
}

function emailEnabled(app: FastifyInstance): boolean {
  return Boolean(app.config.mail.smtpUrl && app.config.mail.from);
}

export const customerStatusRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/jobs/:id/customer-status',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['jobs'],
        params: JobParams,
        summary: 'Customer updates and shared status links for a job',
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store');
      const { orgId } = requireOrg(request);
      const { job, updates, links } = await tenantTx(request, async (tx) => {
        const job = await loadJob(tx, orgId, request.params.id);
        const updates = await tx
          .select()
          .from(jobCustomerUpdates)
          .where(and(eq(jobCustomerUpdates.orgId, orgId), eq(jobCustomerUpdates.jobId, job.id)))
          .orderBy(desc(jobCustomerUpdates.createdAt), desc(jobCustomerUpdates.id))
          .limit(200);
        const links = await tx
          .select()
          .from(portalTokens)
          .where(
            and(
              eq(portalTokens.orgId, orgId),
              eq(portalTokens.scope, 'job'),
              eq(portalTokens.subjectId, job.id),
            ),
          )
          .orderBy(desc(portalTokens.createdAt))
          .limit(50);
        return { job, updates, links };
      });
      return {
        job: jobSummary(job),
        stages: JOB_STAGES.map((key) => ({ key, label: customerStageLabel(key) })),
        updates: updates.map(updateDto),
        links: links.map((l) => linkDto(l)),
        emailEnabled: emailEnabled(app),
      };
    },
  );

  app.post(
    '/jobs/:id/customer-updates',
    {
      config: { permission: 'job:move_stage', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['jobs'],
        params: JobParams,
        body: UpdateInput,
        summary: 'Post a customer-visible update, optionally moving the stage and emailing links',
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        let job = await loadJob(tx, orgId, request.params.id, true);
        if (request.body.stage) job = await moveJobStage(request, tx, job, request.body.stage);
        const [update] = await tx
          .insert(jobCustomerUpdates)
          .values({
            orgId,
            jobId: job.id,
            stage: job.stageKey,
            message: request.body.message,
            createdByUserId: userId,
          })
          .returning();
        if (!update) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'job.customer_update_posted',
          resourceType: 'job',
          resourceId: job.id,
          after: { updateId: update.id, stage: update.stage },
        });
        let emailsQueued = 0;
        if (request.body.notifyCustomer && emailEnabled(app)) {
          const links = await tx
            .select({ id: portalTokens.id })
            .from(portalTokens)
            .where(
              and(
                eq(portalTokens.orgId, orgId),
                eq(portalTokens.scope, 'job'),
                eq(portalTokens.subjectId, job.id),
                sql`${portalTokens.revokedAt} IS NULL`,
                sql`${portalTokens.expiresAt} > now()`,
                sql`${portalTokens.recipientEmail} IS NOT NULL`,
              ),
            );
          for (const link of links) {
            await enqueue(tx, {
              orgId,
              task: 'job_status.email',
              aggregateType: 'portal_token',
              aggregateId: link.id,
              payload: { portalTokenId: link.id, kind: 'update', updateId: update.id },
              correlationId: request.id,
              jobKey: `job_status.email:${link.id}:${update.id}`,
            });
            emailsQueued += 1;
          }
        }
        return { job, update, emailsQueued };
      });
      reply.code(201);
      return {
        job: jobSummary(result.job),
        update: updateDto(result.update),
        emailsQueued: result.emailsQueued,
      };
    },
  );

  app.post(
    '/jobs/:id/customer-links',
    {
      config: { permission: 'job:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['jobs'],
        params: JobParams,
        body: LinkInput,
        summary: 'Create a job-status link for a customer (the URL is returned only here)',
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const token = newJobStatusToken();
      const expiresAt = new Date(Date.now() + request.body.expiresInDays * 86_400_000);
      const recipientName = request.body.recipientName || null;
      const recipientEmail = request.body.recipientEmail?.toLowerCase() || null;
      const result = await tenantTx(request, async (tx) => {
        const job = await loadJob(tx, orgId, request.params.id);
        if (job.status === 'cancelled')
          throw problem('conflict', 'Cancelled jobs cannot be shared with a customer.');
        const [link] = await tx
          .insert(portalTokens)
          .values({
            orgId,
            tokenHash: jobStatusTokenHash(token),
            scope: 'job',
            subjectId: job.id,
            expiresAt,
            createdByUserId: userId,
            recipientName,
            recipientEmail,
            sealedToken: sealSecret(app.config.session.secret, token),
          })
          .returning();
        if (!link) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'job.customer_link_created',
          resourceType: 'job',
          resourceId: job.id,
          after: {
            linkId: link.id,
            expiresAt: expiresAt.toISOString(),
            emailed: Boolean(recipientEmail),
          },
        });
        let emailQueued = false;
        if (recipientEmail && request.body.sendEmail && emailEnabled(app)) {
          await enqueue(tx, {
            orgId,
            task: 'job_status.email',
            aggregateType: 'portal_token',
            aggregateId: link.id,
            payload: { portalTokenId: link.id, kind: 'shared', updateId: null },
            correlationId: request.id,
            jobKey: `job_status.email:${link.id}:shared`,
          });
          emailQueued = true;
        }
        return { link, emailQueued };
      });
      reply.code(201);
      reply.header('cache-control', 'private, no-store');
      return {
        link: linkDto(result.link),
        url: jobStatusUrl(app.config.appOrigin, token),
        emailQueued: result.emailQueued,
      };
    },
  );

  app.post(
    '/jobs/:id/customer-links/:linkId/revoke',
    {
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['jobs'],
        params: LinkParams,
        summary: 'Turn off a job-status link immediately',
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const link = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .update(portalTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(portalTokens.orgId, orgId),
              eq(portalTokens.id, request.params.linkId),
              eq(portalTokens.scope, 'job'),
              eq(portalTokens.subjectId, request.params.id),
              sql`${portalTokens.revokedAt} IS NULL`,
            ),
          )
          .returning();
        if (!row) throw problem('not_found', 'This link does not exist or is already turned off.');
        await auditRequest(request, tx, {
          orgId,
          action: 'job.customer_link_revoked',
          resourceType: 'job',
          resourceId: request.params.id,
          after: { linkId: row.id },
        });
        return row;
      });
      return { link: linkDto(link) };
    },
  );
};
