// Minimal key-value storage used by the offline draft store and the upload/write outbox.
// Production uses IndexedDB through idb-keyval (Blobs are stored natively, so queued photos survive
// a reload). Tests and environments without IndexedDB use the in-memory store.
import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';

export interface KeyValueStore<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  entries(): Promise<Array<[string, V]>>;
}

export function memoryStore<V>(): KeyValueStore<V> {
  const map = new Map<string, V>();
  return {
    get: async (key) => (map.has(key) ? structuredClone(map.get(key)) : undefined),
    set: async (key, value) => {
      map.set(key, structuredClone(value));
    },
    delete: async (key) => {
      map.delete(key);
    },
    entries: async () => [...map.entries()].map(([k, v]) => [k, structuredClone(v)]),
  };
}

export const OFFLINE_DB_NAME = 'fieldline-offline';

export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/** One IndexedDB database per store name (idb-keyval keeps one object store per database). */
export function idbStore<V>(storeName: string): KeyValueStore<V> {
  const store: UseStore = createStore(`${OFFLINE_DB_NAME}-${storeName}`, storeName);
  return {
    get: (key) => get<V>(key, store),
    set: (key, value) => set(key, value, store),
    delete: (key) => del(key, store),
    entries: async () => (await entries<string, V>(store)).map(([k, v]) => [String(k), v]),
  };
}

/** IndexedDB in the browser, memory elsewhere (SSR, tests, private modes without IDB). */
export function browserStore<V>(storeName: string): KeyValueStore<V> {
  return indexedDbAvailable() ? idbStore<V>(storeName) : memoryStore<V>();
}
