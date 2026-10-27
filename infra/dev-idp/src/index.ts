// Local stand-in OpenID Connect provider (docs/adr/0006). It lets the API's real OIDC code path
// (authorization code + PKCE + state + nonce via openid-client) run on a laptop and in CI before the
// owner registers a Microsoft Entra app. DEVELOPMENT/TEST ONLY: it refuses to run in production.
//
// - One registered client (the API's `dev` provider). PKCE (S256) is required for every request.
// - Seeded fictional identities (./identities.ts); the login screen lets you pick one. No passwords:
//   nothing here is real authentication, which is why it must never be deployed.
// - Signing keys are generated per process, so tokens from a previous run are useless.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import Provider, { type ClientMetadata, type Configuration, type KoaContextWithOIDC } from 'oidc-provider';
import { DEV_IDENTITIES, type DevIdentity } from './identities';
import { errorPage, homePage, loginPage, PAGE_HEADERS } from './views';

export { DEV_IDENTITIES, findIdentity, type DevIdentity } from './identities';

export const DEV_IDP_DEFAULT_PORT = 4100;
/** Must match DEV_IDP_CLIENT_ID in apps/api (its `dev` sign-in provider). */
export const DEV_CLIENT_ID_DEFAULT = 'fieldline-api-dev';
export const DEV_REDIRECT_URIS_DEFAULT = [
  'http://localhost:4000/v1/auth/callback/dev',
  'http://127.0.0.1:4000/v1/auth/callback/dev',
];
const MAX_FORM_BYTES = 4096;

export interface DevClientOptions {
  clientId: string;
  /** Unset = public client (token_endpoint_auth_method none); PKCE protects the code either way. */
  clientSecret?: string | undefined;
  redirectUris: readonly string[];
  postLogoutRedirectUris?: readonly string[];
}

export interface DevIdpOptions {
  /** Public base URL; must exactly match what clients use for discovery (no trailing slash). */
  issuer: string;
  clients?: readonly DevClientOptions[];
  identities?: readonly DevIdentity[];
}

export interface DevIdp {
  provider: Provider;
  /** Node request listener: the provider plus the login screen. */
  handler: RequestListener;
  identities: readonly DevIdentity[];
}

/** Client list from env (DEV_IDP_CLIENT_ID / DEV_IDP_CLIENT_SECRET / DEV_IDP_REDIRECT_URIS). */
export function clientsFromEnv(env: NodeJS.ProcessEnv = process.env): DevClientOptions[] {
  const list = (value: string | undefined) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  const redirectUris = list(env.DEV_IDP_REDIRECT_URIS);
  return [
    {
      clientId: env.DEV_IDP_CLIENT_ID?.trim() || DEV_CLIENT_ID_DEFAULT,
      clientSecret: env.DEV_IDP_CLIENT_SECRET?.trim() || undefined,
      redirectUris: redirectUris.length > 0 ? redirectUris : DEV_REDIRECT_URIS_DEFAULT,
      postLogoutRedirectUris: list(env.DEV_IDP_POST_LOGOUT_REDIRECT_URIS ?? 'http://localhost:3000/'),
    },
  ];
}

function clientMetadata(client: DevClientOptions): ClientMetadata {
  return {
    client_id: client.clientId,
    client_name: 'Field Pro API (development)',
    ...(client.clientSecret
      ? { client_secret: client.clientSecret, token_endpoint_auth_method: 'client_secret_post' as const }
      : { token_endpoint_auth_method: 'none' as const }),
    redirect_uris: [...client.redirectUris],
    post_logout_redirect_uris: [...(client.postLogoutRedirectUris ?? [])],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    id_token_signed_response_alg: 'RS256',
  };
}

function signingKey() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { ...privateKey.export({ format: 'jwk' }), kid: `dev-${randomUUID()}`, alg: 'RS256', use: 'sig' };
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_FORM_BYTES) throw new Error('form too large');
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, PAGE_HEADERS);
  res.end(html);
}

