// USA Structures (FEMA Geospatial Response Office, Oak Ridge National Laboratory, USGS): building
// footprints for structures larger than 450 sq ft. Licence: CC BY 4.0, so storing derived data is
// allowed with attribution (see licenses.ts). Property address fields are deliberately NOT carried
// forward: they are personal information and their upstream provenance is not established.
import { polygonAreaSqM, type Ring } from './footprints';
import type { ShpShape, DbfPhysicalRecord } from './shapefile';

export const USA_STRUCTURES_ATTRIBUTION =
  'Building footprints: USA Structures, FEMA Geospatial Response Office, Oak Ridge National Laboratory and USGS. Licensed CC BY 4.0.';

/** Geographic box covering Texas and its four bordering launch states (generous, for sanity checks). */
export const LAUNCH_BOUNDS = { minLat: 25.8, maxLat: 37.0, minLon: -106.7, maxLon: -88.8 } as const;

export const SQM_TO_SQFT = 10.763910416709722;
/** The dataset's inclusion threshold: structures greater than 450 sq ft. */
export const MIN_STRUCTURE_SQFT = 450;

/** Attribute fields the product may keep. Everything else, including addresses, is dropped. */
export const KEPT_FIELDS = [
  'build_id',
  'occ_cls',
  'prim_occ',
  'outbldg',
  'height',
  'sqfeet',
  'sqmeters',
  'fips',
  'censuscode',
  'source',
  'latitude',
  'longitude',
  'uuid',
] as const;

export type KeptField = (typeof KEPT_FIELDS)[number];

export function keepAllowedFields(values: Record<string, string>): Partial<Record<KeptField, string>> {
  const out: Partial<Record<KeptField, string>> = {};
  for (const key of KEPT_FIELDS) {
    if (values[key] !== undefined) out[key] = values[key];
  }
  return out;
}

/** Split a polygon shape into rings using its part start indices. Returns null if the parts are malformed. */
export function shapeRings(shape: { parts: readonly number[]; points: readonly [number, number][] }): Ring[] | null {
  const { parts, points } = shape;
  if (points.length === 0) return null;
  if (parts.length === 0) return [points.slice()];
  if (parts[0] !== 0) return null;
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i]! <= parts[i - 1]! || parts[i]! >= points.length) return null;
  }
  return parts.map((start, i) => points.slice(start, parts[i + 1] ?? points.length));
}

/** A ring is usable when it has at least four points and is closed. */
export function ringIsValid(ring: Ring): boolean {
  if (ring.length < 4) return false;
  const [fx, fy] = ring[0]!;
  const [lx, ly] = ring[ring.length - 1]!;
  return Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9;
}

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export interface StructuresAnalysis {
  shapeRecords: number;
  dbfRecords: number;
  deletedRows: number;
  /** Shapefile and attribute table describe the same number of records. */
  countsMatch: boolean;
  invalidGeometry: number;
  outsideBounds: number;
  belowMinimumSqFt: number;
  totalSqFt: number;
  /** Relative difference between our polygon area and the dataset's sqfeet attribute. */
  areaCheck: { compared: number; medianRelErr: number | null; p95RelErr: number | null };
  occupancy: Record<string, number>;
  height: { withHeight: number; medianM: number | null; maxM: number | null };
  duplicateUuids: number;
  kept: Array<Partial<Record<KeptField, string>>>;
}

export interface AnalyzeOptions {
  bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  /** Keep the first N cleaned rows (for sampling). Default 0 = keep none. */
  keepSample?: number;
}

/**
 * Pair shapefile records with attribute records by position and check them. Iteration is streamed, so
 * a 550k-record part never needs its attribute rows held in memory at once.
 */
export function analyzeStructures(
  shapes: Iterable<{ recordNumber: number; shape: ShpShape }>,
  attributes: Iterable<DbfPhysicalRecord>,
  options: AnalyzeOptions = {},
): StructuresAnalysis {
  const bounds = options.bounds ?? LAUNCH_BOUNDS;
  const keepSample = options.keepSample ?? 0;
  const attrIter = attributes[Symbol.iterator]();
  const uuids = new Set<string>();
  const relErrs: number[] = [];
  const heights: number[] = [];
  const occupancy: Record<string, number> = {};
  const result: StructuresAnalysis = {
    shapeRecords: 0,
    dbfRecords: 0,
    deletedRows: 0,
    countsMatch: false,
    invalidGeometry: 0,
    outsideBounds: 0,
    belowMinimumSqFt: 0,
    totalSqFt: 0,
    areaCheck: { compared: 0, medianRelErr: null, p95RelErr: null },
    occupancy,
    height: { withHeight: 0, medianM: null, maxM: null },
    duplicateUuids: 0,
    kept: [],
  };

  for (const { shape } of shapes) {
    result.shapeRecords += 1;
    const next = attrIter.next();
    const attr = next.done ? undefined : next.value;
    if (attr) {
      result.dbfRecords += 1;
      if (attr.deleted) result.deletedRows += 1;
    }
    if (shape.kind !== 'polygon' || !attr) {
      result.invalidGeometry += 1;
      continue;
    }
    const rings = shapeRings(shape);
    if (!rings || !rings.every(ringIsValid)) {
      result.invalidGeometry += 1;
      continue;
    }
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const [lon, lat] of shape.points) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    if (minLat < bounds.minLat || maxLat > bounds.maxLat || minLon < bounds.minLon || maxLon > bounds.maxLon) {
      result.outsideBounds += 1;
    }
    const areaSqFt = polygonAreaSqM(rings) * SQM_TO_SQFT;
    if (areaSqFt < MIN_STRUCTURE_SQFT) result.belowMinimumSqFt += 1;
    result.totalSqFt += areaSqFt;

    const datasetSqFt = Number(attr.values.sqfeet);
    if (Number.isFinite(datasetSqFt) && datasetSqFt > 0) {
      relErrs.push(Math.abs(areaSqFt - datasetSqFt) / datasetSqFt);
    }
    const uuid = attr.values.uuid ?? '';
    if (uuid) {
      if (uuids.has(uuid)) result.duplicateUuids += 1;
      else uuids.add(uuid);
    }
    const occ = (attr.values.occ_cls || 'unknown').slice(0, 20);
    occupancy[occ] = (occupancy[occ] ?? 0) + 1;
    const h = Number(attr.values.height);
    if (Number.isFinite(h) && h > 0) heights.push(h);
    if (result.kept.length < keepSample) result.kept.push(keepAllowedFields(attr.values));
  }

  // Any attribute records left over mean the table and shapefile disagree.
  const leftover = attrIter.next();
  let extra = 0;
  if (!leftover.done) {
    extra = 1;
    for (let n = attrIter.next(); !n.done; n = attrIter.next()) extra += 1;
    result.dbfRecords += extra;
  }
  result.countsMatch = extra === 0 && result.shapeRecords === result.dbfRecords;

  relErrs.sort((a, b) => a - b);
  result.areaCheck = {
    compared: relErrs.length,
    medianRelErr: percentile(relErrs, 50),
    p95RelErr: percentile(relErrs, 95),
  };
  heights.sort((a, b) => a - b);
  result.height = {
    withHeight: heights.length,
    medianM: percentile(heights, 50),
    maxM: heights.length ? heights[heights.length - 1]! : null,
  };
  result.totalSqFt = Math.round(result.totalSqFt);
  return result;
}
