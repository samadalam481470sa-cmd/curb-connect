// GIS Workbench contracts: desktop-grade map workspace (the QGIS-desktop equivalent built for
// the web). Layer queries are bbox-based; layer answers are GeoJSON feature collections with
// typed attributes, a source, a checked-at time and an honest status — a down upstream is
// `upstream_unavailable`, never invented rows. The print composer renders a DRAFT plan sheet
// PDF from a snapshot (map image + legend + scale bar + north arrow + source notes).
import { z } from 'zod';

const Lon = z.number().min(-180).max(180);
const Lat = z.number().min(-90).max(90);

/** Map view bounds. The API clamps the span: parcel/stream queries are view-scale, not county-scale. */
export const GisBboxSchema = z.object({
  west: Lon,
  south: Lat,
  east: Lon,
  north: Lat,
});
export type GisBbox = z.infer<typeof GisBboxSchema>;

export const GisLayerQuerySchema = z.object({ bbox: GisBboxSchema });
export type GisLayerQuery = z.infer<typeof GisLayerQuerySchema>;

// ---------------------------------------------------------------- GeoJSON shapes

const PositionSchema = z.array(z.number()).min(2).max(3);
const LinearRingSchema = z.array(PositionSchema).min(4);
const PolygonCoordinatesSchema = z.array(LinearRingSchema).min(1);
const MultiPolygonCoordinatesSchema = z.array(PolygonCoordinatesSchema).min(1);
const LineStringCoordinatesSchema = z.array(PositionSchema).min(2);
const MultiLineStringCoordinatesSchema = z.array(LineStringCoordinatesSchema).min(1);

export const GisPolygonGeometrySchema = z.union([
  z.object({ type: z.literal('Polygon'), coordinates: PolygonCoordinatesSchema }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: MultiPolygonCoordinatesSchema }),
]);
export type GisPolygonGeometry = z.infer<typeof GisPolygonGeometrySchema>;

export const GisLineGeometrySchema = z.union([
  z.object({ type: z.literal('LineString'), coordinates: LineStringCoordinatesSchema }),
  z.object({ type: z.literal('MultiLineString'), coordinates: MultiLineStringCoordinatesSchema }),
]);
export type GisLineGeometry = z.infer<typeof GisLineGeometrySchema>;

// ---------------------------------------------------------------- parcels layer

/** One CAD parcel as published (Collin CCAD / Dallas DCAD via City of Dallas GIS). */
export const GisParcelPropertiesSchema = z.object({
  layer: z.literal('parcels'),
  county: z.enum(['collin', 'dallas']),
  parcelId: z.string(),
  ownerName: z.string().nullable(),
  situsAddress: z.string().nullable(),
  city: z.string().nullable(),
  zip: z.string().nullable(),
  acres: z.number().nullable(),
  /** Appraisal use/class as published by the CAD (not municipal zoning). */
  appraisalUse: z.string().nullable(),
  landValue: z.number().nullable(),
  marketValue: z.number().nullable(),
  valueYear: z.number().nullable(),
  /** Data vintage as published (CAD data date / appraisal year), never a freshness claim. */
  vintage: z.string().nullable(),
});
export type GisParcelProperties = z.infer<typeof GisParcelPropertiesSchema>;

export const GisParcelFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: GisPolygonGeometrySchema,
  properties: GisParcelPropertiesSchema,
});
export type GisParcelFeature = z.infer<typeof GisParcelFeatureSchema>;

export const GisParcelsResponseSchema = z.object({
  status: z.enum(['ok', 'empty', 'upstream_unavailable']),
  source: z.string(),
  sourceUrl: z.string(),
  checkedAt: z.string(),
  /** True when a county service hit the record cap: the view shows a subset, said plainly. */
  truncated: z.boolean(),
  featureCount: z.number().int().nonnegative(),
  message: z.string(),
  features: z.array(GisParcelFeatureSchema),
});
export type GisParcelsResponse = z.infer<typeof GisParcelsResponseSchema>;

// ---------------------------------------------------------------- streams layer

