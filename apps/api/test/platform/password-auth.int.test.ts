// Username and password sign-in: create account, sign in by username or email, wrong passwords and
// lock-out, "keep me signed in", adding a password to a Microsoft / Google account, changing it
// (other devices signed out), and the email-takeover guard.
import { MeResponseSchema } from '@fieldline/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  createCompany,
  createTestContext,
  createUser,
  setCookieValue,
  signIn,
  type TestContext,
} from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  const rows = await ctx.owner.client<{ user_id: string }[]>`
    select user_id from password_credentials where username like 'pw-%'`;
  for (const row of rows) ctx.track.user(row.user_id);
  await ctx.cleanup();
});
afterAll(async () => {
  await ctx?.close();
});

const ORIGIN = { origin: 'http://localhost:3000' };
const PASSWORD = 'curbs-and-roofs-2026';

function account(label = 'sam') {
  const id = crypto.randomUUID().slice(0, 8);
  return {
    displayName: 'Sam Alam',
    username: `pw-${label}-${id}`,
    email: `pw-${label}-${id}@example.test`,
    phone: '(469) 555-0100',
    password: PASSWORD,
  };
}

async function signUp(body: Record<string, unknown>) {
  return call(ctx, 'POST', '/v1/auth/password/sign-up', { body, headers: ORIGIN });
}
async function signInWith(body: Record<string, unknown>) {
  return call(ctx, 'POST', '/v1/auth/password/sign-in', { body, headers: ORIGIN });
}
function cookieOf(res: Awaited<ReturnType<typeof call>>) {
  const value = setCookieValue(res, 'fl_session');
  if (!value) throw new Error('no session cookie');
  return { cookie: value };
}

