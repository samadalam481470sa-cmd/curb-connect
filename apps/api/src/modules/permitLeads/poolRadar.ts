// Texas Pool Radar: pool permits are hot leads for a fence / outdoor-living company,
// because a barrier is required around a residential pool. A fence permit typically follows
// the pool permit by a few weeks — the reel that inspired this ("Pool Radar", Florida)
// claims ~4 weeks, and a Florida-only "3x more likely within 50 days" stat. Neither number
// is copied here: the windows below are labelled estimates, and the only timing Field Pro
// reports is what it observes in the Texas permits it actually scanned (median pool-to-fence
// lag across matched leads, when any matched). Nothing is invented: a pool permit is only a
// pool permit when the city's own type/description says so, and a fence match only counts
// when a later fence permit is filed at the same normalized address in the same city.
import type { RawPermit } from './engine';
import { assessFreshness } from './freshness';
import {
  checkCustomFeed,
  fetchCustom,
  fetchers,
  LIVE_SOURCES,
  type SourceFetcherFn,
} from './sources';
import { cleanCityName } from './texas';

type FetchLike = typeof fetch;
const DAY_MS = 86_400_000;

// Word-boundary matching: "pool" inside "Liverpool", "carpool" or "whirlpool" is not a pool
// permit, and "fence" inside "defence" is not a fence permit. Compounds that are pool work
// ("poolhouse", "poolside") count; "swimming" on its own in a permit description means a pool.
const POOL_TEXT = /\bpools?\b|\bswimming\b|\bpool(?:house|side|deck)\b/i;
const FENCE_TEXT = /\bfences?\b|\bfencing\b/i;

const searchableText = (p: RawPermit): string =>
  [p.description, p.permitType, p.workClass, p.landUse].join(' ');

/** True when the city's own type/description/work class says this is a pool permit. */
export function isPoolPermit(p: RawPermit): boolean {
  return POOL_TEXT.test(searchableText(p));
}

/** True when the city's own type/description/work class says this is a fence permit. */
export function isFencePermit(p: RawPermit): boolean {
  return FENCE_TEXT.test(searchableText(p));
}

const STREET_SUFFIX: Record<string, string> = {
  ST: 'STREET',
  STR: 'STREET',
  AVE: 'AVENUE',
  AV: 'AVENUE',
  RD: 'ROAD',
  DR: 'DRIVE',
  LN: 'LANE',
  CT: 'COURT',
  BLVD: 'BOULEVARD',
  PKWY: 'PARKWAY',
  HWY: 'HIGHWAY',
  TER: 'TERRACE',
  PL: 'PLACE',
  CIR: 'CIRCLE',
};

/**
 * Stable property key: normalized street address + city. Street suffixes are expanded
 * ("123 Main St" and "123 Main Street" are the same property); unit/suite designators are
 * kept, so "123 Main St Apt 4" does not match "123 Main St". Empty when no address is
 * published — an address-less permit can never match a fence permit.
 */
export function poolPropertyKey(p: RawPermit): string {
  const address = p.address
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!address) return '';
  const parts = address.split(' ');
  const last = parts[parts.length - 1]!;
  if (STREET_SUFFIX[last]) parts[parts.length - 1] = STREET_SUFFIX[last]!;
  const city = p.city.toUpperCase().trim();
  if (!city) return '';
  return parts.join(' ') + '|' + city;
}

export type PoolWindow =
  'before_window' | 'in_window' | 'window_closing' | 'past_window' | 'no_date';

/** Follow-up windows around the ~28-day fence-follow-up estimate. These are estimates for
 *  when to call, not measured Texas conversion rates — Field Pro has no conversion data. */
export const POOL_WINDOW_LABEL: Record<PoolWindow, string> = {
  before_window: 'Too soon — fence window opens ~day 21 (estimate)',
  in_window: 'In window — days 21–35 (estimate)',
  window_closing: 'Window closing — days 36–50 (estimate)',
  past_window: 'Past window — day 51+ (estimate)',
  no_date: 'No permit date on file',
};

