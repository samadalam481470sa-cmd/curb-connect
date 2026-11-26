import { ContractorMediaJob, ContractorMediaJobs } from '@fieldline/contracts';
import { and, asc, count, desc, eq, exists, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { enterpriseProjects as projects } from '../../db/schema/enterprise';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaProjectGrants as grants,
  enterpriseMediaUploadSessions as uploads,
} from '../../db/schema/enterpriseMedia';
import {
  enterpriseEvidenceAssignments as assignments,
  enterpriseEvidenceReviewDecisions as decisions,
  enterpriseEvidenceReviewTasks as reviews,
  enterpriseEvidenceSubmissions as submissions,
} from '../../db/schema/enterpriseMediaEvidence';
import { enterpriseScheduleTasks as tasks } from '../../db/schema/enterpriseSchedule';
import { organizations } from '../../db/schema/orgs';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { readVerifiedJobsiteOriginal } from '../enterprise/jobsiteMediaOriginal';
import { checkMediaEnabled, MediaProjectParams } from '../enterprise/jobsiteMediaAccess';

const path = '/portal/contractor/jobs';

type Contractor = ReturnType<typeof requireOrg>;

function contractorFor(request: Parameters<typeof requireOrg>[0]) {
  const org = requireOrg(request);
  if (org.role !== 'crew_manager') throw problem('not_found');
  return org;
}

async function companyName(tx: Tx, org: Contractor) {
  await checkMediaEnabled(tx, org.orgId);
  const [company] = await tx
    .select({ name: organizations.displayName })
    .from(organizations)
    .where(eq(organizations.id, org.orgId));
  if (!company) throw problem('not_found');
  return company.name;
}

function contractorTasks(tx: Tx, org: Contractor, projectId?: string) {
  const latest = tx
    .selectDistinctOn([assignments.taskId], {
      taskId: assignments.taskId,
      projectId: assignments.projectId,
      actor: assignments.contractorMembershipId,
      requiredMedia: assignments.minimumMedia,
      active: assignments.active,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.orgId, org.orgId),
        projectId ? eq(assignments.projectId, projectId) : undefined,
      ),
    )
    .orderBy(asc(assignments.taskId), desc(assignments.revision))
    .as('latest_contractor_evidence_assignments');
  const access = tx
    .selectDistinctOn([grants.projectId], { projectId: grants.projectId, active: grants.active })
    .from(grants)
    .where(
      and(
        eq(grants.orgId, org.orgId),
        eq(grants.membershipId, org.membershipId),
        projectId ? eq(grants.projectId, projectId) : undefined,
      ),
    )
    .orderBy(asc(grants.projectId), desc(grants.revision))
    .as('granted_contractor_media_projects');
  return tx
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      startsOn: tasks.startsOn,
      progress: tasks.progressPercent,
      requiredMedia: latest.requiredMedia,
    })
    .from(latest)
    .innerJoin(access, and(eq(access.projectId, latest.projectId), eq(access.active, true)))
    .innerJoin(
      tasks,
      and(
        eq(tasks.orgId, org.orgId),
        eq(tasks.projectId, latest.projectId),
        eq(tasks.id, latest.taskId),
      ),
    )
    .where(and(eq(latest.actor, org.membershipId), eq(latest.active, true)))
    .as('contractor_media_tasks');
}

function uploadStatus(scan: string, video: string | null) {
  if (scan === 'pending') return 'processing' as const;
  if (scan !== 'clean') return 'unavailable' as const;
  if (video === null || video === 'ready') return 'available' as const;
  return video === 'queued' || video === 'processing'
    ? ('processing' as const)
    : ('unavailable' as const);
}

