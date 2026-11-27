import type { SalesStageKey } from '@fieldline/contracts';
import { bigint, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
export const salesStageEvents = suite.table('sales_stage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  fromStage: text('from_stage').$type<SalesStageKey>().notNull(),
  toStage: text('to_stage').$type<SalesStageKey>().notNull(),
  reason: text('reason'),
  previousStageDurationMs: bigint('previous_stage_duration_ms', { mode: 'number' }).notNull(),
  revision: integer('revision').notNull(),
  actorUserId: uuid('actor_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
