// Local area cost factor for the House Studio. The NAHB survey gives national costs per square
// foot; building costs more where construction wages are higher. This service:
//   1. finds the lot's state and metro area with the U.S. Census geocoder (falls back to the state
//      name from the address when the geocoder does not answer),
//   2. reads the BLS OEWS mean hourly wage for construction and extraction occupations for the
//      metro area, the state and the nation,
//   3. factor = laborShare x (local / national) + (1 - laborShare), with laborShare 0.5.
// Only numbers go upstream; hosts are fixed here. Answers are cached per rounded point for a week.
import {
  type AreaFactorRequest,
  type AreaFactorResponse,
  LABOR_SHARE_OF_CONSTRUCTION,
  areaFactorFromWages,
  oewsWageSeries,
  stateFips,
} from '@fieldline/contracts';

type Fetcher = typeof fetch;
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;
const MAX_BYTES = 1_000_000;
const cache = new Map<string, { at: number; value: AreaFactorResponse }>();

export function resetAreaFactorCache(): void {
  cache.clear();
}

const SOURCES = [
  { name: 'U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics (construction and extraction, 47-0000)', url: 'https://www.bls.gov/oes/' },
  { name: 'U.S. Census Bureau Geocoder (state and metro area)', url: 'https://geocoding.geo.census.gov/' },
];

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('response too large');
  return JSON.parse(text) as unknown;
}

interface Place {
  stateFips: string | null;
  stateName: string | null;
  cbsa: string | null;
  metroName: string | null;
}

/** Census geographies for a point: state FIPS and, if any, the metropolitan statistical area. */
export function parseCensusGeographies(raw: unknown): Place {
  const geos = (raw as { result?: { geographies?: Record<string, unknown> } })?.result?.geographies ?? {};
  const first = (key: (k: string) => boolean) => {
    const k = Object.keys(geos).find(key);
    const list = k ? (geos[k] as Record<string, unknown>[] | undefined) : undefined;
    return Array.isArray(list) ? list[0] : undefined;
  };
  const st = first((k) => k === 'States');
  const msa = first((k) => /^Metropolitan Statistical Areas?$/i.test(k));
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const fips = str(st?.STATE);
  const cbsa = str(msa?.CBSA);
  return {
    stateFips: fips && /^\d{2}$/.test(fips) ? fips : null,
    stateName: str(st?.NAME),
    cbsa: cbsa && /^\d{5}$/.test(cbsa) ? cbsa : null,
    metroName: str(msa?.NAME),
  };
}

/** Latest annual value of each OEWS series in a BLS API payload. */
export function parseOewsLatest(raw: unknown): Map<string, { value: number; year: string }> {
  const out = new Map<string, { value: number; year: string }>();
  const series = (raw as { Results?: { series?: unknown[] } })?.Results?.series;
  if (!Array.isArray(series)) return out;
  for (const s of series as { seriesID?: unknown; data?: unknown[] }[]) {
    if (typeof s.seriesID !== 'string' || !Array.isArray(s.data)) continue;
    const rows = (s.data as { year?: unknown; value?: unknown }[])
      .map((d) => ({ year: String(d.year ?? ''), value: Number(String(d.value ?? '').replace(/,/g, '')) }))
      .filter((d) => /^\d{4}$/.test(d.year) && Number.isFinite(d.value) && d.value > 0 && d.value < 1000)
      .sort((a, b) => b.year.localeCompare(a.year));
    if (rows[0]) out.set(s.seriesID, rows[0]);
  }
  return out;
}

async function geocode(lat: number, lon: number, fetcher: Fetcher): Promise<Place | null> {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/geographies/coordinates');
  url.searchParams.set('x', lon.toFixed(5));
  url.searchParams.set('y', lat.toFixed(5));
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('vintage', 'Current_Current');
  url.searchParams.set('layers', 'States,Metropolitan Statistical Areas');
  url.searchParams.set('format', 'json');
  try {
    const res = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!res.ok) return null;
    return parseCensusGeographies(await readJson(res));
  } catch {
    return null;
  }
}

export async function lookupAreaFactor(
  req: AreaFactorRequest,
  blsApiKey: string | undefined,
  fetcher: Fetcher = fetch,
  nowMs = Date.now(),
): Promise<AreaFactorResponse> {
  const key = `${req.lat.toFixed(2)},${req.lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;
  const base = { laborShare: LABOR_SHARE_OF_CONSTRUCTION, sources: SOURCES };
  const empty = { factor: null, wageRatio: null, localWage: null, nationalWage: null, level: null, areaName: null, year: null };

  const place = await geocode(req.lat, req.lon, fetcher);
  const fips = place?.stateFips ?? stateFips(req.state);
  if (!fips) {
    return { ...base, ...empty, status: 'not_found', message: 'Could not tell which U.S. state the lot is in. Keep the area factor at 1.00 or set it from local bids.' };
  }
  const national = oewsWageSeries('N', '0000000');
  const state = oewsWageSeries('S', `${fips}00000`);
  const metro = place?.cbsa ? oewsWageSeries('M', `00${place.cbsa}`) : null;
  const year = new Date(nowMs).getUTCFullYear();
  const body: Record<string, unknown> = {
    seriesid: [national, state, ...(metro ? [metro] : [])],
    startyear: String(year - 3),
    endyear: String(year),
  };
  if (blsApiKey) body.registrationkey = blsApiKey;
  let values: Map<string, { value: number; year: string }>;
  try {
    const res = await fetcher(`https://api.bls.gov/publicAPI/${blsApiKey ? 'v2' : 'v1'}/timeseries/data/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'FieldProHouseStudio/1.0' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`BLS ${res.status}`);
    values = parseOewsLatest(await readJson(res));
  } catch {
    return { ...base, ...empty, status: 'upstream_unavailable', message: 'The wage data service did not answer. Try again later; the area factor was not changed.' };
  }
  const nat = values.get(national);
  const local = (metro && values.get(metro)) || values.get(state);
  if (!nat || !local) {
    return { ...base, ...empty, status: 'not_found', message: 'No published construction wage was found for this area. Keep the area factor at 1.00 or set it from local bids.' };
  }
  const level = metro && values.get(metro) ? 'metro' : 'state';
  const areaName = level === 'metro' ? place?.metroName ?? null : place?.stateName ?? req.state ?? null;
  const factor = areaFactorFromWages(local.value, nat.value);
  const value: AreaFactorResponse = {
    ...base,
    status: 'found',
    factor,
    wageRatio: Math.round((local.value / nat.value) * 1000) / 1000,
    localWage: local.value,
    nationalWage: nat.value,
    level,
    areaName,
    year: local.year,
    message: `Construction wages in ${areaName ?? 'this area'} average $${local.value.toFixed(2)}/hr against $${nat.value.toFixed(2)}/hr nationally (BLS, ${local.year}). With labor about half of the cost, the area factor is ${factor.toFixed(2)}.`,
  };
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: nowMs, value });
  return value;
}
