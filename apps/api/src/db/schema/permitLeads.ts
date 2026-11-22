// Permit Job Search daily watch: a saved Texas permit search per company that the job worker runs
// every morning (or every two hours) and the latest ranked result. Tenant-scoped with RLS.
import { boolean, jsonb, text } from 'drizzle-orm/pg-core';
import { revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';

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
