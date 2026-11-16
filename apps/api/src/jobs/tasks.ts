// Worker task handlers (BE-076). Every handler is idempotent: a re-run after a crash between the
// side effect and the acknowledgement must not duplicate anything (checks current state first and
// uses stable provider idempotency keys). The wrapper keeps the outbox row (domain_events) in step:
// dispatched on success, attempts/last_error on failure, `dead` when retries are exhausted, at
// which point the failure also surfaces in the tenant's operational queue.
// Tasks run as fieldline_platform (BYPASSRLS), so EVERY query filters by the payload's orgId.
import { BRAND } from '@fieldline/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { JobHelpers, Task, TaskList } from 'graphile-worker';
import { z } from 'zod';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { type Tx, withPlatform } from '../db/runtime';
import {
  auditEvents,
  domainEvents,
  invitations,
  jobCustomerUpdates,
  jobs,
  memberships,
  notifications,
  organizations,
  portalTokens,
  reviewTasks,
  users,
} from '../db/schema';
import { customerStageLabel, jobStatusUrl } from '../modules/portal/jobStatus';
import { invitationAcceptUrl, unsealSecret } from '../modules/team/service';
import type { MailAdapter } from '../services/mail';
import { JOB_TASKS, type JobTask } from './outbox';

export interface WorkerDeps {
  /** Owner connection; every task transaction runs SET LOCAL ROLE fieldline_platform. */
  platformDb: Database;
  mail: MailAdapter;
  config: AppConfig;
}

const BasePayload = z.object({ eventId: z.uuid(), orgId: z.uuid() }).loose();
type BasePayload = z.infer<typeof BasePayload>;

type Handler = (payload: BasePayload, deps: WorkerDeps, helpers: JobHelpers) => Promise<void>;

function inOrg<T>(deps: WorkerDeps, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withPlatform(deps.platformDb, 'worker.task', null, fn, { orgId, userId: null });
}

// ------------------------------------------------------------------ notification.deliver
const deliverNotification: Handler = async (payload, deps) => {
  const { notificationId } = z.object({ notificationId: z.uuid() }).parse(payload);
  const target = await inOrg(deps, payload.orgId, async (tx) => {
    const [row] = await tx
      .select({ n: notifications, email: users.email, orgName: organizations.displayName })
      .from(notifications)
      .innerJoin(organizations, eq(organizations.id, notifications.orgId))
      .leftJoin(
        memberships,
        and(
          eq(memberships.orgId, notifications.orgId),
          eq(memberships.id, notifications.recipientMembershipId),
        ),
      )
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(notifications.orgId, payload.orgId), eq(notifications.id, notificationId)));
    return row ?? null;
  });
  if (!target) return; // deleted since: nothing to deliver
  if (target.n.deliveryStatus !== 'queued' && target.n.deliveryStatus !== 'failed') return; // already done
  if (!target.email) {
    await inOrg(deps, payload.orgId, (tx) =>
      tx
        .update(notifications)
        .set({ deliveryStatus: 'suppressed', data: { reason: 'no_email_address' } })
        .where(and(eq(notifications.orgId, payload.orgId), eq(notifications.id, notificationId))),
    );
    return;
  }
  const link = target.n.link ? `${deps.config.appOrigin}${target.n.link}` : deps.config.appOrigin;
  const result = await deps.mail.send({
    to: target.email,
    subject: `${target.n.title} - ${target.orgName}`,
    text: `${target.n.body ?? target.n.title}\n\nOpen ${BRAND.name}: ${link}\n`,
    idempotencyKey: `notification-${notificationId}`,
  });
  await inOrg(deps, payload.orgId, (tx) =>
    tx
      .update(notifications)
      .set({
        deliveryStatus: 'sent',
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
      })
      .where(and(eq(notifications.orgId, payload.orgId), eq(notifications.id, notificationId))),
  );
};

