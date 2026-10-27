// Request authentication and authorization (PLT-011 R, PLT-015 R, BE-078): verified session ->
// active org membership (re-validated on every request) -> RBAC policy check. Routes declare what
// they need in `config`; the server is authoritative, the web app only mirrors the matrix.
import {
  type Action,
  effectivePermissions,
  explainDenied,
  type MemberRole,
  type PermissionOverride,
} from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { memberships, organizations, permissionOverrides } from '../db/schema';
import { type Tx, withTenant } from '../db/runtime';
import { clearSessionCookie, resolveSession, SESSION_COOKIE } from '../services/sessions';
import { problem } from './problem';

/**
 * none     public (health, docs, auth redirects)
 * user     signed in; no workspace needed (/v1/me, workspace switch, create org, accept invite)
 * org      signed in with an active, valid membership in the active org (the default)
 */
export type AuthLevel = 'none' | 'user' | 'org';

const PUBLIC_DOCS_PREFIX = '/v1/docs';

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: AuthLevel;
    /** RBAC action from packages/contracts POLICY; implies auth 'org'. */
    permission?: Action;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export interface OrgContext {
  orgId: string;
  orgDisplayName: string;
  membershipId: string;
  role: MemberRole;
  permissions: Set<Action>;
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  user: { id: string; displayName: string; email: string | null; locale: string };
  session: { idleExpiresAt: Date; absoluteExpiresAt: Date; activeOrgId: string | null };
  /** Null when no workspace is selected or the membership is no longer active. */
  org: OrgContext | null;
  /** Why org is null although a workspace was selected (for a precise error). */
  orgUnavailableReason: 'none_selected' | 'membership_inactive' | 'org_inactive' | null;
}

async function loadOrgContext(
  tx: Tx,
  userId: string,
  orgId: string,
): Promise<{ org: OrgContext | null; reason: AuthContext['orgUnavailableReason'] }> {
  const [row] = await tx
    .select({
      membershipId: memberships.id,
      role: memberships.role,
      status: memberships.status,
      orgStatus: organizations.status,
      orgDisplayName: organizations.displayName,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  if (!row || row.status !== 'active') return { org: null, reason: 'membership_inactive' };
  if (row.orgStatus !== 'active') return { org: null, reason: 'org_inactive' };
  const overrides = await tx
    .select({
      action: permissionOverrides.action,
      effect: permissionOverrides.effect,
      expiresAt: permissionOverrides.expiresAt,
    })
    .from(permissionOverrides)
    .where(eq(permissionOverrides.membershipId, row.membershipId));
  const parsed: PermissionOverride[] = overrides.map((o) => ({
    action: o.action as Action,
    effect: o.effect,
    expiresAt: o.expiresAt?.toISOString() ?? null,
  }));
  return {
    org: {
      orgId,
      orgDisplayName: row.orgDisplayName,
      membershipId: row.membershipId,
      role: row.role,
      permissions: effectivePermissions(row.role, parsed),
    },
    reason: null,
  };
}

/** Builds the auth context for the cookie on this request (null when signed out). */
export async function authenticate(app: FastifyInstance, request: FastifyRequest): Promise<AuthContext | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const lookup = await resolveSession(app.db, app.config, token);
  if (lookup.status !== 'active') {
    if (lookup.status === 'expired') throw problem('session_expired');
    return null;
  }
  const { session, user } = lookup;
  let org: OrgContext | null = null;
  let reason: AuthContext['orgUnavailableReason'] = 'none_selected';
  if (session.activeOrgId) {
    const loaded = await withTenant(app.db, { orgId: session.activeOrgId, userId: user.id }, (tx) =>
      loadOrgContext(tx, user.id, session.activeOrgId as string),
    );
    org = loaded.org;
    reason = loaded.reason;
  }
  return {
    sessionId: session.id,
    userId: user.id,
    user,
    session: {
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      activeOrgId: session.activeOrgId,
    },
    org,
    orgUnavailableReason: org ? null : reason,
  };
}

/** Throws the precise problem for a missing org context. */
export function orgUnavailable(auth: AuthContext): never {
  switch (auth.orgUnavailableReason) {
    case 'membership_inactive':
    case 'org_inactive':
      throw problem('membership_revoked');
    default:
      throw problem('workspace_required');
  }
}

export function registerAuthContext(app: FastifyInstance): void {
  app.decorateRequest('auth', null);
  app.addHook('preHandler', async (request, reply) => {
    const config = request.routeOptions.config;
    const url = request.routeOptions.url;
    // Secure by default: a route without `config.auth` needs an org. Only the 404 handler and the
    // swagger-ui assets (registered by a plugin, public API docs) are exempt.
    const publicPluginRoute = !url || url.startsWith(PUBLIC_DOCS_PREFIX);
    const level: AuthLevel =
      config?.permission !== undefined ? 'org' : (config?.auth ?? (publicPluginRoute ? 'none' : 'org'));
    if (level === 'none' && !request.cookies[SESSION_COOKIE]) return;
    let auth: AuthContext | null;
    try {
      auth = await authenticate(app, request);
    } catch (error) {
      clearSessionCookie(reply, app.config);
      if (level === 'none') return;
      throw error;
    }
    request.auth = auth;
    if (level === 'none') return;
    if (!auth) {
      if (request.cookies[SESSION_COOKIE]) clearSessionCookie(reply, app.config);
      throw problem('unauthenticated');
    }
    if (level === 'user') return;
    if (!auth.org) orgUnavailable(auth);
    const permission = config?.permission;
    if (permission && !auth.org.permissions.has(permission)) {
      throw problem('forbidden', explainDenied(auth.org.role, permission));
    }
  });
}
