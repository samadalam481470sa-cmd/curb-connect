// Per-state summaries and the daily refresh plan. The plan is pure: given a date it returns the 50
// states in a stable rotation so a large dataset is refreshed in slices rather than all at once.
import { US_STATES, type UsState } from './states';
import type { Footprint } from './footprints';

export interface StateSummary {
  state: string;
  buildings: number;
  totalSqFt: number;
  medianSqFt: number | null;
}

export function summarizeState(state: UsState, footprints: readonly Footprint[]): StateSummary {
  const areas = footprints.map((f) => f.areaSqFt).sort((a, b) => a - b);
  const total = areas.reduce((s, a) => s + a, 0);
  const mid = Math.floor(areas.length / 2);
  const median = areas.length === 0 ? null : areas.length % 2 ? areas[mid]! : (areas[mid - 1]! + areas[mid]!) / 2;
  return {
    state: state.abbr,
    buildings: footprints.length,
    totalSqFt: Math.round(total * 10) / 10,
    medianSqFt: median === null ? null : Math.round(median * 10) / 10,
  };
}

/**
 * Which states to refresh on a given UTC day. Every state is covered within `cycleDays` days (default
 * 10), so a daily job processes about one-tenth of the country and no state goes stale for long.
 */
export function refreshPlanFor(date: Date, cycleDays = 10): UsState[] {
  if (!Number.isInteger(cycleDays) || cycleDays < 1 || cycleDays > US_STATES.length) {
    throw new RangeError('cycleDays must be an integer from 1 to 50.');
  }
  const dayNumber = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
  const slot = ((dayNumber % cycleDays) + cycleDays) % cycleDays;
  return US_STATES.filter((_, i) => i % cycleDays === slot);
}
