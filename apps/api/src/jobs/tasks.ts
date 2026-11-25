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
import { renderToBuffer } from '@fieldline/pdf';
import {
  auditEvents,
  domainEvents,
  invitations,
  invoiceLines,
  invoices,
  jobCustomerUpdates,
  jobs,
  memberships,
  notifications,
  organizations,
  portalTokens,
  reviewTasks,
  users,
} from '../db/schema';
import { createImageryProviders } from '../modules/imagery/providers';
import { runRoofAnalysis } from '../modules/imagery/roof-analysis';
import { scanJobsitePhoto } from '../modules/enterprise/jobsitePhotoScan';
import { ClamdJobsitePhotoScanner } from '../modules/enterprise/jobsitePhotoScanner';
import type { MalwareScanner } from '../modules/media/processing';
import { customerStageLabel, jobStatusUrl } from '../modules/portal/jobStatus';
import { invitationAcceptUrl, unsealSecret } from '../modules/team/service';
import { buildInvoiceEmail } from '../services/invoice-email';
import type { MailAdapter } from '../services/mail';
import { MailerError, type MailerClient } from '../services/mailer-client';
import { createStorage, type StorageAdapter } from '../storage';
import { JOB_TASKS, type JobTask } from './outbox';
import { outreachTasks } from './outreach';
import { permitSourcesTasks } from './permitSources';
import { govOpportunitiesTasks } from './govOpportunities';
import { permitFunnelTasks } from '../modules/permitLeads/funnel/jobs';
import { permitWatchTasks } from './permitWatch';

export interface WorkerDeps {
  /** Owner connection; every task transaction runs SET LOCAL ROLE fieldline_platform. */
  platformDb: Database;
  mail: MailAdapter;
  /** Separate Gmail / Outlook mail server (apps/mailer). */
  mailer: MailerClient;
  config: AppConfig;
  /** Tests can share the app's encrypted object store and scanner fixture. */
  jobsiteMedia?: { storage: StorageAdapter; scanner: MalwareScanner | null };
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

// ------------------------------------------------------------------ invoice.email
/**
 * Emails an issued invoice with its PDF from the issuer's connected Gmail or Outlook, through the
 * mail server. The attempt number is part of the mail server's idempotency key, so a job retried
 * after a crash never sends a second copy, and a superseded attempt (a newer resend) does nothing.
 * Only `retry` outcomes are retried; anything that may have reached the recipient is never resent
 * without a person choosing to.
 */
const emailInvoice: Handler = async (payload, deps, helpers) => {
  const p = z.object({ invoiceId: z.uuid(), attempt: z.number().int().positive() }).parse(payload);
  const found = await inOrg(deps, payload.orgId, async (tx) => {
    const [row] = await tx
      .select({ invoice: invoices, org: organizations })
      .from(invoices)
      .innerJoin(organizations, eq(organizations.id, invoices.orgId))
      .where(and(eq(invoices.orgId, payload.orgId), eq(invoices.id, p.invoiceId)));
    if (!row) return null;
    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.orgId, payload.orgId), eq(invoiceLines.invoiceId, p.invoiceId)))
      .orderBy(invoiceLines.sortOrder);
    return { ...row, lines };
  });
  if (!found) return;
  const { invoice, org, lines } = found;
  if (invoice.emailAttempt !== p.attempt || invoice.emailStatus !== 'queued') return; // done or superseded
  const setOutcome = (patch: Partial<typeof invoices.$inferInsert>) =>
    inOrg(deps, payload.orgId, (tx) =>
      tx
        .update(invoices)
        .set(patch)
        .where(
          and(
            eq(invoices.orgId, payload.orgId),
            eq(invoices.id, invoice.id),
            eq(invoices.emailAttempt, p.attempt),
          ),
        ),
    );
  if (!invoice.recipientEmail || !invoice.emailSenderUserId) {
    await setOutcome({
      emailStatus: 'failed',
      emailError: 'No recipient address or sender was recorded.',
    });
    return;
  }

  const lastTry = helpers.job.attempts >= helpers.job.max_attempts;
  const recipientEmail = invoice.recipientEmail;
  const senderUserId = invoice.emailSenderUserId;
  try {
    const content = buildInvoiceEmail(invoice, lines, {
      displayName: org.displayName,
      timezone: org.timezone,
      locale: org.locale,
    });
    const pdf = await renderToBuffer(content.snapshot);
    const result = await deps.mailer.send(
      { orgId: payload.orgId, userId: senderUserId },
      {
        mailbox: invoice.emailVia ?? null,
        to: recipientEmail,
        subject: content.subject,
        text: content.text,
        fromName: org.displayName,
        attachments: [
          {
            filename: content.filename,
            contentType: 'application/pdf',
            contentBase64: pdf.buffer.toString('base64'),
          },
        ],
        idempotencyKey: `invoice-email:${invoice.id}:${p.attempt}`,
      },
    );
    await setOutcome({
      emailStatus: 'sent',
      emailFrom: result.from,
      emailSentAt: new Date(),
      emailError: null,
    });
  } catch (error) {
    if (!(error instanceof MailerError)) {
      // Unexpected (PDF, database): retried; on the last attempt the invoice shows it failed.
      if (lastTry) {
        await setOutcome({
          emailStatus: 'failed',
          emailError: 'The invoice email could not be prepared. Try emailing it again.',
        });
      }
      throw error;
    }
    if ((error.code === 'retry' || error.code === 'in_progress') && !lastTry) throw error;
    const reason =
      error.code === 'not_connected' || error.code === 'unavailable'
        ? `${error.message} Connect Gmail or Outlook in Settings > Email, then email the invoice again.`
        : error.code === 'reconnect_required'
          ? `${error.message} Reconnect it in Settings > Email, then email the invoice again.`
          : error.message;
    await setOutcome({
      emailStatus: error.code === 'unknown' ? 'unknown' : 'failed',
      emailError: reason.slice(0, 500),
    });
  }
};

