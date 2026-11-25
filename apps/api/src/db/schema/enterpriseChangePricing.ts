import { bigint, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ChangePricedLine } from '@fieldline/contracts';

export const enterpriseChangePricingRevisions = pgSchema('enterprise_suite').table(
  'change_pricing_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    changeOrderId: uuid('change_order_id').notNull(),
    orderRevision: integer('order_revision').notNull(),
    scope: text('scope').notNull(),
    scheduleImpactDays: integer('schedule_impact_days').notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    lines: jsonb('lines').$type<ChangePricedLine[]>().notNull(),
    revisionNote: text('revision_note').notNull(),
    evidenceVersionId: uuid('evidence_version_id'),
    clientRequestId: uuid('client_request_id').notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
