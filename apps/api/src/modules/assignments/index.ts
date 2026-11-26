// `assignments` module (builder operations section): a builder assigns work — a job, a
// purchase order, a task, or a bid invitation — to a contracting company it is connected to
// in the network. The assignment lands in the contractor's account immediately (in-app
// notification, delivered regardless of email), and an email goes out through the existing
// mailer path when email is connected. Until then the assignment records emailState
// 'not_connected' — never claimed sent. Each company owns its mirrored row, written by the
// `network.assignment` platform operation after the connection is verified on both sides.
import { randomUUID } from 'node:crypto';
import {
  AssignmentEmailStatusSchema,
  CreateAssignmentRequestSchema,
  DecideAssignmentRequestSchema,
  WorkAssignmentListSchema,
  WorkAssignmentSchema,
  type AssignmentStatus,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { organizations, workAssignments } from '../../db/schema';
import { platformTx, requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import {
  EMAIL_NOT_CONNECTED_NOTE,
  emailConfigured,
  notifyPartnerAdmins,
  verifyActiveConnection,
} from '../../services/networkNotify';

const READ = 'assignment:read';
const WRITE = 'assignment:write';

const IdParams = z.object({ id: z.uuid() });

type AssignmentRow = typeof workAssignments.$inferSelect;

function assignmentDto(row: AssignmentRow) {
  return {
    id: row.id,
    assignmentKey: row.assignmentKey,
    side: row.side,
    partnerOrgId: row.partnerOrgId,
    partnerDisplayName: row.partnerDisplayName,
    kind: row.kind,
    title: row.title,
    description: row.description,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    status: row.status,
    dueOn: row.dueOn,
    emailState: row.emailState,
    emailSentAt: row.emailSentAt?.toISOString() ?? null,
    emailNote: row.emailNote,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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

const KIND_LABELS: Record<string, string> = {
  job: 'a job',
  purchase_order: 'a purchase order',
  task: 'a task',
  bid_invitation: 'a bid invitation',
};

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
        }),
        response: { 200: WorkAssignmentListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(workAssignments)
          .where(
            and(
              eq(workAssignments.orgId, orgId),
              q.side ? eq(workAssignments.side, q.side) : undefined,
              q.status ? eq(workAssignments.status, q.status) : undefined,
            ),
          )
          .orderBy(desc(workAssignments.createdAt))
          .limit(200),
      );
      return { items: rows.map(assignmentDto) };
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
      const partnerOrgId = request.body.partnerOrgId;
      if (partnerOrgId === org.orgId) {
        throw problem('validation_failed', 'You cannot assign work to your own company.');
      }
      const assignmentKey = randomUUID();
      const emailReady = emailConfigured(request.server.config);

      const assignerRow = await platformTx(request, 'network.assignment', async (tx) => {
        await verifyActiveConnection(tx, org.orgId, partnerOrgId);
        const [me] = await tx
          .select({ displayName: organizations.displayName })
          .from(organizations)
          .where(eq(organizations.id, org.orgId))
          .limit(1);
        const [partner] = await tx
          .select({ displayName: organizations.displayName })
          .from(organizations)
          .where(eq(organizations.id, partnerOrgId))
          .limit(1);
        if (!me || !partner) throw problem('not_found');
        const shared = {
          assignmentKey,
          kind: request.body.kind,
          title: request.body.title,
          description: request.body.description ?? null,
          subjectType: request.body.subjectType ?? null,
          subjectId: request.body.subjectId ?? null,
          status: 'sent' as const,
          dueOn: request.body.dueOn ?? null,
          emailState: emailReady ? ('queued' as const) : ('not_connected' as const),
          emailNote: emailReady ? null : EMAIL_NOT_CONNECTED_NOTE,
        };
        const [assigner] = await tx
          .insert(workAssignments)
          .values({
            ...shared,
            orgId: org.orgId,
            side: 'assigner',
            partnerOrgId,
            partnerDisplayName: partner.displayName,
          })
          .returning();
        if (!assigner) throw problem('internal');
        await tx.insert(workAssignments).values({
          ...shared,
          orgId: partnerOrgId,
          side: 'assignee',
          partnerOrgId: org.orgId,
          partnerDisplayName: me.displayName,
        });
        await notifyPartnerAdmins(tx, {
          partnerOrgId,
          category: 'work_assigned',
          title: `${me.displayName} assigned ${KIND_LABELS[request.body.kind] ?? 'work'} to your company: ${request.body.title}`,
          body: request.body.description ?? null,
          link: '/assignments',
          subjectType: 'assignment',
          subjectId: assigner.id,
          dedupeKey: `assignment:${assignmentKey}`,
        });
        return assigner;
      });

      await tenantTx(request, async (tx) => {
        if (emailReady) {
          await enqueue(tx, {
            orgId: org.orgId,
            task: 'assignment.email',
            aggregateType: 'work_assignment',
            aggregateId: assignerRow.id,
            payload: { assignmentKey, assignerUserId: org.userId },
            jobKey: `assignment-email:${assignmentKey}`,
          });
        }
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'assignment.created',
          resourceType: 'work_assignment',
          resourceId: assignerRow.id,
          after: {
            partnerOrgId,
            kind: request.body.kind,
            emailState: emailReady ? 'queued' : 'not_connected',
          },
        });
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
          after: { status: updated.status },
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
