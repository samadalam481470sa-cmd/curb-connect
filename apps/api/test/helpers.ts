// Shared integration-test helpers for every API module (reuse these instead of re-inventing
// fixtures). They build a real app on fieldline_test with the BINDING DB ROLE RULE in place:
//   - ctx.app runs on TEST_APP_DATABASE_URL (fieldline_app: NOSUPERUSER NOBYPASSRLS), plus the
//     owner connection only for the documented platform path (withPlatform).
//   - ctx.owner (TEST_DATABASE_URL) is for fixtures, assertions and cleanup only, never for the code
//     under test.
// Data is created through fixtures that register what they made (ctx.track), and ctx.cleanup()
// deletes exactly that data afterwards (append-only triggers are bypassed with
// session_replication_role = replica, which needs the owner to be a superuser: true locally and in
// the CI postgis container).
//
// Typical use:
//   const ctx = await createTestContext();
//   afterEach(() => ctx.cleanup());
//   afterAll(() => ctx.close());
//   const a = await createCompany(ctx, { roles: ['reviewer'] });
//   const res = await call(ctx, 'GET', '/v1/team/members', { as: a.owner });
import { createHash, generateKeyPairSync, type KeyObject, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemberRole } from '@fieldline/contracts';
import { type JWK, SignJWT, exportJWK } from 'jose';
import type { LightMyRequestResponse } from 'fastify';
import { type App, buildApp } from '../src/app';
import { type AppConfig, loadConfig } from '../src/config';
import { createDatabase, type DatabaseHandle } from '../src/db/client';
import { externalIdentities, memberships, organizations, orgSettingsRevisions, users } from '../src/db/schema';
import { assertTestDatabaseUrl } from '../src/db/url';
import type { OidcRegistryOptions } from '../src/modules/auth/oidc';
import { type MalwareScanner, NoopScanner } from '../src/modules/media/processing';
import { defaultSettings } from '../src/modules/orgs/settings';
import type { MailAdapter, MailMessage, MailResult } from '../src/services/mail';
import { createSession, SESSION_COOKIE } from '../src/services/sessions';
import { LocalEncryptedStorage, storageSigningSecret } from '../src/storage';

export const TEST_ISSUER = 'https://fixtures.fieldline.invalid';

// ------------------------------------------------------------------------------------ mail
/** Records messages instead of sending; can be told to fail (delivery-failure tests). */
export class RecordingMail implements MailAdapter {
  readonly name = 'dev-outbox' as const;
  readonly sent: MailMessage[] = [];
  failWith: string | null = null;

  async send(message: MailMessage): Promise<MailResult> {
    if (this.failWith) throw new Error(this.failWith);
    this.sent.push(message);
    return { providerMessageId: `test:${message.idempotencyKey}` };
  }
}

// ------------------------------------------------------------------------------------ context
export interface Tracked {
  orgIds: Set<string>;
  userIds: Set<string>;
}

export interface TestContext {
  app: App;
  config: AppConfig;
  /** Restricted runtime role, the same connection the app uses. */
  appDb: DatabaseHandle;
  /** Owner (superuser) connection: fixtures, assertions, cleanup. Never pass it to code under test. */
  owner: DatabaseHandle;
  storage: LocalEncryptedStorage;
  mail: RecordingMail;
  track: { org(id: string): void; user(id: string): void };
  tracked: Tracked;
  /** Deletes everything the tracked orgs/users own (call in afterEach). */
  cleanup(): Promise<void>;
  /** Cleanup + close the app, connections and temp storage (call in afterAll). */
  close(): Promise<void>;
}

export interface TestContextOptions {
  /** Extra env (e.g. STORAGE_MAX_UPLOAD_BYTES, AUTH_RATE_LIMIT_PER_MINUTE). */
  env?: Record<string, string>;
  oidc?: OidcRegistryOptions;
  scanner?: MalwareScanner;
}

function testUrls(): { ownerUrl: string; appUrl: string } {
  const ownerUrl = process.env.TEST_DATABASE_URL;
  const appUrl = process.env.TEST_APP_DATABASE_URL;
  if (!ownerUrl || !appUrl) {
    throw new Error(
      'TEST_DATABASE_URL and TEST_APP_DATABASE_URL (fieldline_app) must be set for API integration tests.',
    );
  }
  assertTestDatabaseUrl(ownerUrl);
  assertTestDatabaseUrl(appUrl);
  return { ownerUrl, appUrl };
}

