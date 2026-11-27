// Worker task handlers (BE-076). Every handler is idempotent: a re-run after a crash between the
// side effect and the acknowledgement must not duplicate anything (checks current state first and
// uses stable provider idempotency keys). The wrapper keeps the outbox row (domain_events) in step:
// dispatched on success, attempts/last_error on failure, `dead` when retries are exhausted, at
// which point the failure also surfaces in the tenant's operational queue.
// Tasks run as fieldline_platform (BYPASSRLS), so EVERY query filters by the payload's orgId.
import { BRAND, EnterpriseWipReportInput } from '@fieldline/contracts';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { JobHelpers, Task, TaskList } from 'graphile-worker';
import { z } from 'zod';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { type Tx, withPlatform } from '../db/runtime';
import { renderToBuffer } from '@fieldline/pdf';
import {
  auditEvents,
  contacts,
  devices,
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
  proposals,
  proposalVersions,
  reviewTasks,
  networkOrders,
  users,
  workAssignments,
} from '../db/schema';
import { createImageryProviders } from '../modules/imagery/providers';
import { runRoofAnalysis } from '../modules/imagery/roof-analysis';
import { scanJobsitePhoto } from '../modules/enterprise/jobsitePhotoScan';
import { notifyJobsiteEvidenceReviewer } from '../modules/enterprise/jobsiteEvidenceNotification';
import { notifyBudgetRevision } from '../modules/enterprise/budgetRevisionNotifications';
import { notifyPurchaseCommitment } from '../modules/enterprise/purchaseCommitmentNotifications';
import { notifyActualBillCost } from '../modules/enterprise/actualBillCostNotifications';
import { refreshForecastForApprovedEvent } from '../modules/enterprise/refreshForecastOnEvent';
import { notifyCostForecast } from '../modules/enterprise/costForecastNotifications';
import { notifyCostScenario } from '../modules/enterprise/costScenarioNotifications';
import { notifySalesLeadAssigned, notifySalesLeadCreated } from '../modules/enterprise/salesLeadNotifications';
import { notifySalesFollowUpDue } from '../modules/enterprise/salesFollowUpNotifications';
import { deliverDraftPurchaseAdvisory } from '../modules/enterprise/financeVarianceAlerts';
import { notifyPurchaseVariance } from '../modules/enterprise/purchaseVarianceNotifications';
import {
  claimWipReport,
  finishWipReport,
  generateWipCsv,
} from '../modules/enterprise/wipReportProcessing';
import { notifyJobsiteHomeownerGalleryPublished } from '../modules/enterprise/jobsiteHomeownerNotification';
import {
  claimJobsiteMediaExport,
  finishJobsiteMediaExport,
  generateJobsiteMediaExport,
} from '../modules/enterprise/jobsiteMediaExportProcessing';
import { ClamdJobsitePhotoScanner } from '../modules/enterprise/jobsitePhotoScanner';
import {
  claimJobsiteVideo,
  finishJobsiteVideo,
  transcodeJobsiteVideo,
} from '../modules/enterprise/jobsiteVideoProcessing';
import type { MalwareScanner } from '../modules/media/processing';
import { customerStageLabel, jobStatusUrl } from '../modules/portal/jobStatus';
import { invitationAcceptUrl, unsealSecret } from '../modules/team/service';
import { buildInvoiceEmail } from '../services/invoice-email';
import { pushConfigured, sendWebPush } from '../services/webPush';
import { emailConfigured, partnerAdminEmails } from '../services/networkNotify';
import type { MailAdapter } from '../services/mail';
import { MailerError, type MailerClient } from '../services/mailer-client';
import { createStorage, type StorageAdapter } from '../storage';
import { JOB_TASKS, type JobTask } from './outbox';
import { outreachTasks } from './outreach';
import { permitSourcesTasks } from './permitSources';
import { portalCaptureTasks } from './portalCapture';
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
  if (target.n.channel === 'push') {
    await deliverPush(deps, payload.orgId, target.n);
    return;
  }
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

/**
 * Push branch of notification.deliver: Web Push to the recipient's web devices.
 * Native (iOS/Android) tokens are recorded but delivery stays gated on the owner's
 * Apple Developer / Firebase accounts — the row is marked failed with that reason,
 * never "sent". A 404/410 from a push service revokes the dead subscription.
 */