export function daysSinceIssue(issuedAt: string | null, now: Date): number | null {
  if (!issuedAt) return null;
  const ms = now.getTime() - Date.parse(issuedAt);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor(ms / DAY_MS));
}

export function poolWindow(daysSince: number | null): PoolWindow {
  if (daysSince === null) return 'no_date';
  if (daysSince < 21) return 'before_window';
  if (daysSince <= 35) return 'in_window';
  if (daysSince <= 50) return 'window_closing';
  return 'past_window';
}

export interface FenceMatch {
  permitNumber: string;
  issuedAt: string;
  description: string;
  source: string;
  sourceName: string;
  url: string;
  /** Days between the pool permit and this fence permit. */
  lagDays: number;
}

export interface PoolRadarLead {
  /** Funnel stage-storage key (source + permit number) so a lead can be added to the funnel. */
  leadKey: string;
  address: string;
  city: string;
  zip: string;
  source: string;
  sourceName: string;
  permitNumber: string;
  description: string;
  permitType: string;
  issuedAt: string | null;
  appliedAt: string | null;
  value: number;
  contractor: string;
  url: string;
  latitude?: number | null;
  longitude?: number | null;
  /** Whole days since the pool permit was issued; null when no date is on file. */
  daysSinceIssue: number | null;
  window: PoolWindow;
  windowLabel: string;
  /** The earliest fence permit filed at this address on/after the pool permit, if any. */
  fencePermit: FenceMatch | null;
}

export interface PoolRadarDerivation {
  leads: PoolRadarLead[];
  poolPermits: number;
  fencePermits: number;
  properties: number;
  matched: number;
  inWindow: number;
  windowClosing: number;
  pastWindow: number;
  beforeWindow: number;
  noDate: number;
  permitsWithoutAddress: number;
  /** Pool-to-fence lag actually observed in this scan, or null when nothing matched.
   *  Observed timing only — never a conversion rate. */
  observedFenceTiming: {
    matchedCount: number;
    medianLagDays: number;
    minLagDays: number;
    maxLagDays: number;
  } | null;
}

const WINDOW_RANK: Record<PoolWindow, number> = {
  in_window: 0,
  window_closing: 1,
  before_window: 2,
  past_window: 3,
  no_date: 4,
};

/**
 * Build Pool Radar leads from scanned permits. Pure: callers supply the permits.
 * A fence permit only matches a pool lead when both permits carry a date and the fence
 * date is on/after the pool date — an undated fence permit, or one filed before the pool,
 * is never counted as a follow-up. One fence per pool lead (the earliest after the pool).
 * Sort: unmatched leads first by window (in window, closing, too soon, past, no date),
 * then fence-filed leads, newest pool permit first within each group.
 */
