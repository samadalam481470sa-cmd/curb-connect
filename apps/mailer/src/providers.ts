// Google (Gmail API) and Microsoft (Graph) adapters: the OAuth 2.0 authorization-code flow with
// PKCE and a client secret, refresh, the signed-in address, sending and revoking. Only the scopes
// needed to send are requested: gmail.send cannot read the inbox, Mail.Send cannot read mail.
import type { MailboxProvider } from '@fieldline/contracts';
import type { MailerConfig } from './config';
import { assertPlainEmail, buildMime, headerSafe, type OutboundMessage } from './mime';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface TokenSet {
  accessToken: string;
  /** Microsoft rotates refresh tokens on every refresh; Google usually returns none on refresh. */
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
}

export interface Profile {
  email: string;
  displayName: string | null;
}

/**
 * What went wrong, in terms the caller can act on:
 * - auth: the grant is gone (revoked, expired, password change). The member must reconnect.
 * - rejected: the provider refused the request and nothing was sent; retrying will not help.
 * - retry: throttled or briefly unavailable before anything was sent; safe to retry later.
 * - unknown: the connection broke after the request left, so it may have been sent.
 */
export type ProviderErrorKind = 'auth' | 'rejected' | 'retry' | 'unknown';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderAdapter {
  readonly id: MailboxProvider;
  readonly label: string;
  readonly requiredScope: string;
  authorizeUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(code: string, verifier: string, redirectUri: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  profile(accessToken: string): Promise<Profile>;
  send(
    accessToken: string,
    from: string,
    message: OutboundMessage,
  ): Promise<{ providerMessageId: string | null }>;
  revoke(refreshToken: string): Promise<void>;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

async function tokenRequest(
  fetchImpl: FetchLike,
  url: string,
  body: Record<string, string>,
  label: string,
): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ProviderError('retry', `${label} sign-in service did not answer`);
  }
  let json: TokenResponse = {};
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    // fall through to the status check
  }
  if (!res.ok || typeof json.access_token !== 'string') {
    const code = typeof json.error === 'string' ? json.error : `HTTP ${res.status}`;
    if (code === 'invalid_grant' || res.status === 401) {
      throw new ProviderError(
        'auth',
        `${label} no longer accepts this connection (${code})`,
        res.status,
      );
    }
    if (res.status === 429 || res.status >= 500) {
      throw new ProviderError('retry', `${label} sign-in service is busy (${code})`, res.status);
    }
    throw new ProviderError('rejected', `${label} refused the sign-in (${code})`, res.status);
  }
  const expiresIn =
    typeof json.expires_in === 'number' ? json.expires_in : Number(json.expires_in ?? 3600);
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    scopes: typeof json.scope === 'string' ? json.scope.split(/\s+/).filter(Boolean) : [],
  };
}

/** Maps a send response to an outcome. Only statuses that prove nothing was sent are retryable. */
async function sendOutcome(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  let detail = '';
  try {
    const json = (await res.json()) as { error?: { message?: unknown; code?: unknown } };
    const message = json.error?.message ?? json.error?.code;
    if (typeof message === 'string') detail = `: ${headerSafe(message, 200)}`;
  } catch {
    // no JSON body
  }
  if (res.status === 401)
    throw new ProviderError('auth', `${label} rejected the sign-in${detail}`, 401);
  if (res.status === 429 || res.status === 503) {
    throw new ProviderError('retry', `${label} is throttling sends${detail}`, res.status);
  }
  if (res.status >= 400 && res.status < 500) {
    throw new ProviderError(
      'rejected',
      `${label} did not send the message (HTTP ${res.status})${detail}`,
      res.status,
    );
  }
  throw new ProviderError(
    'unknown',
    `${label} returned HTTP ${res.status}; the message may have been sent`,
    res.status,
  );
}

async function postSend(
  fetchImpl: FetchLike,
  url: string,
  accessToken: string,
  body: unknown,
  label: string,
) {
  try {
    return await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ProviderError(
      'unknown',
      `${label} stopped answering during the send; it may have been sent`,
    );
  }
}

async function getJson<T>(
  fetchImpl: FetchLike,
  url: string,
  accessToken: string,
  label: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ProviderError('retry', `${label} did not answer`);
  }
  if (res.status === 401) throw new ProviderError('auth', `${label} rejected the sign-in`, 401);
  if (!res.ok)
    throw new ProviderError(
      res.status >= 500 ? 'retry' : 'rejected',
      `${label} profile lookup failed (HTTP ${res.status})`,
      res.status,
    );
  return (await res.json()) as T;
}

