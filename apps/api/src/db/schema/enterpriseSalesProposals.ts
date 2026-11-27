import {
  bigint,
  customType,
  date,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const meta = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  revision: integer('revision').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const salesProposalTemplateRevisions = suite.table('sales_proposal_template_revisions', {
  ...meta(),
  name: text('name').notNull(),
  terms: jsonb('terms').$type<string[]>().notNull(),
  paymentTerms: jsonb('payment_terms').$type<string[]>().notNull(),
  taxTreatment: text('tax_treatment').notNull(),
  reason: text('reason').notNull(),
  approvedByUserId: uuid('approved_by_user_id').notNull(),
});
export const salesProposalIssues = suite.table('sales_proposal_issues', {
  ...meta(),
  opportunityId: uuid('opportunity_id').notNull(),
  estimateRevisionId: uuid('estimate_revision_id').notNull(),
  templateRevisionId: uuid('template_revision_id').notNull(),
  proposalId: uuid('proposal_id').notNull(),
  proposalVersionId: uuid('proposal_version_id').notNull(),
  totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  validUntil: date('valid_until').notNull(),
  pdfBytes: bytes('pdf_bytes').notNull(),
  pdfSha256: text('pdf_sha256').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
});
