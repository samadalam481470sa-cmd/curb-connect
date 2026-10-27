// Provider-neutral OIDC client (PLT-013 R, BE-078 P): authorization code + PKCE (S256) + state +
// nonce via openid-client. openid-client validates issuer, audience, expiry, nonce and (with
// enableNonRepudiationChecks) the ID token signature against the provider's JWKS. Providers come
// from env; an unconfigured provider is reported as unavailable, never simulated.
import * as client from 'openid-client';
import type { IdentityProvider } from '@fieldline/contracts';
import type { AppConfig, OidcClientSettings } from '../../config';
import { withSpan } from '../../http/telemetry';

export const PROVIDER_IDS = ['microsoft', 'dev'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  /** Stored on external_identities.provider. */
  identityProvider: IdentityProvider;
  settings: OidcClientSettings | null;
  /** Development stand-ins on http://localhost only. */
  developmentOnly: boolean;
  /**
   * OIDC `prompt`. Entra: select_account (people often have several work accounts). Dev IdP:
   * login, so the test-identity picker is shown every time (oidc-provider has no select_account).
   */
  prompt: 'select_account' | 'login';
}

export interface ProviderSummary {
  id: ProviderId;
  label: string;
  available: boolean;
  developmentOnly: boolean;
}

const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export interface OidcRegistryOptions {
  /** Tests inject an in-process issuer; keys are provider ids. */
  overrides?: Partial<Record<ProviderId, OidcClientSettings | null>>;
}

export class OidcRegistry {
  private readonly providers: Map<ProviderId, ProviderDefinition>;
  private readonly configs = new Map<ProviderId, Promise<client.Configuration>>();

  constructor(
    private readonly config: AppConfig,
    options: OidcRegistryOptions = {},
  ) {
    const microsoft = options.overrides?.microsoft !== undefined ? options.overrides.microsoft : config.oidc.microsoft;
    const dev = options.overrides?.dev !== undefined ? options.overrides.dev : config.oidc.devIdp;
    this.providers = new Map<ProviderId, ProviderDefinition>([
      [
        'microsoft',
        {
          id: 'microsoft',
          label: 'Microsoft',
          identityProvider: 'microsoft',
          settings: microsoft,
          developmentOnly: false,
          prompt: 'select_account',
        },
      ],
      [
        'dev',
        {
          id: 'dev',
          label: 'Development sign-in (test identities)',
          identityProvider: 'dev_idp',
          // Never in production, whatever the env says.
          settings: config.isProduction ? null : dev,
          developmentOnly: true,
          prompt: 'login',
        },
      ],
    ]);
  }

  list(): ProviderSummary[] {
    return [...this.providers.values()]
      .filter((p) => !(p.developmentOnly && this.config.isProduction))
      .map((p) => ({ id: p.id, label: p.label, available: p.settings !== null, developmentOnly: p.developmentOnly }));
  }

  get(id: ProviderId): ProviderDefinition | null {
    const provider = this.providers.get(id);
    return provider?.settings ? provider : null;
  }

  redirectUri(id: ProviderId): string {
    return `${this.config.apiOrigin}/v1/auth/callback/${id}`;
  }

  /** Discovery is cached per provider; a failed discovery is retried on the next call. */
  configuration(id: ProviderId): Promise<client.Configuration> {
    const provider = this.get(id);
    if (!provider?.settings) return Promise.reject(new Error(`provider ${id} is not configured`));
    const settings = provider.settings;
    let pending = this.configs.get(id);
    if (!pending) {
      const insecure = LOOPBACK.test(new URL(settings.issuer).origin) && !this.config.isProduction;
      pending = withSpan('oidc.discovery', { 'fieldline.oidc_provider': id }, () =>
        client.discovery(
          new URL(settings.issuer),
          settings.clientId,
          { redirect_uris: [this.redirectUri(id)], response_types: ['code'] },
          settings.clientSecret ? client.ClientSecretPost(settings.clientSecret) : client.None(),
          {
            execute: insecure
              ? [client.allowInsecureRequests, client.enableNonRepudiationChecks]
              : [client.enableNonRepudiationChecks],
          },
        ),
      );
      pending.catch(() => this.configs.delete(id));
      this.configs.set(id, pending);
    }
    return pending;
  }
}

export interface AuthorizationRequest {
  url: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export async function buildAuthorizationRequest(
  registry: OidcRegistry,
  id: ProviderId,
): Promise<AuthorizationRequest> {
  const config = await registry.configuration(id);
  const provider = registry.get(id);
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: registry.redirectUri(id),
    scope: 'openid profile email',
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    prompt: provider?.prompt ?? 'login',
  });
  return { url, state, nonce, codeVerifier };
}

export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** Exchanges the code and returns validated ID token claims; throws on any check failure. */
export async function completeAuthorization(
  registry: OidcRegistry,
  id: ProviderId,
  currentUrl: URL,
  checks: { state: string; nonce: string; codeVerifier: string },
): Promise<VerifiedIdentity> {
  const config = await registry.configuration(id);
  const tokens = await withSpan('oidc.token', { 'fieldline.oidc_provider': id }, () =>
    client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    }),
  );
  const claims = tokens.claims();
  if (!claims) throw new Error('ID token missing');
  const str = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);
  return {
    issuer: claims.iss,
    subject: claims.sub,
    email: str(claims.email) ?? str(claims.preferred_username),
    emailVerified: claims.email_verified === true,
    name: str(claims.name),
  };
}
