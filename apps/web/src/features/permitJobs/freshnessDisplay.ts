// Per-source freshness display helpers for the Feed freshness panel.
//
// The API (GET /v1/permit-leads/sources/status) stores one row per live permit feed: its status
// verdict, newest permit date, and when the daily refresh last checked it. These helpers only
// format what the API returned — the status word and the cadence rules (14-day window for daily
// feeds, 45 for Dallas) stay the API's (apps/api/src/modules/permitLeads/freshness.ts). The age
// shown here uses the same whole-days math as the API's assessFreshness, so the panel and the
// stored message always agree. Nothing here invents freshness: a missing or unreadable date
// yields no age label, never a guessed one.

const DAY_MS = 86_400_000;

/** Whole days between a source's newest permit and its last daily check, or null when either
 *  date is missing or unreadable. Mirrors assessFreshness in the API. */
export function permitAgeDays(
  newestPermitDate: string | null,
  lastCheckedAt: string,
): number | null {
  if (!newestPermitDate) return null;
  const newest = Date.parse(newestPermitDate);
  const checked = Date.parse(lastCheckedAt);
  if (Number.isNaN(newest) || Number.isNaN(checked)) return null;
  return Math.max(0, Math.floor((checked - newest) / DAY_MS));
}

/** " (5 days old at last check)" for a source whose newest permit predates its last check, so a
 *  feed that has stopped publishing is visible even while it is still inside its freshness
 *  window. Empty when the newest permit is from the check day itself or the age is unknown. */
export function ageLabel(newestPermitDate: string | null, lastCheckedAt: string): string {
  const days = permitAgeDays(newestPermitDate, lastCheckedAt);
  if (days === null || days === 0) return '';
  return ` (${days} day${days === 1 ? '' : 's'} old at last check)`;
}

/** What the newest-permit date means for a source. Houston publishes a weekly Excel file, so its
 *  newest permit date is the file's coverage end; every other live feed publishes daily. */
export function newestPermitLabel(sourceId: string): string {
  return sourceId === 'houston' ? 'coverage through ' : 'newest permit ';
}
