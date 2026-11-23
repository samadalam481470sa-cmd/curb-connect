// Land Scout data layer: Texas public sources, all verified live 2026-11-23.
// - Collin County parcels: Collin CAD's own ArcGIS Feature Service (nightly refreshed,
//   owner/situs/acres/use; value fields exist but are currently unpublished/null).
// - Dallas County parcels: City of Dallas GIS DallasTaxParcels (DCAD data). Live but the
//   appraisal year in the data is 2019, so every Dallas parcel carries its vintage label;
//   companies can import a fresher DCAD export by CSV instead.
// - Highways: TxDOT Roadways ArcGIS service; distance computed from returned geometry.
// - Substations: HIFLD Electric Substations (public mirror; the official HIFLD layer was
//   reclassified as secured in 2023, so the mirror is labeled as such).
// Flood/terrain reuse services/site-terrain (FEMA NFHL + USGS 3DEP). Nothing is scraped;
// every request is a bounded, documented ArcGIS REST query with timeouts and size caps.
import type { BuyBox, LandCounty, LandParcel, LandSourceStatus } from '@fieldline/contracts';

type Obj = Record<string, unknown>;
type FetchLike = typeof fetch;
const obj = (v: unknown): Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown, max = 300): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '';
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const txLat = (v: unknown): number | null =>
  typeof v === 'number' && v >= 25 && v <= 37 ? v : null;
const txLon = (v: unknown): number | null =>
  typeof v === 'number' && v >= -107 && v <= -93 ? v : null;

export const COLLIN_PARCELS_URL =
  'https://services2.arcgis.com/uXyoacYrZTPTKD3R/arcgis/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4';
export const COLLIN_SOURCE = 'Collin Central Appraisal District (ArcGIS parcel service)';
export const COLLIN_SOURCE_URL = 'https://www.collincad.org/open-data-portal';
export const DALLAS_PARCELS_URL =
  'https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/DallasTaxParcels/FeatureServer/0';
export const DALLAS_SOURCE = 'Dallas Central Appraisal District via City of Dallas GIS (DallasTaxParcels)';
export const DALLAS_SOURCE_URL = 'https://www.dallascad.org/GIS.aspx';
export const TXDOT_ROADWAYS_URL =
  'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadways/FeatureServer/0';
export const SUBSTATIONS_URL =
  'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Electric_Substations/FeatureServer/0';
export const SUBSTATIONS_SOURCE = 'HIFLD Electric Substations (public mirror of the federal dataset)';

const SQFT_PER_ACRE = 43_560;
const MAX_PAGES = 4;
const PAGE_SIZE = 500;
const CACHE_MS = 60 * 60 * 1000;
const MAX_CACHE = 100;
const cache = new Map<string, { at: number; value: LandParcel[] }>();

async function arcgisQuery(
  fetcher: FetchLike,
  layerUrl: string,
  params: Record<string, string>,
): Promise<Obj> {
  const url = new URL(`${layerUrl}/query`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('f', 'json');
  // County services occasionally return a transient 400; one retry keeps searches reliable.
  let lastError: Error = new Error('ArcGIS query failed');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetcher(url.href, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'FieldProLandScout/1.0' },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`ArcGIS query failed (${res.status})`);
      const text = await res.text();
      if (text.length > 8_000_000) throw new Error('ArcGIS response too large');
      const data = obj(JSON.parse(text) as unknown);
      if (data.error) {
        const detail = str(obj(data.error).message, 200);
        throw new Error(`ArcGIS service returned an error${detail ? `: ${detail}` : ''}`);
      }
      return data;
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError;
}

const featuresOf = (data: Obj): Obj[] =>
  Array.isArray(data.features) ? data.features.map((f) => obj(f)) : [];

/** Escape a value for an ArcGIS SQL string literal. */
const sqlStr = (v: string) => `'${v.replace(/'/g, "''")}'`;

function acresWhere(field: string, buyBox: BuyBox, scale: number): string {
  const parts: string[] = [];
  if (buyBox.acresMin !== null) parts.push(`${field} >= ${Math.floor(buyBox.acresMin * scale)}`);
  if (buyBox.acresMax !== null) parts.push(`${field} <= ${Math.ceil(buyBox.acresMax * scale)}`);
  return parts.length ? parts.join(' AND ') : `${field} > 0`;
}

