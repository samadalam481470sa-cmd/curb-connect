// "Caffeinate": keep the funnel's fetch alive so the leads it shows are never a day old.
//
// Honest limits, stated up front: the cities publish new permits daily at best (Houston
// weekly), so fetching every few minutes adds nothing and risks rate limits. The cadence
// below re-checks each feed as often as its own publishing rhythm justifies — every 30
// minutes during the workday (06:00–20:00 Texas time), hourly overnight — and the worker
// keeps itself warm with a 15-minute keep-alive while it is up. It cannot keep Render's
// free web service from sleeping (Render sleeps on no HTTP traffic); what it does guarantee
// is that a sleeping server backfills on wake (the on-start job) instead of showing a
// day-old panel, and that a feed that stops publishing is labelled stale instead of silently
// going quiet. All times use the existing UTC-crontab convention (12:00 UTC = 06:00 CST,
// 07:00 during daylight time), matching permitSources.ts and permitWatch.ts.
import { LIVE_SOURCES } from '../sources';

export const FUNNEL_DAY_START_HOUR_CT = 6;
export const FUNNEL_DAY_END_HOUR_CT = 20;
/** Daytime re-check interval; overnight the feeds are re-checked hourly. */
export const FUNNEL_DAY_INTERVAL_MINUTES = 30;
export const FUNNEL_NIGHT_INTERVAL_MINUTES = 60;
/** Keep-alive heartbeat while the worker is up (daytime only). */
export const FUNNEL_KEEPALIVE_MINUTES = 15;
/** Houston posts one weekly file; re-checking its index more than daily wastes the fetch. */
export const FUNNEL_HOUSTON_MIN_INTERVAL_MINUTES = 24 * 60;

export const FUNNEL_CRONTAB = [
  // Every 30 minutes, 12:00–01:59 UTC (06:00–19:59 CST workday).
  '*/30 12-23,0-1 * * * permit_funnel_refresh',
  // Hourly overnight, 02:00–11:59 UTC.
  '0 2-11 * * * permit_funnel_refresh',
  // Keep-alive heartbeat every 15 minutes during the workday.
  '*/15 12-23,0-1 * * * permit_funnel_keepalive',
].join('\n');

/** Hour of day (0–23) in America/Chicago for a UTC instant — no date library needed. */
export function texasHour(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
}

export function isWorkdayHour(now: Date): boolean {
  const h = texasHour(now);
  return h >= FUNNEL_DAY_START_HOUR_CT && h < FUNNEL_DAY_END_HOUR_CT;
}

/** How often a source should be re-checked right now, in minutes. */
export function refreshIntervalMinutes(sourceId: string, now: Date): number {
  if (sourceId === 'houston') return FUNNEL_HOUSTON_MIN_INTERVAL_MINUTES;
  return isWorkdayHour(now) ? FUNNEL_DAY_INTERVAL_MINUTES : FUNNEL_NIGHT_INTERVAL_MINUTES;
}

/** True when a source is due for a re-check (never checked counts as due). */
export function sourceDue(
  sourceId: string,
  lastCheckedAt: string | null,
  now: Date,
): boolean {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= refreshIntervalMinutes(sourceId, now) * 60_000;
}

/** Next scheduled refresh for a source, for the cadence endpoint. Null when already due. */
export function nextRefreshAt(
  sourceId: string,
  lastCheckedAt: string | null,
  now: Date,
): string | null {
  if (sourceDue(sourceId, lastCheckedAt, now)) return null;
  const last = Date.parse(lastCheckedAt!);
  return new Date(last + refreshIntervalMinutes(sourceId, now) * 60_000).toISOString();
}

/** Sources the funnel keeps alive, with their honest cadence notes for the UI. */
export function funnelCadenceSources(now: Date): {
  id: string;
  name: string;
  intervalMinutes: number;
  note: string;
}[] {
  return LIVE_SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    intervalMinutes: refreshIntervalMinutes(s.id, now),
    note:
      s.id === 'houston'
        ? 'Weekly Excel file — checked at most once a day; a new file posts about once a week.'
        : s.id === 'denton'
          ? 'Feed has not published since 2026-01-06 — still re-checked, labelled stale until the city resumes.'
          : s.id === 'dallas'
            ? 'City publishes on its own schedule — counts are live, contractor and value are sparse in 2026.'
            : isWorkdayHour(now)
              ? 'Checked every 30 minutes during the workday.'
              : 'Checked hourly overnight.',
  }));
}