export function derivePoolRadar(permits: RawPermit[], now: Date): PoolRadarDerivation {
  const pools: RawPermit[] = [];
  const fences: RawPermit[] = [];
  let permitsWithoutAddress = 0;
  for (const p of permits) {
    if (isPoolPermit(p)) {
      pools.push(p);
      if (!poolPropertyKey(p)) permitsWithoutAddress += 1;
    } else if (isFencePermit(p)) {
      fences.push(p);
    }
  }
  const fencesByProperty = new Map<string, RawPermit[]>();
  for (const f of fences) {
    const key = poolPropertyKey(f);
    if (!key || !f.issuedAt) continue;
    fencesByProperty.set(key, [...(fencesByProperty.get(key) ?? []), f]);
  }
  for (const list of fencesByProperty.values()) {
    list.sort((a, b) => (a.issuedAt ?? '').localeCompare(b.issuedAt ?? ''));
  }

  const leads: PoolRadarLead[] = pools.map((p) => {
    const days = daysSinceIssue(p.issuedAt ?? p.appliedAt, now);
    const window = poolWindow(days);
    let fencePermit: FenceMatch | null = null;
    const key = poolPropertyKey(p);
    const poolDate = p.issuedAt ?? p.appliedAt;
    if (key && poolDate) {
      const poolMs = Date.parse(poolDate);
      for (const f of fencesByProperty.get(key) ?? []) {
        const fenceMs = Date.parse(f.issuedAt!);
        if (fenceMs >= poolMs) {
          fencePermit = {
            permitNumber: f.permitNumber,
            issuedAt: f.issuedAt!,
            description: f.description,
            source: f.source,
            sourceName: f.sourceName,
            url: f.url,
            lagDays: Math.floor((fenceMs - poolMs) / DAY_MS),
          };
          break;
        }
      }
    }
    return {
      leadKey: `${p.source}:${p.permitNumber || poolPropertyKey(p) || p.address}`,
      address: p.address,
      city: p.city,
      zip: p.zip,
      source: p.source,
      sourceName: p.sourceName,
      permitNumber: p.permitNumber,
      description: p.description,
      permitType: p.permitType,
      issuedAt: p.issuedAt,
      appliedAt: p.appliedAt,
      value: p.value,
      contractor: p.contractor,
      url: p.url,
      latitude: p.latitude,
      longitude: p.longitude,
      daysSinceIssue: days,
      window,
      windowLabel: POOL_WINDOW_LABEL[window],
      fencePermit,
    };
  });
  leads.sort(
    (a, b) =>
      (a.fencePermit ? 1 : 0) - (b.fencePermit ? 1 : 0) ||
      WINDOW_RANK[a.window] - WINDOW_RANK[b.window] ||
      (b.issuedAt ?? b.appliedAt ?? '').localeCompare(a.issuedAt ?? a.appliedAt ?? ''),
  );

  const lags = leads
    .map((l) => l.fencePermit?.lagDays)
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  const observedFenceTiming =
    lags.length === 0
      ? null
      : {
          matchedCount: lags.length,
          medianLagDays:
            lags.length % 2 === 1
              ? lags[Math.floor(lags.length / 2)]!
              : Math.round((lags[lags.length / 2 - 1]! + lags[lags.length / 2]!) / 2),
          minLagDays: lags[0]!,
          maxLagDays: lags[lags.length - 1]!,
        };
  return {
    leads,
    poolPermits: pools.length,
    fencePermits: fences.length,
    properties: new Set(pools.map((p) => poolPropertyKey(p)).filter(Boolean)).size,
    matched: leads.filter((l) => l.fencePermit).length,
    inWindow: leads.filter((l) => l.window === 'in_window' && !l.fencePermit).length,
    windowClosing: leads.filter((l) => l.window === 'window_closing' && !l.fencePermit).length,
    pastWindow: leads.filter((l) => l.window === 'past_window' && !l.fencePermit).length,
    beforeWindow: leads.filter((l) => l.window === 'before_window' && !l.fencePermit).length,
    noDate: leads.filter((l) => l.window === 'no_date').length,
    permitsWithoutAddress,
    observedFenceTiming,
  };
}

/** Calendar date (YYYY-MM-DD) in America/Chicago for a UTC instant. */
export function texasDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export interface PoolDailyList {
  /** Texas calendar date the list is for (YYYY-MM-DD). */
  date: string;
  /** Pool permits dated today in this scan, no fence permit yet. */
  newToday: PoolRadarLead[];
  /** Leads whose follow-up window opened today (day 21, estimate). */
  windowOpenedToday: PoolRadarLead[];
  /** Leads whose window started closing today (day 36, estimate). */
  windowClosingToday: PoolRadarLead[];
  note: string;
}

/**
 * Today's actionable Pool Radar list, derived from the same leads the search
 * already ranked. Permits are fetched live on every scan (nothing is stored
 * between scans), so "new today" honestly means "the city dated this pool
 * permit today" — not "Field Pro first saw it today". Window boundaries are
 * the same labelled estimates as the main list. Leads with a fence permit
 * already filed are excluded (nothing left to chase).
 */
