// Active Permits Funnel storage: per-company stage + call log for funnel leads.
//
// A funnel lead is keyed by source + permit number (`lead_key`, e.g. `collin:2026-12345`);
// the lead itself is never stored — permits are re-fetched live from the city feeds on
// every funnel open, and only the company's own pipeline state (stage, call notes) is kept.
// Tenant-scoped with RLS (same pattern as permit_watches). Migration 0034.
import { index, integer, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';

/** One row per funnel lead the company has touched. Stage defaults to 'new'. */
export const permitFunnelStages = tenantTable(
  'permit_funnel_stages',
  {
    leadKey: text('lead_key').notNull(),
    stage: text('stage').notNull().default('new'),
    callCount: integer('call_count').notNull().default(0),
    lastCallAt: tsColumn('last_call_at'),
    lastNote: text('last_note'),
    revision: revisionColumn(),
  },
  (t) => [
    uniqueIndex('permit_funnel_stages_org_lead_uq').on(t.orgId, t.leadKey),
  ],
);

/** One row per logged call on a funnel lead, newest first by created_at. */
export const permitFunnelCalls = tenantTable(
  'permit_funnel_calls',
  {
    leadKey: text('lead_key').notNull(),
    outcome: text('outcome').notNull().default('answered'),
    note: text('note').notNull().default(''),
    revision: revisionColumn(),
  },
  (t) => [
    index('permit_funnel_calls_org_lead_idx').on(t.orgId, t.leadKey, t.createdAt),
  ],
);