// ------------------------------------------------------------------ roof.analysis
/**
 * Runs a queued Google Solar lookup for a confirmed property. The service re-checks the confirmed
 * pin, reuses a fresh succeeded result (no provider call), and records a definitive failure when
 * the address changed. Retryable provider failures throw so graphile applies its backoff. The
 * result is structured insight only and is never treated as certified roof geometry.
 */
const analyzeRoof: Handler = async (payload, deps) => {
  const { analysisJobId } = z.object({ analysisJobId: z.uuid() }).parse(payload);
  const provider = createImageryProviders(deps.config).find(
    (candidate) => candidate.id === 'google_solar',
  );
  if (!provider) throw new Error('Google Solar provider is not registered');
  const outcome = await inOrg(deps, payload.orgId, (tx) =>
    runRoofAnalysis(tx, { orgId: payload.orgId, analysisJobId, provider }),
  );
  if (outcome.status === 'failed' && outcome.retryable) {
    throw new Error(`roof.analysis failed: ${outcome.errorCode ?? 'unknown'}`);
  }
};

const scanEnterpriseMedia: Handler = async (payload, deps, helpers) => {
  const { projectId, assetId } = z.object({ projectId: z.uuid(), assetId: z.uuid() }).parse(payload);
  const endpoint = deps.config.jobsitePhotoScanner;
  const adapters = deps.jobsiteMedia ?? {
    storage: createStorage(deps.config),
    scanner: endpoint ? new ClamdJobsitePhotoScanner(endpoint) : null,
  };
  const outcome = await inOrg(deps, payload.orgId, (tx) =>
    scanJobsitePhoto(tx, {
      orgId: payload.orgId,
      projectId,
      assetId,
      eventId: payload.eventId,
      auditSecret: deps.config.session.secret,
      lastAttempt: helpers.job.attempts >= helpers.job.max_attempts,
      ...adapters,
    }),
  );
  if (outcome !== 'complete') throw new Error('Jobsite photo scan could not complete.');
};

const HANDLERS: Record<JobTask, Handler> = {
  'notification.deliver': deliverNotification,
  'invitation.send': sendInvitation,
  'membership.revoked': releaseMembershipWork,
  'job_status.email': emailJobStatus,
  'invoice.email': emailInvoice,
  'roof.analysis': analyzeRoof,
  'enterprise_media.scan': scanEnterpriseMedia,
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
  return {
    ...Object.fromEntries(
      (Object.keys(JOB_TASKS) as JobTask[]).map((task) => [task, wrap(task, HANDLERS[task], deps)]),
    ),
    ...outreachTasks(deps),
    ...permitWatchTasks(deps),
    ...permitSourcesTasks(deps),
    ...govOpportunitiesTasks(deps),
    ...permitFunnelTasks(deps),
  };
}
