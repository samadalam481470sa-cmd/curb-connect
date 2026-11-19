import { randomUUID } from 'node:crypto';
import {
  MAILER_CONNECT_AUDIENCE,
  MAILER_ISSUER,
  MAILER_SERVICE_AUDIENCE,
  type MailboxProvider,
} from '@fieldline/contracts';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMailer, STATE_COOKIE } from './app';
import type { MailerConfig } from './config';
import {
  createProviders,
  GMAIL_SEND_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  GRAPH_ME_URL,
  GRAPH_SEND_URL,
} from './providers';
import { MemoryStore } from './store';

const SECRET = 'test-shared-secret-that-is-long-enough-0123456789';
const ORG = randomUUID();
const USER = randomUUID();

const config: MailerConfig = {
  env: 'test',
  logLevel: 'silent',
  host: '127.0.0.1',
  port: 0,
  publicOrigin: 'http://localhost:4300',
  appOrigin: 'http://localhost:3000',
  trustProxy: false,
  sharedSecret: SECRET,
  tokenKey: Buffer.alloc(32, 7),
  databaseUrl: undefined,
  dataFile: '/dev/null',
  google: { clientId: 'new-google-client.apps.googleusercontent.com', clientSecret: 'g-secret' },
  microsoft: {
    clientId: '00000000-1111-2222-3333-444444444444',
    clientSecret: 'm-secret',
    tenant: 'common',
  },
};

interface Call {
  url: string;
  init?: RequestInit;
}

/** Scripted stand-in for Google and Microsoft. Each test sets the responses it needs. */
function fakeProviders() {
  const calls: Call[] = [];
  const routes = new Map<string, () => Response>();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  routes.set(GOOGLE_TOKEN_URL, () =>
    json({
      access_token: 'g-access',
      refresh_token: 'g-refresh',
      expires_in: 3600,
      scope:
        'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send',
    }),
  );
  routes.set(GOOGLE_USERINFO_URL, () =>
    json({ email: 'Owner@Gmail.com', email_verified: true, name: 'Roof Owner' }),
  );
  routes.set(GMAIL_SEND_URL, () => json({ id: 'gmail-msg-1' }));
  routes.set('https://login.microsoftonline.com/common/oauth2/v2.0/token', () =>
    json({
      access_token: 'm-access',
      refresh_token: 'm-refresh',
      expires_in: 3600,
      scope:
        'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read openid email profile',
    }),
  );
  routes.set(GRAPH_ME_URL, () =>
    json({ mail: null, userPrincipalName: 'owner@outlook.com', displayName: 'Roof Owner' }),
  );
  routes.set(GRAPH_SEND_URL, () => new Response(null, { status: 202 }));
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init && { init }) });
    const route = routes.get(url);
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  };
  return { calls, routes, json, fetchImpl };
}