// ------------------------------------------------------------------ invitation.send
const sendInvitation: Handler = async (payload, deps) => {
  const p = z
    .object({ invitationId: z.uuid(), revision: z.number().int(), sealedToken: z.string() })
    .parse(payload);
  const inv = await inOrg(deps, payload.orgId, async (tx) => {
    const [row] = await tx
      .select({ i: invitations, orgName: organizations.displayName })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.orgId))
      .where(and(eq(invitations.orgId, payload.orgId), eq(invitations.id, p.invitationId)));
    return row ?? null;
  });
  // Revoked, accepted or re-sent since (newer revision has its own job): skip.
  if (!inv || inv.i.status !== 'pending' || inv.i.revision !== p.revision) return;
  const token = unsealSecret(deps.config.session.secret, p.sealedToken);
  await deps.mail.send({
    to: inv.i.email,
    subject: `You are invited to ${inv.orgName} on ${BRAND.name}`,
    text:
      `You have been invited to join ${inv.orgName} as ${inv.i.role}.\n\n` +
      `Accept: ${invitationAcceptUrl(deps.config.appOrigin, token)}\n\n` +
      `The link expires on ${inv.i.expiresAt.toISOString()}.\n`,
    idempotencyKey: `invitation-${p.invitationId}-r${p.revision}`,
  });
};

// ------------------------------------------------------------------ membership.revoked
/**
 * PLT-015 S: a removed reviewer's claimed tasks go back to the open queue (lease cleared) and any
 * second-review slot they held is released, so nobody can complete a stale approval as them.
 */
const releaseMembershipWork: Handler = async (payload, deps) => {
  const { membershipId } = z.object({ membershipId: z.uuid() }).parse(payload);
  await inOrg(deps, payload.orgId, async (tx) => {
    const [membership] = await tx
      .select({ status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.orgId, payload.orgId), eq(memberships.id, membershipId)));
    if (!membership || membership.status === 'active') return; // reinstated meanwhile
    const claimed = await tx
      .update(reviewTasks)
      .set({
        status: 'open',
        claimedByMembershipId: null,
        leaseExpiresAt: null,
        revision: sql`${reviewTasks.revision} + 1`,
      })
      .where(
        and(
          eq(reviewTasks.orgId, payload.orgId),
          eq(reviewTasks.claimedByMembershipId, membershipId),
          inArray(reviewTasks.status, ['claimed']),
        ),
      )
      .returning({ id: reviewTasks.id });
    const second = await tx
      .update(reviewTasks)
      .set({
        secondReviewerMembershipId: null,
        claimedByMembershipId: null,
        leaseExpiresAt: null,
        revision: sql`${reviewTasks.revision} + 1`,
      })
      .where(
        and(
          eq(reviewTasks.orgId, payload.orgId),
          eq(reviewTasks.status, 'awaiting_second_review'),
          sql`(${reviewTasks.secondReviewerMembershipId} = ${membershipId} or ${reviewTasks.claimedByMembershipId} = ${membershipId})`,
        ),
      )
      .returning({ id: reviewTasks.id });
    for (const task of [...claimed, ...second]) {
      await tx.insert(auditEvents).values({
        orgId: payload.orgId,
        actorType: 'worker',
        actorLabel: 'membership.revoked',
        action: 'review_task.released',
        resourceType: 'review_task',
        resourceId: task.id,
        before: { claimedByMembershipId: membershipId },
        after: { status: 'open' },
        reason: 'Reviewer removed from the company',
        correlationId: null,
      });
    }
  });
};

// ------------------------------------------------------------------ job_status.email
/**
 * Emails a customer their job-status link: when the link is first shared ('shared') and when the
 * contractor posts an update and asks to notify ('update'). Skips links revoked or expired since.
 */
