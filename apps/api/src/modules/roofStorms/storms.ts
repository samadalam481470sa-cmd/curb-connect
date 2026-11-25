// Hail feed for the Roofing Storm Response feature.
//
// Source: NOAA Storm Prediction Center daily storm reports
// (https://www.spc.noaa.gov/climo/reports/). Each day publishes one CSV,
// `<YYMMDD>_rpts.csv`, with three sections — tornado, wind, hail — each headed by
// its own `Time,...` row; the hail section header is `Time,Size,Location,County,
// State,Lat,Lon,Comments` and hail size is in hundredths of an inch (100 = 1.00").
//
// Verified live 2026-11-24: `261122_rpts.csv` returned two real hail rows
// (1.00" at Poyen, AR 34.32,-92.64 and 1.00" near Warren, AR 33.62,-92.06);
// `today.csv` / `yesterday.csv` returned headers only — no storms those days,
// which is a normal empty result, not a feed failure.
//
// Never invent storm data: when the feed cannot be reached the callers get an
// `unavailable` status with a `checkedAt` timestamp and an empty event list.
// Feed data is cached in memory only (15 minutes); there is no DB table.
import { z } from 'zod';

export const SPC_SOURCE = 'NOAA Storm Prediction Center';
export const SPC_REPORTS_BASE = 'https://www.spc.noaa.gov/climo/reports';
export const CACHE_TTL_MS = 15 * 60 * 1000;
export const MAX_DAYS = 30;
export const DEFAULT_DAYS = 30;

export const HailEventSchema = z.object({
  id: z.string(),
  /** ISO date of the hail report (SPC convective day: times before 12:00 UTC belong to the next calendar day). */
  date: z.string(),
  timeUtc: z.string(),
  magnitudeIn: z.number(),
  location: z.string(),
  county: z.string(),
  state: z.string(),
  lat: z.number(),
  lon: z.number(),
  comments: z.string(),
  source: z.literal(SPC_SOURCE),
});
export type HailEvent = z.infer<typeof HailEventSchema>;

export const HailFeedResultSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  source: z.literal(SPC_SOURCE),
  checkedAt: z.string(),
  daysRequested: z.number().int(),
  daysFetched: z.number().int(),
  daysFailed: z.number().int(),
  message: z.string(),
  events: z.array(HailEventSchema),
});
export type HailFeedResult = z.infer<typeof HailFeedResultSchema>;

type FetchLike = typeof fetch;

/** Split one CSV record line, honouring double-quoted fields that contain commas. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function yymmdd(date: Date): string {
  const y = String(date.getUTCFullYear()).slice(-2);
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/**
 * Parse one SPC daily storm reports CSV. Only the hail section (header starting
 * `Time,Size,`) is kept. `fileDate` is the UTC date the filename names; SPC storm
 * days run 12:00 UTC to 12:00 UTC, so a report time before 12:00 belongs to the
 * next calendar day.
 */
export function parseSpcReports(csv: string, fileDate: Date): HailEvent[] {
  const events: HailEvent[] = [];
  const lines = csv.split(/\r?\n/);
  let inHail = false;
  let index = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('Time,')) {
      // Each section re-states its header; only the Size (hail) section counts.
      inHail = line.startsWith('Time,Size,');
      continue;
    }
    if (!inHail) continue;
    const f = splitCsvLine(line);
    if (f.length < 7) continue;
    const [timeRaw, sizeRaw, location, county, state, latRaw, lonRaw] = f as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const comments = f.slice(7).join(', ');
    // Empty strings coerce to 0 with Number(), so require the fields to be present.
    if (!sizeRaw || !latRaw || !lonRaw) continue;
    const size = Number(sizeRaw);
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    const timeMatch = /^(\d{2})(\d{2})$/.exec(timeRaw ?? '');
    if (!Number.isFinite(size) || !Number.isFinite(lat) || !Number.isFinite(lon) || !timeMatch) {
      continue;
    }
    const hour = Number(timeMatch[1]);
    // SPC convective day: 12:00 UTC file-date to 12:00 UTC next day.
    const day = new Date(fileDate);
    if (hour < 12) day.setUTCDate(day.getUTCDate() + 1);
    const date = isoDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    const id = `spc-${yymmdd(fileDate)}-${timeRaw}-${lat.toFixed(2)}-${lon.toFixed(2)}-${index}`;
    index += 1;
    events.push({
      id,
      date,
      timeUtc: `${timeMatch[1]}:${timeMatch[2]}`,
      magnitudeIn: Math.round(size) / 100,
      location: location ?? '',
      county: county ?? '',
      state: state ?? '',
      lat,
      lon,
      comments,
      source: SPC_SOURCE,
    });
  }
  return events;
}

