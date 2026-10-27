// Tables owned by the `imagery` module (RR pages 021-024): imagery candidates and ingested assets
// with license rights, attribution, ground sample distance, capture date, georeference and expiry.
import { date, integer, jsonb, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { geometry, revisionColumn, tsColumn } from './_columns';
import { imageryKindEnum, imageryProviderEnum, imageryStatusEnum } from './_enums';
import { tenantTable } from './_tenant';
import { mediaAssets } from './media';
import { properties } from './properties';

export const imageryAssets = tenantTable(
  'imagery_assets',
  {
    propertyId: uuid('property_id').notNull(),
    provider: imageryProviderEnum('provider').notNull(),
    providerImageId: text('provider_image_id'),
    kind: imageryKindEnum('kind').notNull().default('orthophoto'),
    status: imageryStatusEnum('status').notNull().default('candidate'),
    /** License terms: { commercialUse, storageAllowed, derivativeAllowed, maxRetentionDays, ... }. */
    rights: jsonb('rights').notNull(),
    attribution: text('attribution').notNull(),
    /** Ground sample distance in meters per pixel. */
    gsdM: numeric('gsd_m', { precision: 10, scale: 5 }),
    captureDate: date('capture_date'),
    /** Affine/world-file or control points; crs is always EPSG:4326 for footprint. */
    georef: jsonb('georef'),
    footprint: geometry('footprint', 'Polygon'),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    objectKey: text('object_key'),
    mediaAssetId: uuid('media_asset_id'),
    expiresAt: tsColumn('expires_at'),
    cost: jsonb('cost'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('propertyId', () => properties),
    h.fk('mediaAssetId', () => mediaAssets),
    h.idx('propertyId', 'status'),
    h.uniq('orgId', 'provider', 'providerImageId'),
  ],
);
