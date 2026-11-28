// `assignments` module (builder operations section): a builder assigns work — a job, a
// purchase order, a task, a bid invitation, a whole house build, or a whole development
// phase — to a contracting company it is connected to in the network. The assignment lands
// in the contractor's account immediately (in-app notification, delivered regardless of
// email), and an email goes out through the existing mailer path when email is connected.
// Until then the assignment records emailState 'not_connected' — never claimed sent. Each
// company owns its mirrored row, written by the `network.assignment` platform operation
// after the connection is verified on both sides. Accepting a house_build or
// development_phase assignment creates a mirrored job in the contractor's account (origin
// 'assignment', linked by assignment_key). Creation lives in services/assignments.ts so
// the land-management assign-build endpoints, bid award and per-task assignment share it.
import {
  AssignmentEmailStatusSchema,
  CreateAssignmentRequestSchema,
  DecideAssignmentRequestSchema,
  WorkAssignmentListSchema,
  WorkAssignmentSchema,
  type AssignmentStatus,
} from '@fieldline/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { workAssignments } from '../../db/schema';
import { platformTx, requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import {
  assignmentDto,
  createMirroredJob,
  createWorkAssignment,
} from '../../services/assignments';
import { emailConfigured, notifyPartnerAdmins, verifyActiveConnection } from '../../services/networkNotify';

const READ = 'assignment:read';
const WRITE = 'assignment:write';

const IdParams = z.object({ id: z.uuid() });

const TRANSITIONS: Record<
  string,
  { to: AssignmentStatus; from: AssignmentStatus[]; bySide: 'assigner' | 'assignee' }
> = {
  accept: { to: 'accepted', from: ['sent'], bySide: 'assignee' },
  decline: { to: 'declined', from: ['sent'], bySide: 'assignee' },
  start: { to: 'in_progress', from: ['accepted'], bySide: 'assignee' },
  complete: { to: 'completed', from: ['in_progress'], bySide: 'assignee' },
  cancel: { to: 'cancelled', from: ['sent', 'accepted'], bySide: 'assigner' },
};

/** Kinds whose accept creates a mirrored job in the assignee's org. */
const MIRRORED_JOB_KINDS = new Set(['house_build', 'development_phase']);

const assignmentsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/assignments/email-status',
    {
      config: { permission: READ },
      schema: {
        tags: ['assignments'],
        summary: 'Whether assignment email can actually go out right now',
        response: { 200: AssignmentEmailStatusSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const connected = emailConfigured(request.server.config);
      return {
        emailConnected: connected,
        message: connected
          ? 'Email is connected: assignment emails go out through the mailer/SMTP when you assign work.'
          : 'Email is not connected yet (the mailer/SMTP setup is outstanding). Assignments still land in the contractor\u2019s account as in-app notifications; the email will go out when email is connected and you re-send it.',
      };
    },
  );

  app.get(
    '/assignments',
    {
      config: { permission: READ },
      schema: {
        tags: ['assignments'],
        summary: 'Work assigned by or to this company, newest first',
        querystring: z.object({
          side: z.enum(['assigner', 'assignee']).optional(),
          status: z
            .enum(['sent', 'accepted', 'declined', 'in_progress', 'completed', 'cancelled'])
            .optional(),
          /** Delta sync: only rows changed since this ISO timestamp. */
          updatedSince: z.string().datetime().optional(),
        }),
        response: { 200: WorkAssignmentListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const since = q.updatedSince ? new Date(q.updatedSince) : null;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(workAssignments)
          .where(
            and(
              eq(workAssignments.orgId, orgId),
              q.side ? eq(workAssignments.side, q.side) : undefined,
              q.status ? eq(workAssignments.status, q.status) : undefined,
              since ? sql`${workAssignments.updatedAt} > ${since}` : undefined,
            ),
          )
          .orderBy(desc(workAssignments.createdAt))
          .limit(200),
      );
      return {
        items: rows.map(assignmentDto),
        deletedIds: [],
        serverTime: new Date().toISOString(),
      };
    },
  );

  app.post(
    '/assignments',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['assignments'],
        summary: 'Assign work to a connected contracting company (in-app now, email when connected)',
        body: CreateAssignmentRequestSchema,
        response: { 201: WorkAssignmentSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      // House builds and development phases carry a server-built snapshot (plan, budget,
      // schedule) — they are created from Land Management so the snapshot comes from the
      // real records, never from a free-form body.
      if (request.body.kind === 'house_build' || request.body.kind === 'development_phase') {
        throw problem(
          'validation_failed',
          'Assign a house build or development phase from Land Management (Assign build on the house or phase) so the plan, budget and schedule snapshot is built from the real records.',
        );
      }
      const assignerRow = await createWorkAssignment(request, {
        orgId: org.orgId,
        userId: org.userId,
        partnerOrgId: request.body.partnerOrgId,
        kind: request.body.kind,
        title: request.body.title,
        description: request.body.description ?? null,
        subjectType: request.body.subjectType ?? null,
        subjectId: request.body.subjectId ?? null,
        dueOn: request.body.dueOn ?? null,
      });
      reply.code(201);
      return assignmentDto(assignerRow);
    },
  );

  app.post(
    '/assignments/:id/decide',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['assignments'],
        summary: 'Accept, decline, start, complete, or cancel an assignment',
        params: IdParams,
        body: DecideAssignmentRequestSchema,
        response: { 200: WorkAssignmentSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const transition = TRANSITIONS[request.body.decision];
      if (!transition) throw problem('validation_failed', 'Unknown decision.');
      const mine = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(workAssignments)
          .where(and(eq(workAssignments.orgId, org.orgId), eq(workAssignments.id, request.params.id)))
          .limit(1);
        return row ?? null;
      });
      if (!mine) throw problem('not_found');
      if (mine.side !== transition.bySide) {
        throw problem(
          'conflict',
          transition.bySide === 'assignee'
            ? 'Only the assigned company can do that on this assignment.'
            : 'Only the assigning company can do that on this assignment.',
        );
      }
      if (!transition.from.includes(mine.status)) {
        throw problem('conflict', `A ${mine.status} assignment cannot move to ${transition.to}.`);
      }
      const now = new Date();
      const updated = await platformTx(request, 'network.assignment', async (tx) => {
        await verifyActiveConnection(tx, org.orgId, mine.partnerOrgId);
        await tx
          .update(workAssignments)
          .set({
            status: transition.to,
            respondedAt: mine.side === 'assignee' ? (mine.respondedAt ?? now) : mine.respondedAt,
            revision: mine.revision + 1,
            updatedAt: now,
          })
          .where(eq(workAssignments.assignmentKey, mine.assignmentKey));
        // Accepting a house build / development phase creates the mirrored job in the
        // assignee's org (this caller's org — accept is assignee-only) and links it on
        // both rows. Idempotent via the (org_id, assignment_key) unique index.
        if (
          request.body.decision === 'accept' &&
          MIRRORED_JOB_KINDS.has(mine.kind) &&
          !mine.mirroredJobId
        ) {
          const mirrored = await createMirroredJob(tx, {
            assigneeOrgId: org.orgId,
            assignment: mine,
          });
          await tx
            .update(workAssignments)
            .set({ mirroredJobId: mirrored.jobId, updatedAt: now })
            .where(eq(workAssignments.assignmentKey, mine.assignmentKey));
        }
        const [mineNow] = await tx
          .select()
          .from(workAssignments)
          .where(and(eq(workAssignments.orgId, org.orgId), eq(workAssignments.id, mine.id)))
          .limit(1);
        await notifyPartnerAdmins(tx, {
          partnerOrgId: mine.partnerOrgId,
          category: 'work_assigned',
          title: `Assignment "${mine.title}" is now ${transition.to}`,
          body: null,
          link: '/assignments',
          subjectType: 'assignment',
          subjectId: mine.id,
          dedupeKey: `assignment:${mine.assignmentKey}:${transition.to}`,
        });
        return mineNow ?? null;
      });
      if (!updated) throw problem('internal');
      await tenantTx(request, (tx) =>
        auditRequest(request, tx, {
          orgId: org.orgId,
          action: `assignment.${request.body.decision}`,
          resourceType: 'work_assignment',
          resourceId: updated.id,
          before: { status: mine.status },
          after: { status: updated.status, mirroredJobId: updated.mirroredJobId },
        }),
      );
      return assignmentDto(updated);
    },
  );

  app.post(
    '/assignments/:id/resend-email',
    {
      config: { permission: WRITE, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['assignments'],
        summary: 'Re-send the assignment email (only queues when email is connected)',
        params: IdParams,
        response: { 200: WorkAssignmentSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const mine = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(workAssignments)
          .where(and(eq(workAssignments.orgId, org.orgId), eq(workAssignments.id, request.params.id)))
          .limit(1);
        return row ?? null;
      });
      if (!mine) throw problem('not_found');
      if (mine.side !== 'assigner') {
        throw problem('conflict', 'Only the assigning company can re-send the assignment email.');
      }
      if (!emailConfigured(request.server.config)) {
        throw problem(
          'dependency_unavailable',
          'Email is not connected yet (the mailer/SMTP setup is outstanding), so the email cannot go out. The in-app notification was already delivered.',
          { retryable: true },
        );
      }
      await tenantTx(request, async (tx) => {
        await tx
          .update(workAssignments)
          .set({ emailState: 'queued', emailNote: null, updatedAt: new Date() })
          .where(and(eq(workAssignments.orgId, org.orgId), eq(workAssignments.id, mine.id)));
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'assignment.email',
          aggregateType: 'work_assignment',
          aggregateId: mine.id,
          payload: { assignmentKey: mine.assignmentKey, assignerUserId: org.userId },
          jobKey: `assignment-email:${mine.assignmentKey}:resend:${Date.now()}`,
        });
      });
      const refreshed = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(workAssignments)
          .where(and(eq(workAssignments.orgId, org.orgId), eq(workAssignments.id, mine.id)))
          .limit(1);
        return row ?? mine;
      });
      return assignmentDto(refreshed);
    },
  );
};

export default assignmentsModule;
