// Tables owned by the `commands` module (COS starter section C/D, ADD-014, ADD-078): one receipt per
// committed command, keyed by (org_id, command_id). The Idempotency-Key of POST /v1/commands is
// the command_id, so a replay finds the receipt and returns it unchanged. Receipts are written in
// the SAME transaction as the aggregate change, its audit row and its outbox event.
import { integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { tsColumn } from './_columns';
import { tenantTable } from './_tenant';

export const commandReceipts = tenantTable(
  'command_receipts',
  {
    commandId: uuid('command_id').notNull(),
    commandType: text('command_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    status: text('status').notNull(),
    expectedRevision: integer('expected_revision').notNull(),
    serverRevision: integer('server_revision').notNull(),
    /** sha256 of the canonical envelope: same id with a different body is rejected (422). */
    requestHash: text('request_hash').notNull(),
    /** The exact receipt returned to the client (replayed verbatim). */
    responseBody: jsonb('response_body').notNull(),
    actorUserId: uuid('actor_user_id'),
    correlationId: text('correlation_id'),
    observedAt: tsColumn('observed_at').notNull().defaultNow(),
  },
  (_t, h) => [h.uniq('orgId', 'commandId'), h.idx('orgId', 'aggregateId')],
);
