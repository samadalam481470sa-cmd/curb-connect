import {
  integer,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { EnterpriseEstimateStatus, EnterpriseEstimateUnit } from '@fieldline/contracts';
import type { z } from 'zod';

const suite = pgSchema('enterprise_suite');
const id = () => uuid('id').primaryKey().defaultRandom();
const org = () => uuid('org_id').notNull();
const project = () => uuid('project_id').notNull();
const createdBy = () => uuid('created_by_user_id').notNull();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const enterpriseEstimates = suite.table('project_estimates', {
  id: id(),
  orgId: org(),
  projectId: project(),
  title: text('title').notNull(),
  createdByUserId: createdBy(),
  createdAt: createdAt(),
  clientRequestId: uuid('client_request_id').notNull(),
});

export const enterpriseEstimateRevisions = suite.table('project_estimate_revisions', {
  id: id(),
  orgId: org(),
  projectId: project(),
  estimateId: uuid('estimate_id').notNull(),
  revisionNumber: integer('revision_number').notNull(),
  revision: integer('revision').notNull().default(1),
  currency: varchar('currency', { length: 3 }).notNull(),
  quantityPrecision: smallint('quantity_precision').notNull(),
  status: text('status')
    .$type<z.infer<typeof EnterpriseEstimateStatus>>()
    .notNull()
    .default('draft'),
  createdByUserId: createdBy(),
  createdAt: createdAt(),
  approvedByUserId: uuid('approved_by_user_id'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvalReason: text('approval_reason'),
});

export const enterpriseEstimateLines = suite.table('project_estimate_lines', {
  id: id(),
  orgId: org(),
  projectId: project(),
  estimateRevisionId: uuid('estimate_revision_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  description: text('description').notNull(),
  unit: text('unit').$type<EnterpriseEstimateUnit>().notNull(),
  quantity: numeric('quantity'),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdByUserId: createdBy(),
  createdAt: createdAt(),
  clientRequestId: uuid('client_request_id').notNull(),
});