/** One USGS NHD flowline as published. NHD warns the data is not for site-specific regulatory determinations. */
export const GisStreamPropertiesSchema = z.object({
  layer: z.literal('streams'),
  name: z.string(),
  type: z.enum(['stream', 'canal', 'waterway']),
  /** NHD feature type code as published (460 StreamRiver, 336 CanalDitch, 558 Artificial Path, …). */
  ftype: z.number().nullable(),
});
export type GisStreamProperties = z.infer<typeof GisStreamPropertiesSchema>;

export const GisStreamFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: GisLineGeometrySchema,
  properties: GisStreamPropertiesSchema,
});
export type GisStreamFeature = z.infer<typeof GisStreamFeatureSchema>;

export const GisStreamsResponseSchema = z.object({
  status: z.enum(['ok', 'empty', 'upstream_unavailable']),
  source: z.string(),
  sourceUrl: z.string(),
  checkedAt: z.string(),
  truncated: z.boolean(),
  featureCount: z.number().int().nonnegative(),
  message: z.string(),
  features: z.array(GisStreamFeatureSchema),
});
export type GisStreamsResponse = z.infer<typeof GisStreamsResponseSchema>;

// ---------------------------------------------------------------- roofs layer

/** One traced roof facet from the company's saved roof measurements (contractor-traced on imagery). */
export const GisRoofPropertiesSchema = z.object({
  layer: z.literal('roofs'),
  measurementId: z.string(),
  address: z.string(),
  label: z.string().nullable(),
  planSqFt: z.number(),
  /** Null while pitch is unknown: never a partial total presented as complete. */
  slopedSqFt: z.number().nullable(),
  pitchRise: z.number().nullable(),
  needsReview: z.boolean(),
});
export type GisRoofProperties = z.infer<typeof GisRoofPropertiesSchema>;

export const GisRoofFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: GisPolygonGeometrySchema,
  properties: GisRoofPropertiesSchema,
});
export type GisRoofFeature = z.infer<typeof GisRoofFeatureSchema>;

export const GisRoofsResponseSchema = z.object({
  status: z.enum(['ok', 'empty']),
  source: z.string(),
  checkedAt: z.string(),
  /** Saved measurements in the view whose geometry could not be read (counted, never placed). */
  unreadable: z.number().int().nonnegative(),
  featureCount: z.number().int().nonnegative(),
  message: z.string(),
  features: z.array(GisRoofFeatureSchema),
});
export type GisRoofsResponse = z.infer<typeof GisRoofsResponseSchema>;

// ---------------------------------------------------------------- print composer

export const GisPageSizeSchema = z.enum(['letter', 'legal', 'tabloid']);
export type GisPageSize = z.infer<typeof GisPageSizeSchema>;

export const GisPrintRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(1).max(120),
  pageSize: GisPageSizeSchema.default('letter'),
  orientation: z.enum(['portrait', 'landscape']).default('landscape'),
  /** PNG data URL of the current map view, captured from the workbench canvas. */
  mapImageDataUrl: z
    .string()
    .startsWith('data:image/png;base64,')
    .max(8_000_000),
  centerLat: Lat,
  centerLon: Lon,
  zoom: z.number().min(0).max(24),
  /** Map bearing in degrees (0 = north up); the north arrow rotates by the inverse. */
  bearing: z.number().min(-360).max(360).default(0),
  /** Scale-bar caption computed at the map centre, e.g. "500 ft". Approximate, said so on the sheet. */
  scaleBarLabel: z.string().trim().min(1).max(40),
  /** Scale-bar width as a fraction of the map frame width (0..1). */
  scaleBarWidthFraction: z.number().min(0.01).max(1),
  legend: z
    .array(z.object({ label: z.string().trim().min(1).max(80), color: z.string().trim().min(1).max(32) }))
    .max(12)
    .default([]),
  /** Visible-layer summary lines (feature counts + status), frozen at export time. */
  layerSummary: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        featureCount: z.number().int().nonnegative(),
        status: z.string().trim().min(1).max(60),
      }),
    )
    .max(12)
    .default([]),
  /** Source notes printed on the sheet (imagery + each layer's publisher). */
  sourceNotes: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
});
export type GisPrintRequest = z.infer<typeof GisPrintRequestSchema>;

export const GisPrintResponseSchema = z.object({
  filename: z.string(),
  contentBase64: z.string(),
  sha256Hex: z.string(),
  pages: z.number().int().positive(),
});
export type GisPrintResponse = z.infer<typeof GisPrintResponseSchema>;
