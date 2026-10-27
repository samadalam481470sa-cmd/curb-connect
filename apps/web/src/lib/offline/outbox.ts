// PLT-018 S: a flaky network must not create duplicate photos, jobs, charges or measurements on
// retry. Writes made while offline (or that failed with a retryable error) are queued here with an
// Idempotency-Key that is generated ONCE at enqueue time and reused on every attempt, so the API's
// idempotency store replays the original response instead of applying the write twice (BE-076).
//
// Entries are scoped to the user and organization that created them: a queued write is never sent
// while a different workspace is active, so records from two companies are never merged (PLT-004 S).
import { isApiError, newIdempotencyKey, type ApiClient, type HttpMethod } from '../api';
import { browserStore, type KeyValueStore } from './store';

export type OutboxStatus = 'pending' | 'sending' | 'failed';

export interface OutboxScope {
  userId: string;
  orgId: string;
}

export interface OutboxEntry {
  id: string;
  /** Who queued it and in which workspace; never sent under another scope. */
  scope: OutboxScope;
  /** Short machine name for the UI, e.g. "curb_photo_upload". */
  kind: string;
  /** Human-readable description shown in the outbox list (no tenant secrets). */
  label: string;
  method: HttpMethod;
  path: string;
  /** JSON body, or a Blob for uploads (IndexedDB stores Blobs natively). */
  body?: unknown;
  ifMatch?: number;
  /** Generated once; every retry sends the same key. */
  idempotencyKey: string;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  /** Earliest time the next attempt may run (exponential backoff). */
  nextAttemptAt: string;
  lastError?: { code: string; message: string; correlationId?: string };
}

export type OutboxSender = (entry: OutboxEntry) => Promise<void>;

export interface FlushResult {
  sent: string[];
  retried: string[];
  failed: string[];
  skipped: number;
}

export interface OutboxOptions {
  store?: KeyValueStore<OutboxEntry>;
  now?: () => Date;
  /** Base delay for exponential backoff; attempt n waits base * 2^(n-1), capped. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** After this many retryable failures the entry is parked as failed for the user to review. */
  maxAttempts?: number;
}

export type EnqueueInput = Pick<
  OutboxEntry,
  'kind' | 'label' | 'method' | 'path' | 'body' | 'ifMatch'
> & {
  scope: OutboxScope;
  /** Pass an existing key when the write was already attempted online once. */
  idempotencyKey?: string;
};

type Listener = () => void;

export class Outbox {
  private readonly store: KeyValueStore<OutboxEntry>;
  private readonly now: () => Date;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly maxAttempts: number;
  private flushing: Promise<FlushResult> | null = null;
  private readonly listeners = new Set<Listener>();
  private changeCount = 0;

  /** Changes on every mutation; a cheap snapshot for useSyncExternalStore. */
  get version(): number {
    return this.changeCount;
  }

  constructor(options: OutboxOptions = {}) {
    this.store = options.store ?? browserStore<OutboxEntry>('outbox');
    this.now = options.now ?? (() => new Date());
    this.backoffBaseMs = options.backoffBaseMs ?? 2_000;
    this.backoffMaxMs = options.backoffMaxMs ?? 5 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 8;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.changeCount += 1;
    for (const listener of this.listeners) listener();
  }

  async enqueue(input: EnqueueInput): Promise<OutboxEntry> {
    const at = this.now().toISOString();
    const entry: OutboxEntry = {
      id: crypto.randomUUID(),
      scope: input.scope,
      kind: input.kind,
      label: input.label,
      method: input.method,
      path: input.path,
      body: input.body,
      ifMatch: input.ifMatch,
      idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
      status: 'pending',
      attempts: 0,
      createdAt: at,
      updatedAt: at,
      nextAttemptAt: at,
    };
    await this.store.set(entry.id, entry);
    this.notify();
    return entry;
  }

  /** Entries for one scope, oldest first (writes are replayed in the order they were made). */
  async list(scope?: OutboxScope): Promise<OutboxEntry[]> {
    const all = (await this.store.entries()).map(([, entry]) => entry);
    return all
      .filter((e) => !scope || (e.scope.userId === scope.userId && e.scope.orgId === scope.orgId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(id);
    this.notify();
  }

  /** User asked to try a failed entry again: same key, fresh attempt budget. */
  async requeue(id: string): Promise<void> {
    const entry = await this.store.get(id);
    if (!entry) return;
    const at = this.now().toISOString();
    await this.store.set(id, {
      ...entry,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: at,
      updatedAt: at,
    });
    this.notify();
  }

  backoffMs(attempts: number): number {
    return Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** Math.max(0, attempts - 1));
  }

  /**
   * Sends due entries for `scope` in order. Concurrent calls share one run, so a reconnect event
   * and a manual "retry now" cannot send the same entry twice in parallel.
   */
  flush(scope: OutboxScope, send: OutboxSender): Promise<FlushResult> {
    if (!this.flushing) {
      this.flushing = this.runFlush(scope, send).finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async runFlush(scope: OutboxScope, send: OutboxSender): Promise<FlushResult> {
    const result: FlushResult = { sent: [], retried: [], failed: [], skipped: 0 };
    const entries = await this.list(scope);
    const nowMs = this.now().getTime();
    for (const entry of entries) {
      if (entry.status === 'failed' || Date.parse(entry.nextAttemptAt) > nowMs) {
        result.skipped += 1;
        continue;
      }
      await this.store.set(entry.id, { ...entry, status: 'sending' });
      try {
        await send(entry);
        await this.store.delete(entry.id);
        result.sent.push(entry.id);
      } catch (error) {
        const attempts = entry.attempts + 1;
        const retryable = isApiError(error) ? error.retryable : true;
        const at = this.now();
        const lastError = isApiError(error)
          ? { code: error.code, message: error.message, correlationId: error.correlationId }
          : { code: 'unknown', message: error instanceof Error ? error.message : String(error) };
        const parked = !retryable || attempts >= this.maxAttempts;
        const retryAfterMs =
          isApiError(error) && error.problem.retryAfterSeconds !== undefined
            ? error.problem.retryAfterSeconds * 1000
            : this.backoffMs(attempts);
        await this.store.set(entry.id, {
          ...entry,
          status: parked ? 'failed' : 'pending',
          attempts,
          updatedAt: at.toISOString(),
          nextAttemptAt: new Date(at.getTime() + retryAfterMs).toISOString(),
          lastError,
        });
        (parked ? result.failed : result.retried).push(entry.id);
        // Later writes may depend on this one (e.g. a measurement on a just-created project), so
        // stop on a network failure instead of hammering a dead connection.
        if (isApiError(error) && error.kind === 'network') break;
      }
    }
    this.notify();
    return result;
  }
}

/** Default sender: replays the entry through the API client with its original Idempotency-Key. */
export function apiSender(api: ApiClient): OutboxSender {
  return async (entry) => {
    await api.request(entry.path, {
      method: entry.method,
      body: entry.body,
      idempotencyKey: entry.idempotencyKey,
      ifMatch: entry.ifMatch,
    });
  };
}

let shared: Outbox | null = null;

/** The app-wide outbox (IndexedDB-backed in the browser). */
export function getOutbox(): Outbox {
  shared ??= new Outbox();
  return shared;
}
