import type {
  EnterpriseSalesLeadInput,
  SalesLeadConsent,
  SalesStageKey,
} from '@fieldline/contracts';
import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

const suite = pgSchema('enterprise_suite');

export const enterpriseSalesLeadSources = suite.table('sales_lead_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseSalesLeads = suite.table('sales_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  sourceId: uuid('source_id').notNull(),
  ownerMembershipId: uuid('owner_membership_id'),
  pipelineStage: text('pipeline_stage').$type<SalesStageKey>().notNull().default('new'),
  stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }),
  communityId: uuid('community_id'),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  contactMethod: text('contact_method')
    .$type<z.infer<typeof EnterpriseSalesLeadInput>['contactMethod']>()
    .notNull(),
  consent: jsonb('consent').$type<z.infer<typeof SalesLeadConsent>>().notNull(),
  possibleDuplicate: boolean('possible_duplicate').notNull(),
  revision: integer('revision').notNull().default(1),
  createdByUserId: uuid('created_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  inboundEventId: text('inbound_event_id'),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseSalesLeadActivities = suite.table('sales_lead_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  kind: text('kind').$type<'created'>().notNull(),
  actorUserId: uuid('actor_user_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});
