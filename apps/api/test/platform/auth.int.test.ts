// PLT-013-QA / BE-078-QA: OIDC login against an in-process issuer (code + PKCE + state + nonce,
// signed with jose), replay, tampering, wrong audience/issuer/signature, expiry, redirect
// allowlist, explicit account linking, session expiry, logout, rotation and tenant switching.
import { MeResponseSchema } from '@fieldline/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  call,
  cookieCleared,
  createCompany,
  createTestContext,
  createUser,
  loginWithMock,
  MockIssuer,
  type TestContext,
} from '../helpers';

let mock: MockIssuer;
let ctx: TestContext;

beforeAll(async () => {
  mock = await new MockIssuer().start();
  ctx = await createTestContext({ oidc: mock.registry() });
});
afterEach(async () => {
  // Users created by the login flow are found by the mock issuer.
  const rows = await ctx.owner.client<{ user_id: string }[]>`
    select user_id from external_identities where issuer = ${mock.issuer}`;
  for (const row of rows) ctx.track.user(row.user_id);
  await ctx.cleanup();
});
afterAll(async () => {
  await ctx?.close();
  await mock?.stop();
});

const newIdentity = (label: string) => ({
  sub: `${label}-${crypto.randomUUID()}`,
  email: `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`,
  name: `Test ${label}`,
});

async function sessionCount(userIdOrSub: string): Promise<number> {
  const [row] = await ctx.owner.client<{ n: number }[]>`
    select count(*)::int as n from sessions s join external_identities e on e.user_id = s.user_id
    where e.subject = ${userIdOrSub} and s.revoked_at is null`;
  return row?.n ?? 0;
}

describe('PLT-013-QA sign-in providers', () => {
  it('lists providers and marks unconfigured ones unavailable instead of faking them', async () => {
    const res = await call(ctx, 'GET', '/v1/auth/providers');
    expect(res.statusCode).toBe(200);
    const { providers } = res.json() as { providers: { id: string; available: boolean; developmentOnly: boolean }[] };
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'microsoft', available: false, developmentOnly: false }),
        expect.objectContaining({ id: 'dev', available: true, developmentOnly: true }),
      ]),
    );
    const ms = await call(ctx, 'GET', '/v1/auth/login/microsoft');
    expect(ms.statusCode).toBe(404);
    expect(ms.headers['content-type']).toContain('application/problem+json');
  });

  it('starts the code flow with PKCE S256, state, nonce and an httpOnly transaction cookie', async () => {
    const res = await call(ctx, 'GET', '/v1/auth/login/dev?returnTo=%2Froof');
    expect(res.statusCode).toBe(302);
    const url = new URL(String(res.headers.location));
    expect(url.origin).toBe(mock.issuer);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4000/v1/auth/callback/dev');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^fl_oidc=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/v1\/auth\/callback\/dev/);
  });
});