async function deliverPush(
  deps: WorkerDeps,
  orgId: string,
  n: typeof notifications.$inferSelect,
): Promise<void> {
  const setStatus = (deliveryStatus: 'sent' | 'failed' | 'suppressed', data: unknown) =>
    inOrg(deps, orgId, (tx) =>
      tx
        .update(notifications)
        .set({
          deliveryStatus,
          sentAt: deliveryStatus === 'sent' ? new Date() : null,
          data,
        })
        .where(and(eq(notifications.orgId, orgId), eq(notifications.id, n.id))),
    );

  if (!n.recipientMembershipId) {
    await setStatus('suppressed', { reason: 'no_recipient' });
    return;
  }
  const rows = await inOrg(deps, orgId, (tx) =>
    tx
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.orgId, orgId),
          eq(devices.membershipId, n.recipientMembershipId as string),
          isNull(devices.revokedAt),
        ),
      ),
  );
  if (rows.length === 0) {
    await setStatus('suppressed', { reason: 'no_registered_devices' });
    return;
  }
  const web = rows.filter((d) => d.platform === 'web' && d.p256dh && d.auth);
  if (web.length === 0) {
    await setStatus('failed', { reason: 'native_push_not_connected' });
    return;
  }
  if (!pushConfigured(deps.config)) {
    await setStatus('failed', { reason: 'push_not_configured' });
    return;
  }
  let delivered = 0;
  let lastReason = 'push_failed';
  for (const device of web) {
    const result = await sendWebPush(
      deps.config,
      { endpoint: device.endpoint, p256dh: device.p256dh as string, auth: device.auth as string },
      { title: n.title, body: n.body, link: n.link },
    );
    if (result.ok) {
      delivered += 1;
      await inOrg(deps, orgId, (tx) =>
        tx
          .update(devices)
          .set({ lastSeenAt: new Date(), updatedAt: new Date() })
          .where(eq(devices.id, device.id)),
      );
    } else {
      lastReason = result.reason;
      if (result.gone) {
        await inOrg(deps, orgId, (tx) =>
          tx
            .update(devices)
            .set({ revokedAt: new Date(), updatedAt: new Date() })
            .where(eq(devices.id, device.id)),
        );
      }
    }
  }
  if (delivered > 0) {
    await setStatus('sent', { deliveredDevices: delivered });
  } else {
    await setStatus('failed', { reason: lastReason });
  }
}

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
  const { projectId, assetId } = z
    .object({ projectId: z.uuid(), assetId: z.uuid() })
    .parse(payload);
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
  if (outcome !== 'complete') throw new Error('Jobsite media scan could not complete.');
};

const transcodeEnterpriseVideo: Handler = async (payload, deps, helpers) => {
  const parsed = z.object({ projectId: z.uuid(), assetId: z.uuid() }).parse(payload);
  const scope = { orgId: payload.orgId, ...parsed };
  const source = await inOrg(deps, scope.orgId, (tx) => claimJobsiteVideo(tx, scope));
  if (!source) return;
  const storage = deps.jobsiteMedia?.storage ?? createStorage(deps.config);
  const audit = { storage, eventId: payload.eventId, auditSecret: deps.config.session.secret };
  try {
    const result = await transcodeJobsiteVideo(deps.config.vision, storage, source);
    await inOrg(deps, scope.orgId, (tx) => finishJobsiteVideo(tx, scope, source, result, audit));
  } catch (error) {
    if (helpers.job.attempts >= helpers.job.max_attempts)
      await inOrg(deps, scope.orgId, (tx) =>
        finishJobsiteVideo(tx, scope, source, { state: 'failed' }, audit),
      );
    throw error;
  }
};

const notifyEnterpriseEvidenceReviewer: Handler = async (payload, deps) => {
  const scope = z
    .object({ projectId: z.uuid(), taskId: z.uuid(), reviewId: z.uuid() })
    .parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    notifyJobsiteEvidenceReviewer(tx, { ...scope, orgId: payload.orgId, eventId: payload.eventId }),
  );
};

const notifyPublishedHomeownerGallery: Handler = async (payload, deps) => {
  const scope = z
    .object({ projectId: z.uuid(), shareId: z.uuid(), membershipId: z.uuid() })
    .parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    notifyJobsiteHomeownerGalleryPublished(tx, {
      ...scope,
      orgId: payload.orgId,
      eventId: payload.eventId,
    }),
  );
};

