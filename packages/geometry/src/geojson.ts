// GeoJSON import for parcels and footprints (QGIS-style data ingest, scoped to GeoJSON).
//
// Only lon/lat (EPSG:4326) Polygon / MultiPolygon input is accepted. Coordinates that look
// like projected metres (outside ±180/±90) are refused with a plain-language error instead of
// being silently misread, and anything that is not a polygon is refused the same way. Use
// reprojectRing (crs.ts) first when the source is in another CRS.
import { GeometryError, isFiniteNumber } from './numeric';
import type { LonLat } from './projection';

/** At most this many polygons per file; more is almost certainly the wrong file. */
export const MAX_GEOJSON_POLYGONS = 100;
/** At most this many vertices per polygon; more is almost certainly the wrong file. */
export const MAX_GEOJSON_VERTICES = 2000;

export interface GeoJsonImport {
  /** Imported polygons as open lon/lat rings (closing vertex stripped). */
  polygons: LonLat[][];
  /** One entry per skipped feature, in file order, saying why it was skipped. */
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePosition(value: unknown, label: string): LonLat {
  if (!Array.isArray(value) || value.length < 2) {
    throw new GeometryError('invalid_argument', `${label} is not a [lon, lat] pair`);
  }
  const [lon, lat] = value as unknown[];
  if (typeof lon !== 'number' || typeof lat !== 'number' || !isFiniteNumber(lon) || !isFiniteNumber(lat)) {
    throw new GeometryError('invalid_argument', `${label} has non-numeric coordinates`);
  }
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
    throw new GeometryError(
      'invalid_argument',
      `${label} is outside lon/lat range — this looks like projected metres (EPSG:3857), ` +
        `not lon/lat. Only lon/lat GeoJSON is accepted.`,
    );
  }
  return { lon, lat };
}

function parsePolygonRings(coordinates: unknown, label: string): LonLat[][] {
  if (!Array.isArray(coordinates)) {
    throw new GeometryError('invalid_argument', `${label} has no coordinate rings`);
  }
  const rings: LonLat[][] = [];
  for (const [ri, rawRing] of coordinates.entries()) {
    if (!Array.isArray(rawRing) || rawRing.length < 4) {
      throw new GeometryError(
        'invalid_argument',
        `${label} ring ${ri + 1} needs at least 4 positions (closed), got ${Array.isArray(rawRing) ? rawRing.length : 0}`,
      );
    }
    if (rawRing.length - 1 > MAX_GEOJSON_VERTICES) {
      throw new GeometryError(
        'invalid_argument',
        `${label} ring ${ri + 1} has more than ${MAX_GEOJSON_VERTICES} vertices`,
      );
    }
    const ring = (rawRing as unknown[]).map((pos, i) => parsePosition(pos, `${label} ring ${ri + 1} vertex ${i + 1}`));
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first.lon !== last.lon || first.lat !== last.lat) {
      throw new GeometryError(
        'invalid_argument',
        `${label} ring ${ri + 1} is not closed (first and last positions differ)`,
      );
    }
    rings.push(ring.slice(0, -1));
  }
  return rings;
}

function parseGeometry(geometry: unknown, label: string): LonLat[][] {
  if (!isRecord(geometry) || typeof geometry.type !== 'string') {
    throw new GeometryError('invalid_argument', `${label} has no geometry type`);
  }
  switch (geometry.type) {
    case 'Polygon':
      return parsePolygonRings(geometry.coordinates, label);
    case 'MultiPolygon': {
      if (!Array.isArray(geometry.coordinates)) {
        throw new GeometryError('invalid_argument', `${label} has no coordinate rings`);
      }
      const out: LonLat[][] = [];
      for (const [pi, rawPolygon] of (geometry.coordinates as unknown[]).entries()) {
        out.push(...parsePolygonRings(rawPolygon, `${label} polygon ${pi + 1}`));
      }
      return out;
    }
    default:
      throw new GeometryError(
        'invalid_argument',
        `${label} is a ${geometry.type} — only Polygon and MultiPolygon are supported`,
      );
  }
}

/**
 * Parse GeoJSON (FeatureCollection, Feature, Polygon, or MultiPolygon) into lon/lat polygon
 * rings. Bad features are skipped with a recorded reason instead of failing the whole file;
 * a file with no usable polygons returns an empty list plus the reasons.
 */
export function parseGeoJsonPolygons(input: unknown): GeoJsonImport {
  const polygons: LonLat[][] = [];
  const errors: string[] = [];
  if (!isRecord(input) || typeof input.type !== 'string') {
    return { polygons, errors: ['Not GeoJSON: the file has no "type" field.'] };
  }
  const features: { geometry: unknown; label: string }[] = [];
  if (input.type === 'FeatureCollection') {
    if (!Array.isArray(input.features)) {
      return { polygons, errors: ['FeatureCollection has no "features" array.'] };
    }
    for (const [i, raw] of (input.features as unknown[]).entries()) {
      if (!isRecord(raw)) {
        errors.push(`Feature ${i + 1} is not an object — skipped.`);
        continue;
      }
      features.push({ geometry: raw.geometry, label: `Feature ${i + 1}` });
    }
  } else if (input.type === 'Feature') {
    features.push({ geometry: input.geometry, label: 'Feature' });
  } else if (input.type === 'Polygon' || input.type === 'MultiPolygon') {
    features.push({ geometry: input, label: input.type });
  } else {
    return { polygons, errors: [`Unsupported GeoJSON type "${input.type}".`] };
  }
  for (const { geometry, label } of features) {
    if (polygons.length >= MAX_GEOJSON_POLYGONS) {
      errors.push(`More than ${MAX_GEOJSON_POLYGONS} polygons — the rest were skipped.`);
      break;
    }
    if (geometry === null) {
      errors.push(`${label} has no geometry — skipped.`);
      continue;
    }
    try {
      const parsed = parseGeometry(geometry, label);
      for (const ring of parsed) {
        if (polygons.length >= MAX_GEOJSON_POLYGONS) {
          errors.push(`More than ${MAX_GEOJSON_POLYGONS} polygons — the rest were skipped.`);
          break;
        }
        polygons.push(ring);
      }
    } catch (e) {
      errors.push(e instanceof GeometryError ? `${label}: ${e.message}` : `${label}: unreadable geometry — skipped.`);
    }
  }
  return { polygons, errors };
}
