// End-to-end tests against a real HTTP server on a random port, with Google and Microsoft
// replaced by an in-memory fake (no network).
import { request as httpRequest, createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { loadConfig } from './config';
import { Store } from './db';
import type { FetchLike } from './oauth';

const FAST = { N: 1024, r: 8, p: 1 };
const GOOGLE_ID = 'google-client.apps.googleusercontent.com';
const MS_ID = '00000000-0000-0000-0000-00000000c11e';
const MS_TENANT_ISS = 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0';

function jwt(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
}

/** Stands in for Google, Microsoft, Gmail and Graph. */
class FakeProviders {
  calls: { url: string; body: string; auth: string }[] = [];
  /** Claims (minus nonce) for the next ID token, keyed by provider. */
  next: Record<string, Record<string, unknown>> = {};
  nonce = '';
  scope = '';
  gmailFailOnce = 0;
  tokenCounter = 0;

  fetch: FetchLike = async (url, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    this.calls.push({ url, body, auth });
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const isGoogle = url.startsWith('https://oauth2.googleapis.com/token');
    const isMicrosoft = url.includes('login.microsoftonline.com') && url.endsWith('/token');
    if (isGoogle || isMicrosoft) {
      const form = new URLSearchParams(body);
      this.tokenCounter += 1;
      if (form.get('grant_type') === 'refresh_token') {
        return json(200, { access_token: `fresh-access-${this.tokenCounter}`, expires_in: 3600 });
      }
      const base = this.next[isGoogle ? 'google' : 'microsoft'] ?? {};
      return json(200, {
        access_token: `access-${this.tokenCounter}`,
        refresh_token: `refresh-${this.tokenCounter}`,
        expires_in: 3600,
        scope: this.scope,
        id_token: jwt({ ...base, nonce: this.nonce, exp: Math.floor(Date.now() / 1000) + 600 }),
      });
    }
    if (url.startsWith('https://graph.microsoft.com/v1.0/me?')) {
      return json(200, {
        mail: 'owner@contoso.example',
        userPrincipalName: 'owner@contoso.example',
      });
    }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      if (this.gmailFailOnce > 0) {
        this.gmailFailOnce -= 1;
        return json(401, { error: 'invalid_token' });
      }
      return json(200, { id: 'gmail-msg-1' });
    }
    if (url === 'https://graph.microsoft.com/v1.0/me/sendMail')
      return new Response(null, { status: 202 });
    return json(404, { error: 'unexpected url in test' });
  };
}

class Browser {
  cookies = new Map<string, string>();
  constructor(
    readonly base: string,
    readonly origin = base,
  ) {}

  private store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const [name, value] = [
        pair!.slice(0, pair!.indexOf('=')),
        pair!.slice(pair!.indexOf('=') + 1),
      ];
      if (attrs.some((a) => a.trim().toLowerCase() === 'max-age=0')) this.cookies.delete(name);
      else this.cookies.set(name, decodeURIComponent(value));
    }
  }

  private headers(extra: Record<string, string> = {}) {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    return { ...(cookie ? { cookie } : {}), ...extra };
  }

  async get(path: string) {
    const res = await fetch(new URL(path, this.base), {
      redirect: 'manual',
      headers: this.headers(),
    });
    this.store(res);
    return res;
  }

  async post(path: string, form: Record<string, string>, origin = this.origin) {
    const res = await fetch(new URL(path, this.base), {
      method: 'POST',
      redirect: 'manual',
      headers: this.headers({ 'content-type': 'application/x-www-form-urlencoded', origin }),
      body: new URLSearchParams(form).toString(),
    });
    this.store(res);
    return res;
  }

  async postJson(path: string, body: unknown, contentType = 'application/json') {
    const res = await fetch(new URL(path, this.base), {
      method: 'POST',
      redirect: 'manual',
      headers: this.headers({ 'content-type': contentType, origin: this.origin }),
      body: JSON.stringify(body),
    });
    this.store(res);
    return res;
  }

  /** Follows a provider round trip: start, then come back to the callback with a code. */
  async oauth(provider: 'gmail' | 'outlook', purpose: 'signin' | 'connect', fake: FakeProviders) {
    const start = await this.get(`/auth/${provider}/start?purpose=${purpose}`);
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('location')!);
    fake.nonce = authorize.searchParams.get('nonce')!;
    const state = authorize.searchParams.get('state')!;
    return this.get(`/auth/${provider}/callback?code=test-code&state=${encodeURIComponent(state)}`);
  }
}

