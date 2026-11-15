// `reviews` module (RR-033, AIQ-086, COS-212, ADD-036): the human review queue. Tasks are created by
// the owning module (roof submit creates a roof_measurement task); reviewers claim a lease, decide
// with the task revision they saw, and high-complexity work waits for a second, different reviewer.
import { ReviewDecideSchema, ReviewTaskKindSchema, ReviewTaskStatusSchema, UuidSchema } from '@fieldline/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { reviewTasks } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { claimTask, decideTask, lockTask, releaseTask, type ReviewActor, taskDto } from './service';

const IdParams = z.object({ id: UuidSchema });
const TaskDto = z.object({
  id: UuidSchema,
  kind: ReviewTaskKindSchema,
  status: ReviewTaskStatusSchema,
  priority: z.string(),
  subjectType: z.string(),
  subjectId: UuidSchema,
  claimedByMembershipId: UuidSchema.nullable(),
  leaseExpiresAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  overdue: z.boolean(),
  requiresSecondReview: z.boolean(),
  firstReviewerMembershipId: UuidSchema.nullable(),
  secondReviewerMembershipId: UuidSchema.nullable(),
  decision: z.string().nullable(),
  checklist: z.record(z.string(), z.boolean()).nullable(),
  comments: z.string().nullable(),
  completedAt: z.string().nullable(),
  revision: z.number().int(),
  createdAt: z.string(),
});

function actorOf(request: FastifyRequest): ReviewActor {
  const org = requireOrg(request);
  return { orgId: org.orgId, userId: org.userId, membershipId: org.membershipId, now: new Date() };
}

const reviewsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/review-tasks',
    {
      config: { permission: 'review_task:read' },
      schema: {
        tags: ['reviews'],
        summary: 'Review queue, oldest due first (expired leases show as open)',
        querystring: z.object({ kind: ReviewTaskKindSchema.optional(), subjectId: UuidSchema.optional(), includeDone: z.coerce.boolean().default(false), limit: z.coerce.number().int().min(1).max(100).default(50) }),
        response: { 200: z.object({ items: z.array(TaskDto), nextCursor: z.string().nullable() }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const q = request.query;
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(reviewTasks)
          .where(
            and(
              eq(reviewTasks.orgId, org.orgId),
              q.kind ? eq(reviewTasks.kind, q.kind) : undefined,
              q.subjectId ? eq(reviewTasks.subjectId, q.subjectId) : undefined,
              q.includeDone ? undefined : sql`${reviewTasks.status} not in ('completed', 'cancelled')`,
            ),
          )
          .orderBy(sql`${reviewTasks.dueAt} asc nulls last`, asc(reviewTasks.createdAt))
          .limit(q.limit);
        const now = new Date();
        return { items: rows.map((r) => taskDto(r, now)), nextCursor: null };
      });
    },
  );

  app.get(
    '/review-tasks/:id',
    { config: { permission: 'review_task:read' }, schema: { tags: ['reviews'], params: IdParams, response: { 200: TaskDto } } },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [row] = await tx.select().from(reviewTasks).where(and(eq(reviewTasks.orgId, org.orgId), eq(reviewTasks.id, request.params.id)));
        if (!row) throw problem('not_found');
        return taskDto(row);
      });
    },
  );

  app.post(
    '/review-tasks/:id/claim',
    { config: { permission: 'review_task:claim' }, schema: { tags: ['reviews'], summary: `Claim a lease`, params: IdParams, response: { 200: TaskDto } } },
    async (request) => {
      const actor = actorOf(request);
      return tenantTx(request, async (tx) => {
        const row = await claimTask(tx, actor, request.params.id);
        await auditRequest(request, tx, { orgId: actor.orgId, action: 'review_task.claimed', resourceType: 'review_task', resourceId: row.id, after: { leaseExpiresAt: row.leaseExpiresAt } });
        return taskDto(row, actor.now);
      });
    },
  );

  app.post(
    '/review-tasks/:id/release',
    { config: { permission: 'review_task:claim' }, schema: { tags: ['reviews'], params: IdParams, response: { 200: TaskDto } } },
    async (request) => {
      const actor = actorOf(request);
      return tenantTx(request, async (tx) => taskDto(await releaseTask(tx, actor, request.params.id), actor.now));
    },
  );

  app.post(
    '/review-tasks/:id/decide',
    {
      config: { permission: 'review_task:decide' },
      schema: {
        tags: ['reviews'],
        summary: 'Decide a claimed task (expectedRevision required; 409 when your view is stale)',
        params: IdParams,
        body: ReviewDecideSchema,
        response: { 200: z.object({ task: TaskDto, final: z.boolean() }) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      return tenantTx(request, async (tx) => {
        const before = await lockTask(tx, actor.orgId, request.params.id);
        const { task, final } = await decideTask(tx, actor, request.params.id, request.body);
        await auditRequest(request, tx, {
          orgId: actor.orgId,
          action: final ? 'review_task.decided' : 'review_task.first_review_recorded',
          resourceType: 'review_task',
          resourceId: task.id,
          before: { status: before.status, revision: before.revision },
          after: { status: task.status, decision: request.body.decision, checklist: request.body.checklist },
          reason: request.body.comments ?? null,
        });
        return { task: taskDto(task, actor.now), final };
      });
    },
  );
};

export default reviewsModule;
