// Tables owned by the `audit` module: the append-only audit log (UPDATE/DELETE rejected by a
// trigger), the transactional outbox of domain events, and idempotency keys.
import { index, integer, jsonb, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { tsColumn } from './_columns';
import { actorTypeEnum, idempotencyStatusEnum, outboxStatusEnum } from './_enums';
import { tenantTable } from './_tenant';

export const auditEvents = tenantTable(
  'audit_events',
  {
    occurredAt: tsColumn('occurred_at').notNull().defaultNow(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    correlationId: text('correlation_id'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
  },
  (t, h) => [
    h.idx('orgId', 'resourceType', 'resourceId'),
    index(h.name('occurred_at_idx')).on(t.orgId, t.occurredAt.desc()),
  ],
);

/** Outbox: written in the same transaction as the change, dispatched by the job worker. */
export const domainEvents = tenantTable(
  'domain_events',
  {
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    schemaVersion: smallint('schema_version').notNull().default(1),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: tsColumn('available_at').notNull().defaultNow(),
    dispatchedAt: tsColumn('dispatched_at'),
    lastError: text('last_error'),
    correlationId: text('correlation_id'),
  },
  (_t, h) => [h.idx('status', 'availableAt'), h.idx('orgId', 'aggregateType', 'aggregateId')],
);

/** Idempotency-Key storage per org + key; replay returns the stored response. */
export const idempotencyKeys = tenantTable(
  'idempotency_keys',
  {
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    status: idempotencyStatusEnum('status').notNull().default('in_progress'),
    responseStatus: smallint('response_status'),
    responseBody: jsonb('response_body'),
    actorUserId: uuid('actor_user_id'),
    lockedUntil: tsColumn('locked_until'),
    expiresAt: tsColumn('expires_at').notNull(),
  },
  (_t, h) => [h.uniq('orgId', 'key'), h.idx('expiresAt')],
);
