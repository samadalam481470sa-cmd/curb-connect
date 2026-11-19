// OAuth 2.0 / OpenID Connect for Google and Microsoft: authorization code flow with PKCE (S256),
// state and nonce. The ID token comes straight from the provider's token endpoint over TLS, so per
// OpenID Connect Core 3.1.3.7 its issuer, audience, expiry and nonce are checked here and TLS
// stands in for the signature check.
import type { Config } from './config';
import type { OAuthPurpose, Provider } from './db';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export interface ProviderEndpoints {
  authorize: string;
  token: string;
  callbackPath: string;
  scopes: Record<OAuthPurpose, string>;
}

export function endpoints(provider: Provider, config: Config): ProviderEndpoints {
  if (provider === 'google') {
    return {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      callbackPath: '/auth/gmail/callback',
      scopes: { signin: 'openid email profile', connect: `openid email ${GMAIL_SEND_SCOPE}` },
    };
  }
  const tenant = config.microsoft?.tenant ?? 'common';
  return {
    authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    callbackPath: '/auth/outlook/callback',
    scopes: {
      signin: 'openid email profile',
      connect: 'openid email offline_access User.Read Mail.Send',
    },
  };
}

export function clientFor(provider: Provider, config: Config) {
  return provider === 'google' ? config.google : config.microsoft;
}

export function redirectUri(provider: Provider, config: Config): string {
  return config.publicUrl + endpoints(provider, config).callbackPath;
}

export function authorizeUrl(
  provider: Provider,
  purpose: OAuthPurpose,
  config: Config,
  params: { state: string; nonce: string; codeChallenge: string; loginHint?: string },
): string {
  const client = clientFor(provider, config);
  if (!client) throw new Error(`${provider} is not configured`);
  const ep = endpoints(provider, config);
  const url = new URL(ep.authorize);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirectUri(provider, config));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', ep.scopes[purpose]);
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (provider === 'google' && purpose === 'connect') {
    // A refresh token is only issued with offline access; consent makes Google issue it again on reconnect.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
  } else {
    url.searchParams.set('prompt', 'select_account');
  }
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint);
  return url.toString();
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
  idToken: string | null;
}

async function postForm(fetchImpl: FetchLike, url: string, form: Record<string, string>) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== 'string') {
    const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new Error(`token request failed: ${reason}`);
  }
  const expiresIn = Number(body.expires_in ?? 3600);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    scope: typeof body.scope === 'string' ? body.scope : '',
    idToken: typeof body.id_token === 'string' ? body.id_token : null,
  } satisfies TokenResponse;
}

export function exchangeCode(
  provider: Provider,
  config: Config,
  fetchImpl: FetchLike,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const client = clientFor(provider, config);
  if (!client) throw new Error(`${provider} is not configured`);
  return postForm(fetchImpl, endpoints(provider, config).token, {
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri(provider, config),
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
}

export function refreshAccessToken(
  provider: Provider,
  config: Config,
  fetchImpl: FetchLike,
  refreshToken: string,
): Promise<TokenResponse> {
  const client = clientFor(provider, config);
  if (!client) throw new Error(`${provider} is not configured`);
  const form: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  };
  if (provider === 'microsoft') form.scope = endpoints(provider, config).scopes.connect;
  return postForm(fetchImpl, endpoints(provider, config).token, form);
}

export interface IdentityClaims {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) throw new Error('malformed id_token');
  const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!payload || typeof payload !== 'object') throw new Error('malformed id_token');
  return payload as Record<string, unknown>;
}

export function verifyIdToken(
  provider: Provider,
  config: Config,
  idToken: string,
  expectedNonce: string,
  now = Date.now(),
): IdentityClaims {
  const client = clientFor(provider, config);
  if (!client) throw new Error(`${provider} is not configured`);
  const claims = decodeJwtPayload(idToken);
  const iss = String(claims.iss ?? '');
  const issuerOk =
    provider === 'google'
      ? iss === 'https://accounts.google.com' || iss === 'accounts.google.com'
      : /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/.test(iss);
  if (!issuerOk) throw new Error('id_token issuer mismatch');
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(client.clientId) : aud === client.clientId;
  if (!audOk) throw new Error('id_token audience mismatch');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) {
    throw new Error('id_token expired');
  }
  if (claims.nonce !== expectedNonce) throw new Error('id_token nonce mismatch');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('id_token has no subject');
  const email = String(
    claims.email ?? (provider === 'microsoft' ? (claims.preferred_username ?? '') : ''),
  ).trim();
  return {
    subject: claims.sub,
    email,
    // Microsoft does not promise the email claim is verified, so it is never trusted for linking.
    emailVerified: provider === 'google' && claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name.trim() : '',
  };
}

/** The mailbox address for an Outlook connection, read from Microsoft Graph. */
export async function microsoftMailbox(fetchImpl: FetchLike, accessToken: string): Promise<string> {
  const res = await fetchImpl(
    'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
    {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    },
  );
  if (!res.ok) throw new Error(`Graph /me failed: HTTP ${res.status}`);
  const body = (await res.json()) as { mail?: string | null; userPrincipalName?: string };
  return (body.mail || body.userPrincipalName || '').trim();
}
