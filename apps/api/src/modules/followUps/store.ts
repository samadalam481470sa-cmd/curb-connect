// Follow-up per-item state: snoozes, completions and cadence overrides.
//
// Two implementations behind one interface (same pattern as the funnel stage
// store):
//   - createDbFollowUpStore(): drizzle over follow_up_overrides (migration
//     0101). Tenant-scoped by orgId on every query. This is the production
//     store — state survives restarts.
//   - createMemoryFollowUpStore(): in-memory, for unit tests and as the
//     graceful fallback before migration 0106 is applied (state then lasts
//     only for the process lifetime, exactly as before 0101).
//
// The derived queue (queue.ts) is the source of truth for what is due; this
// store only records what a person did to an item.
import { and, eq, sql } from 'drizzle-orm';
// NOTE: the barrel import below must stay first (circular schema graph — see
// permitLeads/funnel/store.ts for why).
import '../../db/schema';
import { followUpOverrides } from '../../db/schema/roofAgents';
import type { Tx } from '../../db/runtime';
import type { CallOutcome } from '../permitLeads/funnel/stages';
import { emptyFollowUpOverride, validCadenceDays, type FollowUpOverride } from './queue';

export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface FollowUpStore {
  getOverrides(orgId: string): Promise<Map<string, FollowUpOverride>>;
  getOverride(orgId: string, id: string): Promise<FollowUpOverride>;
  snooze(orgId: string, id: string, snoozedUntil: string): Promise<FollowUpOverride>;
  complete(
    orgId: string,
    id: string,
    outcome: CallOutcome,
    note: string,
    completedAt: string,
  ): Promise<FollowUpOverride>;
  setCadence(orgId: string, id: string, cadenceDays: number): Promise<FollowUpOverride | null>;
}

export function createMemoryFollowUpStore(): FollowUpStore {
  const overrides = new Map<string, FollowUpOverride>();
  const key = (orgId: string, id: string) => `${orgId}:${id}`;
  const get = (orgId: string, id: string): FollowUpOverride =>
    overrides.get(key(orgId, id)) ?? emptyFollowUpOverride();
  const put = (orgId: string, id: string, next: FollowUpOverride): FollowUpOverride => {
    overrides.set(key(orgId, id), next);
    return next;
  };
  return {
    async getOverrides(orgId) {
      const out = new Map<string, FollowUpOverride>();
      const prefix = `${orgId}:`;
      for (const [k, v] of overrides) {
        if (k.startsWith(prefix)) out.set(k.slice(prefix.length), v);
      }
      return out;
    },
    async getOverride(orgId, id) {
      return get(orgId, id);
    },
    async snooze(orgId, id, snoozedUntil) {
      return put(orgId, id, { ...get(orgId, id), snoozedUntil });
    },
    async complete(orgId, id, outcome, note, completedAt) {
      // Completing clears a snooze: the next due date is one cadence after completion.
      return put(orgId, id, {
        ...get(orgId, id),
        snoozedUntil: null,
        completedAt,
        lastOutcome: outcome,
        lastNote: note,
      });
    },
    async setCadence(orgId, id, cadenceDays) {
      const valid = validCadenceDays(cadenceDays);
      if (valid === null) return null;
      return put(orgId, id, { ...get(orgId, id), cadenceDays: valid });
    },
  };
}

type OverrideRow = typeof followUpOverrides.$inferSelect;

/** Pure row → domain mapping (exported for unit tests). */
export function rowToFollowUpOverride(row: OverrideRow): FollowUpOverride {
  return {
    snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    lastOutcome: (row.lastOutcome as CallOutcome | null) ?? null,
    lastNote: row.lastNote,
    cadenceDays: row.cadenceDays,
  };
}

export function createDbFollowUpStore(run: TxRunner): FollowUpStore {
  const upsert = async (
    orgId: string,
    id: string,
    patch: Partial<{
      snoozedUntil: Date | null;
      completedAt: Date | null;
      lastOutcome: string | null;
      lastNote: string | null;
      cadenceDays: number | null;
    }>,
  ): Promise<FollowUpOverride> =>
    run(async (tx) => {
      const [row] = await tx
        .insert(followUpOverrides)
        .values({ orgId, itemId: id, ...patch })
        .onConflictDoUpdate({
          target: [followUpOverrides.orgId, followUpOverrides.itemId],
          set: { ...patch, revision: sql`${followUpOverrides.revision} + 1`, updatedAt: new Date() },
        })
        .returning();
      if (!row) throw new Error('follow-up override upsert returned no row');
      return rowToFollowUpOverride(row);
    });

  return {
    async getOverrides(orgId) {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(followUpOverrides)
          .where(eq(followUpOverrides.orgId, orgId));
        return new Map(rows.map((r) => [r.itemId, rowToFollowUpOverride(r)]));
      });
    },
    async getOverride(orgId, id) {
      return run(async (tx) => {
        const [row] = await tx
          .select()
          .from(followUpOverrides)
          .where(and(eq(followUpOverrides.orgId, orgId), eq(followUpOverrides.itemId, id)))
          .limit(1);
        return row ? rowToFollowUpOverride(row) : emptyFollowUpOverride();
      });
    },
    async snooze(orgId, id, snoozedUntil) {
      return upsert(orgId, id, { snoozedUntil: new Date(snoozedUntil) });
    },
    async complete(orgId, id, outcome, note, completedAt) {
      return upsert(orgId, id, {
        snoozedUntil: null,
        completedAt: new Date(completedAt),
        lastOutcome: outcome,
        lastNote: note,
      });
    },
    async setCadence(orgId, id, cadenceDays) {
      const valid = validCadenceDays(cadenceDays);
      if (valid === null) return null;
      return upsert(orgId, id, { cadenceDays: valid });
    },
  };
}

/**
 * DB store with an in-memory fallback: if the database call fails (e.g.
 * migration 0106 not applied yet), the memory store answers so the endpoints
 * keep working with process-lifetime state — the pre-0101 behavior.
 */
export function createResilientFollowUpStore(
  db: FollowUpStore,
  memory: FollowUpStore,
): FollowUpStore {
  const wrap = <T>(fn: (s: FollowUpStore) => Promise<T>): Promise<T> =>
    fn(db).catch(() => fn(memory));
  return {
    getOverrides: (orgId) => wrap((s) => s.getOverrides(orgId)),
    getOverride: (orgId, id) => wrap((s) => s.getOverride(orgId, id)),
    snooze: (orgId, id, snoozedUntil) => wrap((s) => s.snooze(orgId, id, snoozedUntil)),
    complete: (orgId, id, outcome, note, completedAt) =>
      wrap((s) => s.complete(orgId, id, outcome, note, completedAt)),
    setCadence: (orgId, id, cadenceDays) => wrap((s) => s.setCadence(orgId, id, cadenceDays)),
  };
}
