// Permit source freshness: how fresh each live feed is, and how complete its fields are.
//
// Verified live 2026-11-23: Fort Worth, Arlington, Collin, Austin and San Antonio publish new
// permits daily; Dallas publishes counts but almost no contractor or value in 2026 (contractor
// 1-5%, value 0-3% all year); Denton's ArcGIS feed has not published since 2026-01-06; Houston
// publishes a weekly Excel report, so its newest permits are normally up to a week old and it
// gets the same 14-day window as the daily feeds (a missed week flips it stale). The daily
// refresh job (apps/api/src/jobs/permitSources.ts) re-checks every source and stores one row per
// source, so the Permit Job Search page can show freshness without re-fetching on every visit.
// Nothing here invents permit data: a source with no recent permits is reported stale, never
// backfilled from older rows.
import { LIVE_SOURCES, fetchers, type RawPermit } from './sources';

export type SourceFreshnessStatus = 'live' | 'stale' | 'unavailable' | 'unknown';

/** A feed that has not produced a newer permit within this many days is stale. Dallas publishes
 *  on the city's own schedule, so it gets a longer leash than the daily feeds. Houston is a
 *  weekly file, so a newest permit up to ~10 days old is normal — the 14-day window covers
 *  one missed week, no more. */
export const SOURCE_CADENCE_DAYS: Record<string, number> = {
  fortworth: 14,
  denton: 14,
  collin: 14,
  dallas: 45,
  arlington: 14,
  sanantonio: 14,
  austin: 14,
  houston: 14,
};

/** Plain-language cadence note appended to a source's freshness message, so the panel says
 *  why a newest permit a week old is normal for that source. */
const CADENCE_NOTES: Record<string, string> = {
  houston:
    ' Weekly Excel file — newest permits are normally up to a week old, and the file publishes no contractor or value.',
};

/** The cadence note for a source (empty for daily feeds), for search results as well as the
 *  stored freshness rows. */
export function freshnessCadenceNote(sourceId: string): string {
  return CADENCE_NOTES[sourceId] ?? '';
}

export interface FieldHealth {
  /** Share of permits naming a contractor (0-1). */
  contractor: number;
  /** Share of permits listing a value above zero (0-1). */
  value: number;
  /** Share of permits carrying a zip code (0-1). */
  zip: number;
}

export interface FreshnessAssessment {
  status: Exclude<SourceFreshnessStatus, 'unknown'>;
  /** Whole days between the newest permit and the check, or null when no permit was seen. */
  ageDays: number | null;
  message: string;
}

const DAY_MS = 86_400_000;

export function assessFreshness(
  sourceId: string,
  newestPermitDate: string | null,
  checkedAt: Date,
): FreshnessAssessment {
  if (!newestPermitDate) {
    return {
      status: 'unavailable',
      ageDays: null,
      message:
        'No permits returned in the last 30 days. The feed may have stopped publishing, or the city may not publish recent weeks yet.',
    };
  }
  const newest = Date.parse(newestPermitDate);
  if (Number.isNaN(newest)) {
    return {
      status: 'unavailable',
      ageDays: null,
      message: 'The newest permit date could not be read, so freshness is unknown.',
    };
  }
  const ageDays = Math.max(0, Math.floor((checkedAt.getTime() - newest) / DAY_MS));
  const cadence = SOURCE_CADENCE_DAYS[sourceId] ?? 14;
  const cadenceNote = CADENCE_NOTES[sourceId] ?? '';
  if (ageDays <= cadence) {
    return {
      status: 'live',
      ageDays,
      message:
        (ageDays === 0
          ? 'New permits published today.'
          : `Newest permit is ${ageDays} day${ageDays === 1 ? '' : 's'} old.`) + cadenceNote,
    };
  }
  return {
    status: 'stale',
    ageDays,
    message:
      `Newest permit is ${ageDays} days old — past the ${cadence}-day freshness window. ` +
      'The city feed has not published newer permits; treat leads from this city as out of date.' +
      cadenceNote,
  };
}

/** Field completeness of one batch of permits, as shares rounded to two decimals. Null when the
 *  batch is empty, so "no permits" is never confused with "permits with no fields". */
export function computeFieldHealth(permits: RawPermit[]): FieldHealth | null {
  if (permits.length === 0) return null;
  const round = (n: number) => Math.round((n / permits.length) * 100) / 100;
  return {
    contractor: round(permits.filter((p) => p.contractor.trim().length > 0).length),
    value: round(permits.filter((p) => p.value > 0).length),
    zip: round(permits.filter((p) => p.zip.trim().length > 0).length),
  };
}

/** Plain-language warning when a feed's fields are too sparse to rank leads on. Returns null
 *  when the fields are usable. Dallas 2026 is the live case: counts are fine, but contractor and
 *  value are present on only a few percent of permits, so those leads usually have no contractor
 *  on file yet. */
export function fieldHealthNote(
  sourceId: string,
  sourceName: string,
  health: FieldHealth | null,
  count: number,
): string | null {
  if (!health || count === 0) return null;
  if (health.contractor < 0.1 && health.value < 0.1) {
    return (
      `${sourceName} publishes permit counts but almost no contractor or value in 2026 ` +
      `(${Math.round(health.contractor * 100)}% name a contractor, ${Math.round(health.value * 100)}% list a value). ` +
      'Leads from this city usually have no contractor on file yet.'
    );
  }
  if (health.contractor < 0.1) {
    return `${sourceName} names a contractor on only ${Math.round(health.contractor * 100)}% of permits, so most leads have no contractor on file yet.`;
  }
  return null;
}