export function derivePoolDailyList(leads: readonly PoolRadarLead[], now: Date): PoolDailyList {
  const today = texasDateString(now);
  const open = leads.filter((l) => !l.fencePermit);
  const newToday = open.filter((l) => {
    const raw = l.issuedAt ?? l.appliedAt;
    if (!raw) return false;
    const ms = Date.parse(raw);
    return !Number.isNaN(ms) && texasDateString(new Date(ms)) === today;
  });
  const windowOpenedToday = open.filter((l) => l.daysSinceIssue === 21);
  const windowClosingToday = open.filter((l) => l.daysSinceIssue === 36);
  return {
    date: today,
    newToday,
    windowOpenedToday,
    windowClosingToday,
    note:
      'Daily list from this scan only. Permits are fetched live, so "new today" means the city dated the pool permit today (Texas date) — Field Pro does not store permits between scans. Window-open and window-closing days use the same estimated windows as the main list (day 21 / day 36), not measured conversion timing. Nothing is sent anywhere; "Add to funnel" only starts tracking the lead in the Active Permits Funnel.',
  };
}

// ---- Fetching pool + fence permits from the same live feeds ----

export interface PoolRadarInput {
  cities: string[];
  days: number;
  customFeeds: { city: string; url: string }[];
}

export interface PoolRadarFeed {
  id: string;
  name: string;
  status: 'ok' | 'unavailable' | 'rejected';
  count: number;
  poolPermits: number;
  fencePermits: number;
  /** Share of permits carrying any pool/fence-searchable text (0-1); null when empty. */
  searchableTextShare: number | null;
  latest: string | null;
  freshness: 'live' | 'stale' | 'unavailable' | 'unknown';
  message: string;
}

