// Land feasibility ground data: elevations from the USGS 3D Elevation Program through the Elevation
// Point Query Service, and the flood zone from FEMA's National Flood Hazard Layer. Both are free
// public services with no key. The user supplies only numbers; the hosts and query shapes are fixed
// here. Results are cached in memory per rounded parcel for a day; nothing is stored.
import {
  parseEpqsElevation,
  parseFemaFloodZone,
  terrainSamplePoints,
  type FloodZone,
  type SiteTerrainRequest,
  type SiteTerrainResponse,
} from '@fieldline/contracts';

export const EPQS_URL = 'https://epqs.nationalmap.gov/v1/json';
export const FEMA_NFHL_URL =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const ELEVATION_SOURCE = 'USGS 3D Elevation Program (3DEP), Elevation Point Query Service';
const ELEVATION_SOURCE_URL = 'https://www.usgs.gov/3d-elevation-program';
const FLOOD_SOURCE = 'FEMA National Flood Hazard Layer (NFHL)';
const FLOOD_SOURCE_URL = 'https://msc.fema.gov/portal';
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 200;
const cache = new Map<string, { at: number; value: SiteTerrainResponse }>();

async function getJson(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetcher(url, {
    headers: { accept: 'application/json', 'user-agent': 'FieldProLandFeasibility/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 200_000) throw new Error('too large');
  return JSON.parse(text) as unknown;
}

async function elevationAt(
  fetcher: typeof fetch,
  lat: number,
  lon: number,
): Promise<number | null> {
  const url = `${EPQS_URL}?x=${lon.toFixed(7)}&y=${lat.toFixed(7)}&wkid=4326&units=Feet&includeDate=false`;
  try {
    return parseEpqsElevation(await getJson(fetcher, url, 10_000));
  } catch {
    return null;
  }
}

export async function lookupFloodZone(
  lat: number,
  lon: number,
  fetcher: typeof fetch = fetch,
): Promise<FloodZone | null> {
  const params = new URLSearchParams({
    geometry: `${lon.toFixed(7)},${lat.toFixed(7)}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF',
    returnGeometry: 'false',
    f: 'json',
  });
  try {
    const zone = parseFemaFloodZone(await getJson(fetcher, `${FEMA_NFHL_URL}?${params}`, 12_000));
    return zone ? { ...zone, source: FLOOD_SOURCE, sourceUrl: FLOOD_SOURCE_URL } : null;
  } catch {
    return null;
  }
}

/** Run tasks a few at a time so the public services are not flooded. */
async function limited<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return out;
}

export async function lookupSiteTerrain(
  req: SiteTerrainRequest,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<SiteTerrainResponse> {
  const key = [
    req.lat.toFixed(5),
    req.lon.toFixed(5),
    Math.round(req.widthFt),
    Math.round(req.depthFt),
    req.samples,
  ].join(',');
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;

  const points = terrainSamplePoints(req);
  const flat = points.flat();
  const [values, flood] = await Promise.all([
    limited(
      flat.map((p) => () => elevationAt(fetcher, p.lat, p.lon)),
      5,
    ),
    lookupFloodZone(req.lat, req.lon, fetcher),
  ]);
  const n = req.samples;
  const grid = Array.from({ length: n }, (_, r) => values.slice(r * n, r * n + n));
  const got = values.filter((v) => v !== null).length;
  const status: SiteTerrainResponse['status'] =
    got === flat.length
      ? 'found'
      : got >= Math.ceil(flat.length / 2)
        ? 'partial'
        : 'upstream_unavailable';
  const floodText = flood
    ? ` FEMA flood zone ${flood.zone}${flood.specialHazard ? ' (special flood hazard area)' : ''}.`
    : ' FEMA did not return a flood zone for this point.';
  const value: SiteTerrainResponse = {
    status,
    message:
      status === 'upstream_unavailable'
        ? `The USGS elevation service did not answer for this parcel (${got} of ${flat.length} points). Enter corner heights by hand.${floodText}`
        : `Got ${got} of ${flat.length} ground heights from USGS 3DEP.${floodText}`,
    grid: status === 'upstream_unavailable' ? [] : grid,
    source: ELEVATION_SOURCE,
    sourceUrl: ELEVATION_SOURCE_URL,
    flood,
  };
  if (status !== 'upstream_unavailable') {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: nowMs, value });
  }
  return value;
}
