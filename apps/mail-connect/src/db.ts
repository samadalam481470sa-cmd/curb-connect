// SQLite storage (node:sqlite, no native add-on). Holds accounts, sessions, sign-in links to
// Google/Microsoft, in-flight OAuth requests and each user's encrypted mail connection.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type Provider = 'google' | 'microsoft';
export type OAuthPurpose = 'signin' | 'connect';

export interface User {
  id: number;
  username: string;
  email: string;
  passwordHash: string | null;
  fullName: string;
  phone: string;
  company: string;
  createdAt: string;
  lastSignInAt: string | null;
}

export interface OAuthState {
  bindingHash: string;
  provider: Provider;
  purpose: OAuthPurpose;
  codeVerifier: string;
  nonce: string;
  userId: number | null;
  expiresAt: number;
}

export interface MailConnection {
  userId: number;
  provider: Provider;
  email: string;
  refreshTokenEnc: string | null;
  accessTokenEnc: string;
  accessExpiresAt: number;
  connectedAt: string;
}

export interface NewUser {
  username: string;
  email: string;
  passwordHash: string | null;
  fullName: string;
  phone: string;
  company: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_sign_in_at TEXT
);
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_connections (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  email TEXT NOT NULL,
  refresh_token_enc TEXT,
  access_token_enc TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  connected_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE IF NOT EXISTS sent_messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider_message_id TEXT,
  sent_at TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  return String(row[key] ?? '');
}
function strOrNull(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}
function num(row: Row, key: string): number {
  return Number(row[key]);
}

function toUser(row: Row): User {
  return {
    id: num(row, 'id'),
    username: str(row, 'username'),
    email: str(row, 'email'),
    passwordHash: strOrNull(row, 'password_hash'),
    fullName: str(row, 'full_name'),
    phone: str(row, 'phone'),
    company: str(row, 'company'),
    createdAt: str(row, 'created_at'),
    lastSignInAt: strOrNull(row, 'last_sign_in_at'),
  };
}

