// Scheduled outreach work (graphile-worker crontab, see worker.ts):
//   outreach_morning: 7:05 am Texas time, find today's new companies for every company that has
//                     automatic refresh on, then check replies.
//   outreach_tick:    every 15 minutes, send queued emails (within each daily limit) and check
//                     replies from contacted companies.
// Runs on the platform role; every service query filters by the orgId it is given.
import type { Task } from 'graphile-worker';
import { withPlatform } from '../db/runtime';
import {
  activeOutreachOrgs,
  autoRefreshOrgs,
  refreshCompanies,
  sendQueued,
  syncReplies,
  type Run,
} from '../modules/outreach/service';
import type { WorkerDeps } from './tasks';

export const OUTREACH_CRONTAB = [
  // 13:05 UTC = 7:05 am CST (8:05 am during daylight time). fill=1d runs a missed morning on wake.
  '5 13 * * * outreach_morning ?fill=1d',
  '*/15 * * * * outreach_tick',
].join('\n');

const runIn =
  (deps: WorkerDeps, orgId: string | null): Run =>
  (fn) =>
    withPlatform(deps.platformDb, 'worker.task', null, fn, { orgId, userId: null });

export function outreachTasks(deps: WorkerDeps): Record<string, Task> {
  const morning: Task = async (_payload, helpers) => {
    const orgs = await autoRefreshOrgs(runIn(deps, null));
    for (const orgId of orgs) {
      const run = runIn(deps, orgId);
      try {
        const r = await refreshCompanies(run, orgId, deps.config.outreach.placesKey);
        helpers.logger.info(`[outreach] ${orgId}: ${r.message}`);
        if (deps.mailer.available) await syncReplies(run, orgId, deps.mailer);
      } catch (error) {
        helpers.logger.error(`[outreach] morning refresh failed for ${orgId}: ${String(error)}`);
      }
    }
  };
  const tick: Task = async (_payload, helpers) => {
    if (!deps.mailer.available) return;
    const orgs = await activeOutreachOrgs(runIn(deps, null));
    for (const orgId of orgs) {
      const run = runIn(deps, orgId);
      try {
        await sendQueued(run, orgId, deps.mailer, 20);
        await syncReplies(run, orgId, deps.mailer);
      } catch (error) {
        helpers.logger.error(`[outreach] tick failed for ${orgId}: ${String(error)}`);
      }
    }
  };
  return { outreach_morning: morning, outreach_tick: tick };
}
