// Transactional outbox (BE-076 R): a domain_events row and a graphile-worker job are written in the
// SAME transaction as the business change, so a commit always has its follow-up work queued and a
// rollback never leaves an orphan job. The restricted app role cannot touch graphile_worker
// directly; it calls fieldline_enqueue_job(), a SECURITY DEFINER function (src/jobs/install.ts)
// that only accepts jobs for the transaction's own app.org_id.
import { sql } from 'drizzle-orm';
import { domainEvents } from '../db/schema';
import type { Tx } from '../db/runtime';

/** Every task the worker knows. Payloads are validated again inside the task. */
export const JOB_TASKS = {
  'notification.deliver': { maxAttempts: 6 },
  'invitation.send': { maxAttempts: 6 },
  'membership.revoked': { maxAttempts: 10 },
  'job_status.email': { maxAttempts: 6 },
  /** Emails an issued invoice (PDF attached) from the issuer's connected Gmail / Outlook. */
  'invoice.email': { maxAttempts: 6 },
  /** Emails a work assignment to the partner company's owners/admins (mailer or SMTP). */
  'assignment.email': { maxAttempts: 6 },
  /** Emails a network purchase order to the supplier company's owners/admins (mailer or SMTP). */
  'order.email': { maxAttempts: 6 },
  /** Emails a sent proposal version to the customer contact (mailer or SMTP). */
  'proposal.email': { maxAttempts: 6 },
  /** Returns a normalized Google Solar lookup for a confirmed property; cache hits do no network. */
  'roof.analysis': { maxAttempts: 3 },
  'enterprise_media.scan': { maxAttempts: 4 },
  'enterprise_media.transcode': { maxAttempts: 4 },
  'enterprise_media.evidence_review': { maxAttempts: 4 },
  'enterprise_media.homeowner_gallery_published': { maxAttempts: 4 },
  'enterprise_media.package_export': { maxAttempts: 4 },
  'budget.revision_requested': { maxAttempts: 4 },
  'budget.revision_approved': { maxAttempts: 4 },
  'cost.commitment_created': { maxAttempts: 4 },
  'cost.actual_posted': { maxAttempts: 4 },
  'forecast.snapshot_created': { maxAttempts: 4 },
  'forecast.refresh_requested': { maxAttempts: 4 },
  'forecast.scenario_created': { maxAttempts: 4 },
  'variance.threshold_crossed': { maxAttempts: 4 },
  'variance.advisory_triggered': { maxAttempts: 4 },
  'variance.approved': { maxAttempts: 4 },
  'variance.rejected': { maxAttempts: 4 },
  'finance.wip_export': { maxAttempts: 4 },
  'sales.lead_created': { maxAttempts: 4 },
  'sales.lead_assigned': { maxAttempts: 4 },
  'sales.follow_up_due': { maxAttempts: 4 },
  'sales.stage_changed': { maxAttempts: 4 },
  'sales.estimate_created': { maxAttempts: 4 },
} as const;
export type JobTask = keyof typeof JOB_TASKS;

export interface EnqueueInput {
  orgId: string;
  task: JobTask;
  aggregateType: string;
  aggregateId: string;
  /** Must not contain secrets in clear text (graphile stores payloads unencrypted). */
  payload: Record<string, unknown>;
  correlationId?: string | null;
  /** Stable job key: a re-enqueue with the same key replaces the pending job (BE-076 D). */
  jobKey?: string;
  runAt?: Date;
}

export interface OutboxJobPayload {
  eventId: string;
  orgId: string;
  [key: string]: unknown;
}

export async function enqueue(tx: Tx, input: EnqueueInput): Promise<string> {
  const [event] = await tx
    .insert(domainEvents)
    .values({
      orgId: input.orgId,
      eventType: input.task,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      correlationId: input.correlationId ?? null,
      ...(input.runAt && { availableAt: input.runAt }),
    })
    .returning({ id: domainEvents.id });
  const eventId = event!.id;
  const payload: OutboxJobPayload = { ...input.payload, eventId, orgId: input.orgId };
  await tx.execute(
    sql`select fieldline_enqueue_job(${input.task}, ${JSON.stringify(payload)}::json, ${JOB_TASKS[input.task].maxAttempts}::int, ${input.jobKey ?? null}::text, ${input.runAt?.toISOString() ?? null}::timestamptz)`,
  );
  return eventId;
}
