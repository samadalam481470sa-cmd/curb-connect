// Contract test: the API's mail server client against the real mail server app (apps/mailer),
// wired through Fastify inject, with Google replaced by a scripted fetch. Proves both sides agree on
// the signed tokens, routes and error codes.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMailer, STATE_COOKIE } from '../../../mailer/src/app';
import type { MailerConfig } from '../../../mailer/src/config';
import {
  createProviders,
  GMAIL_SEND_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
} from '../../../mailer/src/providers';
import { MemoryStore } from '../../../mailer/src/store';
import { createMailerClient, MailerError, type FetchLike } from './mailer-client';

const SECRET = 'contract-test-shared-secret-0123456789abcdef';
const owner = { orgId: randomUUID(), userId: randomUUID() };

const mailerConfig: MailerConfig = {
  env: 'test',
  logLevel: 'silent',
  host: '127.0.0.1',
  port: 0,
  publicOrigin: 'http://localhost:4300',
  appOrigin: 'http://localhost:3000',
  trustProxy: false,
  sharedSecret: SECRET,
  tokenKey: Buffer.alloc(32, 9),
  databaseUrl: undefined,
  dataFile: '/dev/null',
  google: { clientId: 'curb-mailer.apps.googleusercontent.com', clientSecret: 'secret' },
  microsoft: null,
};

describe('API <-> mail server contract', () => {
  let app: Awaited<ReturnType<typeof buildMailer>>;
  let gmailStatus = 200;

  const google: FetchLike = async (url) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url === GOOGLE_TOKEN_URL)
      return json({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
        scope: 'openid https://www.googleapis.com/auth/gmail.send',
      });
    if (url === GOOGLE_USERINFO_URL)
      return json({ email: 'office@gmail.com', email_verified: true });
    if (url === GMAIL_SEND_URL)
      return gmailStatus === 200
        ? json({ id: 'm-1' })
        : new Response(null, { status: gmailStatus });
    throw new Error(`unexpected ${url}`);
  };

  /** Routes the client's fetch calls into the mail server app in-process. */
  const viaInject: FetchLike = async (url, init) => {
    const target = new URL(url);
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: target.pathname + target.search,
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      ...(init?.body !== undefined && { payload: String(init.body) }),
    });
    return new Response(res.body || null, {
      status: res.statusCode,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = () =>
    createMailerClient(
      {
        url: 'http://mailer.internal:4300',
        publicOrigin: 'http://localhost:4300',
        sharedSecret: SECRET,
      },
      viaInject,
    );

  beforeEach(async () => {
    gmailStatus = 200;
    app = await buildMailer({
      config: mailerConfig,
      store: new MemoryStore(),
      providers: createProviders(mailerConfig, google),
      logger: false,
    });
  });
  afterEach(async () => {
    await app.close();
  });

  /** Google sign-in through the mail server; returns the pending id the app must confirm. */
  async function signInGmail() {
    const url = new URL(await client().connectUrl(owner, 'gmail', '/settings/email'));
    expect(url.origin).toBe('http://localhost:4300');
    const start = await app.inject({ method: 'GET', url: url.pathname + url.search });
    const state = new URL(start.headers.location as string).searchParams.get('state');
    const cookie = start.cookies.find((c) => c.name === STATE_COOKIE)!;
    const done = await app.inject({
      method: 'GET',
      url: `/oauth/gmail/callback?code=c&state=${state}`,
      cookies: { [STATE_COOKIE]: cookie.value },
    });
    const pending = new URL(done.headers.location as string).searchParams.get('pending')!;
    return pending;
  }

  async function connectGmail() {
    const list = await client().confirm(owner, await signInGmail());
    expect(list.items).toHaveLength(1);
  }

  it('refuses to attach a mailbox to a member who did not start the sign-in', async () => {
    const pending = await signInGmail();
    const stranger = { orgId: owner.orgId, userId: randomUUID() };
    const err = await client()
      .confirm(stranger, pending)
      .catch((e: unknown) => e);
    expect((err as MailerError).code).toBe('rejected');
    expect((await client().list(owner)).items).toEqual([]);
  });

  it('lists, connects and sends with signed requests', async () => {
    expect((await client().list(owner)).items).toEqual([]);
    await connectGmail();
    const list = await client().list(owner);
    expect(list).toMatchObject({
      available: true,
      defaultProvider: 'gmail',
      items: [{ email: 'office@gmail.com' }],
    });
    const sent = await client().send(owner, {
      mailbox: null,
      to: 'ap@partner.test',
      subject: 'Invoice INV-1',
      text: 'Attached.',
      attachments: [],
      idempotencyKey: 'invoice-email:x:1',
    });
    expect(sent).toEqual({
      status: 'sent',
      provider: 'gmail',
      mailboxId: 'gmail:office@gmail.com',
      from: 'office@gmail.com',
      providerMessageId: 'm-1',
    });
  });

  it('surfaces mail server refusals as typed errors', async () => {
    const err = await client()
      .send(owner, {
        mailbox: 'gmail',
        to: 'ap@partner.test',
        subject: 's',
        text: 't',
        attachments: [],
        idempotencyKey: 'invoice-email:y:1',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailerError);
    expect((err as MailerError).code).toBe('not_connected');

    await connectGmail();
    gmailStatus = 500;
    const unknown = await client()
      .send(owner, {
        mailbox: 'gmail',
        to: 'ap@partner.test',
        subject: 's',
        text: 't',
        attachments: [],
        idempotencyKey: 'invoice-email:z:1',
      })
      .catch((e: unknown) => e);
    expect((unknown as MailerError).code).toBe('unknown');
  });

  it('picks a mailbox by address, switches the default and disconnects one address', async () => {
    await connectGmail();
    const list = await client().setDefault(owner, 'gmail:office@gmail.com');
    expect(list.defaultMailboxId).toBe('gmail:office@gmail.com');
    const sent = await client().send(owner, {
      mailbox: 'gmail:office@gmail.com',
      to: 'ap@partner.test',
      subject: 'Invoice INV-2',
      text: 'Attached.',
      attachments: [],
      idempotencyKey: 'invoice-email:w:1',
    });
    expect(sent.mailboxId).toBe('gmail:office@gmail.com');
    const after = await client().disconnect(owner, 'gmail:office@gmail.com');
    expect(after.items).toEqual([]);
    expect(after.defaultMailboxId).toBeNull();
  });

  it('passes a login hint in the connect ticket', async () => {
    const url = new URL(
      await client().connectUrl(owner, 'gmail', '/settings/email', 'office@gmail.com'),
    );
    const start = await app.inject({ method: 'GET', url: url.pathname + url.search });
    const google = new URL(start.headers.location as string);
    expect(google.searchParams.get('login_hint')).toBe('office@gmail.com');
  });

  it('is rejected by a mail server with a different shared secret', async () => {
    const wrong = createMailerClient(
      { url: 'http://m', publicOrigin: 'http://m', sharedSecret: 'w'.repeat(40) },
      viaInject,
    );
    const err = await wrong.list(owner).catch((e: unknown) => e);
    expect((err as MailerError).code).toBe('unavailable');
  });

  it('reports the feature as unavailable when the API has no mail server settings', async () => {
    const off = createMailerClient(null);
    expect(off.available).toBe(false);
    expect((await off.list(owner)).available).toBe(false);
    await expect(off.connectUrl(owner, 'gmail', '/settings/email')).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});
