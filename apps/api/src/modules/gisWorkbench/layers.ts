// GIS Workbench layer data: view-scale (bbox) queries against the same public sources the rest
// of Field Pro already uses — Collin CCAD + Dallas DCAD parcel services (Land Scout's sources)
// and USGS NHD flowlines (the streams service's layer). Nothing is scraped and nothing is
// stored: each request asks the publisher for the current view and answers honestly
// (ok / empty / upstream_unavailable, truncated said plainly).
import type {
  GisBbox,
  GisLineGeometry,
  GisParcelFeature,
  GisParcelProperties,
  GisPolygonGeometry,
  GisStreamFeature,
  GisStreamProperties,
} from '@fieldline/contracts';

export const COLLIN_PARCELS_URL =
  'https://services2.arcgis.com/uXyoacYrZTPTKD3R/arcgis/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4';
export const DALLAS_PARCELS_URL =
  'https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/DallasTaxParcels/FeatureServer/0';
export const PARCELS_SOURCE =
  'Collin Central Appraisal District + Dallas Central Appraisal District (via City of Dallas GIS) parcel services';
export const PARCELS_SOURCE_URL = 'https://www.collincad.org/open-data-portal';

export const NHD_FLOWLINE_URL =
  'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query';
export const STREAMS_SOURCE = 'USGS National Hydrography Dataset (NHD), The National Map';
export const STREAMS_SOURCE_URL = 'https://www.usgs.gov/national-hydrography/national-hydrography-dataset';

export const ROOFS_SOURCE = 'Saved roof measurements traced by your company on imagery (not a survey)';

/** A workbench view is a neighbourhood, not a county: wider boxes are refused, not silently capped. */
export const MAX_BBOX_SPAN_DEG = 0.6;
export const MAX_PARCEL_FEATURES = 500;
export const MAX_STREAM_FEATURES = 500;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown, max = 300): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '';
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : null;
};

export type BboxCheck = { ok: true; bbox: GisBbox } | { ok: false; reason: string };

/** Validates a view bbox: ordered corners inside lon/lat range and view-scale span. */
export function checkBbox(bbox: GisBbox): BboxCheck {
  const { west, south, east, north } = bbox;
  if (!(west < east) || !(south < north)) {
    return { ok: false, reason: 'Map bounds are inverted or empty. Pan or zoom the map and try again.' };
  }
  if (east - west > MAX_BBOX_SPAN_DEG || north - south > MAX_BBOX_SPAN_DEG) {
    return {
      ok: false,
      reason: 'This view is too wide for parcel and stream queries. Zoom in and the layer will load for the smaller view.',
    };
  }
  return { ok: true, bbox };
}

export function bboxContains(lon: number, lat: number, bbox: GisBbox): boolean {
  return lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

// ---------------------------------------------------------------- GeoJSON parsing

function isPosition(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Math.abs(v[0]) <= 180 &&
    Math.abs(v[1]) <= 90
  );
}

function isRing(v: unknown): v is number[][] {
  return Array.isArray(v) && v.length >= 4 && v.every(isPosition);
}

/** A GeoJSON Polygon/MultiPolygon geometry, or null when the payload is not one. */
export function parsePolygonGeometry(v: unknown): GisPolygonGeometry | null {
  const g = obj(v);
  if (g.type === 'Polygon' && Array.isArray(g.coordinates) && g.coordinates.every(isRing)) {
    return { type: 'Polygon', coordinates: g.coordinates as number[][][] };
  }
  if (
    g.type === 'MultiPolygon' &&
    Array.isArray(g.coordinates) &&
    g.coordinates.every((poly) => Array.isArray(poly) && poly.length > 0 && poly.every(isRing))
  ) {
    return { type: 'MultiPolygon', coordinates: g.coordinates as number[][][][] };
  }
  return null;
}

/** A GeoJSON LineString/MultiLineString geometry, or null when the payload is not one. */
export function parseLineGeometry(v: unknown): GisLineGeometry | null {
  const g = obj(v);
  if (g.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.every(isPosition)) {
    return { type: 'LineString', coordinates: g.coordinates as number[][] };
  }
  if (
    g.type === 'MultiLineString' &&
    Array.isArray(g.coordinates) &&
    g.coordinates.every((line) => Array.isArray(line) && line.length >= 2 && line.every(isPosition))
  ) {
    return { type: 'MultiLineString', coordinates: g.coordinates as number[][][] };
  }
  return null;
}

/** Features of a GeoJSON FeatureCollection payload, or null when it is not one. */
export function geoJsonFeatures(payload: unknown): Obj[] | null {
  const root = obj(payload);
  if (root.type !== 'FeatureCollection' || !Array.isArray(root.features)) return null;
  return root.features.map((f) => obj(f));
}

// ---------------------------------------------------------------- parcels