const emailJobStatus: Handler = async (payload, deps) => {
  const p = z
    .object({
      portalTokenId: z.uuid(),
      kind: z.enum(['shared', 'update']),
      updateId: z.uuid().nullable().optional(),
    })
    .parse(payload);
  const found = await inOrg(deps, payload.orgId, async (tx) => {
    const [row] = await tx
      .select({ link: portalTokens, job: jobs, orgName: organizations.displayName })
      .from(portalTokens)
      .innerJoin(jobs, and(eq(jobs.orgId, portalTokens.orgId), eq(jobs.id, portalTokens.subjectId)))
      .innerJoin(organizations, eq(organizations.id, portalTokens.orgId))
      .where(
        and(
          eq(portalTokens.orgId, payload.orgId),
          eq(portalTokens.id, p.portalTokenId),
          eq(portalTokens.scope, 'job'),
        ),
      );
    if (!row) return null;
    const [update] = p.updateId
      ? await tx
          .select()
          .from(jobCustomerUpdates)
          .where(
            and(eq(jobCustomerUpdates.orgId, payload.orgId), eq(jobCustomerUpdates.id, p.updateId)),
          )
      : [];
    return { ...row, update: update ?? null };
  });
  if (!found) return;
  const { link, job, orgName, update } = found;
  if (link.revokedAt || link.expiresAt <= new Date() || !link.recipientEmail || !link.sealedToken)
    return;
  const url = jobStatusUrl(
    deps.config.appOrigin,
    unsealSecret(deps.config.session.secret, link.sealedToken),
  );
  const greeting = link.recipientName ? `Hi ${link.recipientName},` : 'Hello,';
  const stage = customerStageLabel(update?.stage ?? job.stageKey);
  const text =
    p.kind === 'shared'
      ? `${greeting}\n\n${orgName} shared the status of your job "${job.title}" (${job.number}).\n\n` +
        `Current status: ${stage}\n\nTrack it any time: ${url}\n`
      : `${greeting}\n\n${orgName} posted an update on your job "${job.title}" (${job.number}).\n\n` +
        `Status: ${stage}\n${update ? `\n${update.message}\n` : ''}\nSee the full timeline: ${url}\n`;
  await deps.mail.send({
    to: link.recipientEmail,
    subject:
      p.kind === 'shared'
        ? `Track your job with ${orgName}`
        : `Update on your job: ${stage} - ${orgName}`,
    text,
    idempotencyKey: `job-status-${p.portalTokenId}-${p.kind}-${p.updateId ?? 'link'}`,
  });
};

const HANDLERS: Record<JobTask, Handler> = {
  'notification.deliver': deliverNotification,
  'invitation.send': sendInvitation,
  'membership.revoked': releaseMembershipWork,
  'job_status.email': emailJobStatus,
};

async function markEvent(
  deps: WorkerDeps,
  orgId: string,
  eventId: string,
  patch: Partial<typeof domainEvents.$inferInsert>,
): Promise<void> {
  await inOrg(deps, orgId, (tx) =>
    tx
      .update(domainEvents)
      .set(patch)
      .where(and(eq(domainEvents.orgId, orgId), eq(domainEvents.id, eventId))),
  );
}

function wrap(task: JobTask, handler: Handler, deps: WorkerDeps): Task {
  return async (rawPayload, helpers) => {
    const payload = BasePayload.parse(rawPayload);
    try {
      await handler(payload, deps, helpers);
      await markEvent(deps, payload.orgId, payload.eventId, {
        status: 'dispatched',
        dispatchedAt: new Date(),
        attempts: helpers.job.attempts,
        lastError: null,
      });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const exhausted = helpers.job.attempts >= helpers.job.max_attempts;
      await markEvent(deps, payload.orgId, payload.eventId, {
        status: exhausted ? 'dead' : 'failed',
        attempts: helpers.job.attempts,
        lastError: message,
      }).catch(() => undefined);
      if (
        exhausted &&
        task === 'notification.deliver' &&
        typeof payload.notificationId === 'string'
      ) {
        // PLT-020 S: the business transition stays; the failure is visible in the ops queue.
        await inOrg(deps, payload.orgId, (tx) =>
          tx
            .update(notifications)
            .set({ deliveryStatus: 'failed', data: { lastError: message } })
            .where(
              and(
                eq(notifications.orgId, payload.orgId),
                eq(notifications.id, payload.notificationId as string),
              ),
            ),
        ).catch(() => undefined);
      }
      helpers.logger.error(
        `task ${task} failed (attempt ${helpers.job.attempts}/${helpers.job.max_attempts})`,
        {
          eventId: payload.eventId,
        },
      );
      throw error;
    }
  };
}

export function buildTaskList(deps: WorkerDeps): TaskList {
  return Object.fromEntries(
    (Object.keys(JOB_TASKS) as JobTask[]).map((task) => [task, wrap(task, HANDLERS[task], deps)]),
  );
}
