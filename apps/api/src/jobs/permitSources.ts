// Daily permit-source freshness refresh (graphile-worker crontab, see worker.ts):
//   permit_sources_refresh: 6:00 am Texas time, re-fetches every live permit source and stores
//   one freshness row per source (newest permit, 30-day count, field health, last checked).
//   permit_sources_refresh_on_start: queued each time the server starts or wakes up; runs the
//   refresh only when the stored check is more than 24 hours old, so a sleeping free server
//   backfills instead of showing a stale panel.
// The refresh is platform-wide (no org) and idempotent: the store upserts by source_id, so a
// crash-and-retry or a second daily run updates the same rows instead of duplicating them.
// Runs on the platform role via withPlatform('worker.task').
import type { Task } from 'graphile-worker';
import { eq, sql } from 'drizzle-orm';
import { permitSourceStatuses } from '../db/schema';
import { withPlatform, type Tx } from '../db/runtime';
import {
  refreshSourceStatuses,
  type PermitSourceStatusRow,
  type SourceStatusStore,
} from '../modules/permitLeads/freshness';
import type { WorkerDeps } from './tasks';

export const PERMIT_SOURCES_CRONTAB =
  // 12:00 UTC = 6:00 am CST (7:00 am during daylight time).
  '0 12 * * * permit_sources_refresh';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const runIn =
  (deps: WorkerDeps): ((fn: (tx: Tx) => Promise<void>) => Promise<void>) =>
  (fn) =>
    withPlatform(deps.platformDb, 'worker.task', null, fn, { orgId: null, userId: null });

function dbStore(run: (fn: (tx: Tx) => Promise<void>) => Promise<void>): SourceStatusStore {
  return {
    get: async (sourceId) => {
      let found: PermitSourceStatusRow | null = null;
      await run(async (tx) => {
        const [row] = await tx
          .select()
          .from(permitSourceStatuses)
          .where(eq(permitSourceStatuses.sourceId, sourceId));
        if (!row) return;
        found = {
          sourceId: row.sourceId,
          name: row.name,
          status: row.status as PermitSourceStatusRow['status'],
          newestPermitDate: row.newestPermitDate ? row.newestPermitDate.toISOString() : null,
          count30d: row.count30d,
          fieldHealth: row.fieldHealth,
          sourceUpdatedAt: row.sourceUpdatedAt ? row.sourceUpdatedAt.toISOString() : null,
          lastCheckedAt: row.lastCheckedAt.toISOString(),
          message: row.message,
        };
      });
      return found;
    },
    upsert: async (row) => {
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
    },
  };
}

async function refresh(deps: WorkerDeps, helpers: { logger: { info: (msg: string) => void } }) {
  const rows = await refreshSourceStatuses({ store: dbStore(runIn(deps)) });
  for (const row of rows) {
    helpers.logger.info(
      `[permit-sources] ${row.sourceId}: ${row.status} — newest ${row.newestPermitDate ?? 'none'}, ${row.count30d} in 30d, checked ${row.lastCheckedAt}`,
    );
  }
}

export function permitSourcesTasks(deps: WorkerDeps): Record<string, Task> {
  return {
    permit_sources_refresh: async (_payload, helpers) => {
      await refresh(deps, helpers);
    },
    permit_sources_refresh_on_start: async (_payload, helpers) => {
      const now = Date.now();
      let stale = true;
      await runIn(deps)(async (tx) => {
        const rows = await tx.select().from(permitSourceStatuses);
        stale =
          rows.length === 0 ||
          rows.some((r) => now - r.lastCheckedAt.getTime() > STALE_AFTER_MS);
      }).catch(() => {
        // The freshness table does not exist yet (migration not run): run the refresh anyway
        // so the failure surfaces in the worker log instead of silently skipping.
        stale = true;
      });
      if (!stale) {
        helpers.logger.info('[permit-sources] stored check is fresh; skipping startup refresh');
        return;
      }
      await refresh(deps, helpers);
    },
  };
}