export async function searchPoolRadar(
  input: PoolRadarInput,
  deps: {
    fetcher?: FetchLike;
    now?: Date;
    fetchers?: Record<string, SourceFetcherFn>;
    resolve?: Parameters<typeof checkCustomFeed>[1];
  } = {},
) {
  const now = deps.now ?? new Date();
  const fetcher = deps.fetcher ?? fetch;
  const sourceFetchers = deps.fetchers ?? fetchers;
  const since = new Date(now.getTime() - input.days * DAY_MS);
  const wanted = [...new Set(input.cities.map(cleanCityName).filter(Boolean))];
  const wantedLower = new Set(wanted.map((c) => c.toLowerCase()));
  const everyCity = wantedLower.has('all texas');

  const run = async (
    id: string,
    name: string,
    load: () => Promise<RawPermit[]>,
  ): Promise<{ feed: PoolRadarFeed; permits: RawPermit[] }> => {
    try {
      const raw = await load();
      // Same permit can be published more than once in a feed or data refresh.
      const permits = [...new Map(raw.map((p) => [p.source + ':' + p.permitNumber, p])).values()];
      const poolPermits = permits.filter(isPoolPermit).length;
      const fencePermits = permits.filter(isFencePermit).length;
      const searchable = permits.filter((p) => searchableText(p).trim().length > 0).length;
      const latest =
        permits
          .map((p) => p.issuedAt ?? p.appliedAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;
      const freshness = assessFreshness(id, latest, now);
      const searchableShare =
        permits.length === 0 ? null : Math.round((searchable / permits.length) * 100) / 100;
      const houstonNote =
        id === 'houston'
          ? ' Houston pool permits are only identifiable when the weekly file\u2019s comments mention a pool — a \u201cBuilding Pmt\u201d row with no comment cannot be identified as a pool permit.'
          : '';
      const sparseNote =
        searchableShare !== null && searchableShare < 0.5
          ? ` Only ${Math.round(searchableShare * 100)}% of this feed\u2019s permits carry searchable type/description text, so pool permits may be missed here.`
          : '';
      return {
        feed: {
          id,
          name,
          status: 'ok',
          count: permits.length,
          poolPermits,
          fencePermits,
          searchableTextShare: searchableShare,
          latest,
          freshness: permits.length > 0 ? freshness.status : 'unavailable',
          message:
            `${permits.length} permits in the window, ${poolPermits} pool and ${fencePermits} fence.` +
            (permits.length && freshness.status === 'stale' ? ` ${freshness.message}` : '') +
            sparseNote +
            houstonNote,
        },
        permits,
      };
    } catch {
      return {
        feed: {
          id,
          name,
          status: 'unavailable',
          count: 0,
          poolPermits: 0,
          fencePermits: 0,
          searchableTextShare: null,
          latest: null,
          freshness: 'unavailable',
          message: 'The city feed did not answer. Try again in a few minutes.',
        },
        permits: [],
      };
    }
  };

  const jobs: Promise<{ feed: PoolRadarFeed; permits: RawPermit[] }>[] = [];
  for (const src of LIVE_SOURCES) {
    const hit = everyCity || src.cities.some((c) => wantedLower.has(c.toLowerCase()));
    if (!hit) continue;
    const runSource = sourceFetchers[src.id];
    if (!runSource) continue;
    jobs.push(
      run(src.id, src.name, async () =>
        (await runSource({ fetch: fetcher, since, now })).filter((p) =>
          src.id === 'collin' ? everyCity || wantedLower.has(p.city.toLowerCase()) : true,
        ),
      ),
    );
  }
  for (const feed of input.customFeeds) {
    const city = cleanCityName(feed.city);
    const url = await checkCustomFeed(feed.url, deps.resolve);
    if (!url) {
      jobs.push(
        Promise.resolve({
          feed: {
            id: 'custom:' + city,
            name: `${city} feed`,
            status: 'rejected' as const,
            count: 0,
            poolPermits: 0,
            fencePermits: 0,
            searchableTextShare: null,
            latest: null,
            freshness: 'unknown' as const,
            message:
              'Use the https "/resource/xxxx-xxxx.json" API link from the city\u2019s open-data permit page.',
          },
          permits: [],
        }),
      );
      continue;
    }
    jobs.push(
      run('custom:' + url.host, `${city} open data (${url.host})`, () =>
        fetchCustom(url, city, since, fetcher),
      ),
    );
  }
  const outcomes = await Promise.all(jobs);
  const all = [
    ...new Map(
      outcomes.flatMap((o) => o.permits).map((p) => [p.source + ':' + p.permitNumber, p]),
    ).values(),
  ];
  const derived = derivePoolRadar(all, now);
  return {
    fetchedAt: now.toISOString(),
    window: { since: since.toISOString(), days: input.days },
    summary: {
      permitsScanned: all.length,
      poolPermits: derived.poolPermits,
      fencePermits: derived.fencePermits,
      properties: derived.properties,
      matched: derived.matched,
      inWindow: derived.inWindow,
      windowClosing: derived.windowClosing,
      pastWindow: derived.pastWindow,
      beforeWindow: derived.beforeWindow,
      noDate: derived.noDate,
      permitsWithoutAddress: derived.permitsWithoutAddress,
    },
    observedFenceTiming: derived.observedFenceTiming,
    dailyList: derivePoolDailyList(derived.leads, now),
    feeds: outcomes.map((o) => o.feed),
    leads: derived.leads.slice(0, 300),
    caveats: [
      'Follow-up windows are estimates for when to call (around 28 days after the pool permit), not measured Texas conversion rates. Field Pro has no data on how often a pool permit turns into a fence sale.',
      'A fence permit is only counted as filed when a later fence permit appears at the same normalized address in the same city inside this search window. A fence filed for an older pool permit, or outside the window, is not matched.',
      'Houston pool permits are only identifiable when the weekly Excel file\u2019s comments mention a pool. A \u201cBuilding Pmt\u201d row with no comment cannot be identified as a pool permit, so Houston pool counts are a floor, not a total.',
      'Only pool permits issued inside the search window are checked. Use a 90-day window (the default) to cover the full follow-up period.',
      'No Florida numbers are used here: the Florida-only likelihood claim from the reel is not shown as a Texas fact.',
    ],
  };
}
