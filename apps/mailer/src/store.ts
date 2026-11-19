// Mailbox storage. Three interchangeable backends:
//   MemoryStore   - tests;
//   FileStore     - one machine, no database (JSON file; refresh tokens inside are AES-GCM sealed);
//   PostgresStore - production, tables in the "mailer" schema, created on start.
// Rows are keyed by (orgId, userId, provider): one Gmail and one Outlook per member per company.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MailboxProvider } from '@fieldline/contracts';
import postgres from 'postgres';

export interface MailboxRecord {
  orgId: string;
  userId: string;
  provider: MailboxProvider;
  email: string;
  displayName: string | null;
  /** Refresh token sealed with crypto.seal (never stored in clear). */
  sealedRefreshToken: string;
  scopes: string[];
  connectedAt: string;
  updatedAt: string;
}

export type SendStatus = 'sending' | 'sent' | 'failed';

export interface SendRecord {
  key: string;
  orgId: string;
  userId: string;
  status: SendStatus;
  provider: MailboxProvider | null;
  from: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  updatedAt: string;
}

export interface MailerStore {
  listMailboxes(orgId: string, userId: string): Promise<MailboxRecord[]>;
  getMailbox(
    orgId: string,
    userId: string,
    provider: MailboxProvider,
  ): Promise<MailboxRecord | null>;
  upsertMailbox(record: MailboxRecord): Promise<void>;
  deleteMailbox(orgId: string, userId: string, provider: MailboxProvider): Promise<void>;
  getDefault(orgId: string, userId: string): Promise<MailboxProvider | null>;
  setDefault(orgId: string, userId: string, provider: MailboxProvider | null): Promise<void>;
  /**
   * Claims an idempotency key. Returns null when the key is new (now marked `sending`), or the
   * existing record when the key was used before (the caller must not send again).
   */
  claimSend(record: Omit<SendRecord, 'updatedAt'>): Promise<SendRecord | null>;
  finishSend(key: string, patch: Partial<Omit<SendRecord, 'key'>>): Promise<void>;
  /** Releases a claim whose send provably never reached the provider, so it can be retried. */
  releaseSend(key: string): Promise<void>;
  /**
   * A finished Google / Microsoft sign-in waiting for the Field Pro member to confirm it from their
   * own signed-in session. `value` is sealed by the caller; it expires after a few minutes.
   */
  putPending(id: string, value: string, expiresAt: Date): Promise<void>;
  /** Returns the value once and deletes it (null when unknown or expired). */
  takePending(id: string): Promise<string | null>;
  close(): Promise<void>;
}

const now = () => new Date().toISOString();
const mailboxKey = (orgId: string, userId: string, provider: string) =>
  `${orgId}:${userId}:${provider}`;
const ownerKey = (orgId: string, userId: string) => `${orgId}:${userId}`;

interface Snapshot {
  version: 1;
  mailboxes: Record<string, MailboxRecord>;
  defaults: Record<string, MailboxProvider>;
  sends: Record<string, SendRecord>;
  pending: Record<string, { value: string; expiresAt: string }>;
}

const emptySnapshot = (): Snapshot => ({
  version: 1,
  mailboxes: {},
  defaults: {},
  sends: {},
  pending: {},
});

/** Sends older than this are forgotten; a worker never retries a key that late. */
const SEND_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class MemoryStore implements MailerStore {
  protected data: Snapshot = emptySnapshot();

  /** Hook for FileStore: persist after every change. */
  protected async changed(): Promise<void> {}

  async listMailboxes(orgId: string, userId: string) {
    return Object.values(this.data.mailboxes)
      .filter((m) => m.orgId === orgId && m.userId === userId)
      .sort((a, b) => a.provider.localeCompare(b.provider));
  }
  async getMailbox(orgId: string, userId: string, provider: MailboxProvider) {
    return this.data.mailboxes[mailboxKey(orgId, userId, provider)] ?? null;
  }
  async upsertMailbox(record: MailboxRecord) {
    this.data.mailboxes[mailboxKey(record.orgId, record.userId, record.provider)] = { ...record };
    await this.changed();
  }
  async deleteMailbox(orgId: string, userId: string, provider: MailboxProvider) {
    delete this.data.mailboxes[mailboxKey(orgId, userId, provider)];
    await this.changed();
  }
  async getDefault(orgId: string, userId: string) {
    return this.data.defaults[ownerKey(orgId, userId)] ?? null;
  }
  async setDefault(orgId: string, userId: string, provider: MailboxProvider | null) {
    if (provider) this.data.defaults[ownerKey(orgId, userId)] = provider;
    else delete this.data.defaults[ownerKey(orgId, userId)];
    await this.changed();
  }
  async claimSend(record: Omit<SendRecord, 'updatedAt'>) {
    const existing = this.data.sends[record.key];
    if (existing) return { ...existing };
    const cutoff = Date.now() - SEND_RETENTION_MS;
    for (const [key, value] of Object.entries(this.data.sends)) {
      if (Date.parse(value.updatedAt) < cutoff) delete this.data.sends[key];
    }
    this.data.sends[record.key] = { ...record, updatedAt: now() };
    await this.changed();
    return null;
  }
  async finishSend(key: string, patch: Partial<Omit<SendRecord, 'key'>>) {
    const existing = this.data.sends[key];
    if (!existing) return;
    this.data.sends[key] = { ...existing, ...patch, key, updatedAt: now() };
    await this.changed();
  }
  async releaseSend(key: string) {
    delete this.data.sends[key];
    await this.changed();
  }
  async putPending(id: string, value: string, expiresAt: Date) {
    const nowMs = Date.now();
    for (const [key, item] of Object.entries(this.data.pending)) {
      if (Date.parse(item.expiresAt) < nowMs) delete this.data.pending[key];
    }
    this.data.pending[id] = { value, expiresAt: expiresAt.toISOString() };
    await this.changed();
  }
  async takePending(id: string) {
    const item = this.data.pending[id];
    if (!item) return null;
    delete this.data.pending[id];
    await this.changed();
    return Date.parse(item.expiresAt) < Date.now() ? null : item.value;
  }
  async close() {}
}

