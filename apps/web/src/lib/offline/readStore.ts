// Offline read cache + delta sync. Server list endpoints accept ?updatedSince=<ISO>
// and answer with changed rows, deletedIds, and serverTime (the next watermark). This
// store keeps one merged copy per (org, entity) in IndexedDB so field screens render
// with no signal; the next sync only pulls what changed.
//
// Conflict rules (decided per entity, same for all four synced lists):
//   * Reads are server-wins: a synced row replaces the cached row with the same id.
//   * Writes never go through this cache — they use the outbox (idempotency keys), so
//     a replayed write cannot double-apply.
//   * Data is scoped by org id in the key: switching workspace can never surface
//     another company's rows. The service worker stays shell-only (no tenant data in
//     Cache Storage); this IndexedDB store is the only offline read cache.
import { z } from 'zod';
import type { ApiClient } from '../api';
import { browserStore, type KeyValueStore } from './store';

export interface ReadScope {
  orgId: string;
}

export type SyncedEntity = 'jobs' | 'assignments' | 'orders' | 'scheduleTasks';

interface EntityCache<T> {
  items: Record<string, T>;
  watermark: string | null;
}

const DeltaResponse = z.object({
  items: z.array(z.object({ id: z.string() }).passthrough()),
  deletedIds: z.array(z.string()).optional(),
  serverTime: z.string().optional(),
});

function cacheKey(scope: ReadScope, entity: SyncedEntity, qualifier?: string): string {
  return qualifier ? `${scope.orgId}:${entity}:${qualifier}` : `${scope.orgId}:${entity}`;
}

export class ReadStore {
  private readonly store: KeyValueStore<EntityCache<Record<string, unknown>>>;

  constructor(store?: KeyValueStore<EntityCache<Record<string, unknown>>>) {
    this.store = store ?? browserStore<EntityCache<Record<string, unknown>>>('read-cache');
  }

  /** Cached rows for offline rendering (empty until the first successful sync). */
  async read<T extends { id: string }>(
    scope: ReadScope,
    entity: SyncedEntity,
    qualifier?: string,
  ): Promise<T[]> {
    const cache = await this.store.get(cacheKey(scope, entity, qualifier));
    if (!cache) return [];
    return Object.values(cache.items) as T[];
  }

  /** The delta watermark from the last successful sync, if any. */
  async watermark(
    scope: ReadScope,
    entity: SyncedEntity,
    qualifier?: string,
  ): Promise<string | null> {
    const cache = await this.store.get(cacheKey(scope, entity, qualifier));
    return cache?.watermark ?? null;
  }

  /**
   * Pull changes since the watermark, merge server-wins, drop deleted ids, and store
   * the new watermark. Returns the full merged list. Throws on network failure —
   * callers fall back to `read()` for offline rendering.
   */
  async sync<T extends { id: string }>(
    api: ApiClient,
    scope: ReadScope,
    entity: SyncedEntity,
    path: string,
    qualifier?: string,
  ): Promise<T[]> {
    const key = cacheKey(scope, entity, qualifier);
    const cache = (await this.store.get(key)) ?? { items: {}, watermark: null };
    const separator = path.includes('?') ? '&' : '?';
    const url = cache.watermark
      ? `${path}${separator}updatedSince=${encodeURIComponent(cache.watermark)}`
      : path;
    const response = await api.get(url, { schema: DeltaResponse });
    const items: Record<string, Record<string, unknown>> = { ...cache.items };
    for (const item of response.items) items[item.id] = item as Record<string, unknown>;
    for (const id of response.deletedIds ?? []) delete items[id];
    const next: EntityCache<Record<string, unknown>> = {
      items,
      watermark: response.serverTime ?? cache.watermark,
    };
    await this.store.set(key, next);
    return Object.values(items) as T[];
  }

  /** Drop one org's cached reads (workspace switch / sign-out hygiene). */
  async clearOrg(orgId: string): Promise<void> {
    for (const [key] of await this.store.entries()) {
      if (key.startsWith(`${orgId}:`)) await this.store.delete(key);
    }
  }
}

let shared: ReadStore | null = null;
export function getReadStore(): ReadStore {
  shared ??= new ReadStore();
  return shared;
}