export function testConfig(env: Record<string, string> = {}): AppConfig {
  const { ownerUrl, appUrl } = testUrls();
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: ownerUrl,
    APP_DATABASE_URL: appUrl,
    TEST_APP_DATABASE_URL: appUrl,
    API_ORIGIN: 'http://localhost:4000',
    APP_ORIGIN: 'http://localhost:3000',
    SESSION_SECRET: process.env.SESSION_SECRET ?? 'integration-test-session-secret-0123456789',
    STORAGE_DRIVER: 'local',
    STORAGE_ENCRYPTION_KEY: '',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    // Real Microsoft config never leaks into tests.
    MICROSOFT_TENANT_ID: '',
    MICROSOFT_CLIENT_ID: '',
    MICROSOFT_CLIENT_SECRET: '',
    DEV_IDP_CLIENT_ID: '',
    ...env,
  });
}

let orgColumnTables: string[] | null = null;

async function tenantTables(owner: DatabaseHandle): Promise<string[]> {
  orgColumnTables ??= (
    await owner.client<{ table_name: string }[]>`
      select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type = 'BASE TABLE'
      order by c.table_name`
  ).map((r) => r.table_name);
  return orgColumnTables;
}

export async function cleanupTracked(owner: DatabaseHandle, tracked: Tracked): Promise<void> {
  const orgIds = [...tracked.orgIds];
  const userIds = [...tracked.userIds];
  if (orgIds.length === 0 && userIds.length === 0) return;
  const tables = await tenantTables(owner);
  await owner.client.begin(async (sql) => {
    // Append-only/locked-version triggers (and FK triggers) do not fire in replica mode.
    await sql`set local session_replication_role = replica`;
    if (orgIds.length > 0) {
      for (const table of tables) {
        await sql`delete from ${sql(table)} where org_id = any(${orgIds}::uuid[])`;
      }
      await sql`delete from graphile_worker._private_jobs where payload ->> 'orgId' = any(${orgIds}::text[])`;
      await sql`delete from sessions where active_org_id = any(${orgIds}::uuid[])`;
      await sql`delete from organizations where id = any(${orgIds}::uuid[])`;
    }
    if (userIds.length > 0) {
      await sql`delete from sessions where user_id = any(${userIds}::uuid[])`;
      await sql`delete from external_identities where user_id = any(${userIds}::uuid[])`;
      await sql`delete from memberships where user_id = any(${userIds}::uuid[])`;
      await sql`delete from users where id = any(${userIds}::uuid[])`;
    }
  });
  tracked.orgIds.clear();
  tracked.userIds.clear();
}

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const config = testConfig(options.env);
  const { ownerUrl, appUrl } = testUrls();
  const appDb = createDatabase(appUrl, { max: 4, applicationName: 'api-test-app' });
  const platformDb = createDatabase(ownerUrl, { max: 2, applicationName: 'api-test-platform' });
  const owner = createDatabase(ownerUrl, { max: 2, applicationName: 'api-test-owner' });
  const storageRoot = await mkdtemp(join(tmpdir(), 'fieldline-api-test-'));
  const storage = new LocalEncryptedStorage({
    root: storageRoot,
    key: randomBytes(32),
    signingSecret: storageSigningSecret(config),
    publicOrigin: config.apiOrigin,
  });
  const mail = new RecordingMail();
  const app = await buildApp({
    config,
    database: appDb,
    platformDatabase: platformDb,
    logger: false,
    storage,
    mail,
    scanner: options.scanner ?? new NoopScanner(),
    ...(options.oidc && { oidc: options.oidc }),
  });
  await app.ready();
  const tracked: Tracked = { orgIds: new Set(), userIds: new Set() };
  const ctx: TestContext = {
    app,
    config,
    appDb,
    owner,
    storage,
    mail,
    tracked,
    track: {
      org: (id) => void tracked.orgIds.add(id),
      user: (id) => void tracked.userIds.add(id),
    },
    cleanup: () => cleanupTracked(owner, tracked),
    async close() {
      try {
        await cleanupTracked(owner, tracked);
      } finally {
        await app.close();
        await appDb.close();
        await platformDb.close();
        await owner.close();
        await rm(storageRoot, { recursive: true, force: true });
      }
    },
  };
  return ctx;
}

// ------------------------------------------------------------------------------------ fixtures
export interface TestUser {
  userId: string;
  identityId: string;
  email: string;
  displayName: string;
  subject: string;
  issuer: string;
}

