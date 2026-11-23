// Tables owned by the `landScout` module: saved buy boxes and company-imported parcels.
// Live county CAD data is queried per search and never stored; only parcels a company
// imports itself (e.g. a fresher DCAD export) are kept here, labeled with their source.
import { sql } from 'drizzle-orm';
import { jsonb, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { revisionColumn } from './_columns';
import { tenantTable } from './_tenant';

export const landScoutBuyBoxes = tenantTable(
  'land_scout_buy_boxes',
  {
    name: text('name').notNull(),
    /** BuyBox criteria (contracts BuyBoxSchema), stored as entered/reviewed by the user. */
    criteria: jsonb('criteria').notNull().default(sql`'{}'::jsonb`),
    createdByUserId: uuid('created_by_user_id'),
    revision: revisionColumn(),
  },
  (t, h) => [h.idx('orgId', 'createdAt')],
);

export const landScoutParcels = tenantTable(
  'land_scout_parcels',
  {
    county: text('county').notNull(),
    parcelId: text('parcel_id').notNull(),
    ownerName: text('owner_name'),
    ownerMailing: text('owner_mailing'),
    situsAddress: text('situs_address'),
    city: text('city'),
    zip: text('zip'),
    acres: numeric('acres', { precision: 14, scale: 4 }),
    appraisalUse: text('appraisal_use'),
    landValue: numeric('land_value', { precision: 16, scale: 2 }),
    marketValue: numeric('market_value', { precision: 16, scale: 2 }),
    valueYear: numeric('value_year', { precision: 6, scale: 0 }),
    lat: numeric('lat', { precision: 12, scale: 7 }),
    lon: numeric('lon', { precision: 12, scale: 7 }),
    vintage: text('vintage'),
    source: text('source').notNull(),
    sourceUrl: text('source_url').notNull().default(''),
    revision: revisionColumn(),
  },
  (t, h) => [h.uniq('orgId', 'county', 'parcelId'), h.idx('orgId', 'county')],
);
