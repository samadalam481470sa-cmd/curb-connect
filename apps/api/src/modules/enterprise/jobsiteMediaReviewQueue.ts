import { JobsiteMediaReviewQuery, JobsiteMediaReviewQueue } from '@fieldline/contracts';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { enterpriseProjects as projects } from '../../db/schema/enterprise';
import { enterpriseMediaProjectGrants as grants } from '../../db/schema/enterpriseMedia';
import {
  enterpriseEvidenceReviewDecisions as decisions,
  enterpriseEvidenceReviewTasks as reviews,
  enterpriseEvidenceSubmissions as submissions,
} from '../../db/schema/enterpriseMediaEvidence';
import { enterpriseScheduleTasks as tasks } from '../../db/schema/enterpriseSchedule';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { checkMediaEnabled } from './jobsiteMediaAccess';

const jobsiteMediaReviewQueue: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/enterprise/media/review',
    {
      config: { permission: 'review_task:read' },
      schema: {
        tags: ['enterprise'],
        querystring: JobsiteMediaReviewQuery,
        response: { 200: JobsiteMediaReviewQueue },
      },
    },
    async (request, reply) => {
      assertCan(request, 'enterprise_media:read');
      const org = requireOrg(request);
      const { status, limit } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const result = await tenantTx(request, async (tx) => {
        await checkMediaEnabled(tx, org.orgId);
        const latest = tx
          .selectDistinctOn([submissions.taskId], {
            taskId: submissions.taskId,
            projectId: submissions.projectId,
            submissionId: submissions.id,
            submittedAt: submissions.createdAt,
            revision: submissions.revision,
          })
          .from(submissions)
          .where(eq(submissions.orgId, org.orgId))
          .orderBy(asc(submissions.taskId), desc(submissions.revision))
          .as('latest_media_evidence');
        const access = tx
          .selectDistinctOn([grants.projectId], {
            projectId: grants.projectId,
            active: grants.active,
          })
          .from(grants)
          .where(and(eq(grants.orgId, org.orgId), eq(grants.membershipId, org.membershipId)))
          .orderBy(asc(grants.projectId), desc(grants.revision))
          .as('reviewer_project_access');
        const managed = org.permissions.has('enterprise_media:manage_grants');
        const rows = await tx
          .select({
            reviewId: reviews.id,
            projectId: projects.id,
            projectName: projects.name,
            taskId: tasks.id,
            title: tasks.title,
            submissionRevision: latest.revision,
            submittedAt: latest.submittedAt,
            reviewCreatedAt: reviews.createdAt,
            outcome: decisions.decision,
          })
          .from(latest)
          .innerJoin(
            reviews,
            and(
              eq(reviews.orgId, org.orgId),
              eq(reviews.projectId, latest.projectId),
              eq(reviews.taskId, latest.taskId),
              eq(reviews.submissionId, latest.submissionId),
            ),
          )
          .innerJoin(
            projects,
            and(eq(projects.orgId, org.orgId), eq(projects.id, latest.projectId)),
          )
          .innerJoin(
            tasks,
            and(
              eq(tasks.orgId, org.orgId),
              eq(tasks.projectId, projects.id),
              eq(tasks.id, latest.taskId),
            ),
          )
          .leftJoin(
            decisions,
            and(
              eq(decisions.orgId, org.orgId),
              eq(decisions.projectId, projects.id),
              eq(decisions.taskId, tasks.id),
              eq(decisions.reviewId, reviews.id),
            ),
          )
          .leftJoin(access, eq(access.projectId, projects.id))
          .where(
            and(
              managed
                ? undefined
                : and(eq(access.active, true), eq(reviews.reviewerMembershipId, org.membershipId)),
              status === 'pending' ? isNull(decisions.id) : undefined,
              beforeCursor(reviews.createdAt, reviews.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(reviews.createdAt)), desc(reviews.id))
          .limit(limit + 1);

        return pageResult(
          rows,
          limit,
          ({ reviewCreatedAt, reviewId }) => ({ at: reviewCreatedAt, id: reviewId }),
          ({ submittedAt, reviewCreatedAt: _reviewCreatedAt, outcome, ...item }) => ({
            ...item,
            submittedAt: submittedAt.toISOString(),
            status: outcome ?? ('pending' as const),
          }),
        );
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
};

export default jobsiteMediaReviewQueue;