/**
 * JSON file on disk, written atomically (temp file + rename) and serialized through one queue so
 * concurrent requests cannot interleave writes. For a single server only.
 */
export class FileStore extends MemoryStore {
  private queue: Promise<void> = Promise.resolve();
  private constructor(private readonly file: string) {
    super();
  }

  static async open(file: string): Promise<FileStore> {
    const store = new FileStore(file);
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<Snapshot>;
      if (parsed.version === 1) {
        store.data = {
          version: 1,
          mailboxes: parsed.mailboxes ?? {},
          defaults: parsed.defaults ?? {},
          sends: parsed.sends ?? {},
          pending: parsed.pending ?? {},
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `Could not read the mailbox store at ${file}: ${(error as Error).message}`,
          {
            cause: error,
          },
        );
      }
    }
    return store;
  }

  protected override changed(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile(temp, snapshot, { mode: 0o600 });
      await rename(temp, this.file);
    });
    return this.queue;
  }

  override async close() {
    await this.queue;
  }
}

type Sql = ReturnType<typeof postgres>;

interface MailboxRow {
  org_id: string;
  user_id: string;
  provider: MailboxProvider;
  email: string;
  display_name: string | null;
  sealed_refresh_token: string;
  scopes: string[];
  connected_at: Date;
  updated_at: Date;
}

interface SendRow {
  key: string;
  org_id: string;
  user_id: string;
  status: SendStatus;
  provider: MailboxProvider | null;
  from_address: string | null;
  provider_message_id: string | null;
  error_code: string | null;
  updated_at: Date;
}

