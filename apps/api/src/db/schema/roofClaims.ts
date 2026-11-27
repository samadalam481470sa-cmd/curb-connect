// Roof insurance claims + agent activity log (migration 0036).
//
// A claim is the insurance workflow for one roof order (roof_orders): carrier, adjuster,
// claim number and a small status machine (filed -> adjuster_assigned -> inspection_scheduled
// -> estimate_submitted -> approved / denied -> settled). Documents are references only —
// either an already-stored media asset or the browser-side photo inspection report id
// (the inspection report lives in the browser as a draft; see
// apps/web/src/features/roof/inspection/inspection.ts, which has no server record).
// Never raw blobs.
//
// agent_activity_log is the raw material for "hours saved": one row per agent action, with
// minutes_saved only when a real duration was measured (null = not measured). Hours are
// COMPUTED from this log in modules/roofClaims/activity.ts, never stored as a headline.
import { integer, text, uuid } from 'drizzle-orm/pg-core';
import { revisionColumn } from './_columns';
import { type TenantParent, tenantTable } from './_tenant';
import { mediaAssets } from './media';
import { roofOrders } from './roof';

/** One insurance claim for one roof order. Status defaults to 'filed'. */
export const roofClaims = tenantTable(
  'roof_claims',
  {
    roofOrderId: uuid('roof_order_id').notNull(),
    carrier: text('carrier').notNull(),
    adjusterName: text('adjuster_name'),
    adjusterContact: text('adjuster_contact'),
    claimNumber: text('claim_number'),
    status: text('status').notNull().default('filed'),
    note: text('note'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('roofOrderId', () => roofOrders),
    h.idx('orgId', 'roofOrderId'),
    h.idx('orgId', 'status'),
  ],
);

/**
 * One evidence document on a claim. At least one reference is required (DB check):
 * a stored media asset, the browser-side photo inspection report id, or both.
 */
export const roofClaimDocuments = tenantTable(
  'roof_claim_documents',
  {
    claimId: uuid('claim_id').notNull(),
    mediaAssetId: uuid('media_asset_id'),
    /** Browser-side inspection draft id (see inspection.ts `newInspectionId`); no server FK. */
    inspectionReportId: text('inspection_report_id'),
    kind: text('kind').notNull().default('other'),
    label: text('label'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('claimId', () => roofClaims, 'cascade'),
    h.fk('mediaAssetId', (): TenantParent => mediaAssets, 'set null'),
    h.idx('orgId', 'claimId'),
  ],
);

/**
 * One logged action by one roofing agent. minutes_saved is null unless a real duration
 * was measured — hours saved are computed from the non-null rows only.
 */
export const agentActivityLog = tenantTable(
  'agent_activity_log',
  {
    agent: text('agent').notNull(),
    action: text('action').notNull(),
    minutesSaved: integer('minutes_saved'),
    relatedType: text('related_type'),
    relatedId: uuid('related_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.idx('orgId', 'agent', 'createdAt')],
);

/**
 * Contractor-entered time baselines (audit-gaps round 2): minutes saved per
 * agent task type, per organization. When an agent action completes, the
 * activity log row is auto-filled with the baseline for that task type.
 * Task types with no row here are not counted — the starting template in
 * modules/roofClaims/timeBaselines.ts is a labeled estimate the contractor
 * applies or edits, never a fact Field Pro asserts.
 */
export const agentTimeBaselines = tenantTable(
  'agent_time_baselines',
  {
    /** Task type: the action prefix before any ':detail' (e.g. follow_up_completed). */
    taskType: text('task_type').notNull(),
    minutes: integer('minutes').notNull(),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'taskType')],
);
