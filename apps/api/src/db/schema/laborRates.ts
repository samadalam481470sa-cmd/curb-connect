// Labor rate book (audit-gaps round 2): contractor-entered hourly rates per
// Plan-to-Bid trade, stored per organization and reusable across bids. A rate
// reaches a bid only when the contractor picks it — nothing here is ever
// auto-applied, and there are no default rates. Money is integer minor units
// (cents per hour).
import { integer, text } from 'drizzle-orm/pg-core';
import { revisionColumn } from './_columns';
import { tenantTable } from './_tenant';

export const laborRates = tenantTable(
  'labor_rates',
  {
    /** Plan-to-Bid trade value (contracts PlanToBidTradeSchema). */
    trade: text('trade').notNull(),
    /** Contractor's own name for the rate, e.g. "Journeyman" or "Crew A". */
    label: text('label').notNull(),
    rateCentsPerHour: integer('rate_cents_per_hour').notNull(),
    note: text('note').notNull().default(''),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'trade', 'label'), h.idx('orgId', 'trade')],
);
