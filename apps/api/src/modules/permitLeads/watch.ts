// Daily permit watch: the saved search each company runs every morning (or every two hours).
// The worker stores the ranked result and marks jobs it has not shown before as new.
import { eq } from 'drizzle-orm';
import { permitWatches } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { searchTexasPermits, type SearchInput } from './search';

export type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
export type Schedule = 'morning' | 'all_day';

const MAX_SEEN = 5000;

export async function getWatch(run: Run, orgId: string) {
  return run(async (tx) => {
    const [row] = await tx
      .select()
      .from(permitWatches)
      .where(eq(permitWatches.orgId, orgId))
      .limit(1);
    return row ?? null;
  });
}

export async function saveWatch(
  run: Run,
  orgId: string,
  input: { enabled: boolean; schedule: Schedule; search: SearchInput },
) {
  return run(async (tx) => {
    const [row] = await tx
      .insert(permitWatches)
      .values({ orgId, enabled: input.enabled, schedule: input.schedule, search: input.search })
      .onConflictDoUpdate({
        target: permitWatches.orgId,
        set: {
          enabled: input.enabled,
          schedule: input.schedule,
          search: input.search,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row!;
  });
}

/** Run one company's saved search now and store the result. */
export async function runWatch(
  run: Run,
  orgId: string,
  deps: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<string> {
  const watch = await getWatch(run, orgId);
  if (!watch) return 'No saved search.';
  const now = deps.now ?? new Date();
  const result = await searchTexasPermits(watch.search as SearchInput, {
    fetcher: deps.fetcher,
    now,
  });
  const seen = new Set(watch.seenKeys);
  const isNew = (k: string) => !seen.has(k);
  const leads = result.leads.map((p) => ({ ...p, isNew: isNew(p.source + ':' + p.permitNumber) }));
  const newCount = leads.filter((p) => p.isNew).length;
  const keys = [
    ...new Set([...leads.map((p) => p.source + ':' + p.permitNumber), ...watch.seenKeys]),
  ].slice(0, MAX_SEEN);
  const message =
    `${newCount} new jobs, ${result.summary.qualified} total, ` +
    `$${Math.round(result.summary.totalValue).toLocaleString('en-US')} in permit value.`;
  await run(async (tx) => {
    await tx
      .update(permitWatches)
      .set({
        lastRunAt: now,
        lastMessage: message.slice(0, 500),
        lastResult: {
          ...result,
          leads: leads.slice(0, 150),
          topLeads: leads.slice(0, 20),
          profiles: result.profiles.slice(0, 40),
          newCount,
        },
        seenKeys: keys,
        updatedAt: now,
      })
      .where(eq(permitWatches.orgId, orgId));
  });
  return message;
}

/** Companies due for a scheduled run (worker only; platform role). */
export async function dueWatches(run: Run, schedule: Schedule | 'any'): Promise<string[]> {
  return run(async (tx) => {
    const rows = await tx
      .select({ orgId: permitWatches.orgId, schedule: permitWatches.schedule })
      .from(permitWatches)
      .where(eq(permitWatches.enabled, true))
      .limit(1000);
    return rows.filter((r) => schedule === 'any' || r.schedule === schedule).map((r) => r.orgId);
  });
}
