// Permit Job Search daily watch: a saved Texas permit search per company that the job worker runs
// every morning (or every two hours) and the latest ranked result. Tenant-scoped with RLS.
import { boolean, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  revisionColumn,
  tsColumn,
  updatedAtColumn,
} from './_columns';
import { tenantTable } from './_tenant';

/**
 * Daily permit-source freshness, written by the graphile-worker job `permit_sources_refresh`
 * (apps/api/src/jobs/permitSources.ts) and read by GET /v1/permit-leads/sources/status.
 * Platform-owned, not tenant data: one row per live source (source_id is the primary key), so a
 * re-run overwrites the same row instead of duplicating it. No RLS: the API reads it through the
 * named platform operation `permit.sources_status`, and the worker writes it as fieldline_platform.
 * Field health is shares (0-1) of the last 30 days' permits naming a contractor, listing a value
 * above zero, and carrying a zip code — null when the source returned no permits.
 */
export const permitSourceStatuses = pgTable('permit_source_statuses', {
  sourceId: text('source_id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('unknown'),
  newestPermitDate: tsColumn('newest_permit_date'),
  count30d: integer('count_30d').notNull().default(0),
  fieldHealth: jsonb('field_health').$type<{
    contractor: number;
    value: number;
    zip: number;
  } | null>(),
  sourceUpdatedAt: tsColumn('source_updated_at'),
  lastCheckedAt: tsColumn('last_checked_at').notNull(),
  message: text('message').notNull().default(''),
  revision: revisionColumn(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const permitWatches = tenantTable(
  'permit_watches',
  {
    enabled: boolean('enabled').notNull().default(true),
    schedule: text('schedule').notNull().default('morning'),
    search: jsonb('search').notNull(),
    lastRunAt: tsColumn('last_run_at'),
    lastMessage: text('last_message').notNull().default(''),
    lastResult: jsonb('last_result'),
    seenKeys: text('seen_keys').array().notNull().default([]),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId')],
);