// ------------------------------------------------------------------ Google / Gmail
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export function googleAdapter(
  client: { clientId: string; clientSecret: string },
  fetchImpl: FetchLike,
): ProviderAdapter {
  return {
    id: 'gmail',
    label: 'Gmail',
    requiredScope: GMAIL_SEND_SCOPE,
    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL(GOOGLE_AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: ['openid', 'email', 'profile', GMAIL_SEND_SCOPE].join(' '),
        // offline + consent: Google only returns a refresh token on a consent screen.
        access_type: 'offline',
        prompt: 'consent select_account',
        include_granted_scopes: 'true',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.toString();
    },
    exchangeCode(code, verifier, redirectUri) {
      return tokenRequest(
        fetchImpl,
        GOOGLE_TOKEN_URL,
        {
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          client_id: client.clientId,
          client_secret: client.clientSecret,
        },
        'Google',
      );
    },
    refresh(refreshToken) {
      return tokenRequest(
        fetchImpl,
        GOOGLE_TOKEN_URL,
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: client.clientId,
          client_secret: client.clientSecret,
        },
        'Google',
      );
    },
    async profile(accessToken) {
      const info = await getJson<{ email?: unknown; email_verified?: unknown; name?: unknown }>(
        fetchImpl,
        GOOGLE_USERINFO_URL,
        accessToken,
        'Google',
      );
      if (typeof info.email !== 'string' || info.email_verified === false) {
        throw new ProviderError('rejected', 'Google did not return a verified email address');
      }
      return {
        email: assertPlainEmail(info.email.toLowerCase()),
        displayName: typeof info.name === 'string' ? headerSafe(info.name, 120) : null,
      };
    },
    async send(accessToken, from, message) {
      const raw = Buffer.from(buildMime(message, from), 'utf8').toString('base64url');
      const res = await postSend(fetchImpl, GMAIL_SEND_URL, accessToken, { raw }, 'Gmail');
      await sendOutcome(res, 'Gmail');
      try {
        const json = (await res.json()) as { id?: unknown };
        return { providerMessageId: typeof json.id === 'string' ? json.id : null };
      } catch {
        return { providerMessageId: null };
      }
    },
    async revoke(refreshToken) {
      await fetchImpl(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
    },
  };
}

// ------------------------------------------------------------------ Microsoft / Outlook
export const GRAPH_ME_URL =
  'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName';
export const GRAPH_SEND_URL = 'https://graph.microsoft.com/v1.0/me/sendMail';
export const GRAPH_MAIL_SEND_SCOPE = 'https://graph.microsoft.com/Mail.Send';

export function microsoftAdapter(
  client: { clientId: string; clientSecret: string; tenant: string },
  fetchImpl: FetchLike,
): ProviderAdapter {
  const base = `https://login.microsoftonline.com/${encodeURIComponent(client.tenant)}/oauth2/v2.0`;
  const scope = [
    'openid',
    'email',
    'profile',
    'offline_access',
    'https://graph.microsoft.com/User.Read',
    GRAPH_MAIL_SEND_SCOPE,
  ].join(' ');
  return {
    id: 'outlook',
    label: 'Outlook',
    requiredScope: GRAPH_MAIL_SEND_SCOPE,
    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL(`${base}/authorize`);
      url.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        response_mode: 'query',
        scope,
        prompt: 'select_account',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.toString();
    },
    exchangeCode(code, verifier, redirectUri) {
      return tokenRequest(
        fetchImpl,
        `${base}/token`,
        {
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          client_id: client.clientId,
          client_secret: client.clientSecret,
          scope,
        },
        'Microsoft',
      );
    },
    refresh(refreshToken) {
      return tokenRequest(
        fetchImpl,
        `${base}/token`,
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: client.clientId,
          client_secret: client.clientSecret,
          scope,
        },
        'Microsoft',
      );
    },
    async profile(accessToken) {
      const me = await getJson<{
        mail?: unknown;
        userPrincipalName?: unknown;
        displayName?: unknown;
      }>(fetchImpl, GRAPH_ME_URL, accessToken, 'Microsoft');
      // Personal accounts (outlook.com, hotmail.com) often have no `mail`; the UPN is the address.
      const address = typeof me.mail === 'string' && me.mail ? me.mail : me.userPrincipalName;
      if (typeof address !== 'string')
        throw new ProviderError('rejected', 'Microsoft did not return an email address');
      return {
        email: assertPlainEmail(address.toLowerCase()),
        displayName: typeof me.displayName === 'string' ? headerSafe(me.displayName, 120) : null,
      };
    },
    async send(accessToken, _from, message) {
      const body = {
        message: {
          subject: headerSafe(message.subject, 250),
          body: { contentType: 'Text', content: message.text },
          toRecipients: [{ emailAddress: { address: assertPlainEmail(message.to) } }],
          attachments: message.attachments.map((a) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: headerSafe(a.filename, 150),
            contentType: a.contentType,
            contentBytes: a.contentBase64.replace(/\s+/g, ''),
          })),
        },
        saveToSentItems: true,
      };
      const res = await postSend(fetchImpl, GRAPH_SEND_URL, accessToken, body, 'Outlook');
      await sendOutcome(res, 'Outlook');
      // Graph answers 202 Accepted with no body and no message id.
      return { providerMessageId: null };
    },
    async revoke() {
      // Microsoft has no per-token revocation endpoint for delegated refresh tokens; deleting the
      // sealed token here ends this app's access. The member can also remove the app at
      // https://account.live.com/consent/Manage or https://myapps.microsoft.com.
    },
  };
}

export type ProviderSet = Partial<Record<MailboxProvider, ProviderAdapter>>;

export function createProviders(config: MailerConfig, fetchImpl: FetchLike = fetch): ProviderSet {
  return {
    ...(config.google && { gmail: googleAdapter(config.google, fetchImpl) }),
    ...(config.microsoft && { outlook: microsoftAdapter(config.microsoft, fetchImpl) }),
  };
}

/** Did the person leave the required send permission ticked on the consent screen? */
export function hasScope(granted: string[], required: string): boolean {
  const want = required.toLowerCase();
  const short = want.split('/').pop()!;
  return granted.some((s) => {
    const value = s.toLowerCase();
    return value === want || value === short;
  });
}