function notifyFinanceRevision(event: 'requested' | 'approved'): Handler {
  return async (payload, deps) => {
    const scope = z
      .object({ projectId: z.uuid(), budgetId: z.uuid(), revisionId: z.uuid() })
      .parse(payload);
    await inOrg(deps, payload.orgId, (tx) =>
      notifyBudgetRevision(tx, { ...scope, orgId: payload.orgId, eventId: payload.eventId }, event),
    );
  };
}

const notifyFinanceCommitment: Handler = async (payload, deps) => {
  const scope = z
    .object({ projectId: z.uuid(), orderId: z.uuid(), revisionId: z.uuid() })
    .parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    notifyPurchaseCommitment(tx, { ...scope, orgId: payload.orgId, eventId: payload.eventId }),
  );
};

const notifyFinanceActual: Handler = async (payload, deps) => {
  const scope = z.object({ projectId: z.uuid(), postingId: z.uuid() }).parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    notifyActualBillCost(tx, { ...scope, orgId: payload.orgId, eventId: payload.eventId }),
  );
};

const notifyFinanceForecast: Handler = async (payload, deps) => {
  const scope = z.object({ projectId: z.uuid(), forecastId: z.uuid() }).parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    notifyCostForecast(tx, { ...scope, orgId: payload.orgId, eventId: payload.eventId }),
  );
};

const processForecastRefresh: Handler = async (payload, deps) => {
  const signal = z.object({
    projectId: z.uuid(), kind: z.enum(['purchase_commitment', 'change_order', 'actual_bill']),
    resourceId: z.uuid(), actorUserId: z.uuid(), effectiveOn: z.iso.date().nullable(),
    settingRevision: z.number().int().nonnegative(),
  }).parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    refreshForecastForApprovedEvent(tx, { ...signal, orgId: payload.orgId, eventId: payload.eventId }, deps.config.session.secret),
  );
};

const notifyFinanceScenario: Handler = async (payload, deps) => {
  const scope = z.object({ projectId: z.uuid(), scenarioId: z.uuid() }).parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    notifyCostScenario(tx, { ...scope, orgId: payload.orgId, eventId: payload.eventId }),
  );
};

const notifySalesLead: Handler = async (payload, deps) => {
  const { leadId } = z.object({ leadId: z.uuid() }).parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    notifySalesLeadCreated(tx, { leadId, orgId: payload.orgId, eventId: payload.eventId }),
  );
};

const notifySalesAssignment: Handler = async (payload, deps) => {
  const scope = z.object({ leadId: z.uuid(), assignmentId: z.uuid() }).parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    notifySalesLeadAssigned(tx, { ...scope, orgId: payload.orgId, eventId: payload.eventId }),
  );
};

const notifySalesFollowUp: Handler = async (payload, deps) => {
  const scope = z.object({ leadId: z.uuid(), followUpId: z.uuid(), policyRevision: z.number().int().nonnegative() }).parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    notifySalesFollowUpDue(tx, { ...scope, orgId: payload.orgId, eventId: payload.eventId }),
  );
};

function notifyFinanceVariance(kind: 'threshold_crossed' | 'approved' | 'rejected'): Handler {
  return async (payload, deps) => {
    const scope = z
      .object({ projectId: z.uuid(), orderId: z.uuid(), varianceId: z.uuid() })
      .parse(payload);
    await inOrg(deps, payload.orgId, (tx) =>
      notifyPurchaseVariance(
        tx,
        { ...scope, orgId: payload.orgId, eventId: payload.eventId },
        kind,
      ),
    );
  };
}

const notifyFinanceAdvisory: Handler = async (payload, deps) => {
  const scope = z.object({
    projectId: z.uuid(),
    orderId: z.uuid(),
    orderRevision: z.number().int().positive(),
    ruleRevision: z.number().int().positive(),
  }).parse(payload);
  await inOrg(deps, payload.orgId, (tx) =>
    deliverDraftPurchaseAdvisory(tx, { ...scope, orgId: payload.orgId, eventId: payload.eventId }),
  );
};