const COLLIN_FIELDS = [
  'propID', 'geoID', 'landTypeCode', 'propUseCode', 'situsConcat', 'situsConcatShort',
  'situsCity', 'situsZip', 'ownerName', 'landSizeAcres', 'currValYear', 'currValLand',
  'currValMarket', 'noticeYear', 'noticeValLand', 'noticeValMarket', 'dataDate',
].join(',');

const DALLAS_FIELDS = [
  'ACCT', 'TAXPANAME1', 'ST_NUM', 'ST_DIR', 'ST_NAME', 'ST_TYPE', 'CITY', 'AREA_FEET',
  'APPRAISALYEAR', 'PROP_CL',
].join(',');

const SQFT_PER_ACRE = 43_560;

export function normalizeCollinGeoJsonFeature(feature: Obj): GisParcelFeature | null {
  const r = obj(feature.properties);
  const parcelId = str(r.propID, 40) || str(r.geoID, 60);
  const geometry = parsePolygonGeometry(feature.geometry);
  if (!parcelId || !geometry) return null;
  const dataDate = str(r.dataDate, 30);
  const properties: GisParcelProperties = {
    layer: 'parcels',
    county: 'collin',
    parcelId,
    ownerName: str(r.ownerName, 200) || null,
    situsAddress: str(r.situsConcatShort, 200) || str(r.situsConcat, 200) || null,
    city: str(r.situsCity, 60) || null,
    zip: str(r.situsZip, 10) || null,
    acres: numOrNull(r.landSizeAcres),
    appraisalUse: str(r.landTypeCode, 40) || str(r.propUseCode, 40) || null,
    landValue: numOrNull(r.currValLand) ?? numOrNull(r.noticeValLand),
    marketValue: numOrNull(r.currValMarket) ?? numOrNull(r.noticeValMarket),
    valueYear: numOrNull(r.currValYear) ?? numOrNull(r.noticeYear),
    vintage: dataDate ? `CAD data ${dataDate.slice(0, 10)}` : null,
  };
  return { type: 'Feature', geometry, properties };
}

export function normalizeDallasGeoJsonFeature(feature: Obj): GisParcelFeature | null {
  const r = obj(feature.properties);
  const parcelId = str(r.ACCT, 40);
  const geometry = parsePolygonGeometry(feature.geometry);
  if (!parcelId || parcelId === 'MULTIPLE' || !geometry) return null;
  const situs = [str(r.ST_NUM, 20), str(r.ST_DIR, 10), str(r.ST_NAME, 60), str(r.ST_TYPE, 20)]
    .filter(Boolean)
    .join(' ');
  const areaFeet = numOrNull(r.AREA_FEET);
  const year = numOrNull(r.APPRAISALYEAR);
  const properties: GisParcelProperties = {
    layer: 'parcels',
    county: 'dallas',
    parcelId,
    ownerName: str(r.TAXPANAME1, 200) || null,
    situsAddress: situs || null,
    city: str(r.CITY, 60) || null,
    zip: null,
    acres: areaFeet ? Math.round((areaFeet / SQFT_PER_ACRE) * 1000) / 1000 : null,
    appraisalUse: str(r.PROP_CL, 120) || null,
    landValue: null,
    marketValue: null,
    valueYear: year,
    vintage: year ? `Appraisal year ${Math.round(year)} (verify current ownership with DCAD)` : null,
  };
  return { type: 'Feature', geometry, properties };
}

// ---------------------------------------------------------------- streams

function classifyStream(ftype: unknown): GisStreamProperties['type'] {
  if (ftype === 460) return 'stream';
  if (ftype === 336) return 'canal';
  return 'waterway';
}

function unnamedFor(type: GisStreamProperties['type']): string {
  return type === 'stream' ? 'Unnamed stream' : type === 'canal' ? 'Unnamed canal' : 'Unnamed waterway';
}

export function normalizeNhdGeoJsonFeature(feature: Obj): GisStreamFeature | null {
  const r = obj(feature.properties);
  const geometry = parseLineGeometry(feature.geometry);
  if (!geometry) return null;
  const ftypeRaw = r.ftype ?? r.FTYPE;
  const ftype = typeof ftypeRaw === 'number' ? ftypeRaw : Number(ftypeRaw);
  const type = classifyStream(Number.isFinite(ftype) ? ftype : null);
  const rawName = str(r.gnis_name ?? r.GNIS_NAME, 200);
  const properties: GisStreamProperties = {
    layer: 'streams',
    name: rawName || unnamedFor(type),
    type,
    ftype: Number.isFinite(ftype) ? ftype : null,
  };
  return { type: 'Feature', geometry, properties };
}

// ---------------------------------------------------------------- upstream fetch

type FetchLike = typeof fetch;

