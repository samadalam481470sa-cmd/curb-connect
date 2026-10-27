// Persistent drafts (PLT-011 B "persistent draft state", PLT-014 S "resume from the last confirmed
// step"). Drafts live on this device only, keyed by user and workspace so one company's draft is
// never shown inside another (PLT-004 S). They hold what the person typed, never server data, and
// the access-recovery page never renders them (PLT-011 S).
import { browserStore, type KeyValueStore } from './store';

export interface Draft<T> {
  key: string;
  userId: string;
  /** null for drafts made before a workspace exists (e.g. company setup). */
  orgId: string | null;
  value: T;
  updatedAt: string;
  /** Bumped by the caller when the draft's shape changes; older drafts are discarded. */
  schemaVersion: number;
}

export interface DraftScope {
  userId: string;
  orgId: string | null;
}

function storageKey(scope: DraftScope, key: string): string {
  return `${scope.userId}::${scope.orgId ?? '-'}::${key}`;
}

export class DraftStore {
  private readonly store: KeyValueStore<Draft<unknown>>;
  private readonly now: () => Date;

  constructor(store?: KeyValueStore<Draft<unknown>>, now: () => Date = () => new Date()) {
    this.store = store ?? browserStore<Draft<unknown>>('drafts');
    this.now = now;
  }

  async load<T>(scope: DraftScope, key: string, schemaVersion: number): Promise<Draft<T> | null> {
    const draft = await this.store.get(storageKey(scope, key));
    if (!draft) return null;
    if (draft.schemaVersion !== schemaVersion) {
      await this.store.delete(storageKey(scope, key));
      return null;
    }
    return draft as Draft<T>;
  }

  async save<T>(
    scope: DraftScope,
    key: string,
    value: T,
    schemaVersion: number,
  ): Promise<Draft<T>> {
    const draft: Draft<T> = {
      key,
      userId: scope.userId,
      orgId: scope.orgId,
      value,
      updatedAt: this.now().toISOString(),
      schemaVersion,
    };
    await this.store.set(storageKey(scope, key), draft);
    return draft;
  }

  async remove(scope: DraftScope, key: string): Promise<void> {
    await this.store.delete(storageKey(scope, key));
  }

  /** Removes every draft of a user (explicit sign-out on a shared device). */
  async clearUser(userId: string): Promise<void> {
    for (const [k] of await this.store.entries()) {
      if (k.startsWith(`${userId}::`)) await this.store.delete(k);
    }
  }
}

let shared: DraftStore | null = null;

export function getDraftStore(): DraftStore {
  shared ??= new DraftStore();
  return shared;
}