export async function createUser(
  ctx: TestContext,
  input: { displayName?: string; email?: string | null; issuer?: string; subject?: string; status?: 'active' | 'deactivated' } = {},
): Promise<TestUser> {
  const subject = input.subject ?? `user-${randomUUID()}`;
  const email = input.email === undefined ? `${subject}@example.test` : input.email;
  const displayName = input.displayName ?? `Test person ${subject.slice(-6)}`;
  const issuer = input.issuer ?? TEST_ISSUER;
  const [user] = await ctx.owner.db
    .insert(users)
    .values({ displayName, email, status: input.status ?? 'active' })
    .returning({ id: users.id });
  ctx.track.user(user!.id);
  const [identity] = await ctx.owner.db
    .insert(externalIdentities)
    .values({ userId: user!.id, provider: 'dev_idp', issuer, subject, emailAtLogin: email })
    .returning({ id: externalIdentities.id });
  return { userId: user!.id, identityId: identity!.id, email: email ?? '', displayName, subject, issuer };
}

export async function createOrg(
  ctx: TestContext,
  input: { ownerUserId: string; displayName?: string; productLines?: ('roof' | 'curb')[] },
): Promise<{ orgId: string; ownerMembershipId: string; displayName: string }> {
  const orgId = randomUUID();
  const displayName = input.displayName ?? `Test Co ${orgId.slice(0, 6)} (fictional)`;
  const productLines = input.productLines ?? ['roof', 'curb'];
  ctx.track.org(orgId);
  await ctx.owner.db.insert(organizations).values({
    id: orgId,
    slug: `test-${orgId}`,
    legalName: `${displayName} LLC`,
    displayName,
    productLines,
  });
  const [membership] = await ctx.owner.db
    .insert(memberships)
    .values({ orgId, userId: input.ownerUserId, role: 'owner', status: 'active' })
    .returning({ id: memberships.id });
  await ctx.owner.db.insert(orgSettingsRevisions).values({
    orgId,
    revisionNumber: 1,
    settings: defaultSettings(productLines),
    changeReason: 'test fixture',
    changedByUserId: input.ownerUserId,
  });
  return { orgId, ownerMembershipId: membership!.id, displayName };
}

export async function addMember(
  ctx: TestContext,
  input: { orgId: string; userId: string; role: MemberRole; status?: 'active' | 'suspended' | 'revoked' },
): Promise<string> {
  const [row] = await ctx.owner.db
    .insert(memberships)
    .values({ orgId: input.orgId, userId: input.userId, role: input.role, status: input.status ?? 'active' })
    .returning({ id: memberships.id });
  return row!.id;
}

export interface TestSession {
  sessionId: string;
  token: string;
  /** Value for the Cookie header. */
  cookie: string;
}

export async function signIn(
  ctx: TestContext,
  userId: string,
  activeOrgId: string | null,
): Promise<TestSession> {
  const created = await createSession(ctx.appDb.db, ctx.config, {
    userId,
    identityId: null,
    activeOrgId,
    userAgent: 'vitest',
    ipHash: null,
  });
  return { sessionId: created.id, token: created.token, cookie: `${SESSION_COOKIE}=${created.token}` };
}

export interface Person extends TestUser, TestSession {
  orgId: string;
  membershipId: string;
  role: MemberRole;
}

export interface Company {
  orgId: string;
  displayName: string;
  owner: Person;
  members: Partial<Record<MemberRole, Person>>;
  /** The member with this role (throws if the company was created without it). */
  as(role: MemberRole): Person;
}

/** An org with a signed-in owner plus one signed-in member per requested role. */
export async function createCompany(
  ctx: TestContext,
  input: { roles?: MemberRole[]; displayName?: string } = {},
): Promise<Company> {
  const ownerUser = await createUser(ctx, { displayName: 'Owner of record (test)' });
  const org = await createOrg(ctx, { ownerUserId: ownerUser.userId, ...(input.displayName && { displayName: input.displayName }) });
  const owner: Person = {
    ...ownerUser,
    ...(await signIn(ctx, ownerUser.userId, org.orgId)),
    orgId: org.orgId,
    membershipId: org.ownerMembershipId,
    role: 'owner',
  };
  const members: Partial<Record<MemberRole, Person>> = { owner };
  for (const role of input.roles ?? []) {
    if (role === 'owner') continue;
    const user = await createUser(ctx, { displayName: `Test ${role}` });
    const membershipId = await addMember(ctx, { orgId: org.orgId, userId: user.userId, role });
    members[role] = { ...user, ...(await signIn(ctx, user.userId, org.orgId)), orgId: org.orgId, membershipId, role };
  }
  return {
    orgId: org.orgId,
    displayName: org.displayName,
    owner,
    members,
    as(role) {
      const person = members[role];
      if (!person) throw new Error(`createCompany was called without role ${role}`);
      return person;
    },
  };
}

