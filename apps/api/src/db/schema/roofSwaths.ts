// Stored hail swaths (migration 0038): one row per UTC day, written by the swath worker
// (apps/swath-worker) from NOAA MRMS MESH Max 1440min and read by
// GET /v1/roof-storms/swath. Platform-owned, not tenant data: no RLS — the API reads it
// through the named platform operation `roof.swath` and the worker writes it with the owner
// database URL. Features are GeoJSON Polygon/MultiPolygon features with
// properties.maxHailIn (inches); MRMS is a modeled radar estimate, never confirmed damage.
import { date, integer, jsonb, numeric, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, revisionColumn, tsColumn, updatedAtColumn } from './_columns';

/** One GeoJSON hail-path feature stored in a roof_swaths row. */
export interface RoofSwathFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: { maxHailIn: number };
}

export const roofSwaths = pgTable('roof_swaths', {
  /** UTC date of the MRMS file's validity time (the trailing-24h window's end). */
  swathDate: date('swath_date').primaryKey(),
  source: text('source').notNull().default('NOAA MRMS MESH Max 1440min'),
  /** Timestamped MRMS filename the row was built from, e.g. MRMS_MESH_Max_1440min_00.50_20261125-013000.grib2.gz. */
  sourceFile: text('source_file').notNull().default(''),
  sourceValidAt: tsColumn('source_valid_at'),
  /** Severe-hail threshold the cells were cut at, in inches. */
  thresholdIn: numeric('threshold_in', { precision: 4, scale: 2 }).notNull().default('1.00'),
  features: jsonb('features').$type<RoofSwathFeature[]>().notNull().default([]),
  featureCount: integer('feature_count').notNull().default(0),
  /** MRMS grid cells at/above the threshold that built the features. */
  cellCount: integer('cell_count').notNull().default(0),
  checkedAt: tsColumn('checked_at').notNull(),
  revision: revisionColumn(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});
