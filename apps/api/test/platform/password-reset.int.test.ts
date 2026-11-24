// Password reset by email (item 11). The test server has no SMTP configured, so the forgot
// endpoint must say so honestly and create no token. The reset endpoint is exercised with a
// token row inserted directly (only its hash), covering single-use, expiry, session revocation
// and that sign-in works with the new password afterwards.
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { call, createTestContext, setCookieValue, type TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  const rows = await ctx.owner.client<{ user_id: string }[]>`
    select user_id from password_credentials where username like 'rst-%'`;
  for (const row of rows) ctx.track.user(row.user_id);
  await ctx.cleanup();
});
afterAll(async () => {
  await ctx?.close();
});

const ORIGIN = { origin: 'http://localhost:3000' };
const PASSWORD = 'curbs-and-roofs-2026';
const NEW_PASSWORD = 'new-roofs-and-curbs-2027';

function account() {
  const id = crypto.randomUUID().slice(0, 8);
  return {
    displayName: 'Sam Alam',
    username: `rst-${id}`,
    email: `rst-${id}@example.test`,
    phone: '(469) 555-0100',
    password: PASSWORD,
    ageConfirmed: true,
  };
}

async function signUp(body: Record<string, unknown>) {
  return call(ctx, 'POST', '/v1/auth/password/sign-up', { body, headers: ORIGIN });
}
function cookieOf(res: Awaited<ReturnType<typeof call>>) {
  const value = setCookieValue(res, 'fl_session');
  if (!value) throw new Error('no session cookie');
  return { cookie: value };
}

async function userIdOf(username: string): Promise<string> {
  const [row] = await ctx.owner.client<{ user_id: string }[]>`
    select user_id from password_credentials where username = ${username}`;
  if (!row) throw new Error('no credential');
  return row.user_id;
}

async function insertReset(userId: string, token: string, expiresInHours: number): Promise<void> {
  const hash = createHash('sha256').update(token).digest('hex');
  await ctx.owner.client`
    insert into public.password_resets (id, user_id, token_hash, expires_at)
    values (gen_random_uuid(), ${userId}, ${hash}, now() + make_interval(hours => ${expiresInHours}))`;
}

describe('password reset by email', () => {
  it('says email is not configured and creates no token when SMTP is unset', async () => {
    const body = account();
    await signUp(body);
    const res = await call(ctx, 'POST', '/v1/auth/password/forgot', {
      body: { email: body.email },
      headers: ORIGIN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: false, emailConfigured: false });
    const userId = await userIdOf(body.username);
    const rows = await ctx.owner.client`select id from public.password_resets where user_id = ${userId}`;
    expect(rows).toHaveLength(0);
  });

  it('resets the password once, signs out every device, and the new password signs in', async () => {
    const body = account();
    const signedUp = await signUp(body);
    const session = cookieOf(signedUp);
    const userId = await userIdOf(body.username);
    const token = `reset-token-${crypto.randomUUID()}`;
    await insertReset(userId, token, 1);

    const res = await call(ctx, 'POST', '/v1/auth/password/reset', {
      body: { token, newPassword: NEW_PASSWORD },
      headers: ORIGIN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reset: true });

    // The session from sign-up is revoked.
    const me = await call(ctx, 'GET', '/v1/me', { as: session });
    expect(me.statusCode).toBe(401);

    // The token cannot be used twice.
    const again = await call(ctx, 'POST', '/v1/auth/password/reset', {
      body: { token, newPassword: NEW_PASSWORD },
      headers: ORIGIN,
    });
    expect(again.statusCode).toBe(400);
    expect(again.json().code).toBe('reset_link_invalid');

    // Old password fails, new password signs in (login still works after reset).
    const oldLogin = await call(ctx, 'POST', '/v1/auth/password/sign-in', {
      body: { login: body.username, password: PASSWORD },
      headers: ORIGIN,
    });
    expect(oldLogin.statusCode).toBe(400);
    const newLogin = await call(ctx, 'POST', '/v1/auth/password/sign-in', {
      body: { login: body.username, password: NEW_PASSWORD },
      headers: ORIGIN,
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('rejects an expired reset link', async () => {
    const body = account();
    await signUp(body);
    const userId = await userIdOf(body.username);
    const token = `reset-token-${crypto.randomUUID()}`;
    await insertReset(userId, token, -1);
    const res = await call(ctx, 'POST', '/v1/auth/password/reset', {
      body: { token, newPassword: NEW_PASSWORD },
      headers: ORIGIN,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('reset_link_invalid');
  });
});
