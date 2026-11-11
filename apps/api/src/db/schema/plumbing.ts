// Plumbing Pro persistence (ConstructionOS module 10): projects, calibrated plan versions, immutable
// design revisions and priced estimates. Every table is tenant-owned (`tenantTable` adds org_id, id,
// timestamps and the revision counter); RLS from the generated migration keeps each company's plans,
// designs and prices unreachable from any other company.
import { sql } from 'drizzle-orm';
import { integer, jsonb, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { minorUnits, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';

export const plumbingProjects = tenantTable(
  'plumbing_projects',
  {
    name: text('name').notNull(),
    jurisdiction: text('jurisdiction').notNull().default(''),
    /** draft | active | archived (validated by the API contract). */
    status: text('status').notNull().default('draft'),
    createdByUserId: uuid('created_by_user_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.idx('orgId', 'status')],
);

/**
 * A calibrated plan page. The raw file lives in object storage once uploads are enabled; this row
 * records the calibration arithmetic (reference distance, measured pixels, derived scale) so any
 * reviewer can re-check it. No binary content is stored here.
 */
export const plumbingPlanVersions = tenantTable(
  'plumbing_plan_versions',
  {
    projectId: uuid('project_id').notNull(),
    filename: text('filename').notNull(),
    pageNumber: integer('page_number').notNull().default(1),
    referenceFeet: numeric('reference_feet', { precision: 12, scale: 3 }).notNull(),
    measuredPixels: integer('measured_pixels').notNull(),
    feetPerPixel: numeric('feet_per_pixel', { precision: 16, scale: 8 }).notNull(),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('projectId', () => plumbingProjects, 'cascade'), h.idx('orgId', 'projectId')],
);

/**
 * Immutable design snapshot. A revision is never edited: a change creates the next revision, so an
 * estimate always points at the exact fixtures and runs it was priced from (PL-010, PL-016).
 */
export const plumbingRevisions = tenantTable(
  'plumbing_revisions',
  {
    projectId: uuid('project_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    fixtures: jsonb('fixtures')
      .notNull()
      .default(sql`'[]'::jsonb`),
    runs: jsonb('runs')
      .notNull()
      .default(sql`'[]'::jsonb`),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id'),
    approvedAt: tsColumn('approved_at'),
    approvedByUserId: uuid('approved_by_user_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('projectId', () => plumbingProjects, 'cascade'),
    h.uniq('orgId', 'projectId', 'revisionNumber'),
    h.idx('orgId', 'projectId'),
  ],
);

/**
 * Computed, stored estimate. Totals are calculated by the deterministic engine on the server, never
 * accepted from the client; approval freezes the record and is written to the audit trail.
 */
export const plumbingEstimates = tenantTable(
  'plumbing_estimates',
  {
    projectId: uuid('project_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    /** draft | approved | superseded (validated by the API contract). */
    status: text('status').notNull().default('draft'),
    prices: jsonb('prices')
      .notNull()
      .default(sql`'{}'::jsonb`),
    totals: jsonb('totals').notNull(),
    laborHours: numeric('labor_hours', { precision: 12, scale: 2 }).notNull(),
    materialMinor: minorUnits('material_minor').notNull().default(0),
    unpricedLineKeys: jsonb('unpriced_line_keys')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdByUserId: uuid('created_by_user_id'),
    approvedAt: tsColumn('approved_at'),
    approvedByUserId: uuid('approved_by_user_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('projectId', () => plumbingProjects, 'cascade'),
    h.fk('revisionId', () => plumbingRevisions, 'cascade'),
    h.idx('orgId', 'projectId'),
    h.idx('orgId', 'status'),
  ],
);
