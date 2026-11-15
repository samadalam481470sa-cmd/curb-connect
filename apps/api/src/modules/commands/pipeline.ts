// The single write pipeline for commands (COS starter C/D, ADD-014, ADD-015, ADD-078). Order:
//   1. authenticate + internal user + tenant membership   (route preHandler: verified session)
//   2. resource permission                                 (handler.permission, server-side RBAC)
//   3. schema validation                                   (envelope + typed payload)
//   4. one tenant transaction:
//      a. lock + load the aggregate (RLS-scoped: another tenant's id is a 404)
//      b. receipt lookup by command_id = Idempotency-Key   (replay returns the stored receipt)
//      c. business prerequisites on the current state       (handler.validate)
//      d. expected_revision check                          (409 + non-sensitive field diff)
//      e. aggregate change + audit_events + domain_events (outbox) + command_receipts
//   5. receipt { command_id, status, aggregate_id, server_revision, observed_at, correlation_id }
//
// Why the receipt lookup sits after the aggregate lock (and before state validation): a retry of a
// command that already committed must get its original receipt even though the aggregate has
// moved on (its prerequisites or revision would now fail), and taking the row lock first makes a
// concurrent duplicate wait for the first attempt and then see its receipt instead of a 409.
import { createHash } from 'node:crypto';
import { type CommandEnvelope, type CommandReceipt, CommandReceiptSchema, type CommandType } from '@fieldline/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { commandReceipts, domainEvents } from '../../db/schema';
import { withTenant } from '../../db/runtime';
import { assertCan, requireOrg } from '../../http/context';
import { canonicalJson, IDEMPOTENCY_HEADER } from '../../http/idempotency';
import { HttpProblem, problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { type CommandContext, commandHandler, payloadSchema } from './registry';

export function envelopeHash(envelope: CommandEnvelope): string {
  // client_timestamp is informational and excluded: a resend with a new timestamp is the same command.
  const { client_timestamp: _ignored, ...rest } = envelope;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

/** Reads the Idempotency-Key header; for commands it must equal command_id. */
export function readCommandKey(request: FastifyRequest): string | null {
  const raw = request.headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value.trim().toLowerCase() : null;
}

export interface CommandResult {
  receipt: CommandReceipt;
  replayed: boolean;
}

export async function executeCommand(request: FastifyRequest, envelope: CommandEnvelope): Promise<CommandResult> {
  const org = requireOrg(request);
  const handler = commandHandler(envelope.command_type);
  if (!handler) {
    throw problem('validation_failed', `Unknown command_type ${envelope.command_type}.`, {
      errors: [{ path: 'body.command_type', message: 'not a registered command', code: 'unknown_command' }],
    });
  }
  // 2. permission before any data is read (a revoked role gets 403; the client keeps its draft).
  assertCan(request, handler.permission);
  // 3. typed payload validation.
  const parsed = payloadSchema(handler.type as CommandType).safeParse(envelope.payload);
  if (!parsed.success) {
    throw problem('validation_failed', 'The command payload is invalid.', {
      errors: parsed.error.issues.map((i) => ({
        path: ['body', 'payload', ...i.path.map(String)].join('.'),
        message: i.message,
        code: i.code,
      })),
    });
  }
  const payload = parsed.data as never;
  const hash = envelopeHash(envelope);

  return withTenant(request.server.db, { orgId: org.orgId, userId: org.userId }, async (tx) => {
    const now = new Date();
    const ctx: CommandContext = {
      request,
      tx,
      orgId: org.orgId,
      userId: org.userId,
      membershipId: org.membershipId,
      now,
      correlationId: request.id,
    };
    // 4a. lock + load.
    const aggregate = await handler.load(ctx, envelope.aggregate_id);
    if (!aggregate) throw problem('not_found');
    // 4b. receipt lookup (idempotent replay).
    const [existing] = await tx
      .select()
      .from(commandReceipts)
      .where(and(eq(commandReceipts.orgId, org.orgId), eq(commandReceipts.commandId, envelope.command_id)));
    if (existing) {
      if (existing.requestHash !== hash) throw problem('idempotency_key_reused');
      return { receipt: CommandReceiptSchema.parse(existing.responseBody), replayed: true };
    }
    // 4c. business prerequisites.
    await handler.validate?.(ctx, aggregate.state, payload);
    // 4d. optimistic concurrency.
    if (aggregate.revision !== envelope.expected_revision) {
      throw new HttpProblem({
        code: 'revision_conflict',
        detail: `The record is at revision ${aggregate.revision}; your edit was based on revision ${envelope.expected_revision}.`,
        conflict: {
          aggregateId: envelope.aggregate_id,
          expectedRevision: envelope.expected_revision,
          serverRevision: aggregate.revision,
          diff: handler.diff(aggregate.state, payload),
        },
      });
    }
    // 4e. one transaction: aggregate + audit + outbox + receipt.
    const outcome = await handler.execute(ctx, aggregate, payload);
    if (outcome.changed && outcome.audit) {
      await auditRequest(request, tx, {
        orgId: org.orgId,
        action: outcome.audit.action,
        resourceType: handler.aggregateType,
        resourceId: envelope.aggregate_id,
        before: outcome.audit.before,
        after: outcome.audit.after,
        reason: outcome.audit.reason ?? `command ${envelope.command_type} ${envelope.command_id}`,
      });
    }
    if (outcome.changed && outcome.event) {
      await tx.insert(domainEvents).values({
        orgId: org.orgId,
        eventType: outcome.event.type,
        aggregateType: handler.aggregateType,
        aggregateId: envelope.aggregate_id,
        payload: { ...outcome.event.payload, commandId: envelope.command_id, commandType: envelope.command_type },
        correlationId: request.id,
      });
    }
    const receipt: CommandReceipt = {
      command_id: envelope.command_id,
      status: 'committed',
      aggregate_id: envelope.aggregate_id,
      server_revision: outcome.serverRevision,
      observed_at: now.toISOString(),
      correlation_id: request.id,
    };
    await tx.insert(commandReceipts).values({
      orgId: org.orgId,
      commandId: envelope.command_id,
      commandType: envelope.command_type,
      aggregateType: handler.aggregateType,
      aggregateId: envelope.aggregate_id,
      status: receipt.status,
      expectedRevision: envelope.expected_revision,
      serverRevision: outcome.serverRevision,
      requestHash: hash,
      responseBody: sql`${JSON.stringify(receipt)}::jsonb`,
      actorUserId: org.userId,
      correlationId: request.id,
      observedAt: now,
    });
    return { receipt, replayed: false };
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Stable UUID for a non-UUID Idempotency-Key (e.g. the web client's "web-<uuid>" keys). */
export function commandIdForKey(key: string): string {
  if (UUID_RE.test(key)) return key;
  const h = createHash('sha256').update(`idempotency-key:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/**
 * Runs a typed resource endpoint (e.g. POST /v1/properties/{id}/pin) through the same pipeline.
 * The Idempotency-Key, when sent, becomes the command_id (a UUID key is used as is; any other key
 * maps to a stable derived UUID, so replays still match). Without a key a fresh id is generated
 * (no replay protection, which the client opted out of).
 */
export async function executeResourceCommand(
  request: FastifyRequest,
  reply: FastifyReply,
  input: { type: CommandType; aggregateId: string; expectedRevision: number; payload: Record<string, unknown> },
): Promise<CommandResult> {
  const key = readCommandKey(request);
  if (key !== null && (key.length < 8 || key.length > 128)) {
    throw problem('validation_failed', 'Idempotency-Key must be 8-128 characters.');
  }
  const result = await executeCommand(request, {
    command_type: input.type,
    command_id: key === null ? crypto.randomUUID() : commandIdForKey(key),
    aggregate_id: input.aggregateId,
    expected_revision: input.expectedRevision,
    payload: input.payload,
  });
  if (result.replayed) reply.header('idempotent-replayed', 'true');
  return result;
}