const SIGNUP = {
  fullName: 'Sam Alam',
  username: 'samroofing',
  email: 'Sam@Example.com',
  phone: '(469) 555-0100',
  company: 'Alam Roofing & Concrete',
  password: 'curbs-and-roofs-2026',
  confirm: 'curbs-and-roofs-2026',
  remember: '1',
};

let server: Server;
let store: Store;
let base: string;
let fake: FakeProviders;

beforeEach(async () => {
  fake = new FakeProviders();
  store = new Store(':memory:');
  let handler: ReturnType<typeof createApp> | null = null;
  server = createServer((req, res) => void handler!(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  const config = loadConfig({
    PORT: String(port),
    PUBLIC_URL: base,
    TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
    GOOGLE_CLIENT_ID: GOOGLE_ID,
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
    MICROSOFT_CLIENT_ID: MS_ID,
    MICROSOFT_CLIENT_SECRET: 'test-ms-secret',
  });
  handler = createApp({ config, store, fetchImpl: fake.fetch, passwordCost: FAST });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
});

describe('create account and sign in', () => {
  it('creates an account, saves the information and keeps the user signed in', async () => {
    const browser = new Browser(base);
    const res = await browser.post('/signup', SIGNUP);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/account?notice=welcome');
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('mc_session='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=2592000/);

    const user = store.userByUsernameOrEmail('samroofing')!;
    expect(user).toMatchObject({
      email: 'sam@example.com',
      fullName: 'Sam Alam',
      phone: '(469) 555-0100',
      company: 'Alam Roofing & Concrete',
    });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.passwordHash).not.toContain(SIGNUP.password);

    const account = await browser.get('/account?notice=welcome');
    const html = await account.text();
    expect(html).toContain('Hi, Sam Alam');
    expect(html).toContain('Alam Roofing &amp; Concrete');
    expect(html).toContain('Your account is ready.');
  });

  it('rejects bad sign-up input and duplicates', async () => {
    const browser = new Browser(base);
    const mismatch = await browser.post('/signup', { ...SIGNUP, confirm: 'different-pass-1' });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).toContain('do not match');
    expect(await (await browser.post('/signup', { ...SIGNUP, username: 'x' })).text()).toContain(
      '3 to 32',
    );
    expect((await browser.post('/signup', SIGNUP)).status).toBe(303);
    const again = await new Browser(base).post('/signup', {
      ...SIGNUP,
      email: 'other@example.com',
    });
    expect(await again.text()).toContain('username is taken');
    const sameEmail = await new Browser(base).post('/signup', { ...SIGNUP, username: 'other' });
    expect(await sameEmail.text()).toContain('already exists');
  });

  it('signs in with username or email, and a session-only cookie without remember me', async () => {
    await new Browser(base).post('/signup', SIGNUP);
    const byName = await new Browser(base).post('/signin', {
      login: 'SamRoofing',
      password: SIGNUP.password,
    });
    expect(byName.status).toBe(303);
    const cookie = byName.headers.getSetCookie().find((c) => c.startsWith('mc_session='))!;
    expect(cookie).not.toMatch(/Max-Age/);

    const browser = new Browser(base);
    const byEmail = await browser.post('/signin', {
      login: 'sam@example.com',
      password: SIGNUP.password,
      remember: '1',
    });
    expect(byEmail.headers.get('location')).toBe('/account');
    expect((await browser.get('/account')).status).toBe(200);
    expect(store.userByUsernameOrEmail('samroofing')!.lastSignInAt).not.toBeNull();
  });

  it('refuses wrong passwords and locks after five failures', async () => {
    await new Browser(base).post('/signup', SIGNUP);
    const browser = new Browser(base);
    for (let i = 0; i < 5; i += 1) {
      const res = await browser.post('/signin', {
        login: 'samroofing',
        password: 'wrong-password',
      });
      expect(res.status).toBe(401);
      expect(await res.text()).toContain('Wrong username or password.');
    }
    const locked = await browser.post('/signin', {
      login: 'samroofing',
      password: SIGNUP.password,
    });
    expect(locked.status).toBe(429);
    expect(
      (await new Browser(base).post('/signin', { login: 'nobody', password: 'x' })).status,
    ).toBe(401);
  });

  it('signs out and the old session stops working', async () => {
    const browser = new Browser(base);
    await browser.post('/signup', SIGNUP);
    const token = browser.cookies.get('mc_session')!;
    const out = await browser.post('/signout', {});
    expect(out.headers.get('location')).toBe('/signin?notice=signed_out');
    const stale = new Browser(base);
    stale.cookies.set('mc_session', token);
    expect((await stale.get('/account')).headers.get('location')).toBe('/signin');
  });

  it('changes the password and signs out other devices', async () => {
    const browser = new Browser(base);
    await browser.post('/signup', SIGNUP);
    const other = new Browser(base);
    await other.post('/signin', { login: 'samroofing', password: SIGNUP.password });
    const wrong = await browser.post('/account/password', {
      current: 'nope-nope-nope',
      password: 'new-password-2026',
      confirm: 'new-password-2026',
    });
    expect(wrong.status).toBe(400);
    const changed = await browser.post('/account/password', {
      current: SIGNUP.password,
      password: 'new-password-2026',
      confirm: 'new-password-2026',
    });
    expect(changed.headers.get('location')).toBe('/account?notice=password');
    expect((await browser.get('/account')).status).toBe(200);
    expect((await other.get('/account')).status).toBe(303);
    expect(
      (
        await new Browser(base).post('/signin', {
          login: 'samroofing',
          password: 'new-password-2026',
        })
      ).status,
    ).toBe(303);
  });

  it('updates profile information', async () => {
    const browser = new Browser(base);
    await browser.post('/signup', SIGNUP);
    const res = await browser.post('/account/profile', {
      fullName: 'Samad Alam',
      email: 'samad@example.com',
      phone: '469-555-0199',
      company: 'Curb Connect',
    });
    expect(res.headers.get('location')).toBe('/account?notice=saved');
    expect(store.userByUsernameOrEmail('samroofing')).toMatchObject({
      fullName: 'Samad Alam',
      email: 'samad@example.com',
      company: 'Curb Connect',
    });
  });
});