// ------------------------------------------------------------------------------------ requests
export interface CallOptions {
  /** Sends this person's (or session's) cookie. */
  as?: { cookie: string } | null;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function call(
  ctx: TestContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  options: CallOptions = {},
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.as) headers.cookie = [headers.cookie, options.as.cookie].filter(Boolean).join('; ');
  return ctx.app.inject({
    method,
    url,
    headers,
    ...(options.body !== undefined && { payload: options.body as object }),
  });
}

/** Raw `name=value` of a Set-Cookie header in the response (as a browser would send it back). */
export function setCookieValue(res: LightMyRequestResponse, name: string): string | null {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const line of list) {
    const [pair] = line.split(';');
    if (pair && pair.startsWith(`${name}=`)) return pair;
  }
  return null;
}

export function cookieCleared(res: LightMyRequestResponse, name: string): boolean {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.some((line) => line.startsWith(`${name}=;`) && /Expires=Thu, 01 Jan 1970/i.test(line));
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Rows of an audit query, newest first (owner connection, bypasses RLS on purpose). */
export async function auditRows(ctx: TestContext, orgId: string, action?: string) {
  return ctx.owner.client<
    {
      action: string;
      resource_type: string;
      resource_id: string | null;
      actor_user_id: string | null;
      before: unknown;
      after: unknown;
      reason: string | null;
      correlation_id: string | null;
    }[]
  >`select action, resource_type, resource_id, actor_user_id, before, after, reason, correlation_id
    from audit_events where org_id = ${orgId} ${action ? ctx.owner.client`and action = ${action}` : ctx.owner.client``}
    order by occurred_at desc, id desc`;
}

// ------------------------------------------------------------------------------------ mock OIDC issuer
export interface TokenTweak {
  iss?: string;
  aud?: string;
  nonce?: string | null;
  /** Seconds from now (negative = already expired). */
  expiresIn?: number;
  /** Sign with a key that is not published in the JWKS. */
  foreignKey?: boolean;
  email?: string | null;
  emailVerified?: boolean;
}

export interface MockIdentity {
  sub: string;
  email?: string | null;
  name?: string;
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce: string | null;
  identity: MockIdentity;
  tweak: TokenTweak;
}

/**
 * In-process OpenID provider for tests: discovery, JWKS, and a token endpoint that verifies PKCE
 * and signs ID tokens with jose. `authorize()` stands in for the user signing in at the provider:
 * it takes the authorization URL the API redirected to and returns the callback URL.
 */
export class MockIssuer {
  readonly clientId = 'fieldline-test-client';
  readonly clientSecret = 'mock-client-secret-for-tests-only';
  issuer = '';
  tokenRequests = 0;
  private server: Server | null = null;
  private readonly codes = new Map<string, PendingCode>();
  private readonly kid = `mock-${randomUUID()}`;
  private readonly key: KeyObject;
  private readonly foreign: KeyObject;
  private publicJwk: JWK | null = null;

  constructor() {
    this.key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    this.foreign = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  }

  async start(): Promise<this> {
    const { createPublicKey } = await import('node:crypto');
    this.publicJwk = { ...(await exportJWK(createPublicKey(this.key))), kid: this.kid, alg: 'RS256', use: 'sig' };
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** OIDC overrides for createTestContext({ oidc }). */
  registry(): OidcRegistryOptions {
    return { overrides: { dev: { issuer: this.issuer, clientId: this.clientId, clientSecret: this.clientSecret } } };
  }

  authorize(authorizationUrl: string, identity: MockIdentity, tweak: TokenTweak = {}): URL {
    const url = new URL(authorizationUrl);
    if (url.origin !== this.issuer) throw new Error(`login was redirected to ${url.origin}, not the mock issuer`);
    const p = url.searchParams;
    if (p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) throw new Error('PKCE missing');
    if (p.get('response_type') !== 'code') throw new Error('not the code flow');
    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, {
      clientId: p.get('client_id') ?? '',
      redirectUri: p.get('redirect_uri') ?? '',
      codeChallenge: p.get('code_challenge') ?? '',
      nonce: p.get('nonce'),
      identity,
      tweak,
    });
    const callback = new URL(p.get('redirect_uri') ?? '');
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', p.get('state') ?? '');
    callback.searchParams.set('iss', this.issuer);
    return callback;
  }

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', this.issuer).pathname;
    if (path === '/.well-known/openid-configuration') {
      return this.json(res, 200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
        authorization_response_iss_parameter_supported: true,
        scopes_supported: ['openid', 'profile', 'email'],
      });
    }
    if (path === '/jwks') return this.json(res, 200, { keys: [this.publicJwk] });
    if (path === '/token' && req.method === 'POST') {
      this.tokenRequests += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const pending = this.codes.get(form.get('code') ?? '');
      this.codes.delete(form.get('code') ?? ''); // single use
      if (!pending) return this.json(res, 400, { error: 'invalid_grant', error_description: 'unknown or used code' });
      if (form.get('client_id') !== this.clientId || form.get('client_secret') !== this.clientSecret) {
        return this.json(res, 401, { error: 'invalid_client' });
      }
      if (form.get('redirect_uri') !== pending.redirectUri) {
        return this.json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      }
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (challenge !== pending.codeChallenge) {
        return this.json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      }
      const t = pending.tweak;
      const now = Math.floor(Date.now() / 1000);
      const email = t.email !== undefined ? t.email : (pending.identity.email ?? null);
      const nonce = t.nonce !== undefined ? t.nonce : pending.nonce;
      const claims: Record<string, unknown> = {
        ...(email && { email, email_verified: t.emailVerified ?? true }),
        ...(pending.identity.name && { name: pending.identity.name }),
        ...(nonce && { nonce }),
      };
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: this.kid, typ: 'JWT' })
        .setIssuer(t.iss ?? this.issuer)
        .setAudience(t.aud ?? this.clientId)
        .setSubject(pending.identity.sub)
        .setIssuedAt(t.expiresIn !== undefined && t.expiresIn < 0 ? now + t.expiresIn - 600 : now)
        .setExpirationTime(now + (t.expiresIn ?? 300))
        .sign(t.foreignKey ? this.foreign : this.key);
      return this.json(res, 200, {
        access_token: randomBytes(16).toString('base64url'),
        token_type: 'Bearer',
        expires_in: 300,
        id_token: idToken,
      });
    }
    return this.json(res, 404, { error: 'not_found' });
  }
}