async function arcgisGeoJsonQuery(
  fetcher: FetchLike,
  layerUrl: string,
  params: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${layerUrl}/query`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('f', 'geojson');
  // County services occasionally return a transient 400; one retry keeps the layer reliable.
  let lastError: Error = new Error('ArcGIS query failed');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetcher(url.href, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'FieldProGisWorkbench/1.0' },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`ArcGIS query failed (${res.status})`);
      const text = await res.text();
      if (text.length > 8_000_000) throw new Error('ArcGIS response too large');
      const data = JSON.parse(text) as unknown;
      const root = obj(data);
      if (root.error) {
        const detail = str(obj(root.error).message, 200);
        throw new Error(`ArcGIS service returned an error${detail ? `: ${detail}` : ''}`);
      }
      return data;
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError;
}

function envelopeParams(bbox: GisBbox): Record<string, string> {
  return {
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outSR: '4326',
  };
}

export interface ParcelsFetchResult {
  status: 'ok' | 'empty' | 'upstream_unavailable';
  features: GisParcelFeature[];
  truncated: boolean;
  message: string;
}

/** Parcels intersecting the view from both county services (the view may span the county line). */
export async function fetchParcelsInBbox(
  bbox: GisBbox,
  fetcher: FetchLike = fetch,
): Promise<ParcelsFetchResult> {
  const queries = [
    {
      county: 'collin' as const,
      url: COLLIN_PARCELS_URL,
      fields: COLLIN_FIELDS,
      normalize: normalizeCollinGeoJsonFeature,
    },
    {
      county: 'dallas' as const,
      url: DALLAS_PARCELS_URL,
      fields: DALLAS_FIELDS,
      normalize: normalizeDallasGeoJsonFeature,
    },
  ];
  const features: GisParcelFeature[] = [];
  let truncated = false;
  let failures = 0;
  for (const q of queries) {
    try {
      const payload = await arcgisGeoJsonQuery(fetcher, q.url, {
        ...envelopeParams(bbox),
        where: '1=1',
        outFields: q.fields,
        returnGeometry: 'true',
        resultRecordCount: String(MAX_PARCEL_FEATURES),
      });
      const raw = geoJsonFeatures(payload);
      if (raw === null) {
        failures += 1;
        continue;
      }
      if (raw.length >= MAX_PARCEL_FEATURES) truncated = true;
      for (const f of raw) {
        const parcel = q.normalize(f);
        if (parcel) features.push(parcel);
        if (features.length >= MAX_PARCEL_FEATURES) {
          truncated = true;
          break;
        }
      }
    } catch {
      failures += 1;
    }
    if (features.length >= MAX_PARCEL_FEATURES) break;
  }
  if (features.length === 0 && failures === queries.length) {
    return {
      status: 'upstream_unavailable',
      features,
      truncated: false,
      message: 'Both county parcel services are unavailable right now. Nothing is shown rather than stale parcels.',
    };
  }
  if (features.length === 0) {
    return {
      status: 'empty',
      features,
      truncated: false,
      message: 'No parcels from the Collin or Dallas county services intersect this view.',
    };
  }
  return {
    status: 'ok',
    features,
    truncated,
    message: truncated
      ? `Showing the first ${features.length} parcels in this view (record cap reached). Zoom in for the rest.`
      : `${features.length} parcels in this view.`,
  };
}

export interface StreamsFetchResult {
  status: 'ok' | 'empty' | 'upstream_unavailable';
  features: GisStreamFeature[];
  truncated: boolean;
  message: string;
}

/** NHD flowlines intersecting the view. No lines found is an honest empty list, never a "clear" verdict. */
export async function fetchStreamsInBbox(
  bbox: GisBbox,
  fetcher: FetchLike = fetch,
): Promise<StreamsFetchResult> {
  try {
    const payload = await arcgisGeoJsonQuery(fetcher, NHD_FLOWLINE_URL.replace(/\/query$/, ''), {
      ...envelopeParams(bbox),
      where: '1=1',
      outFields: 'gnis_name,ftype,fcode',
      returnGeometry: 'true',
      resultRecordCount: String(MAX_STREAM_FEATURES),
    });
    const raw = geoJsonFeatures(payload);
    if (raw === null) {
      return {
        status: 'upstream_unavailable',
        features: [],
        truncated: false,
        message: 'The USGS NHD service returned an unreadable answer. Nothing is shown rather than stale streams.',
      };
    }
    const features: GisStreamFeature[] = [];
    for (const f of raw) {
      const stream = normalizeNhdGeoJsonFeature(f);
      if (stream) features.push(stream);
    }
    const truncated = raw.length >= MAX_STREAM_FEATURES;
    if (features.length === 0) {
      return {
        status: 'empty',
        features,
        truncated: false,
        message:
          'NHD maps no flowlines in this view. That is not a "no water" verdict — unmapped ditches still need a surveyor.',
      };
    }
    return {
      status: 'ok',
      features,
      truncated,
      message: truncated
        ? `Showing the first ${features.length} mapped flowlines in this view (record cap reached). Zoom in for the rest.`
        : `${features.length} mapped flowlines in this view.`,
    };
  } catch {
    return {
      status: 'upstream_unavailable',
      features: [],
      truncated: false,
      message: 'The USGS NHD service is unavailable right now. Nothing is shown rather than stale streams.',
    };
  }
}