export interface PermitSourceStatusRow {
  sourceId: string;
  name: string;
  status: SourceFreshnessStatus;
  newestPermitDate: string | null;
  count30d: number;
  fieldHealth: FieldHealth | null;
  /** Last edit date the city's own service reports (ArcGIS sources only), if it could be read. */
  sourceUpdatedAt: string | null;
  lastCheckedAt: string;
  message: string;
}

export interface SourceStatusStore {
  get(sourceId: string): Promise<PermitSourceStatusRow | null>;
  /** Upsert by sourceId: a re-run overwrites the same row, never duplicates it. */
  upsert(row: PermitSourceStatusRow): Promise<void>;
}

export type SourceFetcher = (
  ctx: { fetch: typeof fetch; since: Date; now: Date },
) => Promise<RawPermit[]>;

const ARC_GIS_SERVICE_ROOT: Record<string, string> = {
  fortworth:
    'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer',
  denton:
    'https://services.arcgis.com/9dTWrhPzuDPnUVXr/ArcGIS/rest/services/All_Permits/FeatureServer',
  arlington:
    'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer',
};

/** The last edit date a city's ArcGIS service reports for itself. Null when the service does not
 *  publish one or the read fails — never a reason to fail the whole refresh. */
export async function fetchArcGisLastEdit(
  fetchFn: typeof fetch,
  serviceRoot: string,
): Promise<string | null> {
  try {
    const res = await fetchFn(`${serviceRoot}?f=json`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const meta = (await res.json()) as { editingInfo?: { lastEditDate?: number } };
    const edit = meta.editingInfo?.lastEditDate;
    return typeof edit === 'number' && edit > 0 ? new Date(edit).toISOString() : null;
  } catch {
    return null;
  }
}

function newestDate(permits: RawPermit[]): string | null {
  let newest: string | null = null;
  for (const p of permits) {
    const date = p.appliedAt ?? p.issuedAt;
    if (date && (!newest || date > newest)) newest = date;
  }
  return newest;
}

/**
 * Re-fetch every live source for the last 30 days and store one freshness row per source.
 * Idempotent: the store upserts by sourceId, so a crash-and-retry or a second daily run updates
 * the same rows instead of duplicating them. A single source failing never stops the others;
 * its row keeps its previous newest date and is marked unavailable with the error.
 */
export async function refreshSourceStatuses(deps: {
  fetchFn?: typeof fetch;
  fetchers?: Record<string, SourceFetcher>;
  now?: Date;
  store: SourceStatusStore;
}): Promise<PermitSourceStatusRow[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const sourceFetchers = deps.fetchers ?? fetchers;
  const now = deps.now ?? new Date();
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const rows: PermitSourceStatusRow[] = [];
  for (const source of LIVE_SOURCES) {
    const previous = await deps.store.get(source.id).catch(() => null);
    try {
      const run = sourceFetchers[source.id];
      if (!run) throw Error(`No fetcher for permit source ${source.id}.`);
      const permits = await run({ fetch: fetchFn, since, now });
      const newest = newestDate(permits);
      const health = computeFieldHealth(permits);
      const freshness = assessFreshness(source.id, newest, now);
      const note = fieldHealthNote(source.id, source.name, health, permits.length);
      const serviceRoot = ARC_GIS_SERVICE_ROOT[source.id];
      const sourceUpdatedAt = serviceRoot
        ? await fetchArcGisLastEdit(fetchFn, serviceRoot)
        : null;
      const row: PermitSourceStatusRow = {
        sourceId: source.id,
        name: source.name,
        status: freshness.status,
        newestPermitDate: newest,
        count30d: permits.length,
        fieldHealth: health,
        sourceUpdatedAt,
        lastCheckedAt: now.toISOString(),
        message: note ? `${freshness.message} ${note}` : freshness.message,
      };
      await deps.store.upsert(row);
      rows.push(row);
    } catch (error) {
      const row: PermitSourceStatusRow = {
        sourceId: source.id,
        name: source.name,
        status: 'unavailable',
        newestPermitDate: previous?.newestPermitDate ?? null,
        count30d: previous?.count30d ?? 0,
        fieldHealth: previous?.fieldHealth ?? null,
        sourceUpdatedAt: previous?.sourceUpdatedAt ?? null,
        lastCheckedAt: now.toISOString(),
        message: `Daily refresh could not reach this feed (${error instanceof Error ? error.message : String(error)}). Last known newest permit is shown, if any.`,
      };
      await deps.store.upsert(row);
      rows.push(row);
    }
  }
  return rows;
}

/** Placeholder rows for the status endpoint before the first daily refresh has run. */
export function unknownSourceStatuses(now: Date): PermitSourceStatusRow[] {
  return LIVE_SOURCES.map((source) => ({
    sourceId: source.id,
    name: source.name,
    status: 'unknown' as const,
    newestPermitDate: null,
    count30d: 0,
    fieldHealth: null,
    sourceUpdatedAt: null,
    lastCheckedAt: now.toISOString(),
    message:
      'Not checked yet — the daily refresh has not run since the last deploy. Run a search to check this feed live.',
  }));
}
