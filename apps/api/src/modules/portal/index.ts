import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  jobCustomerUpdates,
  jobs,
  organizations,
  portalTokens,
  salesContracts,
  salesOptions,
  salesSelections,
  scheduleTasks,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { platformTx } from '../../http/context';
import { problem } from '../../http/problem';
import { JOB_STAGES, customerStageLabel, jobStatusTokenHash } from './jobStatus';
import homeownerGallery from './jobsiteHomeownerGallery';
import homeownerFinancePortal from './homeownerFinancePortal';
import jobsiteContractorMedia from './jobsiteContractorMedia';

/**
 * `portal` module: Homeowner portal (a non-member principal with its own access rules).
 *
 * POST /v1/portal/job-status: the customer's view of one job, opened from a link the contractor
 * shared. No account: the token is the credential. It returns only what a customer may see (company
 * name, job title and number, stage, customer updates). Unknown, revoked and expired links are the
 * same 404 so a link cannot be probed for existence.
 */
const TokenBody = z.object({ token: z.string().min(20).max(200) });

const Milestone = z.object({
  id: z.string(),
  title: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  progressPercent: z.number(),
  status: z.string(),
});

const DesignOption = z.object({
  id: z.string(),
  category: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceMinor: z.number().nullable(),
  currency: z.string(),
});

const DesignBlock = z.object({
  contract: z
    .object({
      id: z.string(),
      status: z.string(),
      planName: z.string().nullable(),
      basePriceMinor: z.number().nullable(),
      currency: z.string(),
    })
    .nullable(),
  /** Options the buyer has picked (price snapshotted at pick time). */
  selections: z.array(
    z.object({
      optionId: z.string(),
      name: z.string(),
      category: z.string(),
      priceMinor: z.number().nullable(),
      currency: z.string(),
    }),
  ),
  /** The builder's active options catalog the buyer can still pick from. */
  availableOptions: z.array(DesignOption),
  selectionsTotalMinor: z.number(),
});

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
  milestones: z.array(Milestone),
  design: DesignBlock,
  recipientName: z.string().nullable(),
  expiresAt: z.string(),
});

/** Milestones + design selections for the linked job, scoped to the link's org. */
async function loadMilestonesAndDesign(tx: Tx, orgId: string, jobId: string) {
  const milestones = await tx
    .select()
    .from(scheduleTasks)
    .where(and(eq(scheduleTasks.orgId, orgId), eq(scheduleTasks.jobId, jobId)))
    .orderBy(asc(scheduleTasks.sortOrder), asc(scheduleTasks.startsOn))
    .limit(200);
  const [contract] = await tx
    .select()
    .from(salesContracts)
    .where(and(eq(salesContracts.orgId, orgId), eq(salesContracts.jobId, jobId)))
    .orderBy(desc(salesContracts.createdAt))
    .limit(1);
  let selections: { optionId: string; name: string; category: string; priceMinor: number | null; currency: string }[] = [];
  let selectionsTotalMinor = 0;
  if (contract) {
    const picked = await tx
      .select({ selection: salesSelections, option: salesOptions })
      .from(salesSelections)
      .innerJoin(salesOptions, eq(salesOptions.id, salesSelections.optionId))
      .where(eq(salesSelections.contractId, contract.id));
    selections = picked.map((p) => ({
      optionId: p.option.id,
      name: p.option.name,
      category: p.option.category,
      priceMinor: p.selection.priceMinor,
      currency: p.selection.currency,
    }));
    selectionsTotalMinor = picked.reduce((s, p) => s + (p.selection.priceMinor ?? 0), 0);
  }
  const available = contract
    ? await tx
        .select()
        .from(salesOptions)
        .where(and(eq(salesOptions.orgId, orgId), eq(salesOptions.active, true)))
        .orderBy(asc(salesOptions.category), asc(salesOptions.name))
        .limit(200)
    : [];
  return {
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      startsOn: m.startsOn,
      endsOn: m.endsOn,
      progressPercent: m.progressPercent,
      status: m.status,
    })),
    design: {
      contract: contract
        ? {
            id: contract.id,
            status: contract.status,
            planName: contract.planName,
            basePriceMinor: contract.basePriceMinor,
            currency: contract.currency,
          }
        : null,
      selections,
      availableOptions: available.map((o) => ({
        id: o.id,
        category: o.category,
        name: o.name,
        description: o.description,
        priceMinor: o.priceMinor,
        currency: o.currency,
      })),
      selectionsTotalMinor,
    },
  };
}

const portalModule: FastifyPluginAsyncZod = async (app) => {
  await app.register(homeownerGallery);
  await app.register(homeownerFinancePortal);
  await app.register(jobsiteContractorMedia);
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
        const extra = await loadMilestonesAndDesign(tx, link.orgId, link.subjectId);
        await tx
          .update(portalTokens)
          .set({ lastUsedAt: now, useCount: sql`${portalTokens.useCount} + 1` })
          .where(and(eq(portalTokens.orgId, link.orgId), eq(portalTokens.id, link.id)));
        return { link, row, updates, extra };
      });
      if (!result) throw problem('not_found', 'This job-status link is not valid or has expired.');
      const { link, row, updates, extra } = result;
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
        milestones: extra.milestones,
        design: extra.design,
        recipientName: link.recipientName,
        expiresAt: link.expiresAt.toISOString(),
      };
    },
  );

  app.post(
    '/portal/selections',
    {
      config: { auth: 'none', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['portal'],
        summary: 'Buyer self-serve design selection from the job-status link (add or remove)',
        body: TokenBody.extend({
          optionId: z.uuid(),
          action: z.enum(['add', 'remove']),
        }),
        response: { 200: z.object({ design: DesignBlock }) },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store');
      reply.header('x-robots-tag', 'noindex, nofollow');
      const hash = jobStatusTokenHash(request.body.token);
      const result = await platformTx(request, 'portal.selections', async (tx) => {
        const now = new Date();
        const [link] = await tx
          .select()
          .from(portalTokens)
          .where(and(eq(portalTokens.tokenHash, hash), eq(portalTokens.scope, 'job')))
          .limit(1);
        if (!link || link.revokedAt || link.expiresAt <= now) return null;
        if (link.maxUses !== null && link.useCount >= link.maxUses) return null;
        const [contract] = await tx
          .select()
          .from(salesContracts)
          .where(and(eq(salesContracts.orgId, link.orgId), eq(salesContracts.jobId, link.subjectId)))
          .orderBy(desc(salesContracts.createdAt))
          .limit(1);
        if (!contract) return null;
        const [option] = await tx
          .select()
          .from(salesOptions)
          .where(
            and(
              eq(salesOptions.orgId, link.orgId),
              eq(salesOptions.id, request.body.optionId),
              eq(salesOptions.active, true),
            ),
          )
          .limit(1);
        if (!option) return null;
        if (request.body.action === 'add') {
          await tx
            .insert(salesSelections)
            .values({
              orgId: link.orgId,
              contractId: contract.id,
              optionId: option.id,
              priceMinor: option.priceMinor,
              currency: option.currency,
            })
            .onConflictDoNothing();
        } else {
          await tx
            .delete(salesSelections)
            .where(
              and(
                eq(salesSelections.contractId, contract.id),
                eq(salesSelections.optionId, option.id),
              ),
            );
        }
        const extra = await loadMilestonesAndDesign(tx, link.orgId, link.subjectId);
        return extra.design;
      });
      if (!result) throw problem('not_found', 'This job-status link is not valid or has expired.');
      return { design: result };
    },
  );
};

export default portalModule;