const processFinanceWipReport: Handler = async (payload, deps, helpers) => {
  const { reportId } = z.object({ reportId: z.uuid() }).parse(payload);
  const scope = { orgId: payload.orgId, reportId };
  try {
    const claimed = await inOrg(deps, scope.orgId, (tx) => claimWipReport(tx, scope));
    if (!claimed) return;
    const artifact = generateWipCsv(reportId, EnterpriseWipReportInput.parse(claimed));
    await inOrg(deps, scope.orgId, (tx) => finishWipReport(tx, scope, artifact));
  } catch (cause) {
    if (helpers.job.attempts >= helpers.job.max_attempts)
      await inOrg(deps, scope.orgId, (tx) => finishWipReport(tx, scope, null));
    throw cause;
  }
};

const packageJobsiteMediaExport: Handler = async (payload, deps, helpers) => {
  const parsed = z.object({ projectId: z.uuid(), exportId: z.uuid() }).parse(payload);
  const scope = { ...parsed, orgId: payload.orgId };
  const claimed = await inOrg(deps, scope.orgId, (tx) => claimJobsiteMediaExport(tx, scope));
  if (!claimed) return;
  const storage = deps.jobsiteMedia?.storage ?? createStorage(deps.config);
  try {
    const result = await generateJobsiteMediaExport(storage, deps.config.appOrigin, scope, claimed);
    await inOrg(deps, scope.orgId, (tx) => finishJobsiteMediaExport(tx, scope, result));
  } catch (error) {
    if (error instanceof Error && error.message === 'media_export_too_large') {
      await inOrg(deps, scope.orgId, (tx) =>
        finishJobsiteMediaExport(tx, scope, { status: 'failed', failureCode: 'too_large' }),
      );
      return;
    }
    if (helpers.job.attempts >= helpers.job.max_attempts)
      await inOrg(deps, scope.orgId, (tx) =>
        finishJobsiteMediaExport(tx, scope, { status: 'failed', failureCode: 'generation_failed' }),
      );
    throw error;
  }
};

// ------------------------------------------------------------------ assignment.email
/**
 * Emails a work assignment to the partner company's owners/admins. Runs in the assigner's
 * org context (the assigner's connected mailbox sends it, or platform SMTP when configured).
 * The assignment rows on BOTH sides carry the honest outcome: 'sent' only after a real
 * provider send succeeds; otherwise 'failed' with the reason. When no mail path is
 * configured the job is never enqueued in the first place (the route records
 * 'not_connected'), so reaching here without a path records that same honest state.
 */