describe('create account', () => {
  it('creates the user, stores only a password hash and signs in', async () => {
    const body = account();
    const res = await signUp(body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ redirectTo: '/' });
    const raw = String(res.headers['set-cookie']);
    expect(raw).toMatch(/fl_session=.+HttpOnly/);
    expect(raw).toMatch(/Expires=/);

    const me = await call(ctx, 'GET', '/v1/me', { as: cookieOf(res) });
    expect(me.statusCode).toBe(200);
    const parsed = MeResponseSchema.parse(me.json());
    expect(parsed.user.displayName).toBe('Sam Alam');
    expect(parsed.user.email).toBe(body.email);

    const [row] = await ctx.owner.client<{ password_hash: string; phone: string }[]>`
      select c.password_hash, u.phone from password_credentials c join users u on u.id = c.user_id
      where c.username = ${body.username}`;
    expect(row!.password_hash).toMatch(/^scrypt\$/);
    expect(row!.password_hash).not.toContain(PASSWORD);
    expect(row!.phone).toBe('(469) 555-0100');
  });

  it('refuses a taken username (any letter case) and weak passwords', async () => {
    const body = account();
    expect((await signUp(body)).statusCode).toBe(200);
    const again = await signUp({
      ...account(),
      username: body.username.toUpperCase(),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().detail).toContain('username is taken');
    const weak = await signUp({ ...account(), password: 'password123' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().detail).toContain('too common');
    const short = await signUp({ ...account(), password: 'short' });
    expect(short.statusCode).toBe(400);
  });

  it('does not let a new password account take over an existing email', async () => {
    const existing = await createUser(ctx, {
      email: `pw-owner-${crypto.randomUUID().slice(0, 6)}@example.test`,
    });
    const res = await signUp({ ...account(), email: existing.email.toUpperCase() });
    expect(res.statusCode).toBe(409);
    expect(res.json().detail).toContain('already exists');
  });
});

describe('sign in', () => {
  it('signs in with the username or the email, in any letter case', async () => {
    const body = account();
    await signUp(body);
    const byName = await signInWith({ login: body.username.toUpperCase(), password: PASSWORD });
    expect(byName.statusCode).toBe(200);
    expect((await call(ctx, 'GET', '/v1/me', { as: cookieOf(byName) })).statusCode).toBe(200);
    const byEmail = await signInWith({ login: body.email, password: PASSWORD });
    expect(byEmail.statusCode).toBe(200);
  });

  it('gives a browser-session cookie when "keep me signed in" is off', async () => {
    const body = account();
    await signUp(body);
    const res = await signInWith({ login: body.username, password: PASSWORD, remember: false });
    const line = String(res.headers['set-cookie']);
    expect(line).toMatch(/fl_session=/);
    expect(line).not.toMatch(/Expires=/);
  });

  it('answers the same for an unknown user and a wrong password, and locks after five', async () => {
    const body = account();
    await signUp(body);
    const unknown = await signInWith({ login: 'pw-nobody-here', password: PASSWORD });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().detail).toBe('Wrong username or password.');
    for (let i = 0; i < 5; i += 1) {
      const wrong = await signInWith({ login: body.username, password: 'not-the-password' });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().detail).toBe('Wrong username or password.');
    }
    const locked = await signInWith({ login: body.username, password: PASSWORD });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().detail).toMatch(/Try again in 1[45] minutes/);
  });

  it('refuses a deactivated user', async () => {
    const body = account();
    await signUp(body);
    await ctx.owner.client`
      update users set status = 'deactivated'
      where id = (select user_id from password_credentials where username = ${body.username})`;
    const res = await signInWith({ login: body.username, password: PASSWORD });
    expect(res.statusCode).toBe(403);
  });

  it('sends a member of one company straight to its workspace and returns to a safe path', async () => {
    const body = account();
    await signUp(body);
    const [cred] = await ctx.owner.client<{ user_id: string }[]>`
      select user_id from password_credentials where username = ${body.username}`;
    const company = await createCompany(ctx);
    await ctx.owner.client`
      insert into memberships (org_id, user_id, role, status)
      values (${company.orgId}, ${cred!.user_id}, 'finance', 'active')`;
    const res = await signInWith({
      login: body.username,
      password: PASSWORD,
      returnTo: '/billing',
    });
    expect(res.json()).toEqual({ redirectTo: '/billing' });
    const evil = await signInWith({
      login: body.username,
      password: PASSWORD,
      returnTo: '//evil.test/x',
    });
    expect(evil.json()).toEqual({ redirectTo: '/' });
  });

  it('rejects a sign-in posted from another site', async () => {
    const res = await call(ctx, 'POST', '/v1/auth/password/sign-in', {
      body: { login: 'x', password: 'y' },
      headers: { origin: 'https://evil.test' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('set or change a password', () => {
  it('adds a password and username to a Microsoft / Google account', async () => {
    const company = await createCompany(ctx);
    const owner = company.owner;
    const before = await call(ctx, 'GET', '/v1/auth/password', { as: owner });
    expect(before.json()).toEqual({ hasPassword: false, username: null });
    const username = `pw-owner-${crypto.randomUUID().slice(0, 6)}`;
    const noName = await call(ctx, 'PUT', '/v1/auth/password', {
      as: owner,
      headers: ORIGIN,
      body: { newPassword: PASSWORD },
    });
    expect(noName.statusCode).toBe(400);
    const added = await call(ctx, 'PUT', '/v1/auth/password', {
      as: owner,
      headers: ORIGIN,
      body: { newPassword: PASSWORD, username },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toEqual({ hasPassword: true, username });
    // The same person can now also sign in with the username.
    const res = await signInWith({ login: username, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ redirectTo: '/' });
  });

  it('needs the current password to change it and signs out the other devices', async () => {
    const body = account();
    const created = await signUp(body);
    const here = cookieOf(created);
    const otherDevice = cookieOf(await signInWith({ login: body.username, password: PASSWORD }));
    const wrong = await call(ctx, 'PUT', '/v1/auth/password', {
      as: here,
      headers: ORIGIN,
      body: { currentPassword: 'nope-nope-nope', newPassword: 'new-roof-pass-2026' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().detail).toContain('current password is wrong');
    const changed = await call(ctx, 'PUT', '/v1/auth/password', {
      as: here,
      headers: ORIGIN,
      body: { currentPassword: PASSWORD, newPassword: 'new-roof-pass-2026' },
    });
    expect(changed.statusCode).toBe(200);
    expect((await call(ctx, 'GET', '/v1/me', { as: here })).statusCode).toBe(200);
    expect((await call(ctx, 'GET', '/v1/me', { as: otherDevice })).statusCode).toBe(401);
    expect(
      (await signInWith({ login: body.username, password: 'new-roof-pass-2026' })).statusCode,
    ).toBe(200);
  });

  it('works with a session created by the shared test helper', async () => {
    const user = await createUser(ctx);
    const session = await signIn(ctx, user.userId, null);
    const res = await call(ctx, 'GET', '/v1/auth/password', { as: session });
    expect(res.json()).toEqual({ hasPassword: false, username: null });
  });
});
