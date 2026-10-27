// `auth` module (PLT-013, BE-078): provider list, OIDC login redirect, callback, explicit account
// linking, logout. Rate limited per client IP. The OIDC transaction (state, nonce, PKCE verifier,
// returnTo) travels in a signed, httpOnly, short-lived cookie scoped to the callback path, and each
// state is single-use in this process, so a replayed callback is rejected.
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { defaultActiveOrg, membershipsForUser } from '../../services/memberships';
import {
  clearSessionCookie,
  createSession,
  hashIp,
  hashToken,
  revokeSessionByToken,
  SESSION_COOKIE,
  setSessionCookie,
} from '../../services/sessions';
import { withTenant } from '../../db/runtime';
import { linkIdentity, resolveIdentity } from './identity';
import { buildAuthorizationRequest, completeAuthorization, PROVIDER_IDS, type ProviderId } from './oidc';

export const OIDC_COOKIE = 'fl_oidc';
const OIDC_TRANSACTION_SECONDS = 600;

const ProviderParamsSchema = z.object({ provider: z.enum(PROVIDER_IDS) });

const ProviderListSchema = z.object({
  providers: z.array(
    z.object({
      id: z.enum(PROVIDER_IDS),
      label: z.string(),
      available: z.boolean(),
      developmentOnly: z.boolean(),
    }),
  ),
});

interface OidcTransaction {
  p: ProviderId;
  s: string;
  n: string;
  v: string;
  r: string;
  /** 'login' or 'link' (explicit account linking for the signed-in user). */
  m: 'login' | 'link';
  u?: string;
  exp: number;
}

/**
 * returnTo allowlist (PLT-013 G): same-site paths, APP_ORIGIN, or AUTH_RETURN_TO_ORIGINS. Anything
 * else (other hosts, protocol-relative //evil, backslash tricks, javascript:) falls back to "/".
 */
function hasControlOrBackslash(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || ch === '\\') return true;
  }
  return false;
}

export function safeReturnTo(value: string | undefined, appOrigin: string, extraOrigins: readonly string[]): string {
  if (!value || value.length > 1000 || hasControlOrBackslash(value)) return '/';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && [appOrigin, ...extraOrigins].includes(url.origin)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // not a URL
  }
  return '/';
}

/** States consumed by this process; a replayed callback finds its state here (PLT-013 G). */
const consumedStates = new Map<string, number>();
function consumeState(state: string): boolean {
  const now = Date.now();
  for (const [key, expires] of consumedStates) if (expires < now) consumedStates.delete(key);
  if (consumedStates.has(state)) return false;
  consumedStates.set(state, now + OIDC_TRANSACTION_SECONDS * 1000);
  return true;
}

function webUrl(request: FastifyRequest, path: string): string {
  return `${request.server.config.appOrigin}${path}`;
}

function signInError(request: FastifyRequest, reply: FastifyReply, code: string) {
  return reply.redirect(webUrl(request, `/sign-in?error=${encodeURIComponent(code)}`), 302);
}

