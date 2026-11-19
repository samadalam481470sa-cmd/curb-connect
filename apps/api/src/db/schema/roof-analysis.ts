// Roof analysis runs (ROOF-AI-001). Each row belongs to one property and snapshots the address the
// person confirmed, so a later pin move cannot silently change what was analysed. A succeeded row
// also acts as the durable cache: a new run with the same provider/location reuses the newest
// succeeded result until its TTL expires, avoiding repeat Google Solar quota spend.
import { boolean, doublePrecision, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { properties } from './properties';
import { roofOrders } from './roof';

export const ROOF_ANALYSIS_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type RoofAnalysisJobStatus = (typeof ROOF_ANALYSIS_JOB_STATUSES)[number];

export const roofAnalysisJobs = tenantTable(
  'roof_analysis_jobs',
  {
    propertyId: uuid('property_id').notNull(),
    roofOrderId: uuid('roof_order_id'),
    requestedByUserId: uuid('requested_by_user_id'),
    status: text('status').$type<RoofAnalysisJobStatus>().notNull().default('queued'),
    provider: text('provider').notNull().default('google_solar'),
    /** Provider + rounded confirmed coordinates (see solarCacheKey). */
    cacheKey: text('cache_key').notNull(),
    /** Address snapshot taken when the run was requested; evidence of what was confirmed. */
    confirmedAddress: text('confirmed_address').notNull(),
    confirmedLatitude: doublePrecision('confirmed_latitude').notNull(),
    confirmedLongitude: doublePrecision('confirmed_longitude').notNull(),
    /** Normalized provider insights; null until a run succeeds. */
    result: jsonb('result'),
    cached: boolean('cached').notNull().default(false),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: tsColumn('started_at'),
    finishedAt: tsColumn('finished_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('propertyId', () => properties),
    h.fk('roofOrderId', () => roofOrders),
    h.idx('orgId', 'status'),
    h.idx('orgId', 'cacheKey', 'finishedAt'),
    h.idx('propertyId', 'createdAt'),
  ],
);
