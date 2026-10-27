import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientsFromEnv, createDevIdp, DEV_CLIENT_ID_DEFAULT, DEV_IDENTITIES } from './index';

const REDIRECT = 'http://localhost:4000/v1/auth/callback/dev';

/** Tiny cookie jar: good enough for one provider on one host. */
class Jar {
  private readonly cookies = new Map<string, string>();
  store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url');

describe('@fieldline/dev-idp', () => {
  let server: Server;
  let issuer: string;

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const idp = createDevIdp({
      issuer,
      clients: [{ clientId: DEV_CLIENT_ID_DEFAULT, redirectUris: [REDIRECT] }],
    });
    server.on('request', idp.handler);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves an OpenID discovery document for its issuer with PKCE S256', async () => {
    const res = await fetch(`${issuer}/.well-known/openid-configuration`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc.issuer).toBe(issuer);
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
    expect(doc.jwks_uri).toBe(`${issuer}/jwks`);
  });

  it('labels every page DEVELOPMENT ONLY', async () => {
    const res = await fetch(`${issuer}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('DEVELOPMENT ONLY');
  });

  it('seeds four fictional identities matching the API demo seed (owner, reviewer, estimator of A; owner of B)', () => {
    expect(DEV_IDENTITIES.map((i) => i.sub)).toEqual([
      'demo-roof-owner',
      'demo-roof-reviewer',
      'demo-roof-estimator',
      'demo-curb-owner',
    ]);
    for (const identity of DEV_IDENTITIES) expect(identity.email).toBe(`${identity.sub}@example.test`);
  });

  it('rejects an authorization request without PKCE', async () => {
    const params = new URLSearchParams({
      client_id: DEV_CLIENT_ID_DEFAULT,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid',
      state: 'state-no-pkce',
      nonce: 'nonce-no-pkce',
    });
    const res = await fetch(`${issuer}/auth?${params}`, { redirect: 'manual' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('error_description')).toMatch(/PKCE/);
  });

  it('completes code + PKCE login through the login screen and issues an ID token with the nonce', async () => {
    const jar = new Jar();
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const nonce = b64url(randomBytes(16));
    const state = b64url(randomBytes(16));
    const params = new URLSearchParams({
      client_id: DEV_CLIENT_ID_DEFAULT,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    let res = await fetch(`${issuer}/auth?${params}`, { redirect: 'manual' });
    jar.store(res);
    expect(res.status).toBe(303);
    const interaction = new URL(res.headers.get('location')!, issuer);
    expect(interaction.pathname).toMatch(/^\/interaction\//);

    res = await fetch(interaction, { headers: { cookie: jar.header() } });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Choose a test identity');
    expect(html).toContain('demo-roof-owner');

    // An identity that is not seeded is refused.
    res = await fetch(`${interaction}/login`, {
      method: 'POST',
      headers: { cookie: jar.header(), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'sub=somebody-else',
      redirect: 'manual',
    });
    expect(res.status).toBe(400);

    res = await fetch(`${interaction}/login`, {
      method: 'POST',
      headers: { cookie: jar.header(), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'sub=demo-roof-owner',
      redirect: 'manual',
    });
    jar.store(res);
    expect(res.status).toBe(303);

    // Follow the resume redirect(s) until the provider sends the browser back to the client.
    let next = new URL(res.headers.get('location')!, issuer);
    for (let hop = 0; hop < 5 && next.origin === issuer; hop += 1) {
      res = await fetch(next, { headers: { cookie: jar.header() }, redirect: 'manual' });
      jar.store(res);
      expect([302, 303]).toContain(res.status);
      next = new URL(res.headers.get('location')!, issuer);
    }
    expect(next.origin + next.pathname).toBe(REDIRECT);
    expect(next.searchParams.get('state')).toBe(state);
    const code = next.searchParams.get('code');
    expect(code).toBeTruthy();

    const token = await fetch(`${issuer}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: REDIRECT,
        client_id: DEV_CLIENT_ID_DEFAULT,
        code_verifier: verifier,
      }),
    });
    expect(token.status).toBe(200);
    const body = (await token.json()) as { id_token: string };
    const claims = JSON.parse(Buffer.from(body.id_token.split('.')[1]!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(claims).toMatchObject({
      iss: issuer,
      aud: DEV_CLIENT_ID_DEFAULT,
      sub: 'demo-roof-owner',
      nonce,
      email: 'demo-roof-owner@example.test',
      email_verified: true,
    });

    // The code is single-use.
    const replay = await fetch(`${issuer}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: REDIRECT,
        client_id: DEV_CLIENT_ID_DEFAULT,
        code_verifier: verifier,
      }),
    });
    expect(replay.status).toBe(400);
  });

  it('reads its client from env with a public PKCE client by default', () => {
    expect(clientsFromEnv({})).toEqual([
      expect.objectContaining({ clientId: DEV_CLIENT_ID_DEFAULT, clientSecret: undefined }),
    ]);
    expect(clientsFromEnv({ DEV_IDP_CLIENT_ID: 'x', DEV_IDP_CLIENT_SECRET: 's', DEV_IDP_REDIRECT_URIS: 'http://a/cb' })).toEqual([
      expect.objectContaining({ clientId: 'x', clientSecret: 's', redirectUris: ['http://a/cb'] }),
    ]);
  });

  it('refuses to start in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => createDevIdp({ issuer: 'http://localhost:4100' })).toThrow(/production/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