export function normalizeCollinParcel(feature: Obj): LandParcel | null {
  const r = obj(feature.attributes);
  const centroid = obj(feature.centroid);
  const parcelId = str(r.propID, 40) || str(r.geoID, 60);
  if (!parcelId) return null;
  const mailing = [
    str(r.ownerAddrLine1, 120),
    str(r.ownerAddrLine2, 120),
    [str(r.ownerAddrCity, 60), str(r.ownerAddrState, 10), str(r.ownerAddrZip, 20)]
      .filter(Boolean)
      .join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  const dataDate = str(r.dataDate, 30);
  return {
    county: 'collin',
    parcelId,
    ownerName: str(r.ownerName, 200) || null,
    ownerMailing: mailing || null,
    situsAddress: str(r.situsConcatShort, 200) || str(r.situsConcat, 200) || null,
    city: str(r.situsCity, 60) || null,
    zip: str(r.situsZip, 10) || null,
    acres: numOrNull(r.landSizeAcres),
    appraisalUse: str(r.landTypeCode, 40) || str(r.propUseCode, 40) || null,
    landValue: numOrNull(r.currValLand) ?? numOrNull(r.noticeValLand),
    marketValue: numOrNull(r.currValMarket) ?? numOrNull(r.noticeValMarket),
    valueYear: numOrNull(r.currValYear) ?? numOrNull(r.noticeYear),
    lat: txLat(centroid.y),
    lon: txLon(centroid.x),
    highwayMiles: null,
    highwayName: null,
    substationMiles: null,
    substationName: null,
    substationKv: null,
    vintage: dataDate ? `CAD data ${dataDate.slice(0, 10)}` : null,
    source: COLLIN_SOURCE,
    sourceUrl: COLLIN_SOURCE_URL,
    origin: 'live',
  };
}

export function normalizeDallasParcel(feature: Obj): LandParcel | null {
  const r = obj(feature.attributes);
  const centroid = obj(feature.centroid);
  const parcelId = str(r.ACCT, 40);
  if (!parcelId || parcelId === 'MULTIPLE') return null;
  const mailing = [
    str(r.TAXPAADD1, 120),
    str(r.TAXPAADD2, 120),
    [str(r.TAXPACITY, 60), str(r.TAXPASTA, 20), str(r.TAXPAZIP, 20)].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  const situs = [str(r.ST_NUM, 20), str(r.ST_DIR, 10), str(r.ST_NAME, 60), str(r.ST_TYPE, 20)]
    .filter(Boolean)
    .join(' ');
  const areaFeet = numOrNull(r.AREA_FEET);
  const year = numOrNull(r.APPRAISALYEAR);
  return {
    county: 'dallas',
    parcelId,
    ownerName: str(r.TAXPANAME1, 200) || null,
    ownerMailing: mailing || null,
    situsAddress: situs || null,
    city: str(r.CITY, 60) || null,
    zip: null,
    acres: areaFeet ? Math.round((areaFeet / SQFT_PER_ACRE) * 1000) / 1000 : null,
    appraisalUse: str(r.PROP_CL, 120) || null,
    landValue: null,
    marketValue: null,
    valueYear: year,
    lat: txLat(centroid.y),
    lon: txLon(centroid.x),
    highwayMiles: null,
    highwayName: null,
    substationMiles: null,
    substationName: null,
    substationKv: null,
    vintage: year ? `Appraisal year ${Math.round(year)} (verify current ownership with DCAD)` : null,
    source: DALLAS_SOURCE,
    sourceUrl: DALLAS_SOURCE_URL,
    origin: 'live',
  };
}

const COLLIN_FIELDS = [
  'propID', 'geoID', 'landTypeCode', 'propUseCode', 'situsConcat', 'situsConcatShort',
  'situsCity', 'situsZip', 'ownerName', 'ownerAddrLine1', 'ownerAddrLine2', 'ownerAddrCity',
  'ownerAddrState', 'ownerAddrZip', 'landSizeAcres', 'currValYear', 'currValLand',
  'currValMarket', 'noticeYear', 'noticeValLand', 'noticeValMarket', 'dataDate',
].join(',');

const DALLAS_FIELDS = [
  'ACCT', 'TAXPANAME1', 'TAXPAADD1', 'TAXPAADD2', 'TAXPACITY', 'TAXPASTA', 'TAXPAZIP',
  'ST_NUM', 'ST_DIR', 'ST_NAME', 'ST_TYPE', 'CITY', 'COUNTY', 'AREA_FEET', 'APPRAISALYEAR',
  'PROP_CL',
].join(',');

export async function fetchCountyParcels(
  county: LandCounty,
  buyBox: BuyBox,
  fetcher: FetchLike = fetch,
  nowMs = Date.now(),
): Promise<LandParcel[]> {
  const key = `${county}:${buyBox.acresMin ?? ''}:${buyBox.acresMax ?? ''}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;
  const layer = county === 'collin' ? COLLIN_PARCELS_URL : DALLAS_PARCELS_URL;
  const where =
    county === 'collin'
      ? acresWhere('landSizeAcres', buyBox, 1)
      : acresWhere('AREA_FEET', buyBox, SQFT_PER_ACRE);
  const out: LandParcel[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await arcgisQuery(fetcher, layer, {
      where,
      outFields: county === 'collin' ? COLLIN_FIELDS : DALLAS_FIELDS,
      returnGeometry: 'false',
      returnCentroid: 'true',
      outSR: '4326',
      orderByFields: county === 'collin' ? 'landSizeAcres DESC' : 'AREA_FEET DESC',
      resultOffset: String(page * PAGE_SIZE),
      resultRecordCount: String(PAGE_SIZE),
    });
    const features = featuresOf(data);
    for (const f of features) {
      const parcel = county === 'collin' ? normalizeCollinParcel(f) : normalizeDallasParcel(f);
      if (parcel) out.push(parcel);
    }
    if (features.length < PAGE_SIZE) break;
  }
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: nowMs, value: out });
  return out;
}

/** Fetch one parcel by its county id (for the due-diligence report). */
export async function fetchParcelById(
  county: LandCounty,
  parcelId: string,
  fetcher: FetchLike = fetch,
): Promise<LandParcel | null> {
  const layer = county === 'collin' ? COLLIN_PARCELS_URL : DALLAS_PARCELS_URL;
  const where =
    county === 'collin'
      ? `propID = ${Number(parcelId) || 0} OR geoID = ${sqlStr(parcelId)}`
      : `ACCT = ${sqlStr(parcelId)}`;
  const data = await arcgisQuery(fetcher, layer, {
    where,
    outFields: county === 'collin' ? COLLIN_FIELDS : DALLAS_FIELDS,
    returnGeometry: 'false',
    returnCentroid: 'true',
    outSR: '4326',
    resultRecordCount: '1',
  });
  const [first] = featuresOf(data);
  if (!first) return null;
  return county === 'collin' ? normalizeCollinParcel(first) : normalizeDallasParcel(first);
}

const MI_PER_DEG_LAT = 69.0;
export function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * MI_PER_DEG_LAT;
  const dLon = (bLon - aLon) * MI_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Distance from a point to a polyline (list of [lon, lat] vertices), in miles. */
export function pointToPathMiles(lat: number, lon: number, path: [number, number][]): number {
  let best = Number.POSITIVE_INFINITY;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const px = lon * MI_PER_DEG_LAT * cosLat;
  const py = lat * MI_PER_DEG_LAT;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = [path[i]![0] * MI_PER_DEG_LAT * cosLat, path[i]![1] * MI_PER_DEG_LAT];
    const [bx, by] = [path[i + 1]![0] * MI_PER_DEG_LAT * cosLat, path[i + 1]![1] * MI_PER_DEG_LAT];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

export interface HighwayHit {
  miles: number;
  name: string;
}

/** Nearest Interstate/US/State highway to a point, from TxDOT Roadways geometry. */
export async function nearestHighway(
  lat: number,
  lon: number,
  fetcher: FetchLike = fetch,
  searchMiles = 10,
): Promise<HighwayHit | null> {
  const data = await arcgisQuery(fetcher, TXDOT_ROADWAYS_URL, {
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    distance: String(searchMiles),
    units: 'esriSRUnit_StatuteMile',
    spatialRel: 'esriSpatialRelIntersects',
    where: "RTE_PRFX IN ('IH','US','SH','SL')",
    outFields: 'RTE_NM,RTE_PRFX,RTE_NBR',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '200',
  });
  let best: HighwayHit | null = null;
  for (const f of featuresOf(data)) {
    const attrs = obj(f.attributes);
    const paths = obj(f.geometry).paths;
    if (!Array.isArray(paths)) continue;
    const name = `${str(attrs.RTE_PRFX, 4)} ${str(attrs.RTE_NBR, 10)}`.trim() || str(attrs.RTE_NM, 30);
    for (const path of paths) {
      if (!Array.isArray(path)) continue;
      const pts = path
        .map((p) => (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' ? ([p[0], p[1]] as [number, number]) : null))
        .filter((p): p is [number, number] => p !== null);
      if (pts.length < 2) continue;
      const miles = pointToPathMiles(lat, lon, pts);
      if (!best || miles < best.miles) best = { miles: Math.round(miles * 100) / 100, name };
    }
  }
  return best;
}

export interface SubstationHit {
  miles: number;
  name: string | null;
  kv: number | null;
}

/** Nearest electric substation to a point (HIFLD public mirror). */
export async function nearestSubstation(
  lat: number,
  lon: number,
  fetcher: FetchLike = fetch,
  searchMiles = 15,
): Promise<SubstationHit | null> {
  const data = await arcgisQuery(fetcher, SUBSTATIONS_URL, {
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    distance: String(searchMiles),
    units: 'esriSRUnit_StatuteMile',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'NAME,MAX_VOLTAG,LATITUDE,LONGITUDE',
    returnGeometry: 'false',
    resultRecordCount: '200',
  });
  let best: SubstationHit | null = null;
  for (const f of featuresOf(data)) {
    const attrs = obj(f.attributes);
    const sLat = txLat(attrs.LATITUDE);
    const sLon = txLon(attrs.LONGITUDE);
    if (sLat === null || sLon === null) continue;
    const miles = Math.round(haversineMiles(lat, lon, sLat, sLon) * 100) / 100;
    const kv = numOrNull(attrs.MAX_VOLTAG);
    if (!best || miles < best.miles) {
      best = { miles, name: str(attrs.NAME, 80) || null, kv };
    }
  }
  return best;
}

export function landSourceStatuses(): LandSourceStatus[] {
  return [
    {
      id: 'collin-cad',
      name: COLLIN_SOURCE,
      status: 'ok',
      detail: 'Live parcel query (owner, situs, acres, use). Value fields are currently unpublished, so price is unscored for Collin parcels.',
      url: COLLIN_SOURCE_URL,
    },
    {
      id: 'dallas-cad',
      name: DALLAS_SOURCE,
      status: 'stale',
      detail: 'Live query, but the appraisal year in this layer is 2019. Each Dallas parcel shows its vintage; import a current DCAD export by CSV for fresher data.',
      url: DALLAS_SOURCE_URL,
    },
    {
      id: 'txdot',
      name: 'TxDOT Roadways (highway distance)',
      status: 'ok',
      detail: 'Nearest Interstate/US/State highway computed from TxDOT geometry.',
      url: 'https://gis-txdot.opendata.arcgis.com/',
    },
    {
      id: 'substations',
      name: SUBSTATIONS_SOURCE,
      status: 'ok',
      detail: 'Nearest substation and voltage where published. The official HIFLD layer is secured; this is the public mirror.',
      url: 'https://hifld-geoplatform.opendata.arcgis.com/datasets/electric-substations',
    },
    {
      id: 'fema-usgs',
      name: 'FEMA flood zone + USGS terrain (report only)',
      status: 'ok',
      detail: 'Used in the due-diligence report via the existing site-terrain service.',
      url: 'https://msc.fema.gov/portal',
    },
  ];
}