const emailAssignment: Handler = async (payload, deps, helpers) => {
  const p = z
    .object({ assignmentKey: z.uuid(), assignerUserId: z.uuid() })
    .parse(payload);
  const found = await inOrg(deps, payload.orgId, async (tx) => {
    const [row] = await tx
      .select({ assignment: workAssignments, org: organizations })
      .from(workAssignments)
      .innerJoin(organizations, eq(organizations.id, workAssignments.orgId))
      .where(
        and(
          eq(workAssignments.orgId, payload.orgId),
          eq(workAssignments.assignmentKey, p.assignmentKey),
          eq(workAssignments.side, 'assigner'),
        ),
      );
    return row ?? null;
  });
  if (!found) return;
  const { assignment, org } = found;
  if (assignment.emailState === 'sent') return; // idempotent: already delivered

  const setOutcome = (patch: Partial<typeof workAssignments.$inferInsert>) =>
    inOrg(deps, payload.orgId, (tx) =>
      tx
        .update(workAssignments)
        .set(patch)
        .where(eq(workAssignments.assignmentKey, p.assignmentKey)),
    );

  if (!emailConfigured(deps.config)) {
    await setOutcome({
      emailState: 'not_connected',
      emailNote:
        'Email is not connected yet (the mailer/SMTP setup is outstanding), so nothing was emailed. The in-app notification was delivered.',
    });
    return;
  }

  const emails = await inOrg(deps, payload.orgId, (tx) =>
    partnerAdminEmails(tx, assignment.partnerOrgId),
  );
  if (!emails.length) {
    await setOutcome({
      emailState: 'failed',
      emailNote:
        "No email address is on file for the partner company's owners or admins, so the email could not be sent. The in-app notification was delivered.",
    });
    return;
  }

  const kindLabels: Record<string, string> = {
    job: 'a job',
    purchase_order: 'a purchase order',
    task: 'a task',
    bid_invitation: 'a bid invitation',
  };
  const subject = `Work assigned to your company: ${assignment.title}`;
  const text =
    `${org.displayName} assigned ${kindLabels[assignment.kind] ?? 'work'} to your company on ${BRAND.name}.\n\n` +
    `${assignment.title}\n` +
    (assignment.description ? `${assignment.description}\n` : '') +
    (assignment.dueOn ? `Due: ${assignment.dueOn}\n` : '') +
    `\nOpen ${BRAND.name}: ${deps.config.appOrigin}/assignments\n`;

  const lastTry = helpers.job.attempts >= helpers.job.max_attempts;
  try {
    await deliverNetworkEmail(deps, {
      orgId: payload.orgId,
      senderUserId: p.assignerUserId,
      fromName: org.displayName,
      emails,
      subject,
      text,
      idempotencyPrefix: `assignment-email:${p.assignmentKey}`,
    });
    await setOutcome({ emailState: 'sent', emailSentAt: new Date(), emailNote: null });
  } catch (error) {
    if (error instanceof MailerError) {
      if ((error.code === 'retry' || error.code === 'in_progress') && !lastTry) throw error;
      const reason =
        error.code === 'not_connected' || error.code === 'unavailable'
          ? `${error.message} Connect Gmail or Outlook in Settings > Email, then re-send the assignment email.`
          : error.code === 'reconnect_required'
            ? `${error.message} Reconnect it in Settings > Email, then re-send the assignment email.`
            : error.message;
      await setOutcome({ emailState: 'failed', emailNote: reason.slice(0, 500) });
      return;
    }
    if (lastTry) {
      await setOutcome({
        emailState: 'failed',
        emailNote: 'The assignment email could not be sent. Re-send it from the assignment.',
      });
    }
    throw error;
  }
};

/** Sends one cross-company email to each recipient via the connected mailbox or platform SMTP. */
async function deliverNetworkEmail(
  deps: WorkerDeps,
  input: {
    orgId: string;
    senderUserId: string;
    fromName: string;
    emails: string[];
    subject: string;
    text: string;
    idempotencyPrefix: string;
  },
): Promise<void> {
  for (const to of input.emails) {
    if (deps.mailer.available) {
      await deps.mailer.send(
        { orgId: input.orgId, userId: input.senderUserId },
        {
          mailbox: null,
          to,
          subject: input.subject,
          text: input.text,
          fromName: input.fromName,
          attachments: [],
          idempotencyKey: `${input.idempotencyPrefix}:${to}`,
        },
      );
    } else {
      await deps.mail.send({
        to,
        subject: `${input.subject} - ${input.fromName}`,
        text: input.text,
        idempotencyKey: `${input.idempotencyPrefix}:${to}`,
      });
    }
  }
}

// ------------------------------------------------------------------ order.email
/**
 * Emails a network purchase order to the supplier company's owners/admins. Same honest
 * contract as assignment.email: 'sent' only after a real provider send; otherwise the
 * order rows record why. Runs in the buyer's org context.
 */