const jobsiteContractorMedia: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'enterprise_media:upload' },
      schema: {
        tags: ['portal'],
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
        response: { 200: ContractorMediaJobs },
      },
    },
    async (request, reply) => {
      const org = contractorFor(request);
      const { limit } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const result = await tenantTx(request, async (tx) => {
        const name = await companyName(tx, org);
        const own = contractorTasks(tx, org);
        const rows = await tx
          .select({
            id: projects.id,
            name: projects.name,
            createdAt: projects.createdAt,
            taskCount: count(own.id),
            completedTaskCount: sql`count(*) filter (where ${own.progress} = 100)`.mapWith(Number),
          })
          .from(own)
          .innerJoin(projects, and(eq(projects.orgId, org.orgId), eq(projects.id, own.projectId)))
          .where(beforeCursor(projects.createdAt, projects.id, cursor))
          .groupBy(projects.id, projects.name, projects.createdAt)
          .orderBy(desc(msTrunc(projects.createdAt)), desc(projects.id))
          .limit(limit + 1);
        const page = pageResult(
          rows,
          limit,
          ({ createdAt, id }) => ({ at: createdAt, id }),
          ({ createdAt: _createdAt, ...job }) => job,
        );
        return { companyName: name, ...page };
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.get(
    path + '/:projectId/media',
    {
      config: { permission: 'enterprise_media:upload' },
      schema: {
        tags: ['portal'],
        params: MediaProjectParams,
        querystring: z.object({ fileCursor: z.string().max(256).optional() }),
        response: { 200: ContractorMediaJob },
      },
    },
    async (request, reply) => {
      const org = contractorFor(request);
      const { projectId } = request.params;
      const fileCursor = decodeCursor(request.query.fileCursor);
      const result = await tenantTx(request, async (tx) => {
        const name = await companyName(tx, org);
        const own = contractorTasks(tx, org, projectId);
        const latest = tx
          .select({
            revision: submissions.revision,
            decision: decisions.decision,
          })
          .from(submissions)
          .innerJoin(
            reviews,
            and(
              eq(reviews.orgId, org.orgId),
              eq(reviews.projectId, projectId),
              eq(reviews.submissionId, submissions.id),
            ),
          )
          .leftJoin(
            decisions,
            and(
              eq(decisions.orgId, org.orgId),
              eq(decisions.projectId, projectId),
              eq(decisions.reviewId, reviews.id),
            ),
          )
          .where(
            and(
              eq(submissions.orgId, org.orgId),
              eq(submissions.projectId, projectId),
              eq(submissions.taskId, own.id),
            ),
          )
          .orderBy(desc(submissions.revision))
          .limit(1)
          .as('contractor_task_evidence');
        const records = await tx
          .select({
            id: own.id,
            title: own.title,
            requiredMedia: own.requiredMedia,
            progress: own.progress,
            projectName: projects.name,
            evidenceRevision: latest.revision,
            decision: latest.decision,
          })
          .from(own)
          .innerJoin(projects, and(eq(projects.orgId, org.orgId), eq(projects.id, own.projectId)))
          .leftJoinLateral(latest, sql`true`)
          .orderBy(asc(own.startsOn), asc(own.title), asc(own.id));
        const projectName = records[0]?.projectName;
        if (!projectName) throw problem('not_found');
        const media = await tx
          .select({
            id: assets.id,
            filename: uploads.filename,
            revision: assets.revision,
            createdAt: assets.createdAt,
            capturedAt: uploads.capturedAt,
            scanState: assets.scanState,
            videoState: assets.videoState,
          })
          .from(uploads)
          .innerJoin(
            assets,
            and(
              eq(assets.orgId, org.orgId),
              eq(assets.projectId, projectId),
              eq(assets.id, uploads.id),
            ),
          )
          .where(
            and(
              eq(uploads.orgId, org.orgId),
              eq(uploads.projectId, projectId),
              eq(uploads.uploaderUserId, org.userId),
              beforeCursor(assets.createdAt, assets.id, fileCursor),
            ),
          )
          .orderBy(desc(msTrunc(assets.createdAt)), desc(assets.id))
          .limit(51);
        const page = pageResult(
          media,
          50,
          ({ createdAt, id }) => ({ at: createdAt, id }),
          ({ capturedAt, createdAt: _createdAt, scanState, videoState, ...item }) => ({
            ...item,
            capturedAt: capturedAt.toISOString(),
            kind: videoState === null ? ('photo' as const) : ('video' as const),
            status: uploadStatus(scanState, videoState),
          }),
        );
        return {
          companyName: name,
          job: {
            id: projectId,
            name: projectName,
            taskCount: records.length,
            completedTaskCount: records.filter(({ progress }) => progress === 100).length,
          },
          tasks: records.map(
            ({ id, title, requiredMedia, progress, evidenceRevision, decision }) => ({
              id,
              title,
              requiredMedia,
              completed: progress === 100,
              evidenceRevision,
              evidenceStatus:
                evidenceRevision === null
                  ? ('unsubmitted' as const)
                  : (decision ?? ('pending' as const)),
            }),
          ),
          files: page.items,
          nextFileCursor: page.nextCursor,
        };
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
  app.get(
    path + '/:projectId/media/files/:assetId',
    {
      config: {
        permission: 'enterprise_media:upload',
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      schema: { tags: ['portal'], params: MediaProjectParams.extend({ assetId: z.uuid() }) },
    },
    async (request, reply) => {
      const org = contractorFor(request);
      const { projectId, assetId } = request.params;
      const original = await tenantTx(request, async (tx) => {
        await checkMediaEnabled(tx, org.orgId);
        const own = contractorTasks(tx, org, projectId);
        const [record] = await tx
          .select({ asset: assets, upload: uploads })
          .from(uploads)
          .innerJoin(
            assets,
            and(
              eq(assets.orgId, uploads.orgId),
              eq(assets.projectId, uploads.projectId),
              eq(assets.id, uploads.id),
            ),
          )
          .where(
            and(
              eq(uploads.orgId, org.orgId),
              eq(uploads.projectId, projectId),
              eq(uploads.uploaderUserId, org.userId),
              eq(uploads.id, assetId),
              exists(tx.select({ id: own.id }).from(own).where(eq(own.projectId, projectId))),
            ),
          )
          .limit(1);
        if (!record) throw problem('not_found');
        const verified = await readVerifiedJobsiteOriginal(
          app.storage,
          record.upload,
          record.asset,
        );
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_media_asset',
          resourceId: assetId,
          action: 'media.original_downloaded',
        });
        return verified;
      });
      return reply
        .type('application/octet-stream')
        .header('content-disposition', 'attachment; filename="' + original.filename + '"')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(original.bytes);
    },
  );
};

export default jobsiteContractorMedia;
