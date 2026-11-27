import type { LogEnterpriseSalesInteraction } from '@fieldline/contracts';
import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

const suite = pgSchema('enterprise_suite');
type LogInput = z.infer<typeof LogEnterpriseSalesInteraction>;
const leadScope = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const salesLeadConversations = suite.table('sales_lead_conversations', {
  ...leadScope(),
  title: text('title').notNull(),
  openedByUserId: uuid('opened_by_user_id').notNull(),
});

export const salesLeadInteractions = suite.table('sales_lead_interactions', {
  ...leadScope(),
  channel: text('channel').$type<LogInput['channel']>().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  outcome: text('outcome').$type<LogInput['outcome']>().notNull(),
  notes: text('notes').notNull(),
  conversationId: uuid('conversation_id'),
  leadRevision: integer('lead_revision').notNull(),
  recordedByUserId: uuid('recorded_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: text('request_hash').notNull(),
});

export const salesLeadFollowUps = suite.table('sales_lead_follow_ups', {
  ...leadScope(),
  interactionId: uuid('interaction_id').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  reminderScheduled: boolean('reminder_scheduled').notNull(),
});

export const salesFollowUpPolicyRevisions = suite.table('sales_follow_up_policy_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  pipelineKey: text('pipeline_key').$type<'home_sales'>().notNull(),
  enabled: boolean('enabled').notNull(),
  revision: integer('revision').notNull(),
  reason: text('reason').notNull(),
  actorUserId: uuid('actor_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