const emailOrder: Handler = async (payload, deps, helpers) => {
  const p = z.object({ orderKey: z.uuid(), senderUserId: z.uuid() }).parse(payload);
  const found = await inOrg(deps, payload.orgId, async (tx) => {
    const [row] = await tx
      .select({ order: networkOrders, org: organizations })
      .from(networkOrders)
      .innerJoin(organizations, eq(organizations.id, networkOrders.orgId))
      .where(
        and(
          eq(networkOrders.orgId, payload.orgId),
          eq(networkOrders.orderKey, p.orderKey),
          eq(networkOrders.side, 'buyer'),
        ),
      );
    return row ?? null;
  });
  if (!found) return;
  const { order, org } = found;
  if (order.emailState === 'sent') return;

  const setOutcome = (patch: Partial<typeof networkOrders.$inferInsert>) =>
    inOrg(deps, payload.orgId, (tx) =>
      tx.update(networkOrders).set(patch).where(eq(networkOrders.orderKey, p.orderKey)),
    );

  if (!emailConfigured(deps.config)) {
    await setOutcome({
      emailState: 'not_connected',
      emailNote:
        'Email is not connected yet (the mailer/SMTP setup is outstanding), so nothing was emailed. The in-app notification was delivered.',
    });
    return;
  }

  const emails = await inOrg(deps, payload.orgId, (tx) =>
    partnerAdminEmails(tx, order.partnerOrgId),
  );
  if (!emails.length) {
    await setOutcome({
      emailState: 'failed',
      emailNote:
        "No email address is on file for the supplier company's owners or admins, so the email could not be sent. The in-app notification was delivered.",
    });
    return;
  }

  const subject = `Purchase order ${order.reference} from ${org.displayName}`;
  const text =
    `${org.displayName} sent your company purchase order ${order.reference} on ${BRAND.name}.\n\n` +
    (order.requestedDeliveryOn ? `Requested delivery: ${order.requestedDeliveryOn}\n` : '') +
    (order.deliveryAddress ? `Deliver to: ${order.deliveryAddress}\n` : '') +
    (order.note ? `${order.note}\n` : '') +
    `\nOpen ${BRAND.name}: ${deps.config.appOrigin}/network-orders\n`;

  const lastTry = helpers.job.attempts >= helpers.job.max_attempts;
  try {
    await deliverNetworkEmail(deps, {
      orgId: payload.orgId,
      senderUserId: p.senderUserId,
      fromName: org.displayName,
      emails,
      subject,
      text,
      idempotencyPrefix: `order-email:${p.orderKey}`,
    });
    await setOutcome({ emailState: 'sent', emailSentAt: new Date(), emailNote: null });
  } catch (error) {
    if (error instanceof MailerError) {
      if ((error.code === 'retry' || error.code === 'in_progress') && !lastTry) throw error;
      const reason =
        error.code === 'not_connected' || error.code === 'unavailable'
          ? `${error.message} Connect Gmail or Outlook in Settings > Email, then re-send the order email.`
          : error.code === 'reconnect_required'
            ? `${error.message} Reconnect it in Settings > Email, then re-send the order email.`
            : error.message;
      await setOutcome({ emailState: 'failed', emailNote: reason.slice(0, 500) });
      return;
    }
    if (lastTry) {
      await setOutcome({
        emailState: 'failed',
        emailNote: 'The order email could not be sent. Re-send it from the order.',
      });
    }
    throw error;
  }
};

// ------------------------------------------------------------------ proposal.email
/**
 * Emails a sent proposal version to the customer contact. Same honest contract as
 * assignment.email: 'sent' only after a real provider send; otherwise the version
 * records why. Runs in the sender's org context.
 */
