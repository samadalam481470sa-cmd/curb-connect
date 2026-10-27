// Tables owned by the `changeorders` module (OPS-068): scope/price changes after a contract.
import { sql } from 'drizzle-orm';
import { integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import { changeOrderStatusEnum } from './_enums';
import { tenantTable } from './_tenant';
import { estimateRevisions } from './estimates';
import { jobs } from './jobs';
import { contracts, signatureEnvelopes } from './signatures';

export const changeOrders = tenantTable(
  'change_orders',
  {
    number: text('number').notNull(),
    jobId: uuid('job_id').notNull(),
    contractId: uuid('contract_id'),
    status: changeOrderStatusEnum('status').notNull().default('draft'),
    title: text('title').notNull(),
    reason: text('reason').notNull(),
    lines: jsonb('lines').notNull().default(sql`'[]'::jsonb`),
    amountDeltaMinor: minorUnits('amount_delta_minor').notNull(),
    currency: currencyColumn(),
    scheduleImpactDays: integer('schedule_impact_days').notNull().default(0),
    estimateRevisionId: uuid('estimate_revision_id'),
    envelopeId: uuid('envelope_id'),
    sentAt: tsColumn('sent_at'),
    decidedAt: tsColumn('decided_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.uniq('orgId', 'number'),
    h.fk('jobId', () => jobs),
    h.fk('contractId', () => contracts),
    h.fk('estimateRevisionId', () => estimateRevisions),
    h.fk('envelopeId', () => signatureEnvelopes),
  ],
);
