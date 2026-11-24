// Funnel keep-alive ("caffeinate") worker tasks (graphile-worker).
//
//   permit_funnel_refresh          every 30 min in the workday, hourly overnight
//   permit_funnel_keepalive        every 15 min in the workday — heartbeat only
//   permit_funnel_refresh_on_start queued on every server start/wake; backfills when due
//
// What the refresh does: re-check each live permit feed that is DUE under the funnel cadence
// (cadence.ts) and upsert its freshness row — the same rows the funnel view reads for its
// "last fetched X minutes ago" labels. Houston is re-checked at most once a day (weekly file);
// a feed that is not due is left untouched, so its last-checked time stays honest. The job
// never invents permits: it only re-runs the existing fetchers and freshness assessment.
// Register the crontab + tasks from worker.ts / jobs/tasks.ts (see docs/active-permits-funnel.md
// "Integration"); this file itself adds no wiring.
import type { Task } from 'graphile-worker';
import { sql } from 'drizzle-orm';
import { permitSourceStatuses } from '../../../db/schema';
import { withPlatform, type Tx } from '../../../db/runtime';
import type { WorkerDeps } from '../../../jobs/tasks';
import { assessFreshness, computeFieldHealth, type PermitSourceStatusRow } from '../freshness';
import { fetchers, LIVE_SOURCES } from '../sources';
import { FUNNEL_CRONTAB, sourceDue } from './cadence';

export { FUNNEL_CRONTAB };

const runIn =
  (deps: WorkerDeps): ((fn: (tx: Tx) => Promise<void>) => Promise<void>) =>
  (fn) =>
    withPlatform(deps.platformDb, 'worker.task', null, fn, { orgId: null, userId: null });

async function storedLastChecked(
  run: (fn: (tx: Tx) => Promise<void>) => Promise<void>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await run(async (tx) => {
    const rows = await tx.select().from(permitSourceStatuses);
    for (const r of rows) out.set(r.sourceId, r.lastCheckedAt.toISOString());
  }).catch(() => {
    // Freshness table does not exist yet (migration not run): treat everything as due so
    // the failure surfaces in the worker log instead of silently skipping.
  });
  return out;
}

async function upsertRow(
  run: (fn: (tx: Tx) => Promise<void>) => Promise<void>,
  row: PermitSourceStatusRow,
): Promise<void> {
  await run(async (tx) => {
    await tx
      .insert(permitSourceStatuses)
      .values({
        sourceId: row.sourceId,
        name: row.name,
        status: row.status,
        newestPermitDate: row.newestPermitDate ? new Date(row.newestPermitDate) : null,
        count30d: row.count30d,
        fieldHealth: row.fieldHealth,
        sourceUpdatedAt: row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null,
        lastCheckedAt: new Date(row.lastCheckedAt),
        message: row.message,
      })
      .onConflictDoUpdate({
        target: permitSourceStatuses.sourceId,
        set: {
          name: row.name,
          status: row.status,
          newestPermitDate: row.newestPermitDate ? new Date(row.newestPermitDate) : null,
          count30d: row.count30d,
          fieldHealth: row.fieldHealth,
          sourceUpdatedAt: row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null,
          lastCheckedAt: new Date(row.lastCheckedAt),
          message: row.message,
          revision: sql`${permitSourceStatuses.revision} + 1`,
          updatedAt: new Date(),
        },
      });
  });
}

/**
 * Re-check every due source and upsert its freshness row. Idempotent: a re-run after a
 * crash updates the same rows. One failing source never stops the others.
 */
export async function refreshDueFunnelSources(
  deps: WorkerDeps,
  now = new Date(),
  fetchFn: typeof fetch = fetch,
): Promise<{ checked: string[]; skipped: string[] }> {
  const run = runIn(deps);
  const lastChecked = await storedLastChecked(run);
  const checked: string[] = [];
  const skipped: string[] = [];
  const since = new Date(now.getTime() - 30 * 86_400_000);
  for (const source of LIVE_SOURCES) {
    const last = lastChecked.get(source.id) ?? null;
    if (!sourceDue(source.id, last, now)) {
      skipped.push(source.id);
      continue;
    }
    checked.push(source.id);
    try {
      const runSource = fetchers[source.id];
      if (!runSource) throw new Error(`No fetcher for permit source ${source.id}.`);
      const permits = await runSource({ fetch: fetchFn, since, now });
      const newest =
        permits.map((p) => p.issuedAt ?? p.appliedAt).filter(Boolean).sort().at(-1) ?? null;
      const freshness = assessFreshness(source.id, newest, now);
      await upsertRow(run, {
        sourceId: source.id,
        name: source.name,
        status: freshness.status,
        newestPermitDate: newest,
        count30d: permits.length,
        fieldHealth: computeFieldHealth(permits),
        sourceUpdatedAt: null,
        lastCheckedAt: now.toISOString(),
        message: freshness.message,
      });
    } catch (error) {
      const previous = lastChecked.get(source.id);
      await upsertRow(run, {
        sourceId: source.id,
        name: source.name,
        status: 'unavailable',
        newestPermitDate: null,
        count30d: 0,
        fieldHealth: null,
        sourceUpdatedAt: null,
        lastCheckedAt: now.toISOString(),
        message: `Funnel refresh could not reach this feed (${error instanceof Error ? error.message : String(error)}).${previous ? ` Last checked ${previous}.` : ''}`,
      });
    }
  }
  return { checked, skipped };
}

export function permitFunnelTasks(deps: WorkerDeps): Record<string, Task> {
  return {
    permit_funnel_refresh: async (_payload, helpers) => {
      const { checked, skipped } = await refreshDueFunnelSources(deps);
      helpers.logger.info(
        `[permit-funnel] refresh: checked ${checked.join(', ') || 'none'}; skipped (not due) ${skipped.join(', ') || 'none'}`,
      );
    },
    // Heartbeat: keeps the worker loop warm while the process is up and refreshes anything
    // that came due since the last tick. It does not — and cannot — keep Render's free web
    // service from sleeping on zero HTTP traffic; the on-start job covers the wake-up.
    permit_funnel_keepalive: async (_payload, helpers) => {
      const { checked } = await refreshDueFunnelSources(deps);
      helpers.logger.info(
        `[permit-funnel] keepalive: ${checked.length ? `refreshed ${checked.join(', ')}` : 'nothing due'}`,
      );
    },
    permit_funnel_refresh_on_start: async (_payload, helpers) => {
      const { checked } = await refreshDueFunnelSources(deps);
      helpers.logger.info(
        `[permit-funnel] startup refresh: ${checked.length ? `checked ${checked.join(', ')}` : 'nothing due'}`,
      );
    },
  };
}