const emailProposal: Handler = async (payload, deps, helpers) => {
  const p = z
    .object({
      proposalVersionId: z.uuid(),
      senderUserId: z.uuid(),
      recipientContactIds: z.array(z.uuid()).default([]),
      message: z.string().nullable().optional(),
    })
    .parse(payload);
  const found = await inOrg(deps, payload.orgId, async (tx) => {
    const [row] = await tx
      .select({ version: proposalVersions, proposal: proposals, org: organizations })
      .from(proposalVersions)
      .innerJoin(proposals, eq(proposals.id, proposalVersions.proposalId))
      .innerJoin(organizations, eq(organizations.id, proposalVersions.orgId))
      .where(
        and(
          eq(proposalVersions.orgId, payload.orgId),
          eq(proposalVersions.id, p.proposalVersionId),
        ),
      );
    if (!row) return null;
    const recipientIds = p.recipientContactIds.length
      ? p.recipientContactIds
      : row.proposal.contactId
        ? [row.proposal.contactId]
        : [];
    const rows = recipientIds.length
      ? await tx
          .select({ email: contacts.email })
          .from(contacts)
          .where(and(eq(contacts.orgId, payload.orgId), inArray(contacts.id, recipientIds)))
      : [];
    const emails = rows.map((r) => r.email).filter((e): e is string => Boolean(e));
    return { ...row, emails };
  });
  if (!found) return;
  const { version, proposal, org, emails } = found;
  if (version.emailState === 'sent') return; // idempotent: already delivered

  const setOutcome = (patch: Partial<typeof proposalVersions.$inferInsert>) =>
    inOrg(deps, payload.orgId, (tx) =>
      tx.update(proposalVersions).set(patch).where(eq(proposalVersions.id, version.id)),
    );

  if (!emailConfigured(deps.config)) {
    await setOutcome({
      emailState: 'not_connected',
      emailNote:
        'Email is not connected yet (the mailer/SMTP setup is outstanding), so nothing was emailed.',
    });
    return;
  }
  if (!emails.length) {
    await setOutcome({
      emailState: 'failed',
      emailNote: 'No email address is on file for the proposal recipients, so the email could not be sent.',
    });
    return;
  }

  const content = (version.content as { scope?: string; terms?: string } | null) ?? {};
  const total = (version.totalMinor / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: proposal.currency,
  });
  const subject = `Proposal ${proposal.number} from ${org.displayName}`;
  const text =
    `${org.displayName} sent you proposal ${proposal.number}: ${proposal.title}\n\n` +
    (p.message ? `${p.message}\n\n` : '') +
    (content.scope ? `${content.scope}\n\n` : '') +
    `Total: ${total}\n` +
    (proposal.expiresOn ? `Valid through: ${proposal.expiresOn}\n` : '') +
    (content.terms ? `\nTerms:\n${content.terms}\n` : '') +
    `\nReply to this email or call ${org.displayName} to accept.\n`;

  const lastTry = helpers.job.attempts >= helpers.job.max_attempts;
  try {
    await deliverNetworkEmail(deps, {
      orgId: payload.orgId,
      senderUserId: p.senderUserId,
      fromName: org.displayName,
      emails,
      subject,
      text,
      idempotencyPrefix: `proposal-email:${version.id}`,
    });
    await setOutcome({ emailState: 'sent', emailSentAt: new Date(), emailNote: null });
  } catch (error) {
    if (error instanceof MailerError) {
      if ((error.code === 'retry' || error.code === 'in_progress') && !lastTry) throw error;
      const reason =
        error.code === 'not_connected' || error.code === 'unavailable'
          ? `${error.message} Connect Gmail or Outlook in Settings > Email, then re-send the proposal.`
          : error.code === 'reconnect_required'
            ? `${error.message} Reconnect it in Settings > Email, then re-send the proposal.`
            : error.message;
      await setOutcome({ emailState: 'failed', emailNote: reason.slice(0, 500) });
      return;
    }
    if (lastTry) {
      await setOutcome({
        emailState: 'failed',
        emailNote: 'The proposal email could not be sent. Re-send it from the proposal.',
      });
    }
    throw error;
  }
};

const HANDLERS: Record<JobTask, Handler> = {
  'notification.deliver': deliverNotification,
  'invitation.send': sendInvitation,
  'membership.revoked': releaseMembershipWork,
  'job_status.email': emailJobStatus,
  'invoice.email': emailInvoice,
  'assignment.email': emailAssignment,
  'order.email': emailOrder,
  'proposal.email': emailProposal,
  'roof.analysis': analyzeRoof,
  'enterprise_media.scan': scanEnterpriseMedia,
  'enterprise_media.transcode': transcodeEnterpriseVideo,
  'enterprise_media.evidence_review': notifyEnterpriseEvidenceReviewer,
  'enterprise_media.homeowner_gallery_published': notifyPublishedHomeownerGallery,
  'enterprise_media.package_export': packageJobsiteMediaExport,
  'budget.revision_requested': notifyFinanceRevision('requested'),
  'budget.revision_approved': notifyFinanceRevision('approved'),
  'cost.commitment_created': notifyFinanceCommitment,
  'cost.actual_posted': notifyFinanceActual,
  'forecast.snapshot_created': notifyFinanceForecast,
  'forecast.refresh_requested': processForecastRefresh,
  'forecast.scenario_created': notifyFinanceScenario,
  'sales.lead_created': notifySalesLead,
  'sales.lead_assigned': notifySalesAssignment,
  'sales.follow_up_due': notifySalesFollowUp,
  'variance.threshold_crossed': notifyFinanceVariance('threshold_crossed'),
  'variance.advisory_triggered': notifyFinanceAdvisory,
  'variance.approved': notifyFinanceVariance('approved'),
  'variance.rejected': notifyFinanceVariance('rejected'),
  'finance.wip_export': processFinanceWipReport,
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
    ...portalCaptureTasks(deps),
    ...govOpportunitiesTasks(deps),
    ...permitFunnelTasks(deps),
  };
}
