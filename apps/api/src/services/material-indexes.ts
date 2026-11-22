// Official material price indexes for the House Studio "market" ticker and automatic escalation.
// Source: U.S. Bureau of Labor Statistics producer price indexes, read through the BLS public data
// API, which is meant for programs to call. If that fails, the same BLS series are read from FRED
// (Federal Reserve Bank of St. Louis) CSV downloads. Nothing is scraped from stores.
//
// One server checks at most every CHECK_MS; concurrent callers share one upstream request. A failed
// check keeps serving the last good values (marked "cached") instead of inventing any.
import {
  MATERIAL_INDEX_SERIES,
  type MaterialIndexesResponse,
  parseBlsSeries,
  summarizeIndexes,
} from '@fieldline/contracts';

const CHECK_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;
const MAX_BYTES = 2_000_000;
const START_YEAR = 2024;

type Fetcher = typeof fetch;
type SeriesRows = ReturnType<typeof parseBlsSeries>;

interface CacheEntry {
  at: number;
  ok: boolean;
  value: MaterialIndexesResponse;
}

let cache: CacheEntry | null = null;
let inflight: Promise<MaterialIndexesResponse> | null = null;

/** Test hook. */
export function resetMaterialIndexCache(): void {
  cache = null;
  inflight = null;
}

const BLS_SOURCE = { name: 'U.S. Bureau of Labor Statistics, Producer Price Indexes', url: 'https://www.bls.gov/ppi/' };
const FRED_SOURCE = {
  name: 'U.S. Bureau of Labor Statistics PPI, via FRED (Federal Reserve Bank of St. Louis)',
  url: 'https://fred.stlouisfed.org/',
};

async function readCapped(res: Response): Promise<string> {
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error('index response too large');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('index response too large');
  return text;
}

async function fromBls(apiKey: string | undefined, now: Date, fetcher: Fetcher): Promise<SeriesRows> {
  const version = apiKey ? 'v2' : 'v1';
  const body: Record<string, unknown> = {
    seriesid: MATERIAL_INDEX_SERIES.map((s) => s.seriesId),
    startyear: String(START_YEAR),
    endyear: String(now.getUTCFullYear()),
  };
  if (apiKey) body.registrationkey = apiKey;
  const res = await fetcher(`https://api.bls.gov/publicAPI/${version}/timeseries/data/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'FieldProHouseStudio/1.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!res.ok) throw new Error(`BLS ${res.status}`);
  const payload = JSON.parse(await readCapped(res)) as { status?: unknown };
  if (payload.status !== 'REQUEST_SUCCEEDED') throw new Error('BLS request not processed');
  return parseBlsSeries(payload);
}

/** FRED CSV: "observation_date,SERIES\n2024-09-01,316.0\n..." ("." marks a missing value). */
export function parseFredCsv(csv: string): { period: string; value: number; preliminary: boolean }[] {
  const rows: { period: string; value: number; preliminary: boolean }[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(',');
    if (!date || !/^\d{4}-\d{2}-01$/.test(date)) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 100_000) continue;
    rows.push({ period: date.slice(0, 7), value, preliminary: false });
  }
  return rows.sort((a, b) => a.period.localeCompare(b.period));
}

async function fromFred(fetcher: Fetcher): Promise<SeriesRows> {
  const out: SeriesRows = new Map();
  for (const s of MATERIAL_INDEX_SERIES) {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${s.seriesId}&cosd=${START_YEAR}-01-01`;
    const res = await fetcher(url, {
      headers: { accept: 'text/csv', 'user-agent': 'FieldProHouseStudio/1.0' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!res.ok) continue;
    out.set(s.seriesId, parseFredCsv(await readCapped(res)));
  }
  if (![...out.values()].some((rows) => rows.length > 0)) throw new Error('FRED returned no data');
  return out;
}

async function check(apiKey: string | undefined, fetcher: Fetcher, nowMs: number): Promise<MaterialIndexesResponse> {
  const now = new Date(nowMs);
  let data: SeriesRows | null;
  let source = BLS_SOURCE;
  try {
    data = await fromBls(apiKey, now, fetcher);
    if (![...data.values()].some((rows) => rows.length > 0)) data = null;
  } catch {
    data = null;
  }
  if (!data) {
    try {
      data = await fromFred(fetcher);
      source = FRED_SOURCE;
    } catch {
      data = null;
    }
  }
  if (!data) {
    if (cache?.ok) {
      cache = { ...cache, at: nowMs - CHECK_MS + RETRY_AFTER_FAILURE_MS };
      return { ...cache.value, status: 'cached', message: 'The index service did not answer; showing the last values checked.' };
    }
    const failed: MaterialIndexesResponse = {
      status: 'unavailable',
      checkedAt: now.toISOString(),
      source: BLS_SOURCE,
      indexes: [],
      escalation: null,
      message: 'The official price index service did not answer. Prices use the dated price book until it does.',
    };
    cache = { at: nowMs, ok: false, value: failed };
    return failed;
  }
  const value: MaterialIndexesResponse = { status: 'live', checkedAt: now.toISOString(), source, ...summarizeIndexes(data) };
  cache = { at: nowMs, ok: true, value };
  return value;
}

export async function getMaterialIndexes(
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
  nowMs: number = Date.now(),
): Promise<MaterialIndexesResponse> {
  if (cache) {
    const age = nowMs - cache.at;
    if (cache.ok && age < CHECK_MS) return { ...cache.value, status: 'cached' };
    if (!cache.ok && age < RETRY_AFTER_FAILURE_MS) return cache.value;
  }
  inflight ??= check(apiKey, fetcher, nowMs).finally(() => {
    inflight = null;
  });
  return inflight;
}