describe('request protections', () => {
  it('rejects posts from other sites and form posts to JSON routes', async () => {
    const browser = new Browser(base);
    expect((await browser.post('/signup', SIGNUP, 'https://evil.example')).status).toBe(403);
    await browser.post('/signup', SIGNUP);
    expect((await browser.post('/signout', {}, 'null')).status).toBe(403);
    const formToJson = await browser.postJson(
      '/api/invoices/send',
      {},
      'application/x-www-form-urlencoded',
    );
    expect(formToJson.status).toBe(415);
  });

  it('rejects unknown Host headers (DNS rebinding)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        `${base}/signin`,
        { headers: { host: 'attacker.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(421);
  });

  it('sends a strict CSP with no scripts', async () => {
    const res = await new Browser(base).get('/signin');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
    const html = await res.text();
    expect(html).not.toContain('<script');
    expect(html).toContain('Sign in with Google (Gmail)');
    expect(html).toContain('Sign in with Microsoft (Outlook)');
  });

  it('API routes need a session', async () => {
    const res = await new Browser(base).get('/api/me');
    expect(res.status).toBe(401);
  });
});

describe('Google and Microsoft sign-in', () => {
  it('creates an account from Google and signs back into the same one', async () => {
    fake.next.google = {
      iss: 'https://accounts.google.com',
      aud: GOOGLE_ID,
      sub: 'google-sub-1',
      email: 'crew.lead@gmail.com',
      email_verified: true,
      name: 'Crew Lead',
    };
    const browser = new Browser(base);
    const first = await browser.oauth('gmail', 'signin', fake);
    expect(first.headers.get('location')).toBe('/account?notice=welcome');
    const user = store.userByEmail('crew.lead@gmail.com')!;
    expect(user).toMatchObject({
      username: 'crew.lead',
      fullName: 'Crew Lead',
      passwordHash: null,
    });

    const again = new Browser(base);
    const second = await again.oauth('gmail', 'signin', fake);
    expect(second.headers.get('location')).toBe('/account');
    const me = (await (await again.get('/api/me')).json()) as { user: { username: string } };
    expect(me.user.username).toBe('crew.lead');

    const tokenCall = fake.calls.find((c) =>
      c.url.startsWith('https://oauth2.googleapis.com/token'),
    )!;
    const sent = new URLSearchParams(tokenCall.body);
    expect(sent.get('code_verifier')).toBeTruthy();
    expect(sent.get('redirect_uri')).toBe(`${base}/auth/gmail/callback`);
  });

  it('refuses a callback that was not started in this browser', async () => {
    fake.next.google = {
      iss: 'https://accounts.google.com',
      aud: GOOGLE_ID,
      sub: 's',
      email: 'a@b.co',
    };
    const starter = new Browser(base);
    const start = await starter.get('/auth/gmail/start?purpose=signin');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const victim = new Browser(base);
    const res = await victim.get(`/auth/gmail/callback?code=x&state=${state}`);
    expect(res.status).toBe(400);
    expect(store.userByEmail('a@b.co')).toBeNull();
  });

  it('rejects an ID token for another app', async () => {
    fake.next.google = {
      iss: 'https://accounts.google.com',
      aud: 'someone-else',
      sub: 's2',
      email: 'x@gmail.com',
      email_verified: true,
    };
    const res = await new Browser(base).oauth('gmail', 'signin', fake);
    expect(res.status).toBe(502);
    expect(store.userByEmail('x@gmail.com')).toBeNull();
  });

  it('does not attach an unverified Microsoft email to an existing account', async () => {
    await new Browser(base).post('/signup', SIGNUP);
    fake.next.microsoft = {
      iss: MS_TENANT_ISS,
      aud: MS_ID,
      sub: 'ms-sub-1',
      email: 'sam@example.com',
    };
    const res = await new Browser(base).oauth('outlook', 'signin', fake);
    expect(res.status).toBe(409);
    expect(store.identity('microsoft', 'ms-sub-1')).toBeNull();
  });

  it('links Microsoft sign-in from the account page', async () => {
    const browser = new Browser(base);
    await browser.post('/signup', SIGNUP);
    fake.next.microsoft = {
      iss: MS_TENANT_ISS,
      aud: MS_ID,
      sub: 'ms-sub-2',
      preferred_username: 'sam@outlook.com',
    };
    const res = await browser.oauth('outlook', 'signin', fake);
    expect(res.headers.get('location')).toBe('/account?notice=linked');
    const owner = store.identity('microsoft', 'ms-sub-2');
    expect(owner).toBe(store.userByUsernameOrEmail('samroofing')!.id);
    const fresh = new Browser(base);
    expect((await fresh.oauth('outlook', 'signin', fake)).headers.get('location')).toBe('/account');
  });
});

describe('Gmail and Outlook invoice email', () => {
  it('connects Gmail, stores tokens encrypted and sends an invoice email', async () => {
    const browser = new Browser(base);
    await browser.post('/signup', SIGNUP);
    fake.scope = 'openid email https://www.googleapis.com/auth/gmail.send';
    fake.next.google = {
      iss: 'https://accounts.google.com',
      aud: GOOGLE_ID,
      sub: 'g-owner',
      email: 'Sam.Alam@gmail.com',
      email_verified: true,
    };
    const connected = await browser.oauth('gmail', 'connect', fake);
    expect(connected.headers.get('location')).toBe('/account?notice=connected_google');
    const user = store.userByUsernameOrEmail('samroofing')!;
    const connection = store.connection(user.id, 'google')!;
    expect(connection.email).toBe('sam.alam@gmail.com');
    const raw = JSON.stringify(store.db.prepare('SELECT * FROM mail_connections').all());
    expect(raw).not.toMatch(/access-\d|refresh-\d/);

    const sent = await browser.post('/account/send', {
      provider: 'google',
      to: 'client@example.com',
      subject: 'Invoice 1042',
      text: 'Curb cut on Main St: $1,450.00\nThank you.',
    });
    expect(sent.headers.get('location')).toBe('/account?notice=sent');
    const gmail = fake.calls.find((c) => c.url.includes('gmail.googleapis.com'))!;
    expect(gmail.auth).toMatch(/^Bearer access-\d+$/);
    const message = Buffer.from(JSON.parse(gmail.body).raw, 'base64url').toString('utf8');
    expect(message).toContain('From: sam.alam@gmail.com\r\n');
    expect(message).toContain('To: client@example.com\r\n');
    expect(message).toContain('Subject: Invoice 1042\r\n');
    expect(await (await browser.get('/account')).text()).toContain(
      'to client@example.com by Gmail',
    );
  });

  it('refuses a Gmail connection that did not grant sending', async () => {
    const browser = new Browser(base);
    await browser.post('/signup', SIGNUP);
    fake.scope = 'openid email';
    fake.next.google = {
      iss: 'https://accounts.google.com',
      aud: GOOGLE_ID,
      sub: 'g',
      email: 'a@gmail.com',
    };
    const res = await browser.oauth('gmail', 'connect', fake);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('did not allow sending');
  });

  it('connects Outlook, then the JSON API refreshes a refused token and retries once', async () => {
    const browser = new Browser(base);
    await browser.post('/signup', SIGNUP);
    fake.scope = 'Mail.Send User.Read openid profile email';
    fake.next.microsoft = {
      iss: MS_TENANT_ISS,
      aud: MS_ID,
      sub: 'm',
      preferred_username: 'x@contoso.example',
    };
    await browser.oauth('outlook', 'connect', fake);
    const user = store.userByUsernameOrEmail('samroofing')!;
    expect(store.connection(user.id, 'microsoft')!.email).toBe('owner@contoso.example');

    const viaApi = await browser.postJson('/api/invoices/send', {
      provider: 'microsoft',
      to: 'gc@builder.example',
      subject: 'Invoice 7',
      text: 'Roof repair',
    });
    expect(viaApi.status).toBe(200);
    expect(await viaApi.json()).toMatchObject({ sent: true, provider: 'microsoft' });

    // Gmail is not connected, so the API says so instead of sending.
    const missing = await browser.postJson('/api/invoices/send', {
      provider: 'google',
      to: 'gc@builder.example',
      subject: 's',
      text: 't',
    });
    expect(missing.status).toBe(409);

    // A 401 from Gmail triggers one refresh and one retry.
    fake.scope = 'openid email https://www.googleapis.com/auth/gmail.send';
    fake.next.google = {
      iss: 'https://accounts.google.com',
      aud: GOOGLE_ID,
      sub: 'g2',
      email: 'o@gmail.com',
    };
    await browser.oauth('gmail', 'connect', fake);
    fake.gmailFailOnce = 1;
    const retried = await browser.postJson('/api/invoices/send', {
      provider: 'google',
      to: 'client@example.com',
      subject: 'Invoice 8',
      text: 'Concrete',
    });
    expect(retried.status).toBe(200);
    const gmailCalls = fake.calls.filter((c) => c.url.includes('gmail.googleapis.com'));
    expect(gmailCalls).toHaveLength(2);
    expect(gmailCalls[1]!.auth).toMatch(/^Bearer fresh-access-/);
  });

  it('disconnects a mailbox', async () => {
    const browser = new Browser(base);
    await browser.post('/signup', SIGNUP);
    fake.scope = 'openid email https://www.googleapis.com/auth/gmail.send';
    fake.next.google = {
      iss: 'https://accounts.google.com',
      aud: GOOGLE_ID,
      sub: 'g3',
      email: 'd@gmail.com',
    };
    await browser.oauth('gmail', 'connect', fake);
    const res = await browser.post('/account/mail/gmail/disconnect', {});
    expect(res.headers.get('location')).toBe('/account?notice=disconnected');
    expect(store.connections(store.userByUsernameOrEmail('samroofing')!.id)).toHaveLength(0);
  });

  it('needs a signed-in user to connect a mailbox', async () => {
    const res = await new Browser(base).get('/auth/gmail/start?purpose=connect');
    expect(res.headers.get('location')).toBe('/signin');
  });
});