async function serviceToken(method: string, path: string, org = ORG, usr = USER) {
  return new SignJWT({ org, usr, req: `${method} ${path}` })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(MAILER_ISSUER)
    .setAudience(MAILER_SERVICE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('1m')
    .sign(new TextEncoder().encode(SECRET));
}

async function connectTicket(
  provider: MailboxProvider,
  opts: { ret?: string; secret?: string } = {},
) {
  return new SignJWT({ org: ORG, usr: USER, prv: provider, ret: opts.ret ?? '/settings/email' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(MAILER_ISSUER)
    .setAudience(MAILER_CONNECT_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

describe('mail server', () => {
  let store: MemoryStore;
  let fake: ReturnType<typeof fakeProviders>;
  let app: Awaited<ReturnType<typeof buildMailer>>;

  beforeEach(async () => {
    store = new MemoryStore();
    fake = fakeProviders();
    app = await buildMailer({
      config,
      store,
      providers: createProviders(config, fake.fetchImpl),
      logger: false,
    });
  });
  afterEach(async () => {
    await app.close();
  });

  /** Google / Microsoft sign-in, ending on the app page with a pending connection id. */
  async function signIn(provider: MailboxProvider) {
    const start = await app.inject({
      method: 'GET',
      url: `/connect/${provider}?ticket=${await connectTicket(provider)}`,
    });
    expect(start.statusCode).toBe(303);
    const authorize = new URL(start.headers.location as string);
    const state = authorize.searchParams.get('state')!;
    const cookie = start.cookies.find((c) => c.name === STATE_COOKIE)!;
    const done = await app.inject({
      method: 'GET',
      url: `/oauth/${provider}/callback?code=auth-code&state=${state}`,
      cookies: { [STATE_COOKIE]: cookie.value },
    });
    const back = new URL(done.headers.location as string);
    return { start, authorize, done, pending: back.searchParams.get('pending') };
  }

  async function confirm(pending: string | null, org = ORG, usr = USER) {
    return app.inject({
      method: 'POST',
      url: '/internal/mailboxes/confirm',
      headers: {
        authorization: `Bearer ${await serviceToken('POST', '/internal/mailboxes/confirm', org, usr)}`,
      },
      payload: { pending },
    });
  }

  /** Full connect: sign-in, then the same member confirms from their Field Pro session. */
  async function connect(provider: MailboxProvider) {
    const result = await signIn(provider);
    const confirmed = await confirm(result.pending);
    expect(confirmed.statusCode).toBe(200);
    return { ...result, confirmed };
  }

  async function send(body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/internal/send',
      headers: { authorization: `Bearer ${await serviceToken('POST', '/internal/send')}` },
      payload: {
        provider: null,
        to: 'accounts@customer.test',
        subject: 'Invoice INV-2026-0001',
        text: 'Please find the invoice attached.',
        fromName: 'Acme Roofing',
        attachments: [
          {
            filename: 'INV-2026-0001.pdf',
            contentType: 'application/pdf',
            contentBase64: Buffer.from('%PDF-1.7 test').toString('base64'),
          },
        ],
        idempotencyKey: 'invoice-email:abc:1',
        ...body,
      },
    });
  }

  it('sends Gmail sign-in to Google with PKCE, offline access and only the send scope', async () => {
    const { authorize } = await connect('gmail');
    expect(authorize.origin + authorize.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    const p = authorize.searchParams;
    expect(p.get('client_id')).toBe(config.google!.clientId);
    expect(p.get('redirect_uri')).toBe('http://localhost:4300/oauth/gmail/callback');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('scope')).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(p.get('scope')).not.toContain('gmail.modify');
    expect(p.get('scope')).not.toContain('mail.google.com');
  });

  it('connects Gmail only after the member confirms, and seals the refresh token', async () => {
    const { done, pending } = await signIn('gmail');
    expect(done.statusCode).toBe(303);
    expect(done.headers.location).toMatch(
      /^http:\/\/localhost:3000\/settings\/email\?mailbox=confirm&provider=gmail&pending=/,
    );
    expect(await store.listMailboxes(ORG, USER)).toHaveLength(0);
    expect((await confirm(pending)).json().items[0]).toMatchObject({
      provider: 'gmail',
      isDefault: true,
    });
    const [row] = await store.listMailboxes(ORG, USER);
    expect(row?.email).toBe('owner@gmail.com');
    expect(row?.sealedRefreshToken).not.toContain('g-refresh');
    expect(await store.getDefault(ORG, USER)).toBe('gmail');
    const exchange = fake.calls.find((c) => c.url === GOOGLE_TOKEN_URL)!;
    const form = new URLSearchParams(String(exchange.init?.body));
    expect(form.get('code_verifier')).toBeTruthy();
    expect(form.get('client_secret')).toBe('g-secret');
  });

  it('connects a personal Outlook account using its user principal name', async () => {
    const { authorize, done } = await connect('outlook');
    expect(authorize.hostname).toBe('login.microsoftonline.com');
    expect(authorize.pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(authorize.searchParams.get('scope')).toContain('offline_access');
    expect(authorize.searchParams.get('scope')).toContain('https://graph.microsoft.com/Mail.Send');
    expect(done.headers.location).toContain('mailbox=confirm&provider=outlook');
    expect((await store.getMailbox(ORG, USER, 'outlook'))?.email).toBe('owner@outlook.com');
  });

  it('does not connect a forwarded link: another member cannot confirm it', async () => {
    // Someone signs in to Google through a connect link that a different member started.
    const { pending } = await signIn('gmail');
    const other = await confirm(pending, ORG, randomUUID());
    expect(other.statusCode).toBe(422);
    expect(other.json().code).toBe('rejected');
    expect(await store.listMailboxes(ORG, USER)).toHaveLength(0);
    // The pending sign-in is gone, so the starter cannot claim it afterwards either.
    expect((await confirm(pending)).json().code).toBe('not_connected');
  });

  it('uses a pending sign-in once only', async () => {
    const { pending } = await signIn('gmail');
    expect((await confirm(pending)).statusCode).toBe(200);
    expect((await confirm(pending)).statusCode).toBe(409);
    expect((await confirm('not-a-real-pending-id-000000')).json().code).toBe('not_connected');
  });

  it('refuses a reused, forged or mismatched connect ticket', async () => {
    const ticket = await connectTicket('gmail');
    const first = await app.inject({ method: 'GET', url: `/connect/gmail?ticket=${ticket}` });
    expect(first.headers.location).toContain('accounts.google.com');
    const again = await app.inject({ method: 'GET', url: `/connect/gmail?ticket=${ticket}` });
    expect(again.headers.location).toContain('reason=expired');
    const forged = await app.inject({
      method: 'GET',
      url: `/connect/gmail?ticket=${await connectTicket('gmail', { secret: 'x'.repeat(40) })}`,
    });
    expect(forged.headers.location).toContain('reason=expired');
    const wrong = await app.inject({
      method: 'GET',
      url: `/connect/outlook?ticket=${await connectTicket('gmail')}`,
    });
    expect(wrong.headers.location).toContain('reason=expired');
  });

  it('never redirects outside the app after sign-in', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/connect/gmail?ticket=${await connectTicket('gmail', { ret: '//evil.test/x' })}`,
    });
    const state = new URL(res.headers.location as string).searchParams.get('state');
    const cookie = res.cookies.find((c) => c.name === STATE_COOKIE)!;
    const done = await app.inject({
      method: 'GET',
      url: `/oauth/gmail/callback?code=c&state=${state}`,
      cookies: { [STATE_COOKIE]: cookie.value },
    });
    expect(done.headers.location).toMatch(/^http:\/\/localhost:3000\/settings\/email\?/);
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/connect/gmail?ticket=${await connectTicket('gmail')}`,
    });
    const cookie = res.cookies.find((c) => c.name === STATE_COOKIE)!;
    const done = await app.inject({
      method: 'GET',
      url: '/oauth/gmail/callback?code=c&state=forged',
      cookies: { [STATE_COOKIE]: cookie.value },
    });
    expect(done.headers.location).toContain('reason=state_mismatch');
    expect(await store.listMailboxes(ORG, USER)).toHaveLength(0);
  });

  it('does not keep a Gmail connection when the send permission was unticked', async () => {
    fake.routes.set(GOOGLE_TOKEN_URL, () =>
      fake.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid email' }),
    );
    fake.routes.set(
      'https://oauth2.googleapis.com/revoke',
      () => new Response(null, { status: 200 }),
    );
    const { done } = await signIn('gmail');
    expect(done.headers.location).toContain('reason=missing_permission');
    expect(await store.listMailboxes(ORG, USER)).toHaveLength(0);
  });

  it('sends through Gmail as a MIME message with the PDF attached', async () => {
    await connect('gmail');
    const res = await send({});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'sent',
      provider: 'gmail',
      from: 'owner@gmail.com',
      providerMessageId: 'gmail-msg-1',
    });
    const call = fake.calls.find((c) => c.url === GMAIL_SEND_URL)!;
    const raw = Buffer.from(JSON.parse(String(call.init?.body)).raw, 'base64url').toString('utf8');
    expect(raw).toContain('From: "Acme Roofing" <owner@gmail.com>');
    expect(raw).toContain('To: accounts@customer.test');
    expect(raw).toContain('Content-Type: multipart/mixed');
    expect(raw).toContain('filename="INV-2026-0001.pdf"');
    expect((call.init?.headers as Record<string, string>).Authorization).toBe('Bearer g-access');
  });

  it('sends through Outlook with a Graph file attachment', async () => {
    await connect('outlook');
    const res = await send({ provider: 'outlook' });
    expect(res.statusCode).toBe(200);
    expect(res.json().from).toBe('owner@outlook.com');
    const body = JSON.parse(String(fake.calls.find((c) => c.url === GRAPH_SEND_URL)!.init?.body));
    expect(body.message.toRecipients[0].emailAddress.address).toBe('accounts@customer.test');
    expect(body.message.attachments[0]).toMatchObject({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'INV-2026-0001.pdf',
    });
    expect(body.saveToSentItems).toBe(true);
  });

  it('sends one idempotency key once, and replays the first result', async () => {
    await connect('gmail');
    expect((await send({})).statusCode).toBe(200);
    const again = await send({});
    expect(again.statusCode).toBe(200);
    expect(again.json().providerMessageId).toBe('gmail-msg-1');
    expect(fake.calls.filter((c) => c.url === GMAIL_SEND_URL)).toHaveLength(1);
  });

  it('reports a possibly-sent message as unknown and never resends that key', async () => {
    await connect('gmail');
    fake.routes.set(GMAIL_SEND_URL, () => new Response('oops', { status: 500 }));
    const first = await send({});
    expect(first.statusCode).toBe(502);
    expect(first.json().code).toBe('unknown');
    fake.routes.set(GMAIL_SEND_URL, () => fake.json({ id: 'later' }));
    const retry = await send({});
    expect(retry.json().code).toBe('unknown');
    expect(fake.calls.filter((c) => c.url === GMAIL_SEND_URL)).toHaveLength(1);
  });

  it('lets a throttled send be retried with the same key', async () => {
    await connect('gmail');
    fake.routes.set(GMAIL_SEND_URL, () => new Response(null, { status: 429 }));
    expect((await send({})).json().code).toBe('retry');
    fake.routes.set(GMAIL_SEND_URL, () => fake.json({ id: 'second-try' }));
    const ok = await send({});
    expect(ok.statusCode).toBe(200);
    expect(ok.json().providerMessageId).toBe('second-try');
  });

  it('asks for a reconnect when Google revoked the grant', async () => {
    await connect('gmail');
    // Force a refresh by dropping the cached access token: a new app instance with the same store.
    await app.close();
    app = await buildMailer({
      config,
      store,
      providers: createProviders(config, fake.fetchImpl),
      logger: false,
    });
    fake.routes.set(GOOGLE_TOKEN_URL, () => fake.json({ error: 'invalid_grant' }, 400));
    const res = await send({});
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('reconnect_required');
  });

  it('refuses to send when no mailbox is connected', async () => {
    const res = await send({});
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('not_connected');
  });

  it('requires a service token bound to the exact request', async () => {
    const none = await app.inject({ method: 'GET', url: '/internal/mailboxes' });
    expect(none.statusCode).toBe(401);
    const wrongRoute = await app.inject({
      method: 'GET',
      url: '/internal/mailboxes',
      headers: { authorization: `Bearer ${await serviceToken('POST', '/internal/send')}` },
    });
    expect(wrongRoute.statusCode).toBe(401);
  });

  it('keeps each member and company separate', async () => {
    await connect('gmail');
    const other = await app.inject({
      method: 'GET',
      url: '/internal/mailboxes',
      headers: {
        authorization: `Bearer ${await serviceToken('GET', '/internal/mailboxes', randomUUID(), USER)}`,
      },
    });
    expect(other.json().items).toEqual([]);
  });

  it('lists, switches the default and disconnects mailboxes', async () => {
    await connect('gmail');
    await connect('outlook');
    const auth = async (m: string, p: string) => ({
      authorization: `Bearer ${await serviceToken(m, p)}`,
    });
    const list = await app.inject({
      method: 'GET',
      url: '/internal/mailboxes',
      headers: await auth('GET', '/internal/mailboxes'),
    });
    expect(list.json()).toMatchObject({
      defaultProvider: 'gmail',
      providers: { gmail: true, outlook: true },
    });
    expect(list.json().items).toHaveLength(2);
    const switched = await app.inject({
      method: 'PUT',
      url: '/internal/mailboxes/default',
      headers: await auth('PUT', '/internal/mailboxes/default'),
      payload: { provider: 'outlook' },
    });
    expect(switched.json().defaultProvider).toBe('outlook');
    const removed = await app.inject({
      method: 'DELETE',
      url: '/internal/mailboxes/outlook',
      headers: await auth('DELETE', '/internal/mailboxes/:provider'),
    });
    expect(removed.json()).toMatchObject({
      defaultProvider: 'gmail',
      items: [{ provider: 'gmail', isDefault: true }],
    });
  });
});
