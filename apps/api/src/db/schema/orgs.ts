// Tables owned by the `orgs` module: organizations (the tenant root), immutable settings
// revisions and PostGIS service areas (PLT-013, PLT-014).
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  currencyColumn,
  geometry,
  idColumn,
  revisionColumn,
  updatedAtColumn,
} from './_columns';
import { measurementSystemEnum, orgStatusEnum, productLineEnum, serviceAreaKindEnum } from './_enums';
import { tenantTable } from './_tenant';

/**
 * The tenant root. RLS on this table compares `id` (not org_id) with app.org_id, so a member
 * can only read their own organization row; creating one is a platform/bootstrap operation.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: idColumn(),
    slug: text('slug').notNull(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    status: orgStatusEnum('status').notNull().default('active'),
    productLines: productLineEnum('product_lines').array().notNull().default(sql`'{}'`),
    timezone: text('timezone').notNull().default('America/Chicago'),
    locale: text('locale').notNull().default('en-US'),
    currency: currencyColumn(),
    measurementSystem: measurementSystemEnum('measurement_system').notNull().default('imperial'),
    /** Fictional/demo tenants are flagged so they can never be mistaken for real customers. */
    isDemo: boolean('is_demo').notNull().default(false),
    revision: revisionColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [unique('organizations_slug_uq').on(t.slug), index('organizations_status_idx').on(t.status)],
);

/**
 * PLT-014: every settings change writes a new immutable revision (insert-only, enforced by a
 * trigger). Current settings = the row with the highest revision_number.
 */
export const orgSettingsRevisions = tenantTable(
  'org_settings_revisions',
  {
    revisionNumber: integer('revision_number').notNull(),
    settings: jsonb('settings').notNull(),
    changeReason: text('change_reason'),
    changedByUserId: uuid('changed_by_user_id'),
  },
  (_t, h) => [h.uniq('orgId', 'revisionNumber')],
);

/** PLT-013 service areas: where the company works; drives jurisdiction lookups and routing. */
export const serviceAreas = tenantTable(
  'service_areas',
  {
    name: text('name').notNull(),
    kind: serviceAreaKindEnum('kind').notNull().default('custom'),
    productLines: productLineEnum('product_lines').array().notNull().default(sql`'{}'`),
    boundary: geometry('boundary', 'MultiPolygon').notNull(),
    active: boolean('active').notNull().default(true),
    revision: revisionColumn(),
  },
  (t, h) => [h.uniq('orgId', 'name'), index(h.name('boundary_gist')).using('gist', t.boundary)],
);