/** Fetch one SPC daily file; a missing/empty day is an empty list, not an error. */
export async function fetchSpcDay(
  fileDate: Date,
  fetchFn: FetchLike,
): Promise<{ events: HailEvent[]; ok: boolean }> {
  const url = `${SPC_REPORTS_BASE}/${yymmdd(fileDate)}_rpts.csv`;
  let res: Response;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return { events: [], ok: false };
  }
  if (!res.ok) return { events: [], ok: false };
  const csv = await res.text();
  return { events: parseSpcReports(csv, fileDate), ok: true };
}

export interface FetchHailEventsInput {
  days?: number;
  now?: Date;
  fetchFn?: FetchLike;
}

/**
 * Fetch hail events for the last `days` SPC report days (newest first).
 * Individual day failures are tolerated and counted; only a total failure
 * (no day fetched) is `unavailable`.
 */
export async function fetchHailEvents(input: FetchHailEventsInput = {}): Promise<HailFeedResult> {
  const days = Math.min(Math.max(Math.floor(input.days ?? DEFAULT_DAYS) || DEFAULT_DAYS, 1), MAX_DAYS);
  const now = input.now ?? new Date();
  const fetchFn = input.fetchFn ?? fetch;
  const checkedAt = now.toISOString();
  const dates: Date[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d);
  }
  const results = await Promise.allSettled(dates.map((d) => fetchSpcDay(d, fetchFn)));
  let daysFetched = 0;
  let daysFailed = 0;
  const events: HailEvent[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) {
      daysFetched += 1;
      events.push(...r.value.events);
    } else {
      daysFailed += 1;
    }
  }
  events.sort((a, b) => `${b.date}T${b.timeUtc}`.localeCompare(`${a.date}T${a.timeUtc}`));
  if (daysFetched === 0) {
    return {
      status: 'unavailable',
      source: SPC_SOURCE,
      checkedAt,
      daysRequested: days,
      daysFetched,
      daysFailed,
      message:
        'The NOAA Storm Prediction Center report feed could not be reached. No storm data is shown — try Refresh again later.',
      events: [],
    };
  }
  return {
    status: 'ok',
    source: SPC_SOURCE,
    checkedAt,
    daysRequested: days,
    daysFetched,
    daysFailed,
    message:
      daysFailed > 0
        ? `${daysFailed} of ${days} report days could not be fetched; showing the ${daysFetched} days that loaded.`
        : `${events.length} hail report(s) from the last ${days} day(s).`,
    events,
  };
}

// ---------------------------------------------------------------------------
// In-memory cache (no DB table): the feed is public data, re-fetched at most
// every 15 minutes unless a refresh is forced.
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: HailFeedResult;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

export function getCachedHailEvents(input: FetchHailEventsInput = {}): Promise<HailFeedResult> {
  const now = input.now ?? new Date();
  const days = Math.min(Math.max(Math.floor(input.days ?? DEFAULT_DAYS) || DEFAULT_DAYS, 1), MAX_DAYS);
  if (
    cache &&
    cache.expiresAt > now.getTime() &&
    cache.result.daysRequested >= days
  ) {
    const events = cache.result.events;
    return Promise.resolve({ ...cache.result, daysRequested: days, events });
  }
  return refreshHailEvents(input);
}

export async function refreshHailEvents(input: FetchHailEventsInput = {}): Promise<HailFeedResult> {
  const result = await fetchHailEvents(input);
  const now = (input.now ?? new Date()).getTime();
  cache = { result, expiresAt: now + CACHE_TTL_MS };
  return result;
}

/** Test hook: drop the in-memory cache. */
export function clearHailCache(): void {
  cache = null;
}

/** Great-circle distance in miles (haversine). */
export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.7613 * Math.asin(Math.sqrt(a));
}

/**
 * Average job value from the company's own past roof estimates (totals in minor
 * units). Returns null when there are no priced roof estimates — the caller
 * reports "insufficient data", never a made-up number.
 */
export function averageJobValueMinor(totalsMinor: readonly number[]): number | null {
  const priced = totalsMinor.filter((t) => Number.isFinite(t) && t > 0);
  if (priced.length === 0) return null;
  return Math.round(priced.reduce((a, b) => a + b, 0) / priced.length);
}

export interface StormDraftRecipient {
  name: string;
  phone: string;
}

/**
 * Draft (never send) a storm-response text for one opted-in recipient.
 * The company name is the sender's own; hail size and place come from the NOAA
 * report, so nothing in the text is invented.
 */
export function buildStormDraft(
  event: HailEvent,
  recipient: StormDraftRecipient,
  companyName: string,
): string {
  const size = event.magnitudeIn.toFixed(2).replace(/0$/, '');
  const sender = companyName.trim() || 'your roofing contractor';
  return (
    `Hi ${recipient.name}, this is ${sender}. NOAA reported ${size}" hail` +
    ` near ${event.location}, ${event.state} on ${event.date}. Hail that size can damage a roof` +
    ` without visible leaks. Reply YES for a free roof inspection, or STOP to opt out.`
  );
}