function toConnection(row: Row): MailConnection {
  return {
    userId: num(row, 'user_id'),
    provider: str(row, 'provider') as Provider,
    email: str(row, 'email'),
    refreshTokenEnc: strOrNull(row, 'refresh_token_enc'),
    accessTokenEnc: str(row, 'access_token_enc'),
    accessExpiresAt: num(row, 'access_expires_at'),
    connectedAt: str(row, 'connected_at'),
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  private get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  private run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }

  // Users

  createUser(input: NewUser): User {
    const now = new Date().toISOString();
    const result = this.run(
      `INSERT INTO users (username, email, password_hash, full_name, phone, company, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.username,
      input.email,
      input.passwordHash,
      input.fullName,
      input.phone,
      input.company,
      now,
      now,
    );
    return this.userById(Number(result.lastInsertRowid))!;
  }

  userById(id: number): User | null {
    const row = this.get('SELECT * FROM users WHERE id = ?', id);
    return row ? toUser(row) : null;
  }

  userByUsernameOrEmail(login: string): User | null {
    const row = this.get(
      'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1',
      login,
      login,
    );
    return row ? toUser(row) : null;
  }

  userByEmail(email: string): User | null {
    const row = this.get('SELECT * FROM users WHERE email = ?', email);
    return row ? toUser(row) : null;
  }

  usernameTaken(username: string): boolean {
    return this.get('SELECT 1 AS x FROM users WHERE username = ?', username) !== undefined;
  }

  emailTaken(email: string, exceptUserId = 0): boolean {
    return (
      this.get('SELECT 1 AS x FROM users WHERE email = ? AND id <> ?', email, exceptUserId) !==
      undefined
    );
  }

  updateProfile(
    id: number,
    profile: { fullName: string; email: string; phone: string; company: string },
  ) {
    this.run(
      'UPDATE users SET full_name = ?, email = ?, phone = ?, company = ?, updated_at = ? WHERE id = ?',
      profile.fullName,
      profile.email,
      profile.phone,
      profile.company,
      new Date().toISOString(),
      id,
    );
  }

  setPasswordHash(id: number, hash: string) {
    this.run(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
      hash,
      new Date().toISOString(),
      id,
    );
  }

  markSignedIn(id: number) {
    this.run('UPDATE users SET last_sign_in_at = ? WHERE id = ?', new Date().toISOString(), id);
  }

  // Google / Microsoft sign-in links

  identity(provider: Provider, subject: string): number | null {
    const row = this.get(
      'SELECT user_id FROM identities WHERE provider = ? AND subject = ?',
      provider,
      subject,
    );
    return row ? num(row, 'user_id') : null;
  }

  linkIdentity(provider: Provider, subject: string, userId: number, email: string) {
    this.run(
      `INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (provider, subject) DO NOTHING`,
      provider,
      subject,
      userId,
      email,
      new Date().toISOString(),
    );
  }

  identitiesFor(userId: number): { provider: Provider; email: string }[] {
    return (
      this.db
        .prepare('SELECT provider, email FROM identities WHERE user_id = ? ORDER BY provider')
        .all(userId) as Row[]
    ).map((row) => ({ provider: str(row, 'provider') as Provider, email: str(row, 'email') }));
  }

  // Sessions (only a SHA-256 of the cookie value is stored)

  createSession(idHash: string, userId: number, expiresAt: number) {
    this.run(
      'INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      idHash,
      userId,
      Date.now(),
      expiresAt,
    );
  }

  sessionUser(idHash: string, now = Date.now()): User | null {
    const row = this.get(
      `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id_hash = ? AND sessions.expires_at > ?`,
      idHash,
      now,
    );
    return row ? toUser(row) : null;
  }

  deleteSession(idHash: string) {
    this.run('DELETE FROM sessions WHERE id_hash = ?', idHash);
  }

  deleteOtherSessions(userId: number, keepIdHash: string) {
    this.run('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?', userId, keepIdHash);
  }

  purgeExpired(now = Date.now()) {
    this.run('DELETE FROM sessions WHERE expires_at <= ?', now);
    this.run('DELETE FROM oauth_states WHERE expires_at <= ?', now);
  }

  // OAuth requests in flight

  saveOAuthState(stateHash: string, state: OAuthState) {
    this.run(
      `INSERT INTO oauth_states (state_hash, binding_hash, provider, purpose, code_verifier, nonce, user_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      stateHash,
      state.bindingHash,
      state.provider,
      state.purpose,
      state.codeVerifier,
      state.nonce,
      state.userId,
      state.expiresAt,
    );
  }

  /** Returns and deletes the state, so each one can be used once. */
  takeOAuthState(stateHash: string): OAuthState | null {
    const row = this.get('SELECT * FROM oauth_states WHERE state_hash = ?', stateHash);
    if (!row) return null;
    this.run('DELETE FROM oauth_states WHERE state_hash = ?', stateHash);
    return {
      bindingHash: str(row, 'binding_hash'),
      provider: str(row, 'provider') as Provider,
      purpose: str(row, 'purpose') as OAuthPurpose,
      codeVerifier: str(row, 'code_verifier'),
      nonce: str(row, 'nonce'),
      userId: row.user_id === null ? null : num(row, 'user_id'),
      expiresAt: num(row, 'expires_at'),
    };
  }

  // Mail connections (tokens arrive here already encrypted)

  saveConnection(c: Omit<MailConnection, 'connectedAt'>) {
    this.run(
      `INSERT INTO mail_connections (user_id, provider, email, refresh_token_enc, access_token_enc, access_expires_at, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         email = excluded.email,
         refresh_token_enc = COALESCE(excluded.refresh_token_enc, mail_connections.refresh_token_enc),
         access_token_enc = excluded.access_token_enc,
         access_expires_at = excluded.access_expires_at,
         connected_at = excluded.connected_at`,
      c.userId,
      c.provider,
      c.email,
      c.refreshTokenEnc,
      c.accessTokenEnc,
      c.accessExpiresAt,
      new Date().toISOString(),
    );
  }

  updateAccessToken(
    userId: number,
    provider: Provider,
    accessTokenEnc: string,
    expiresAt: number,
    refreshTokenEnc: string | null,
  ) {
    this.run(
      `UPDATE mail_connections SET access_token_enc = ?, access_expires_at = ?,
         refresh_token_enc = COALESCE(?, refresh_token_enc)
       WHERE user_id = ? AND provider = ?`,
      accessTokenEnc,
      expiresAt,
      refreshTokenEnc,
      userId,
      provider,
    );
  }

  connection(userId: number, provider: Provider): MailConnection | null {
    const row = this.get(
      'SELECT * FROM mail_connections WHERE user_id = ? AND provider = ?',
      userId,
      provider,
    );
    return row ? toConnection(row) : null;
  }

  connections(userId: number): MailConnection[] {
    return (
      this.db
        .prepare('SELECT * FROM mail_connections WHERE user_id = ? ORDER BY provider')
        .all(userId) as Row[]
    ).map(toConnection);
  }

  deleteConnection(userId: number, provider: Provider) {
    this.run('DELETE FROM mail_connections WHERE user_id = ? AND provider = ?', userId, provider);
  }

  logSent(
    userId: number,
    provider: Provider,
    to: string,
    subject: string,
    providerMessageId: string | null,
  ) {
    this.run(
      `INSERT INTO sent_messages (user_id, provider, to_address, subject, provider_message_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      userId,
      provider,
      to,
      subject,
      providerMessageId,
      new Date().toISOString(),
    );
  }

  recentSent(
    userId: number,
    limit = 10,
  ): { provider: Provider; to: string; subject: string; sentAt: string }[] {
    return (
      this.db
        .prepare(
          'SELECT provider, to_address, subject, sent_at FROM sent_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?',
        )
        .all(userId, limit) as Row[]
    ).map((row) => ({
      provider: str(row, 'provider') as Provider,
      to: str(row, 'to_address'),
      subject: str(row, 'subject'),
      sentAt: str(row, 'sent_at'),
    }));
  }
}
