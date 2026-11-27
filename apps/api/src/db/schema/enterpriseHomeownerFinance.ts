import {
  boolean,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { HomeownerFinancialFields } from '@fieldline/contracts';

const suite = pgSchema('enterprise_suite');
export const homeownerFinanceContractLinks = suite.table('homeowner_finance_contract_links', {
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  acceptedProposalVersionId: uuid('accepted_proposal_version_id').notNull(),
});

export const homeownerFinanceVisibilityRevisions = suite.table(
  'homeowner_finance_visibility_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    revision: integer('revision').notNull(),
    enabled: boolean('enabled').notNull(),
    reason: text('reason').notNull(),
    contactId: uuid('contact_id'),
    recipientGrantId: uuid('recipient_grant_id'),
    acceptedProposalId: uuid('accepted_proposal_id'),
    acceptedProposalVersionId: uuid('accepted_proposal_version_id'),
    forecastId: uuid('forecast_id'),
    disclosure: jsonb('disclosure').$type<z.infer<typeof HomeownerFinancialFields>>(),
    tokenHash: varchar('token_hash', { length: 64 }),
    tokenSealed: text('token_sealed'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    approvedByUserId: uuid('approved_by_user_id').notNull(),
    clientRequestId: uuid('client_request_id').notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
