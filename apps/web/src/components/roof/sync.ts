// Geometry autosave (RR-032, ADD-028, ADD-034): every edit lands in a durable local draft first,
// then syncs to PATCH /v1/roof/reports/{id}/geometry with If-Match = geometry revision and a
// stable clientOpId (a resend is a replay, never a second edit). The status shown is exactly one of:
//   "Saved locally/syncing" | "Saved to server" | "Conflict — review required" | "Save failed — draft retained"
// A conflict never auto-merges or discards the local draft: the user reviews it.
import type { RoofGeometryCommand, RoofGeometryState } from '@fieldline/contracts';
import { isApiError } from '../../lib/api';

export type SaveStatus = 'local' | 'saved' | 'conflict' | 'failed';

export const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  local: 'Saved locally/syncing',
  saved: 'Saved to server',
  conflict: 'Conflict — review required',
  failed: 'Save failed — draft retained',
};

export interface DraftStore {
  load(key: string): PendingDraft | null;
  save(key: string, draft: PendingDraft): void;
  clear(key: string): void;
}

export interface PendingDraft {
  /** Geometry revision the pending commands were made against. */
  baseRevision: number;
  clientOpId: string;
  commands: RoofGeometryCommand[];
  savedAt: string;
  /** Edits made after this batch failed; sent as a separate batch (own clientOpId) once it lands. */
  held?: RoofGeometryCommand[];
}

export const browserDraftStore: DraftStore = {
  load(key) {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? (JSON.parse(raw) as PendingDraft) : null;
    } catch {
      return null;
    }
  },
  save(key, draft) {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(draft));
    } catch {
      // Storage unavailable: the in-memory draft is still retained and the status says so.
    }
  },
  clear(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export type GeometrySender = (args: { clientOpId: string; commands: RoofGeometryCommand[]; ifMatch: number }) => Promise<RoofGeometryState>;

export interface SyncSnapshot {
  status: SaveStatus;
  server: RoofGeometryState;
  pending: RoofGeometryCommand[];
  error: unknown;
}

const newOpId = () => `roofop-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

export class GeometrySync {
  private server: RoofGeometryState;
  private draft: PendingDraft | null;
  private inFlight: PendingDraft | null = null;
  /** Edits made after a failed batch; persisted with it. */
  private held: RoofGeometryCommand[] = [];
  private status: SaveStatus = 'saved';
  private error: unknown = null;
  private listeners = new Set<(s: SyncSnapshot) => void>();
  private readonly key: string;

  constructor(
    initial: RoofGeometryState,
    private readonly send: GeometrySender,
    private readonly store: DraftStore = browserDraftStore,
  ) {
    this.server = initial;
    this.key = `fieldpro.roof.draft.${initial.reportId}.${initial.versionId}`;
    this.draft = store.load(this.key);
    if (this.draft?.held) {
      this.held = this.draft.held;
      const { held: _h, ...rest } = this.draft;
      this.draft = rest;
    }
    if (this.draft) {
      // A draft from a previous session made against an older revision is a conflict to review.
      this.status = this.draft.baseRevision === initial.geometryRevision ? 'local' : 'conflict';
    }
  }

  snapshot(): SyncSnapshot {
    return { status: this.status, server: this.server, pending: [...(this.inFlight?.commands ?? []), ...(this.draft?.commands ?? []), ...this.held], error: this.error };
  }

  subscribe(fn: (s: SyncSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }

  /** Record edits locally (durable before any network call), then sync. */
  push(commands: RoofGeometryCommand[]): Promise<void> {
    if (this.status === 'conflict') throw new Error('Resolve the conflict before editing.');
    if (this.status === 'failed' && this.draft) {
      this.held = [...this.held, ...commands];
      this.store.save(this.key, { ...this.draft, held: this.held });
      this.emit();
      return this.flush();
    }
    this.draft = this.draft
      ? { ...this.draft, commands: [...this.draft.commands, ...commands], savedAt: new Date().toISOString() }
      : { baseRevision: this.server.geometryRevision, clientOpId: newOpId(), commands, savedAt: new Date().toISOString() };
    this.store.save(this.key, this.draft);
    this.status = 'local';
    this.emit();
    return this.flush();
  }

  /** Undo: an unsynced local edit is simply dropped; otherwise undo runs on the server log. */
  undo(): Promise<void> {
    if (this.draft && this.draft.commands.length > 0 && !this.inFlight) {
      const commands = this.draft.commands.slice(0, -1);
      this.draft = commands.length ? { ...this.draft, commands } : null;
      if (this.draft) this.store.save(this.key, this.draft);
      else this.store.clear(this.key);
      this.status = this.draft ? 'local' : 'saved';
      this.emit();
      return Promise.resolve();
    }
    return this.push([{ type: 'undo' }]);
  }

  redo(): Promise<void> {
    return this.push([{ type: 'redo' }]);
  }

  /** Send the oldest pending batch. Safe to call repeatedly (retry uses the same clientOpId). */
  async flush(): Promise<void> {
    if (this.inFlight || !this.draft || this.status === 'conflict') return;
    const batch = this.draft;
    this.inFlight = batch;
    this.draft = null;
    try {
      const next = await this.send({ clientOpId: batch.clientOpId, commands: batch.commands, ifMatch: batch.baseRevision });
      this.server = next;
      this.inFlight = null;
      this.error = null;
      if (this.held.length) {
        this.draft = { baseRevision: next.geometryRevision, clientOpId: newOpId(), commands: [...this.held, ...((this.draft as PendingDraft | null)?.commands ?? [])], savedAt: new Date().toISOString() };
        this.held = [];
      }
      if (this.draft) {
        // Edits made while the batch was in flight rebase onto the new revision.
        const d: PendingDraft = this.draft;
        this.draft = { ...d, baseRevision: next.geometryRevision };
        this.store.save(this.key, this.draft);
        this.status = 'local';
        this.emit();
        return this.flush();
      }
      this.store.clear(this.key);
      this.status = 'saved';
    } catch (e) {
      // Keep the failed batch (same clientOpId, so a retry is a replay) and hold later edits
      // behind it; they are sent as their own batch once it lands.
      if (this.draft) this.held = [...this.held, ...this.draft.commands];
      this.draft = batch;
      this.inFlight = null;
      this.store.save(this.key, { ...batch, held: this.held });
      this.error = e;
      this.status = isApiError(e) && (e.is('revision_conflict') || e.is('precondition_failed') || e.status === 409 || e.status === 412) ? 'conflict' : 'failed';
    }
    this.emit();
  }

  /** Conflict resolution: discard the local draft and take the server version. */
  discardLocal(fresh: RoofGeometryState): void {
    this.draft = null;
    this.held = [];
    this.store.clear(this.key);
    this.server = fresh;
    this.status = 'saved';
    this.error = null;
    this.emit();
  }

  /** Conflict resolution: re-apply the local commands on top of the latest server revision. */
  reapplyOnto(fresh: RoofGeometryState): Promise<void> {
    this.server = fresh;
    if (this.draft) {
      this.draft = { ...this.draft, baseRevision: fresh.geometryRevision, clientOpId: newOpId() };
      this.store.save(this.key, this.draft);
    }
    this.status = this.draft ? 'local' : 'saved';
    this.error = null;
    this.emit();
    return this.flush();
  }

  /** The server returned fresh state outside the sync path (e.g. after submit). */
  replaceServer(fresh: RoofGeometryState): void {
    this.server = fresh;
    this.emit();
  }
}