const fromMailboxRow = (r: MailboxRow): MailboxRecord => ({
  orgId: r.org_id,
  userId: r.user_id,
  provider: r.provider,
  email: r.email,
  displayName: r.display_name,
  sealedRefreshToken: r.sealed_refresh_token,
  scopes: r.scopes,
  connectedAt: r.connected_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const fromSendRow = (r: SendRow): SendRecord => ({
  key: r.key,
  orgId: r.org_id,
  userId: r.user_id,
  status: r.status,
  provider: r.provider,
  from: r.from_address,
  providerMessageId: r.provider_message_id,
  errorCode: r.error_code,
  updatedAt: r.updated_at.toISOString(),
});

export class PostgresStore implements MailerStore {
  private constructor(private readonly sql: Sql) {}

  static async open(url: string): Promise<PostgresStore> {
    const sql = postgres(url, { max: 5, onnotice: () => undefined });
    await sql.begin(async (tx) => {
      await tx`create schema if not exists mailer`;
      await tx`create table if not exists mailer.mailboxes (
        org_id uuid not null,
        user_id uuid not null,
        provider text not null check (provider in ('gmail', 'outlook')),
        email text not null,
        display_name text,
        sealed_refresh_token text not null,
        scopes text[] not null default '{}',
        connected_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (org_id, user_id, provider)
      )`;
      await tx`create table if not exists mailer.preferences (
        org_id uuid not null,
        user_id uuid not null,
        default_provider text check (default_provider in ('gmail', 'outlook')),
        primary key (org_id, user_id)
      )`;
      await tx`create table if not exists mailer.sends (
        key text primary key,
        org_id uuid not null,
        user_id uuid not null,
        status text not null check (status in ('sending', 'sent', 'failed')),
        provider text,
        from_address text,
        provider_message_id text,
        error_code text,
        updated_at timestamptz not null default now()
      )`;
      await tx`create table if not exists mailer.pending_connections (
        id text primary key,
        value text not null,
        expires_at timestamptz not null
      )`;
    });
    return new PostgresStore(sql);
  }

  async listMailboxes(orgId: string, userId: string) {
    const rows = await this.sql<MailboxRow[]>`
      select * from mailer.mailboxes where org_id = ${orgId} and user_id = ${userId}
      order by provider`;
    return rows.map(fromMailboxRow);
  }
  async getMailbox(orgId: string, userId: string, provider: MailboxProvider) {
    const [row] = await this.sql<MailboxRow[]>`
      select * from mailer.mailboxes
      where org_id = ${orgId} and user_id = ${userId} and provider = ${provider}`;
    return row ? fromMailboxRow(row) : null;
  }
  async upsertMailbox(r: MailboxRecord) {
    await this.sql`
      insert into mailer.mailboxes
        (org_id, user_id, provider, email, display_name, sealed_refresh_token, scopes, connected_at, updated_at)
      values (${r.orgId}, ${r.userId}, ${r.provider}, ${r.email}, ${r.displayName},
              ${r.sealedRefreshToken}, ${r.scopes}, ${r.connectedAt}, ${r.updatedAt})
      on conflict (org_id, user_id, provider) do update set
        email = excluded.email, display_name = excluded.display_name,
        sealed_refresh_token = excluded.sealed_refresh_token, scopes = excluded.scopes,
        connected_at = excluded.connected_at, updated_at = excluded.updated_at`;
  }
  async deleteMailbox(orgId: string, userId: string, provider: MailboxProvider) {
    await this.sql`
      delete from mailer.mailboxes
      where org_id = ${orgId} and user_id = ${userId} and provider = ${provider}`;
  }
  async getDefault(orgId: string, userId: string) {
    const [row] = await this.sql<{ default_provider: MailboxProvider | null }[]>`
      select default_provider from mailer.preferences where org_id = ${orgId} and user_id = ${userId}`;
    return row?.default_provider ?? null;
  }
  async setDefault(orgId: string, userId: string, provider: MailboxProvider | null) {
    await this.sql`
      insert into mailer.preferences (org_id, user_id, default_provider)
      values (${orgId}, ${userId}, ${provider})
      on conflict (org_id, user_id) do update set default_provider = excluded.default_provider`;
  }
  async claimSend(r: Omit<SendRecord, 'updatedAt'>) {
    const inserted = await this.sql<SendRow[]>`
      insert into mailer.sends (key, org_id, user_id, status, provider, from_address, provider_message_id, error_code)
      values (${r.key}, ${r.orgId}, ${r.userId}, ${r.status}, ${r.provider}, ${r.from},
              ${r.providerMessageId}, ${r.errorCode})
      on conflict (key) do nothing
      returning *`;
    if (inserted.length > 0) {
      await this.sql`delete from mailer.sends where updated_at < now() - interval '30 days'`;
      return null;
    }
    const [existing] = await this.sql<SendRow[]>`select * from mailer.sends where key = ${r.key}`;
    return existing ? fromSendRow(existing) : null;
  }
  async finishSend(key: string, p: Partial<Omit<SendRecord, 'key'>>) {
    const [row] = await this.sql<SendRow[]>`select * from mailer.sends where key = ${key}`;
    if (!row) return;
    const merged = { ...fromSendRow(row), ...p };
    await this.sql`
      update mailer.sends set status = ${merged.status}, provider = ${merged.provider},
        from_address = ${merged.from}, provider_message_id = ${merged.providerMessageId},
        error_code = ${merged.errorCode}, updated_at = now()
      where key = ${key}`;
  }
  async releaseSend(key: string) {
    await this.sql`delete from mailer.sends where key = ${key}`;
  }
  async putPending(id: string, value: string, expiresAt: Date) {
    await this.sql`delete from mailer.pending_connections where expires_at < now()`;
    await this.sql`
      insert into mailer.pending_connections (id, value, expires_at)
      values (${id}, ${value}, ${expiresAt})`;
  }
  async takePending(id: string) {
    const [row] = await this.sql<{ value: string }[]>`
      delete from mailer.pending_connections where id = ${id} and expires_at >= now()
      returning value`;
    return row?.value ?? null;
  }
  async close() {
    await this.sql.end({ timeout: 5 });
  }
}

export async function openStore(opts: {
  databaseUrl: string | undefined;
  dataFile: string;
}): Promise<MailerStore> {
  return opts.databaseUrl ? PostgresStore.open(opts.databaseUrl) : FileStore.open(opts.dataFile);
}
