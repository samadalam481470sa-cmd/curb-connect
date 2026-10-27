// Tables owned by the `properties` module: properties (geocoded, reviewable), structures, and the
// global jurisdictions reference table (PostGIS boundaries + rules version).
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  deletedAtColumn,
  geography,
  geometry,
  idColumn,
  revisionColumn,
  tsColumn,
  updatedAtColumn,
} from './_columns';
import { jurisdictionKindEnum, jurisdictionStatusEnum, structureKindEnum, structureScopeStatusEnum } from './_enums';
import { tenantTable } from './_tenant';

/**
 * Global reference data (no org_id, no RLS; writable only by the platform role). Rules are
 * versioned: approvals and estimates record the rules_version they were evaluated against.
 */
export const jurisdictions = pgTable(
  'jurisdictions',
  {
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: jurisdictionKindEnum('kind').notNull(),
    status: jurisdictionStatusEnum('status').notNull().default('draft'),
    parentId: uuid('parent_id'),
    countryCode: text('country_code').notNull().default('US'),
    region: text('region'),
    boundary: geometry('boundary', 'MultiPolygon'),
    rulesVersion: text('rules_version').notNull().default('0'),
    rules: jsonb('rules').notNull().default(sql`'{}'::jsonb`),
    sourceUrl: text('source_url'),
    verifiedAt: tsColumn('verified_at'),
    /** Synthetic jurisdictions for demos/tests are flagged and never shown as real rules. */
    isSynthetic: boolean('is_synthetic').notNull().default(false),
    revision: revisionColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('jurisdictions_code_uq').on(t.code),
    index('jurisdictions_boundary_gist').using('gist', t.boundary),
  ],
);

export const properties = tenantTable(
  'properties',
  {
    label: text('label'),
    /** Exactly what the user typed or picked. */
    originalQuery: text('original_query').notNull(),
    line1: text('line1'),
    line2: text('line2'),
    locality: text('locality'),
    region: text('region'),
    postalCode: text('postal_code'),
    countryCode: text('country_code').notNull().default('US'),
    normalizedAddress: text('normalized_address'),
    geocoderProvider: text('geocoder_provider'),
    geocoderPlaceId: text('geocoder_place_id'),
    /** 0..1 geocoder confidence. */
    geocodeConfidence: numeric('geocode_confidence', { precision: 4, scale: 3 }),
    geocodedAt: tsColumn('geocoded_at'),
    location: geography('location', 'Point'),
    /** Set when a person drops/moves the pin; wins over the geocoded point. */
    confirmedLocation: geography('confirmed_location', 'Point'),
    confirmedByUserId: uuid('confirmed_by_user_id'),
    confirmedAt: tsColumn('confirmed_at'),
    needsReview: boolean('needs_review').notNull().default(false),
    reviewReason: text('review_reason'),
    parcelId: text('parcel_id'),
    jurisdictionId: uuid('jurisdiction_id').references(() => jurisdictions.id),
    /** Fictional demo/test addresses only (seed data). */
    isFictional: boolean('is_fictional').notNull().default(false),
    notes: text('notes'),
    revision: revisionColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t, h) => [
    h.idx('orgId', 'normalizedAddress'),
    index(h.name('location_gist')).using('gist', t.location),
    index(h.name('confirmed_location_gist')).using('gist', t.confirmedLocation),
  ],
);

export const structures = tenantTable(
  'structures',
  {
    propertyId: uuid('property_id').notNull(),
    label: text('label').notNull(),
    kind: structureKindEnum('kind').notNull().default('main_house'),
    scopeStatus: structureScopeStatusEnum('scope_status').notNull().default('included'),
    footprint: geometry('footprint', 'Polygon'),
    stories: integer('stories'),
    yearBuilt: integer('year_built'),
    sortOrder: integer('sort_order').notNull().default(0),
    observedOn: date('observed_on'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('propertyId', () => properties, 'cascade'),
    h.uniq('propertyId', 'label'),
    index(h.name('footprint_gist')).using('gist', t.footprint),
  ],
);
