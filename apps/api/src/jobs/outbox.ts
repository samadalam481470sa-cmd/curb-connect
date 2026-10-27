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