export interface LoginResult {
  start: LightMyRequestResponse;
  callback: LightMyRequestResponse;
  /** `fl_session=...` when a session was created. */
  sessionCookie: string | null;
  /** Where the API finally sent the browser (on the web origin). */
  location: URL;
  /** Re-sends the exact same callback (replay attack). */
  replay(): Promise<LightMyRequestResponse>;
}

/** Full browser-equivalent login against the mock: /login -> provider -> /callback. */
export async function loginWithMock(
  ctx: TestContext,
  mock: MockIssuer,
  identity: MockIdentity,
  options: {
    returnTo?: string;
    tweak?: TokenTweak;
    /** Mutates the callback URL before it is sent (tampering tests). */
    tamper?: (url: URL) => void;
    /** Cookie(s) the browser already has (e.g. an existing session). */
    cookie?: string;
  } = {},
): Promise<LoginResult> {
  const query = options.returnTo !== undefined ? `?returnTo=${encodeURIComponent(options.returnTo)}` : '';
  const start = await ctx.app.inject({
    method: 'GET',
    url: `/v1/auth/login/dev${query}`,
    headers: options.cookie ? { cookie: options.cookie } : {},
  });
  if (start.statusCode !== 302) throw new Error(`login start returned ${start.statusCode}: ${start.body}`);
  const oidcCookie = setCookieValue(start, 'fl_oidc');
  const callbackUrl = mock.authorize(String(start.headers.location), identity, options.tweak);
  options.tamper?.(callbackUrl);
  const send = () =>
    ctx.app.inject({
      method: 'GET',
      url: `${callbackUrl.pathname}${callbackUrl.search}`,
      headers: { cookie: [oidcCookie, options.cookie].filter(Boolean).join('; ') },
    });
  const callback = await send();
  return {
    start,
    callback,
    sessionCookie: setCookieValue(callback, SESSION_COOKIE),
    location: new URL(String(callback.headers.location ?? '/'), ctx.config.appOrigin),
    replay: send,
  };
}
