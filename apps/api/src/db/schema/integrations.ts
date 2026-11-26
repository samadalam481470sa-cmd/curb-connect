// Tables owned by the `integrations` module: a sync log for external accounting syncs
// (QuickBooks Online first). The integration is gated until the owner connects their Intuit
// OAuth app — until then every attempt records the honest 'not_connected' state and nothing
// syncs. The payments rail needs no table yet: it is provider-shaped scaffolding whose status
// comes from configuration, and payouts ride on AP invoices (jobCost) once a provider exists.
import { integer, text } from 'drizzle-orm/pg-core';
import { tsColumn } from './_columns';
import { tenantTable } from './_tenant';

export const integrationSyncLog = tenantTable(
  'integration_sync_log',
  {
    provider: text('provider').$type<'quickbooks'>().notNull(),
    state: text('state').$type<'ok' | 'not_connected' | 'failed'>().notNull(),
    pushed: integer('pushed').notNull().default(0),
    pulled: integer('pulled').notNull().default(0),
    message: text('message'),
    ranAt: tsColumn('ran_at').notNull().defaultNow(),
  },
  (_t, h) => [h.idx('orgId', 'provider', 'ranAt')],
);