const authModule: FastifyPluginAsyncZod = async (app) => {
  const rateLimit = { max: app.config.auth.rateLimitPerMinute, timeWindow: '1 minute' };
  const cookieBase = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: app.config.isProduction,
    signed: true,
  };

  app.get(
    '/auth/providers',
    {
      config: { auth: 'none', rateLimit },
      schema: {
        tags: ['auth'],
        summary: 'Sign-in providers and whether each is configured',
        response: { 200: ProviderListSchema },
      },
    },
    async () => ({ providers: app.oidc.list() }),
  );

  async function startFlow(
    request: FastifyRequest,
    reply: FastifyReply,
    provider: ProviderId,
    mode: OidcTransaction['m'],
    returnTo: string | undefined,
  ) {
    if (!app.oidc.get(provider)) throw problem('not_found', 'This sign-in provider is not configured.');
    let auth;
    try {
      auth = await buildAuthorizationRequest(app.oidc, provider);
    } catch (error) {
      request.log.error({ err: error, provider }, 'OIDC discovery failed');
      throw problem('dependency_unavailable', 'The sign-in provider is unavailable. Try again shortly.');
    }
    const tx: OidcTransaction = {
      p: provider,
      s: auth.state,
      n: auth.nonce,
      v: auth.codeVerifier,
      r: safeReturnTo(returnTo, app.config.appOrigin, app.config.auth.returnToOrigins),
      m: mode,
      ...(mode === 'link' && request.auth && { u: request.auth.userId }),
      exp: Math.floor(Date.now() / 1000) + OIDC_TRANSACTION_SECONDS,
    };
    reply.setCookie(OIDC_COOKIE, Buffer.from(JSON.stringify(tx)).toString('base64url'), {
      ...cookieBase,
      path: `/v1/auth/callback/${provider}`,
      maxAge: OIDC_TRANSACTION_SECONDS,
    });
    return reply.redirect(auth.url.href, 302);
  }

  app.get(
    '/auth/login/:provider',
    {
      config: { auth: 'none', rateLimit },
      schema: {
        tags: ['auth'],
        summary: 'Start sign-in: redirects to the identity provider (code + PKCE + state + nonce)',
        params: ProviderParamsSchema,
        querystring: z.object({ returnTo: z.string().max(1000).optional() }),
      },
    },
    async (request, reply) => startFlow(request, reply, request.params.provider, 'login', request.query.returnTo),
  );

  app.get(
    '/auth/link/:provider',
    {
      config: { auth: 'user', rateLimit },
      schema: {
        tags: ['auth'],
        summary: 'Explicitly link another sign-in identity to the signed-in user (audited)',
        params: ProviderParamsSchema,
        querystring: z.object({ returnTo: z.string().max(1000).optional() }),
      },
    },
    async (request, reply) => startFlow(request, reply, request.params.provider, 'link', request.query.returnTo),
  );

  app.get(
    '/auth/callback/:provider',
    {
      config: { auth: 'none', rateLimit },
      schema: {
        tags: ['auth'],
        summary: 'OIDC redirect target: validates the response, creates a session, redirects to the app',
        params: ProviderParamsSchema,
        querystring: z.record(z.string(), z.string()),
      },
    },
    async (request, reply) => {
      const provider = request.params.provider;
      const definition = app.oidc.get(provider);
      const raw = request.cookies[OIDC_COOKIE];
      reply.clearCookie(OIDC_COOKIE, { ...cookieBase, path: `/v1/auth/callback/${provider}` });
      if (!definition) return signInError(request, reply, 'provider_unavailable');
      if (request.query.error) return signInError(request, reply, 'provider_denied');

      const unsigned = raw ? request.unsignCookie(raw) : null;
      let tx: OidcTransaction | null = null;
      if (unsigned?.valid && unsigned.value) {
        try {
          tx = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')) as OidcTransaction;
        } catch {
          tx = null;
        }
      }
      if (!tx || tx.p !== provider || tx.exp < Date.now() / 1000) {
        request.log.warn({ provider }, 'OIDC callback without a valid transaction cookie');
        return signInError(request, reply, 'sign_in_expired');
      }
      if (request.query.state !== tx.s || !consumeState(tx.s)) {
        request.log.warn({ provider }, 'OIDC callback state mismatch or replay');
        return signInError(request, reply, 'sign_in_rejected');
      }

      let identity;
      try {
        const currentUrl = new URL(`${app.config.apiOrigin}${request.url}`);
        identity = await completeAuthorization(app.oidc, provider, currentUrl, {
          state: tx.s,
          nonce: tx.n,
          codeVerifier: tx.v,
        });
      } catch (error) {
        // Wrong issuer/audience/signature/nonce, expired token, reused code...: no session.
        request.log.warn({ provider, reason: error instanceof Error ? error.message : 'unknown' }, 'OIDC validation failed');
        return signInError(request, reply, 'sign_in_rejected');
      }

      const ipHash = hashIp(app.config.session.secret, request.ip);
      if (tx.m === 'link') {
        if (!request.auth || request.auth.userId !== tx.u) return signInError(request, reply, 'link_session_mismatch');
        const linked = await linkIdentity(app.db, request.auth.userId, definition.identityProvider, identity);
        if (linked.kind === 'in_use') return signInError(request, reply, 'identity_in_use');
        if (linked.kind === 'linked' && request.auth.org) {
          const orgId = request.auth.org.orgId;
          await withTenant(app.db, { orgId, userId: request.auth.userId }, (t) =>
            auditRequest(request, t, {
              orgId,
              action: 'auth.identity_linked',
              resourceType: 'user',
              resourceId: request.auth!.userId,
              after: { provider: definition.identityProvider, issuer: identity.issuer },
            }),
          );
        }
        request.log.info({ provider, outcome: linked.kind }, 'account link completed');
        return reply.redirect(webUrl(request, tx.r), 302);
      }

      const resolved = await resolveIdentity(app.db, definition.identityProvider, identity);
      if (resolved.kind === 'link_required') {
        request.log.info({ provider }, 'sign-in stopped: email belongs to a user of another issuer');
        return signInError(request, reply, 'account_link_required');
      }
      if (resolved.kind === 'existing' && !resolved.userActive) {
        return signInError(request, reply, 'account_deactivated');
      }
      const list = await membershipsForUser(app.db, resolved.userId);
      const activeOrgId = defaultActiveOrg(list);
      const previous = request.cookies[SESSION_COOKIE];
      const session = await createSession(app.db, app.config, {
        userId: resolved.userId,
        identityId: resolved.identityId,
        activeOrgId,
        userAgent: request.headers['user-agent'],
        ipHash,
        rotateFromTokenHash: previous ? hashToken(previous) : null,
      });
      if (activeOrgId) {
        await withTenant(app.db, { orgId: activeOrgId, userId: resolved.userId }, (t) =>
          auditRequest(request, t, {
            orgId: activeOrgId,
            action: 'auth.signed_in',
            resourceType: 'session',
            resourceId: session.id,
            after: { provider: definition.identityProvider },
            actorLabel: null,
          }),
        );
      }
      setSessionCookie(reply, app.config, session);
      request.log.info({ provider, outcome: resolved.kind }, 'sign-in completed');
      const target = activeOrgId || list.length === 0 ? tx.r : `/choose-workspace?returnTo=${encodeURIComponent(tx.r)}`;
      return reply.redirect(webUrl(request, target), 302);
    },
  );

  app.post(
    '/auth/logout',
    {
      config: { auth: 'none', rateLimit },
      schema: {
        tags: ['auth'],
        summary: 'Sign out: revokes the server session and clears the cookie',
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) {
        await revokeSessionByToken(app.db, token);
        if (request.auth?.org) {
          const { orgId } = request.auth.org;
          await withTenant(app.db, { orgId, userId: request.auth.userId }, (t) =>
            auditRequest(request, t, {
              orgId,
              action: 'auth.signed_out',
              resourceType: 'session',
              resourceId: request.auth!.sessionId,
            }),
          );
        }
      }
      clearSessionCookie(reply, app.config);
      return reply.status(204).send(null);
    },
  );
};

export default authModule;