export function createDevIdp({ issuer, clients, identities = DEV_IDENTITIES }: DevIdpOptions): DevIdp {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('dev-idp is a development stand-in and refuses to run with NODE_ENV=production');
  }
  const registered = clients ?? clientsFromEnv();
  const configuration: Configuration = {
    clients: registered.map(clientMetadata),
    jwks: { keys: [signingKey()] },
    // Ephemeral per-process cookie keys: sessions are throwaway by design.
    cookies: { keys: [randomBytes(32).toString('hex')] },
    claims: {
      openid: ['sub'],
      email: ['email', 'email_verified'],
      profile: ['name', 'preferred_username'],
    },
    // The API reads profile claims from the ID token, not from userinfo.
    conformIdTokenClaims: false,
    // PKCE (S256) for every client, public or confidential (PLT-013 R).
    pkce: { required: () => true },
    responseTypes: ['code'],
    ttl: {
      AuthorizationCode: 60,
      IdToken: 600,
      AccessToken: 600,
      Interaction: 600,
      Session: 8 * 3600,
      Grant: 8 * 3600,
    },
    features: {
      // The library's built-in dev login accepts any username; ours only knows seeded identities.
      devInteractions: { enabled: false },
      rpInitiatedLogout: { enabled: true },
    },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    async findAccount(_ctx, sub) {
      const identity = identities.find((i) => i.sub === sub);
      if (!identity) return undefined;
      return {
        accountId: identity.sub,
        async claims() {
          return {
            sub: identity.sub,
            email: identity.email,
            email_verified: true,
            name: identity.name,
            preferred_username: identity.email,
          };
        },
      };
    },
    // The only client is first-party, so consent is implied (oidc-provider "skip consent" recipe).
    async loadExistingGrant(ctx: KoaContextWithOIDC) {
      const session = ctx.oidc.session;
      const client = ctx.oidc.client;
      if (!session?.accountId || !client) return undefined;
      const grantId = ctx.oidc.result?.consent?.grantId || session.grantIdFor(client.clientId);
      if (grantId) {
        const existing = await ctx.oidc.provider.Grant.find(grantId);
        if (existing) return existing;
      }
      const grant = new ctx.oidc.provider.Grant({ clientId: client.clientId, accountId: session.accountId });
      grant.addOIDCScope('openid email profile');
      await grant.save();
      return grant;
    },
    async renderError(ctx, out) {
      ctx.type = 'html';
      ctx.set('cache-control', 'no-store');
      ctx.body = errorPage(`${String(out.error)}: ${String(out.error_description ?? '')}`);
    },
  };

  const provider = new Provider(issuer, configuration);
  const oidc = provider.callback();

  const handler: RequestListener = (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', issuer);
      const match = /^\/interaction\/([A-Za-z0-9_-]{1,100})(?:\/(login|abort))?$/.exec(url.pathname);
      if (url.pathname === '/' && req.method === 'GET') {
        send(res, 200, homePage(issuer, identities));
        return;
      }
      if (!match) {
        oidc(req, res);
        return;
      }
      const [, uid, action] = match;
      try {
        const details = await provider.interactionDetails(req, res);
        if (details.uid !== uid) throw new Error('interaction mismatch');
        if (req.method === 'GET' && !action) {
          if (details.prompt.name === 'login') {
            send(res, 200, loginPage({ uid: details.uid, clientId: String(details.params.client_id), identities }));
            return;
          }
          // Consent is implied for the first-party client (see loadExistingGrant).
          await provider.interactionFinished(req, res, { consent: {} }, { mergeWithLastSubmission: true });
          return;
        }
        if (req.method === 'POST' && action === 'login') {
          const form = await readForm(req);
          const sub = form.get('sub') ?? '';
          const identity = identities.find((i) => i.sub === sub);
          if (!identity) {
            send(
              res,
              400,
              loginPage({
                uid: details.uid,
                clientId: String(details.params.client_id),
                identities,
                error: 'Pick one of the listed test identities.',
              }),
            );
            return;
          }
          await provider.interactionFinished(
            req,
            res,
            { login: { accountId: identity.sub, amr: ['dev_stand_in'] } },
            { mergeWithLastSubmission: false },
          );
          return;
        }
        if (req.method === 'POST' && action === 'abort') {
          await provider.interactionFinished(
            req,
            res,
            { error: 'access_denied', error_description: 'The user cancelled sign-in.' },
            { mergeWithLastSubmission: false },
          );
          return;
        }
        send(res, 405, errorPage('Method not allowed.'));
      } catch (error) {
        send(res, 400, errorPage(error instanceof Error ? error.message : 'Interaction failed.'));
      }
    })();
  };

  return { provider, handler, identities };
}
