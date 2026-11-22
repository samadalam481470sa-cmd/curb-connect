// Scheduled permit job search (graphile-worker crontab, see worker.ts):
//   permit_watch_morning: 6:10 am Texas time, every company with a saved search.
//   permit_watch_all_day: every two hours, companies that picked "all day".
// Runs on the platform role; every query filters by the orgId it is given.
import type { Task } from 'graphile-worker';
import { withPlatform } from '../db/runtime';
import { dueWatches, runWatch, type Run } from '../modules/permitLeads/watch';
import type { WorkerDeps } from './tasks';

export const PERMIT_WATCH_CRONTAB = [
  // 12:10 UTC = 6:10 am CST (7:10 am during daylight time). fill=1d runs a missed morning on wake.
  '10 12 * * * permit_watch_morning ?fill=1d',
  '40 */2 * * * permit_watch_all_day',
].join('\n');

const runIn =
  (deps: WorkerDeps, orgId: string | null): Run =>
  (fn) =>
    withPlatform(deps.platformDb, 'worker.task', null, fn, { orgId, userId: null });

export function permitWatchTasks(deps: WorkerDeps): Record<string, Task> {
  const runAll =
    (schedule: 'any' | 'all_day'): Task =>
    async (_payload, helpers) => {
      const orgs = await dueWatches(runIn(deps, null), schedule);
      for (const orgId of orgs) {
        try {
          const message = await runWatch(runIn(deps, orgId), orgId);
          helpers.logger.info(`[permit-watch] ${orgId}: ${message}`);
        } catch (error) {
          helpers.logger.error(`[permit-watch] run failed for ${orgId}: ${String(error)}`);
        }
      }
    };
  return { permit_watch_morning: runAll('any'), permit_watch_all_day: runAll('all_day') };
}
