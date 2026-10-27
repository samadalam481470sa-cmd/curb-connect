// Helpers every route handler uses to reach the database with the right tenant scope.
import type { Action } from '@fieldline/contracts';
import { explainDenied } from '@fieldline/contracts';
import type { FastifyRequest } from 'fastify';
import { type Tx, withPlatform, withTenant, type PlatformOperation } from '../db/runtime';
import { type AuthContext, type OrgContext, orgUnavailable } from './auth-context';
import { problem } from './problem';

export function requireUser(request: FastifyRequest): AuthContext {
  if (!request.auth) throw problem('unauthenticated');
  return request.auth;
}

export function requireOrg(request: FastifyRequest): OrgContext & { userId: string } {
  const auth = requireUser(request);
  if (!auth.org) orgUnavailable(auth);
  return { ...auth.org, userId: auth.userId };
}

/** Second, resource-level check inside a handler (e.g. a sub-section needs a stricter action). */
export function assertCan(request: FastifyRequest, action: Action): void {
  const org = requireOrg(request);
  if (!org.permissions.has(action)) throw problem('forbidden', explainDenied(org.role, action));
}

/**
 * The per-request transaction: restricted role, app.org_id = the verified active org, app.user_id =
 * the signed-in user. Never takes an org id from the client (BE-078 D).
 */
export function tenantTx<T>(request: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const org = requireOrg(request);
  return withTenant(request.server.db, { orgId: org.orgId, userId: org.userId }, fn);
}

/** Signed in, no org context (own memberships across companies are readable via app.user_id). */
export function userTx<T>(request: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const auth = requireUser(request);
  return withTenant(request.server.db, { orgId: auth.org?.orgId ?? null, userId: auth.userId }, fn);
}

/** Named cross-tenant operation (see PLATFORM_OPERATIONS in src/db/runtime.ts). */
export function platformTx<T>(
  request: FastifyRequest,
  operation: PlatformOperation,
  fn: (tx: Tx) => Promise<T>,
  scope?: { orgId: string | null; userId: string | null },
): Promise<T> {
  return withPlatform(request.server.platformDb, operation, request.log, fn, scope);
}

/** Request metadata recorded with audit rows and outbox events. */
export interface RequestMeta {
  correlationId: string;
  actorUserId: string | null;
  ip: string | undefined;
  userAgent: string | undefined;
}

export function requestMeta(request: FastifyRequest): RequestMeta {
  const ua = request.headers['user-agent'];
  return {
    correlationId: request.id,
    actorUserId: request.auth?.userId ?? null,
    ip: request.ip,
    userAgent: typeof ua === 'string' ? ua.slice(0, 300) : undefined,
  };
}
