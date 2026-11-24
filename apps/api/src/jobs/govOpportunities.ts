// Daily .gov dead-link refresh (graphile-worker crontab, see worker.ts):
//   gov_opportunities_refresh: 6:00 am Texas time, re-scans every seed .gov resource page and
//   stores one row per outbound link (live/dead/unknown, with checked-at time).
//   gov_opportunities_refresh_on_start: queued each time the server starts or wakes up; runs
//   the refresh only when the stored check is more than 24 hours old, so a sleeping free
//   server backfills instead of showing a stale panel.
// The refresh is platform-wide (no org) and idempotent: the store upserts by (page, link) key,
// so a crash-and-retry or a second daily run updates the same rows instead of duplicating
// them. Runs on the platform role via withPlatform('worker.task').
import type { Task } from 'graphile-worker';
import { sql } from 'drizzle-orm';
import { govLinkChecks } from '../db/schema';
import { withPlatform, type Tx } from '../db/runtime';
import {
  scanSeedPages,
  type GovLinkRow,
  type GovLinkStore,
} from '../modules/govOpportunities/scanner';
import type { WorkerDeps } from './tasks';

export const GOV_OPPORTUNITIES_CRONTAB =
  // 12:00 UTC = 6:00 am CST (7:00 am during daylight time).
  '0 12 * * * gov_opportunities_refresh';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const runIn =
  (deps: WorkerDeps): ((fn: (tx: Tx) => Promise<void>) => Promise<void>) =>
  (fn) =>
    withPlatform(deps.platformDb, 'worker.task', null, fn, { orgId: null, userId: null });

function linkKey(pageUrl: string, linkUrl: string): string {
  return `${pageUrl}\n${linkUrl}`;
}

function dbStore(run: (fn: (tx: Tx) => Promise<void>) => Promise<void>): GovLinkStore {
  return {
    upsert: async (row: GovLinkRow) => {
      await run(async (tx) => {
        await tx
          .insert(govLinkChecks)
          .values({
            key: linkKey(row.pageUrl, row.linkUrl),
            pageId: row.pageId,
            pageName: row.pageName,
            pageCity: row.pageCity,
            pageUrl: row.pageUrl,
            linkUrl: row.linkUrl,
            linkText: row.linkText,
            status: row.status,
            httpStatus: row.httpStatus,
            checkedAt: new Date(row.checkedAt),
            note: row.note,
          })
          .onConflictDoUpdate({
            target: govLinkChecks.key,
            set: {
              linkText: row.linkText,
              status: row.status,
              httpStatus: row.httpStatus,
              checkedAt: new Date(row.checkedAt),
              note: row.note,
              revision: sql`${govLinkChecks.revision} + 1`,
              updatedAt: new Date(),
            },
          });
      });
    },
    all: async () => {
      const rows: GovLinkRow[] = [];
      await run(async (tx) => {
        const found = await tx.select().from(govLinkChecks);
        for (const r of found) {
          rows.push({
            pageId: r.pageId,
            pageName: r.pageName,
            pageCity: r.pageCity,
            pageUrl: r.pageUrl,
            linkUrl: r.linkUrl,
            linkText: r.linkText,
            status: r.status as GovLinkRow['status'],
            httpStatus: r.httpStatus,
            checkedAt: r.checkedAt.toISOString(),
            note: r.note,
          });
        }
      });
      return rows;
    },
  };
}

async function refresh(deps: WorkerDeps, helpers: { logger: { info: (msg: string) => void } }) {
  const summary = await scanSeedPages({ store: dbStore(runIn(deps)) });
  helpers.logger.info(
    `[gov-opportunities] ${summary.pagesChecked} pages, ${summary.linksChecked} links, ` +
      `${summary.deadFound} dead, ${summary.unknownCount} unknown, checked ${summary.checkedAt}`,
  );
  for (const pageError of summary.pageErrors) {
    helpers.logger.info(`[gov-opportunities] page ${pageError.pageId} failed: ${pageError.error}`);
  }
}

export function govOpportunitiesTasks(deps: WorkerDeps): Record<string, Task> {
  return {
    gov_opportunities_refresh: async (_payload, helpers) => {
      await refresh(deps, helpers);
    },
    gov_opportunities_refresh_on_start: async (_payload, helpers) => {
      const now = Date.now();
      let stale = true;
      await runIn(deps)(async (tx) => {
        const rows = await tx.select().from(govLinkChecks);
        stale =
          rows.length === 0 ||
          rows.some((r) => now - r.checkedAt.getTime() > STALE_AFTER_MS);
      }).catch(() => {
        // The gov link table does not exist yet (migration not run): run the refresh anyway
        // so the failure surfaces in the worker log instead of silently skipping.
        stale = true;
      });
      if (!stale) {
        helpers.logger.info('[gov-opportunities] stored check is fresh; skipping startup refresh');
        return;
      }
      await refresh(deps, helpers);
    },
  };
}
