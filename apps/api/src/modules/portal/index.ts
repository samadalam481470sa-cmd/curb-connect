import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { jobCustomerUpdates, jobs, organizations, portalTokens } from '../../db/schema';
import { platformTx } from '../../http/context';
import { problem } from '../../http/problem';
import { JOB_STAGES, customerStageLabel, jobStatusTokenHash } from './jobStatus';
import homeownerGallery from './jobsiteHomeownerGallery';

/**
 * `portal` module: Homeowner portal (a non-member principal with its own access rules).
 *
 * POST /v1/portal/job-status: the customer's view of one job, opened from a link the contractor
 * shared. No account: the token is the credential. It returns only what a customer may see (company
 * name, job title and number, stage, customer updates). Unknown, revoked and expired links are the
 * same 404 so a link cannot be probed for existence.
 */
const TokenBody = z.object({ token: z.string().min(20).max(200) });

const StatusResponse = z.object({
  company: z.object({ name: z.string() }),
  job: z.object({
    number: z.string(),
    title: z.string(),
    productLine: z.string(),
    stage: z.string(),
    stageLabel: z.string(),
    completed: z.boolean(),
    stageEnteredAt: z.string(),
    createdAt: z.string(),
  }),
  stages: z.array(z.object({ key: z.string(), label: z.string() })),
  updates: z.array(
    z.object({
      id: z.string(),
      stage: z.string(),
      stageLabel: z.string(),
      message: z.string(),
      createdAt: z.string(),
    }),
  ),
  recipientName: z.string().nullable(),
  expiresAt: z.string(),
});

const portalModule: FastifyPluginAsyncZod = async (app) => {
  await app.register(homeownerGallery);
  app.post(
    '/portal/job-status',
    {
      config: { auth: 'none', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['portal'],
        summary: 'Customer job-status view opened from a shared link (no account)',
        body: TokenBody,
        response: { 200: StatusResponse },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store');
      reply.header('x-robots-tag', 'noindex, nofollow');
      const hash = jobStatusTokenHash(request.body.token);
      const result = await platformTx(request, 'portal.job_status', async (tx) => {
        const now = new Date();
        const [link] = await tx
          .select()
          .from(portalTokens)
          .where(and(eq(portalTokens.tokenHash, hash), eq(portalTokens.scope, 'job')))
          .limit(1);
        if (!link || link.revokedAt || link.expiresAt <= now) return null;
        if (link.maxUses !== null && link.useCount >= link.maxUses) return null;
        // Everything below is scoped to the link's own org and job.
        const [row] = await tx
          .select({ job: jobs, companyName: organizations.displayName })
          .from(jobs)
          .innerJoin(organizations, eq(organizations.id, jobs.orgId))
          .where(
            and(eq(jobs.orgId, link.orgId), eq(jobs.id, link.subjectId), isNull(jobs.deletedAt)),
          )
          .limit(1);
        if (!row || row.job.status === 'cancelled') return null;
        const updates = await tx
          .select()
          .from(jobCustomerUpdates)
          .where(
            and(
              eq(jobCustomerUpdates.orgId, link.orgId),
              eq(jobCustomerUpdates.jobId, link.subjectId),
            ),
          )
          .orderBy(desc(jobCustomerUpdates.createdAt), desc(jobCustomerUpdates.id))
          .limit(200);
        await tx
          .update(portalTokens)
          .set({ lastUsedAt: now, useCount: sql`${portalTokens.useCount} + 1` })
          .where(and(eq(portalTokens.orgId, link.orgId), eq(portalTokens.id, link.id)));
        return { link, row, updates };
      });
      if (!result) throw problem('not_found', 'This job-status link is not valid or has expired.');
      const { link, row, updates } = result;
      return {
        company: { name: row.companyName },
        job: {
          number: row.job.number,
          title: row.job.title,
          productLine: row.job.productLine,
          stage: row.job.stageKey,
          stageLabel: customerStageLabel(row.job.stageKey),
          completed: row.job.stageKey === 'completed',
          stageEnteredAt: row.job.stageEnteredAt.toISOString(),
          createdAt: row.job.createdAt.toISOString(),
        },
        stages: JOB_STAGES.map((key) => ({ key, label: customerStageLabel(key) })),
        updates: updates.map((u) => ({
          id: u.id,
          stage: u.stage,
          stageLabel: customerStageLabel(u.stage),
          message: u.message,
          createdAt: u.createdAt.toISOString(),
        })),
        recipientName: link.recipientName,
        expiresAt: link.expiresAt.toISOString(),
      };
    },
  );
};

export default portalModule;