describe('PLT-013-QA OIDC callback validation', () => {
  it('creates a user keyed on (issuer, subject), a server session and redirects to returnTo', async () => {
    const identity = newIdentity('new-user');
    const login = await loginWithMock(ctx, mock, identity, { returnTo: '/curb/projects?tab=open' });
    expect(login.callback.statusCode).toBe(302);
    expect(login.location.origin).toBe(ctx.config.appOrigin);
    expect(`${login.location.pathname}${login.location.search}`).toBe('/curb/projects?tab=open');
    expect(login.sessionCookie).toMatch(/^fl_session=[A-Za-z0-9_-]{43}$/);
    const raw = String(login.callback.headers['set-cookie']);
    expect(raw).toMatch(/fl_session=[^;]+;.*HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).not.toMatch(/Secure/); // http://localhost in tests; Secure in production

    const [identityRow] = await ctx.owner.client<{ user_id: string; issuer: string }[]>`
      select user_id, issuer from external_identities where subject = ${identity.sub}`;
    expect(identityRow?.issuer).toBe(mock.issuer);
    // Only the SHA-256 of the cookie token is stored.
    const token = login.sessionCookie!.split('=')[1]!;
    const [stored] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from sessions where token_hash = ${token}`;
    expect(stored?.n).toBe(0);
    expect(await sessionCount(identity.sub)).toBe(1);

    const me = await call(ctx, 'GET', '/v1/me', { headers: { cookie: login.sessionCookie! } });
    expect(me.statusCode).toBe(200);
    const body = MeResponseSchema.parse(me.json());
    expect(body.user.id).toBe(identityRow?.user_id);
    expect(body.user.email).toBe(identity.email);
    expect(body.memberships).toEqual([]);
    expect(body.activeOrgId).toBeNull();
    expect(body.permissions).toEqual([]);
    expect(body.flags['roof.orders']).toBe(true);
  });

  it('signs a returning identity into the same internal user (no duplicate)', async () => {
    const identity = newIdentity('returning');
    const first = await loginWithMock(ctx, mock, identity);
    const second = await loginWithMock(ctx, mock, { ...identity, email: `changed-${identity.email}` });
    expect(first.sessionCookie).toBeTruthy();
    expect(second.sessionCookie).toBeTruthy();
    const [row] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from external_identities where subject = ${identity.sub}`;
    expect(row?.n).toBe(1);
  });

  it('rejects a replayed callback (state is single-use) and creates no second session', async () => {
    const identity = newIdentity('replay');
    const login = await loginWithMock(ctx, mock, identity);
    expect(login.sessionCookie).toBeTruthy();
    const replay = await login.replay();
    expect(replay.statusCode).toBe(302);
    expect(String(replay.headers.location)).toBe(`${ctx.config.appOrigin}/sign-in?error=sign_in_rejected`);
    expect(replay.headers['set-cookie'] ?? '').not.toMatch(/fl_session=[^;]/);
    expect(await sessionCount(identity.sub)).toBe(1);
  });

  it('rejects a tampered state', async () => {
    const login = await loginWithMock(ctx, mock, newIdentity('state'), {
      tamper: (url) => url.searchParams.set('state', 'attacker-chosen-state'),
    });
    expect(String(login.callback.headers.location)).toBe(`${ctx.config.appOrigin}/sign-in?error=sign_in_rejected`);
    expect(login.sessionCookie).toBeNull();
  });

  it('rejects a callback without the transaction cookie (login CSRF / expired transaction)', async () => {
    const start = await call(ctx, 'GET', '/v1/auth/login/dev');
    const callback = mock.authorize(String(start.headers.location), newIdentity('nocookie'));
    const tokenRequestsBefore = mock.tokenRequests;
    const res = await call(ctx, 'GET', `${callback.pathname}${callback.search}`);
    expect(String(res.headers.location)).toBe(`${ctx.config.appOrigin}/sign-in?error=sign_in_expired`);
    // The code was never redeemed.
    expect(mock.tokenRequests).toBe(tokenRequestsBefore);
  });

  it.each([
    ['a wrong nonce', { nonce: 'not-the-nonce-we-sent' }],
    ['a missing nonce', { nonce: null }],
    ['a wrong audience', { aud: 'some-other-client' }],
    ['a wrong issuer', { iss: 'https://evil.example' }],
    ['an expired ID token', { expiresIn: -120 }],
    ['a signature from a key not in the JWKS', { foreignKey: true }],
  ])('rejects an ID token with %s', async (_label, tweak) => {
    const identity = newIdentity('bad-token');
    const login = await loginWithMock(ctx, mock, identity, { tweak });
    expect(login.callback.statusCode).toBe(302);
    expect(String(login.callback.headers.location)).toBe(`${ctx.config.appOrigin}/sign-in?error=sign_in_rejected`);
    expect(login.sessionCookie).toBeNull();
    const [row] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from external_identities where subject = ${identity.sub}`;
    expect(row?.n).toBe(0);
  });

  it('reports a provider-side denial without creating anything', async () => {
    const start = await call(ctx, 'GET', '/v1/auth/login/dev');
    const oidc = String(start.headers['set-cookie']).split(';')[0]!;
    const res = await call(ctx, 'GET', '/v1/auth/callback/dev?error=access_denied&state=x', {
      headers: { cookie: oidc },
    });
    expect(String(res.headers.location)).toBe(`${ctx.config.appOrigin}/sign-in?error=provider_denied`);
  });

  it.each([
    ['https://evil.example/steal', '/'],
    ['//evil.example/steal', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['http://localhost:3000/curb?x=1', '/curb?x=1'],
    ['/roof/orders', '/roof/orders'],
  ])('redirect allowlist: returnTo %s -> %s', async (returnTo, expected) => {
    const login = await loginWithMock(ctx, mock, newIdentity('redirect'), { returnTo });
    expect(login.location.origin).toBe(ctx.config.appOrigin);
    expect(`${login.location.pathname}${login.location.search}`).toBe(expected);
  });
});

describe('PLT-013-QA account linking (no silent duplicates)', () => {
  it('stops sign-in with account_link_required when the email belongs to a user of another issuer', async () => {
    const existing = await createUser(ctx, { issuer: 'https://other-idp.example', email: 'shared.person@example.test' });
    const login = await loginWithMock(ctx, mock, { sub: `shared-${crypto.randomUUID()}`, email: 'Shared.Person@example.test' });
    expect(String(login.callback.headers.location)).toBe(`${ctx.config.appOrigin}/sign-in?error=account_link_required`);
    expect(login.sessionCookie).toBeNull();
    const [row] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from users where lower(email) = 'shared.person@example.test'`;
    expect(row?.n).toBe(1);
    expect(existing.userId).toBeTruthy();
  });

  it('links a second identity explicitly for the signed-in user and audits it', async () => {
    const company = await createCompany(ctx);
    const sub = `linked-${crypto.randomUUID()}`;
    const start = await call(ctx, 'GET', '/v1/auth/link/dev?returnTo=/settings/profile', { as: company.owner });
    expect(start.statusCode).toBe(302);
    const oidc = String(start.headers['set-cookie']).split(';')[0]!;
    const callback = mock.authorize(String(start.headers.location), { sub, email: company.owner.email });
    const res = await call(ctx, 'GET', `${callback.pathname}${callback.search}`, {
      headers: { cookie: `${oidc}; ${company.owner.cookie}` },
    });
    expect(String(res.headers.location)).toBe(`${ctx.config.appOrigin}/settings/profile`);
    const [row] = await ctx.owner.client<{ user_id: string }[]>`select user_id from external_identities where subject = ${sub}`;
    expect(row?.user_id).toBe(company.owner.userId);
    const audit = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from audit_events where org_id = ${company.orgId} and action = 'auth.identity_linked'`;
    expect(audit[0]?.n).toBe(1);

    // Signing in with the linked identity now lands on the same user.
    const login = await loginWithMock(ctx, mock, { sub, email: company.owner.email });
    const me = await call(ctx, 'GET', '/v1/me', { headers: { cookie: login.sessionCookie! } });
    expect(me.json().user.id).toBe(company.owner.userId);
  });

  it('linking requires a signed-in user', async () => {
    const res = await call(ctx, 'GET', '/v1/auth/link/dev');
    expect(res.statusCode).toBe(401);
  });
});

describe('PLT-013-QA sessions, logout and rotation', () => {
  it('rotates the session on login: the previous cookie stops working', async () => {
    const company = await createCompany(ctx);
    const sub = `rotate-${crypto.randomUUID()}`;
    await ctx.owner.client`insert into external_identities (user_id, provider, issuer, subject)
      values (${company.owner.userId}, 'dev_idp', ${mock.issuer}, ${sub})`;
    const login = await loginWithMock(ctx, mock, { sub }, { cookie: company.owner.cookie });
    expect(login.sessionCookie).toBeTruthy();
    expect(login.sessionCookie).not.toBe(company.owner.cookie);
    expect((await call(ctx, 'GET', '/v1/me', { as: company.owner })).statusCode).toBe(401);
    const fresh = await call(ctx, 'GET', '/v1/me', { headers: { cookie: login.sessionCookie! } });
    expect(fresh.statusCode).toBe(200);
    // Exactly one membership -> that company is opened automatically.
    expect(fresh.json().activeOrgId).toBe(company.orgId);
  });

  it('logout revokes the server session and clears the cookie', async () => {
    const company = await createCompany(ctx);
    const out = await call(ctx, 'POST', '/v1/auth/logout', { as: company.owner });
    expect(out.statusCode).toBe(204);
    expect(cookieCleared(out, 'fl_session')).toBe(true);
    const me = await call(ctx, 'GET', '/v1/me', { as: company.owner });
    expect(me.statusCode).toBe(401);
    expect(me.json().code).toBe('unauthenticated');
    const audit = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from audit_events where org_id = ${company.orgId} and action = 'auth.signed_out'`;
    expect(audit[0]?.n).toBe(1);
  });

  it('an idle-expired session returns 401 session_expired and clears the cookie', async () => {
    const company = await createCompany(ctx);
    await ctx.owner.client`update sessions set idle_expires_at = now() - interval '1 minute'
      where id = ${company.owner.sessionId}`;
    const res = await call(ctx, 'GET', '/v1/team/members', { as: company.owner });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('session_expired');
    expect(cookieCleared(res, 'fl_session')).toBe(true);
  });

  it('an absolute-expired session is rejected even if recently active', async () => {
    const company = await createCompany(ctx);
    await ctx.owner.client`update sessions set absolute_expires_at = now() - interval '1 second'
      where id = ${company.owner.sessionId}`;
    expect((await call(ctx, 'GET', '/v1/me', { as: company.owner })).json().code).toBe('session_expired');
  });

  it('a deactivated user loses every session on the next request', async () => {
    const company = await createCompany(ctx);
    await ctx.owner.client`update users set status = 'deactivated' where id = ${company.owner.userId}`;
    expect((await call(ctx, 'GET', '/v1/me', { as: company.owner })).statusCode).toBe(401);
    const [row] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from sessions where user_id = ${company.owner.userId} and revoked_at is null`;
    expect(row?.n).toBe(0);
  });

  it('a deactivated user cannot sign in again', async () => {
    const identity = newIdentity('deactivated');
    await loginWithMock(ctx, mock, identity);
    await ctx.owner.client`update users set status = 'deactivated'
      where id = (select user_id from external_identities where subject = ${identity.sub})`;
    const again = await loginWithMock(ctx, mock, identity);
    expect(String(again.callback.headers.location)).toBe(`${ctx.config.appOrigin}/sign-in?error=account_deactivated`);
    expect(again.sessionCookie).toBeNull();
  });

  it('an unknown cookie is treated as signed out', async () => {
    const res = await call(ctx, 'GET', '/v1/me', { headers: { cookie: 'fl_session=not-a-real-token' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('PLT-013-QA tenant switching', () => {
  it('a member of two companies must choose; switching re-validates membership every time', async () => {
    const a = await createCompany(ctx);
    const b = await createCompany(ctx);
    const sub = `multi-${crypto.randomUUID()}`;
    await ctx.owner.client`insert into external_identities (user_id, provider, issuer, subject)
      values (${a.owner.userId}, 'dev_idp', ${mock.issuer}, ${sub})`;
    const membershipInB = await addMember(ctx, { orgId: b.orgId, userId: a.owner.userId, role: 'estimator' });

    const login = await loginWithMock(ctx, mock, { sub }, { returnTo: '/jobs' });
    expect(`${login.location.pathname}${login.location.search}`).toBe('/choose-workspace?returnTo=%2Fjobs');
    const cookie = { cookie: login.sessionCookie! };
    const noOrg = await call(ctx, 'GET', '/v1/orgs/current', { as: cookie });
    expect(noOrg.statusCode).toBe(403);
    expect(noOrg.json().code).toBe('workspace_required');

    const toB = await call(ctx, 'POST', '/v1/session/active-org', { as: cookie, body: { orgId: b.orgId } });
    expect(toB.statusCode).toBe(200);
    const me = MeResponseSchema.parse(toB.json());
    expect(me.activeOrgId).toBe(b.orgId);
    expect(me.activeRole).toBe('estimator');
    expect(me.permissions).toContain('estimate:write');
    expect(me.permissions).not.toContain('billing_settings:update');
    expect(me.memberships.map((m) => m.orgId).sort()).toEqual([a.orgId, b.orgId].sort());
    expect((await call(ctx, 'GET', '/v1/orgs/current', { as: cookie })).json().id).toBe(b.orgId);

    const toA = await call(ctx, 'POST', '/v1/session/active-org', { as: cookie, body: { orgId: a.orgId } });
    expect(toA.json().activeRole).toBe('owner');

    // A company the user does not belong to looks like a missing one.
    const stranger = await createCompany(ctx);
    const denied = await call(ctx, 'POST', '/v1/session/active-org', { as: cookie, body: { orgId: stranger.orgId } });
    expect(denied.statusCode).toBe(404);

    // Revoked in B: switching there is refused.
    await ctx.owner.client`update memberships set status = 'revoked' where id = ${membershipInB}`;
    const revoked = await call(ctx, 'POST', '/v1/session/active-org', { as: cookie, body: { orgId: b.orgId } });
    expect(revoked.statusCode).toBe(403);
    expect(revoked.json().code).toBe('membership_revoked');
  });
});
