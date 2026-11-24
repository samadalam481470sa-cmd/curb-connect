// Gov Opportunities scan results, written by the graphile-worker job
// `gov_opportunities_refresh` (apps/api/src/jobs/govOpportunities.ts) and read by
// GET /v1/gov-opportunities and GET /v1/gov-opportunities/status. Platform-owned, not tenant
// data: one row per (seed page, outbound link), keyed by a deterministic key, so a re-run
// overwrites the same row instead of duplicating it. No RLS: the API reads it through the
// named platform operation `gov.opportunities` and the worker writes it as fieldline_platform.
// A link is 'dead' only when an actual HTTP check returned 4xx/5xx or the host no longer
// resolves; a check that timed out or errored another way is 'unknown'.
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, revisionColumn, tsColumn, updatedAtColumn } from './_columns';

export const govLinkChecks = pgTable('gov_link_checks', {
  key: text('key').primaryKey(),
  pageId: text('page_id').notNull(),
  pageName: text('page_name').notNull(),
  pageCity: text('page_city').notNull(),
  pageUrl: text('page_url').notNull(),
  linkUrl: text('link_url').notNull(),
  linkText: text('link_text').notNull().default(''),
  status: text('status').notNull().default('unknown'),
  httpStatus: integer('http_status'),
  checkedAt: tsColumn('checked_at').notNull(),
  note: text('note'),
  revision: revisionColumn(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});
