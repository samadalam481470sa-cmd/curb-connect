// `session` module (PLT-013 B, PLT-011 S): who am I, my memberships in every company, the active
// workspace with its effective permissions and server-evaluated feature flags, and explicit
// workspace switching. The active org is stored on the server session and re-validated against
// membership on every request (src/http/auth-context.ts).
import { ACTIONS, MeResponseSchema, type MeResponse, SwitchWorkspaceRequestSchema } from '@fieldline/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { withTenant } from '../../db/runtime';
import { authenticate } from '../../http/auth-context';
import { requireUser } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { flagsFor } from '../../services/flags';
import { membershipsForUser } from '../../services/memberships';
import { setActiveOrg } from '../../services/sessions';

export async function buildMe(request: FastifyRequest, activeOrgOverride?: string | null): Promise<MeResponse> {
  const auth = requireUser(request);
  const db = request.server.db;
  const memberships = await membershipsForUser(db, auth.userId);
  const activeOrgId = activeOrgOverride !== undefined ? activeOrgOverride : (auth.org?.orgId ?? null);
  const active = memberships.find((m) => m.orgId === activeOrgId && m.status === 'active' && m.orgActive);
  const flags = await withTenant(db, { orgId: active?.orgId ?? null, userId: auth.userId }, (tx) =>
    flagsFor(tx, active?.orgId ?? null),
  );
  const permissions =
    active && auth.org && auth.org.orgId === active.orgId
      ? ACTIONS.filter((a) => auth.org!.permissions.has(a))
      : [];
  return {
    user: {
      id: auth.user.id,
      displayName: auth.user.displayName,
      email: auth.user.email,
      locale: auth.user.locale,
    },
    activeOrgId: active?.orgId ?? null,
    activeRole: active?.role ?? null,
    permissions,
    flags,
    memberships: memberships.map((m) => ({
      membershipId: m.membershipId,
      orgId: m.orgId,
      orgDisplayName: m.orgDisplayName,
      role: m.role,
      status: m.status,
    })),
    session: {
      idleExpiresAt: auth.session.idleExpiresAt.toISOString(),
      absoluteExpiresAt: auth.session.absoluteExpiresAt.toISOString(),
    },
  };
}

const sessionModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me',
    {
      config: { auth: 'user' },
      schema: {
        tags: ['session'],
        summary: 'Signed-in user, memberships, active workspace, effective permissions and flags',
        response: { 200: MeResponseSchema },
      },
    },
    async (request) => buildMe(request),
  );

  app.post(
    '/session/active-org',
    {
      config: { auth: 'user' },
      schema: {
        tags: ['session'],
        summary: 'Switch the active workspace (must be an active membership)',
        body: SwitchWorkspaceRequestSchema,
        response: { 200: MeResponseSchema },
      },
    },
    async (request) => {
      const auth = requireUser(request);
      const list = await membershipsForUser(app.db, auth.userId);
      const target = list.find((m) => m.orgId === request.body.orgId);
      // Not a member (or another company's id): indistinguishable from a missing org (BE-078 G).
      if (!target) throw problem('not_found', 'No such workspace.');
      if (target.status !== 'active' || !target.orgActive) throw problem('membership_revoked');
      await setActiveOrg(app.db, auth.sessionId, target.orgId);
      await withTenant(app.db, { orgId: target.orgId, userId: auth.userId }, (tx) =>
        auditRequest(request, tx, {
          orgId: target.orgId,
          action: 'session.workspace_selected',
          resourceType: 'session',
          resourceId: auth.sessionId,
          before: { activeOrgId: auth.session.activeOrgId },
          after: { activeOrgId: target.orgId },
        }),
      );
      // Rebuild the org context for the response from the now-active membership.
      request.auth = await authenticate(app, request);
      return buildMe(request, target.orgId);
    },
  );
};

export default sessionModule;
