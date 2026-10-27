// `team` module (PLT-015, PLT-013 B): members, role changes, deactivation, ownership transfer,
// invitations (create/list/revoke/resend, accept by token with expiry recovery) and approval
// delegations with expiry. Every role change is audited. Lookups by id are tenant-scoped by RLS,
// so another company's id is a 404, never a 403 (BE-078 G).
import {
  ApprovalDelegationSchema,
  AcceptInvitationRequestSchema,
  CreateInvitationRequestSchema,
  InvitationSchema,
  MemberListSchema,
  MemberSchema,
  MembershipSummarySchema,
  PageQuerySchema,
  UpdateMemberRequestSchema,
  ApprovalSubjectTypeSchema,
  MinorUnitsSchema,
  UuidSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  approvalDelegations,
  invitations,
  memberships,
  organizations,
  users,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { platformTx, requireOrg, requireUser, tenantTx } from '../../http/context';
import { idempotent } from '../../http/idempotency';
import { afterCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { enqueue } from '../../jobs/outbox';
import { notify } from '../../services/notifications';
import { setActiveOrg } from '../../services/sessions';
import {
  INVITATION_TTL_DAYS,
  invitationAcceptUrl,
  invitationTokenHash,
  loadMember,
  MAX_DELEGATION_DAYS,
  memberDto,
  newInvitationToken,
  onMembershipRemoved,
  sealSecret,
} from './service';

type InvitationRow = typeof invitations.$inferSelect;
type DelegationRow = typeof approvalDelegations.$inferSelect;

const IdParams = z.object({ id: UuidSchema });
const IfMatchHeaders = z.object({ 'if-match': z.string().optional() }).loose();
const ReasonBody = z.object({ reason: z.string().trim().min(3).max(2000) });

const InvitationWithLinkSchema = InvitationSchema.extend({
  /** Returned only on create/resend so an admin can share the link; the token is never stored. */
  acceptUrl: z.url(),
});

function invitationStatus(row: InvitationRow, now = new Date()) {
  return row.status === 'pending' && row.expiresAt <= now ? ('expired' as const) : row.status;
}

function invitationDto(row: InvitationRow, inviter: { displayName: string | null }) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    email: row.email,
    role: row.role,
    status: invitationStatus(row),
    invitedBy: { userId: row.invitedByUserId, displayName: inviter.displayName },
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  };
}

function delegationDto(row: DelegationRow, currency: string) {
  return {
    id: row.id,
    orgId: row.orgId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    fromMembershipId: row.fromMembershipId,
    toMembershipId: row.toMembershipId,
    subjectTypes: row.subjectTypes,
    maxAmount: row.maxAmountMinor === null ? null : { amountMinor: row.maxAmountMinor, currency },
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

async function inviterName(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  return row?.displayName ?? null;
}

async function queueInvitationEmail(
  request: FastifyRequest,
  tx: Tx,
  row: InvitationRow,
  token: string,
) {
  await enqueue(tx, {
    orgId: row.orgId,
    task: 'invitation.send',
    aggregateType: 'invitation',
    aggregateId: row.id,
    payload: {
      invitationId: row.id,
      revision: row.revision,
      sealedToken: sealSecret(request.server.config.session.secret, token),
    },
    correlationId: request.id,
    jobKey: `invitation.send:${row.id}`,
  });
}

const teamModule: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------------ members
  app.get(
    '/team/members',
    {
      config: { permission: 'team:read' },
      schema: {
        tags: ['team'],
        summary: 'Members of the active company',
        querystring: PageQuerySchema.extend({
          status: z.enum(['active', 'suspended', 'revoked']).optional(),
        }),
        response: { 200: MemberListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, cursor, status } = request.query;
      const after = decodeCursor(cursor);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select({ m: memberships, displayName: users.displayName, email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              eq(memberships.orgId, org.orgId),
              status ? eq(memberships.status, status) : undefined,
              afterCursor(memberships.createdAt, memberships.id, after),
            ),
          )
          .orderBy(asc(msTrunc(memberships.createdAt)), asc(memberships.id))
          .limit(limit + 1),
      );
      return pageResult(
        rows,
        limit,
        (r) => ({ at: r.m.createdAt, id: r.m.id }),
        (r) => memberDto(r.m, r),
      );
    },
  );

  app.get(
    '/team/members/:id',
    {
      config: { permission: 'team:read' },
      schema: {
        tags: ['team'],
        summary: 'One member',
        params: IdParams,
        response: { 200: MemberSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, (tx) => loadMember(tx, org.orgId, request.params.id));
      if (!row) throw problem('not_found');
      setEtag(reply, row.m.revision);
      return memberDto(row.m, row);
    },
  );

  app.patch(
    '/team/members/:id',
    {
      config: { permission: 'team:update_role' },
      schema: {
        tags: ['team'],
        summary: 'Change role, title or status (If-Match). Ownership moves only via transfer.',
        params: IdParams,
        headers: IfMatchHeaders,
        body: UpdateMemberRequestSchema,
        response: { 200: MemberSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const expected = parseIfMatch(request);
      const body = request.body;
      if (body.role === 'owner') {
        throw problem(
          'invalid_transition',
          'Use transfer ownership to make someone the owner of record.',
        );
      }
      if (body.status && body.status !== 'active' && !org.permissions.has('team:revoke')) {
        throw problem('forbidden');
      }
      // Security review: only the owner of record creates admins (matches invitations), and nobody
      // changes their own role or status (a permission override must not become self-promotion).
      if (body.role === 'admin' && org.role !== 'owner') {
        throw problem('forbidden', 'Only the owner can make someone an admin.');
      }
      // (The owner's own record is covered by the owner-of-record rule below: 409.)
      if (org.role !== 'owner' && request.params.id === org.membershipId && (body.role !== undefined || body.status !== undefined)) {
        throw problem('forbidden', 'You cannot change your own role or status.');
      }
      const result = await tenantTx(request, async (tx) => {
        const current = await loadMember(tx, org.orgId, request.params.id);
        if (!current) throw problem('not_found');
        assertRevision(current.m.revision, expected);
        if (
          current.m.role === 'owner' &&
          (body.role || (body.status && body.status !== 'active'))
        ) {
          throw problem(
            'invalid_transition',
            'The owner of record cannot be demoted or removed. Transfer ownership first.',
          );
        }
        if (current.m.role === 'admin' && org.role !== 'owner' && (body.role || body.status)) {
          throw problem('forbidden', 'Only the owner can change an admin.');
        }
        const [row] = await tx
          .update(memberships)
          .set({
            ...(body.role !== undefined && { role: body.role }),
            ...(body.title !== undefined && { title: body.title }),
            ...(body.status !== undefined && {
              status: body.status,
              suspendedAt: body.status === 'active' ? null : new Date(),
            }),
            revision: current.m.revision + 1,
          })
          .where(eq(memberships.id, current.m.id))
          .returning();
        const before = memberDto(current.m, current);
        const after = memberDto(row!, current);
        if (body.role !== undefined && body.role !== current.m.role) {
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'team.role_changed',
            resourceType: 'membership',
            resourceId: row!.id,
            before: { role: current.m.role },
            after: { role: row!.role },
          });
        }
        if (body.status !== undefined && body.status !== current.m.status) {
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action:
              body.status === 'active' ? 'team.member_reactivated' : 'team.member_deactivated',
            resourceType: 'membership',
            resourceId: row!.id,
            before: { status: current.m.status },
            after: { status: row!.status },
          });
          if (body.status !== 'active') {
            await onMembershipRemoved(tx, {
              orgId: org.orgId,
              membershipId: row!.id,
              correlationId: request.id,
              reason: null,
            });
          }
        }
        if (body.title !== undefined && body.title !== current.m.title) {
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'team.member_updated',
            resourceType: 'membership',
            resourceId: row!.id,
            before: { title: before.title },
            after: { title: after.title },
          });
        }
        return { row: row!, user: current };
      });
      setEtag(reply, result.row.revision);
      return memberDto(result.row, result.user);
    },
  );

  app.post(
    '/team/members/:id/deactivate',
    {
      config: { permission: 'team:revoke' },
      schema: {
        tags: ['team'],
        summary: 'Remove a member: effective on their next request; review work is released',
        params: IdParams,
        body: ReasonBody,
        response: { 200: MemberSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const current = await loadMember(tx, org.orgId, request.params.id);
        if (!current) throw problem('not_found');
        if (current.m.role === 'owner') {
          throw problem(
            'invalid_transition',
            'Transfer ownership before removing the owner of record.',
          );
        }
        if (current.m.role === 'admin' && org.role !== 'owner')
          throw problem('forbidden', 'Only the owner can remove an admin.');
        if (current.m.status === 'revoked') return memberDto(current.m, current);
        const [row] = await tx
          .update(memberships)
          .set({ status: 'revoked', suspendedAt: new Date(), revision: current.m.revision + 1 })
          .where(eq(memberships.id, current.m.id))
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'team.member_deactivated',
          resourceType: 'membership',
          resourceId: row!.id,
          before: { status: current.m.status, role: current.m.role },
          after: { status: 'revoked' },
          reason: request.body.reason,
        });
        await onMembershipRemoved(tx, {
          orgId: org.orgId,
          membershipId: row!.id,
          correlationId: request.id,
          reason: request.body.reason,
        });
        return memberDto(row!, current);
      });
    },
  );

  app.post(
    '/team/transfer-ownership',
    {
      config: { permission: 'org:transfer_ownership' },
      schema: {
        tags: ['team'],
        summary: 'Make another active member the owner of record; the current owner becomes admin',
        headers: z.object({ 'idempotency-key': z.string().optional() }).loose(),
        body: z.object({ toMembershipId: UuidSchema, reason: z.string().trim().min(3).max(2000) }),
        response: { 200: z.object({ owner: MemberSchema, previousOwner: MemberSchema }) },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      return idempotent(request, reply, {}, async (tx) => {
        const target = await loadMember(tx, org.orgId, request.body.toMembershipId);
        if (!target) throw problem('not_found');
        if (target.m.status !== 'active')
          throw problem('invalid_transition', 'The new owner must be an active member.');
        if (target.m.id === org.membershipId)
          throw problem('invalid_transition', 'You are already the owner.');
        const self = await loadMember(tx, org.orgId, org.membershipId);
        if (!self || self.m.role !== 'owner') throw problem('forbidden');
        const [newOwner] = await tx
          .update(memberships)
          .set({ role: 'owner', revision: target.m.revision + 1 })
          .where(eq(memberships.id, target.m.id))
          .returning();
        const [oldOwner] = await tx
          .update(memberships)
          .set({ role: 'admin', revision: self.m.revision + 1 })
          .where(eq(memberships.id, self.m.id))
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'org.ownership_transferred',
          resourceType: 'organization',
          resourceId: org.orgId,
          before: { ownerMembershipId: self.m.id },
          after: { ownerMembershipId: target.m.id },
          reason: request.body.reason,
        });
        for (const [row, before] of [
          [newOwner!, target.m.role],
          [oldOwner!, 'owner'],
        ] as const) {
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'team.role_changed',
            resourceType: 'membership',
            resourceId: row.id,
            before: { role: before },
            after: { role: row.role },
            reason: request.body.reason,
          });
        }
        return {
          status: 200,
          body: { owner: memberDto(newOwner!, target), previousOwner: memberDto(oldOwner!, self) },
        };
      });
    },
  );

  // ------------------------------------------------------------------ invitations
  app.post(
    '/team/invitations',
    {
      config: { permission: 'team:invite' },
      schema: {
        tags: ['team'],
        summary: 'Invite someone by email with a role (expires after 7 days; email via outbox)',
        headers: z.object({ 'idempotency-key': z.string().optional() }).loose(),
        body: CreateInvitationRequestSchema,
        response: { 201: InvitationWithLinkSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const { email, role } = request.body;
      if (role === 'owner')
        throw problem('invalid_transition', 'Invite as admin, then transfer ownership.');
      if (role === 'admin' && org.role !== 'owner')
        throw problem('forbidden', 'Only the owner can invite admins.');
      return idempotent(request, reply, {}, async (tx) => {
        const lower = email.toLowerCase();
        const [member] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              eq(memberships.orgId, org.orgId),
              eq(memberships.status, 'active'),
              sql`lower(${users.email}) = ${lower}`,
            ),
          );
        if (member) throw problem('duplicate', 'This person is already an active member.');
        const [pending] = await tx
          .select({ id: invitations.id })
          .from(invitations)
          .where(
            and(
              eq(invitations.orgId, org.orgId),
              eq(invitations.status, 'pending'),
              sql`lower(${invitations.email}) = ${lower}`,
              sql`${invitations.expiresAt} > now()`,
            ),
          );
        if (pending)
          throw problem('duplicate', 'A pending invitation already exists. Resend it instead.');
        const token = newInvitationToken();
        const [row] = await tx
          .insert(invitations)
          .values({
            orgId: org.orgId,
            email: lower,
            role,
            tokenHash: invitationTokenHash(token),
            invitedByUserId: org.userId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
          })
          .returning();
        const dto = invitationDto(row!, { displayName: await inviterName(tx, org.userId) });
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'team.invitation_created',
          resourceType: 'invitation',
          resourceId: row!.id,
          after: dto,
        });
        await queueInvitationEmail(request, tx, row!, token);
        return {
          status: 201,
          body: { ...dto, acceptUrl: invitationAcceptUrl(app.config.appOrigin, token) },
        };
      });
    },
  );

  app.get(
    '/team/invitations',
    {
      config: { permission: 'team:read' },
      schema: {
        tags: ['team'],
        summary: 'Invitations of the active company (pending ones past expiry show as expired)',
        querystring: PageQuerySchema,
        response: {
          200: z.object({ items: z.array(InvitationSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, cursor } = request.query;
      const after = decodeCursor(cursor);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select({ inv: invitations, displayName: users.displayName })
          .from(invitations)
          .leftJoin(users, eq(users.id, invitations.invitedByUserId))
          .where(
            and(
              eq(invitations.orgId, org.orgId),
              afterCursor(invitations.createdAt, invitations.id, after),
            ),
          )
          .orderBy(asc(msTrunc(invitations.createdAt)), asc(invitations.id))
          .limit(limit + 1),
      );
      return pageResult(
        rows,
        limit,
        (r) => ({ at: r.inv.createdAt, id: r.inv.id }),
        (r) => invitationDto(r.inv, { displayName: r.displayName }),
      );
    },
  );

  app.post(
    '/team/invitations/:id/revoke',
    {
      config: { permission: 'team:invite' },
      schema: {
        tags: ['team'],
        summary: 'Revoke a pending invitation',
        params: IdParams,
        response: { 200: InvitationSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [current] = await tx
          .select()
          .from(invitations)
          .where(and(eq(invitations.orgId, org.orgId), eq(invitations.id, request.params.id)))
          .for('update');
        if (!current) throw problem('not_found');
        if (current.status === 'accepted')
          throw problem('invalid_transition', 'This invitation was already accepted.');
        const [row] = await tx
          .update(invitations)
          .set({ status: 'revoked', revokedAt: new Date(), revision: current.revision + 1 })
          .where(eq(invitations.id, current.id))
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'team.invitation_revoked',
          resourceType: 'invitation',
          resourceId: row!.id,
          before: { status: current.status },
          after: { status: 'revoked' },
        });
        return invitationDto(row!, { displayName: await inviterName(tx, row!.invitedByUserId) });
      });
    },
  );

  app.post(
    '/team/invitations/:id/resend',
    {
      config: { permission: 'team:invite' },
      schema: {
        tags: ['team'],
        summary: 'Issue a fresh link and expiry (also the recovery path for an expired invitation)',
        params: IdParams,
        response: { 200: InvitationWithLinkSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [current] = await tx
          .select()
          .from(invitations)
          .where(and(eq(invitations.orgId, org.orgId), eq(invitations.id, request.params.id)))
          .for('update');
        if (!current) throw problem('not_found');
        if (current.status === 'accepted' || current.status === 'revoked') {
          throw problem(
            'invalid_transition',
            `This invitation is ${current.status}; create a new one.`,
          );
        }
        const token = newInvitationToken();
        const [row] = await tx
          .update(invitations)
          .set({
            status: 'pending',
            tokenHash: invitationTokenHash(token),
            expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
            revision: current.revision + 1,
          })
          .where(eq(invitations.id, current.id))
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'team.invitation_resent',
          resourceType: 'invitation',
          resourceId: row!.id,
          before: { status: invitationStatus(current), expiresAt: current.expiresAt },
          after: { status: 'pending', expiresAt: row!.expiresAt },
        });
        await queueInvitationEmail(request, tx, row!, token);
        const dto = invitationDto(row!, {
          displayName: await inviterName(tx, row!.invitedByUserId),
        });
        return { ...dto, acceptUrl: invitationAcceptUrl(app.config.appOrigin, token) };
      });
    },
  );

  app.post(
    '/invitations/preview',
    {
      config: { auth: 'user', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['team'],
        summary: 'What the invitee may see before accepting (company, role, status, expiry)',
        body: AcceptInvitationRequestSchema,
        response: {
          200: z.object({
            orgDisplayName: z.string(),
            role: InvitationSchema.shape.role,
            status: InvitationSchema.shape.status,
            expiresAt: z.string(),
            invitedByName: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      requireUser(request);
      const hash = invitationTokenHash(request.body.token);
      // Platform operation 'invitation.preview': read-only lookup by token hash before membership.
      // Revoked and unknown tokens are indistinguishable (404).
      const [row] = await platformTx(request, 'invitation.preview', (tx) =>
        tx
          .select({
            orgDisplayName: organizations.displayName,
            role: invitations.role,
            status: invitations.status,
            expiresAt: invitations.expiresAt,
            invitedByName: users.displayName,
          })
          .from(invitations)
          .innerJoin(organizations, eq(organizations.id, invitations.orgId))
          .leftJoin(users, eq(users.id, invitations.invitedByUserId))
          .where(eq(invitations.tokenHash, hash)),
      );
      if (!row || row.status === 'revoked')
        throw problem('not_found', 'This invitation link is not valid.');
      const expired = row.status === 'pending' && row.expiresAt <= new Date();
      return {
        ...row,
        status: expired ? ('expired' as const) : row.status,
        expiresAt: row.expiresAt.toISOString(),
      };
    },
  );

  app.post(
    '/invitations/accept',
    {
      config: { auth: 'user', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['team'],
        summary:
          'Accept an invitation by token; joins the company and makes it the active workspace',
        body: AcceptInvitationRequestSchema,
        response: {
          200: MembershipSummarySchema,
        },
      },
    },
    async (request) => {
      const auth = requireUser(request);
      const hash = invitationTokenHash(request.body.token);
      // Platform operation 'invitation.accept': the caller is not a member yet, so the lookup is by
      // token hash across tenants. Every write below is scoped to the invitation's own org.
      const outcome = await platformTx(request, 'invitation.accept', async (tx) => {
        const [inv] = await tx
          .select()
          .from(invitations)
          .where(eq(invitations.tokenHash, hash))
          .for('update');
        if (!inv || inv.status === 'revoked') return { kind: 'invalid' as const };
        if (inv.status === 'accepted') {
          return inv.acceptedByUserId === auth.userId
            ? { kind: 'already' as const, inv }
            : { kind: 'invalid' as const };
        }
        const meta = { orgId: inv.orgId };
        if (inv.expiresAt <= new Date()) {
          // Expiry recovery (PLT-013 B): mark expired and tell whoever invited them to resend.
          await tx
            .update(invitations)
            .set({ status: 'expired', revision: inv.revision + 1 })
            .where(eq(invitations.id, inv.id));
          const [inviter] = await tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(
              and(
                eq(memberships.orgId, inv.orgId),
                eq(memberships.userId, inv.invitedByUserId),
                eq(memberships.status, 'active'),
              ),
            );
          if (inviter) {
            await tx.execute(sql`select set_config('app.org_id', ${inv.orgId}, true)`);
            await notify(tx, {
              ...meta,
              recipientMembershipId: inviter.id,
              category: 'invitation',
              title: `An invitation for ${inv.email} expired`,
              body: 'They tried to join after the link expired. Resend the invitation from Team.',
              link: '/team?tab=invitations',
              dedupeKey: `invitation-expired:${inv.id}:${inv.revision}`,
              channels: ['in_app'],
              correlationId: request.id,
            });
          }
          await auditRequest(request, tx, {
            ...meta,
            action: 'team.invitation_expired_attempt',
            resourceType: 'invitation',
            resourceId: inv.id,
          });
          return { kind: 'expired' as const };
        }
        const [existing] = await tx
          .select()
          .from(memberships)
          .where(and(eq(memberships.orgId, inv.orgId), eq(memberships.userId, auth.userId)));
        let membershipId: string;
        if (existing) {
          if (existing.status === 'active') {
            membershipId = existing.id;
          } else {
            await tx
              .update(memberships)
              .set({
                status: 'active',
                role: inv.role,
                suspendedAt: null,
                revision: existing.revision + 1,
              })
              .where(eq(memberships.id, existing.id));
            membershipId = existing.id;
          }
        } else {
          const [created] = await tx
            .insert(memberships)
            .values({
              orgId: inv.orgId,
              userId: auth.userId,
              role: inv.role,
              invitedByUserId: inv.invitedByUserId,
            })
            .returning({ id: memberships.id });
          membershipId = created!.id;
        }
        const [accepted] = await tx
          .update(invitations)
          .set({
            status: 'accepted',
            acceptedAt: new Date(),
            acceptedByUserId: auth.userId,
            revision: inv.revision + 1,
          })
          .where(eq(invitations.id, inv.id))
          .returning();
        const emailMatched = (auth.user.email ?? '').toLowerCase() === inv.email.toLowerCase();
        await auditRequest(request, tx, {
          ...meta,
          action: 'team.invitation_accepted',
          resourceType: 'invitation',
          resourceId: inv.id,
          after: { membershipId, role: inv.role, emailMatched },
        });
        await auditRequest(request, tx, {
          ...meta,
          action: existing ? 'team.member_reactivated' : 'team.member_added',
          resourceType: 'membership',
          resourceId: membershipId,
          after: { userId: auth.userId, role: inv.role },
        });
        return { kind: 'accepted' as const, inv: accepted!, membershipId };
      });
      if (outcome.kind === 'invalid')
        throw problem('not_found', 'This invitation link is not valid.');
      if (outcome.kind === 'expired') {
        throw problem(
          'invalid_transition',
          'This invitation expired. We asked the company to send you a new one.',
        );
      }
      const orgId = outcome.inv.orgId;
      const [row] = await platformTx(request, 'invitation.accept', (tx) =>
        tx
          .select({
            displayName: organizations.displayName,
            membershipId: memberships.id,
            role: memberships.role,
            status: memberships.status,
          })
          .from(memberships)
          .innerJoin(organizations, eq(organizations.id, memberships.orgId))
          .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, auth.userId))),
      );
      await setActiveOrg(app.db, auth.sessionId, orgId);
      return {
        orgId,
        orgDisplayName: row!.displayName,
        membershipId: row!.membershipId,
        role: row!.role,
        status: row!.status,
      };
    },
  );

  // ------------------------------------------------------------------ approval delegations
  const CreateDelegationSchema = z.object({
    fromMembershipId: UuidSchema,
    toMembershipId: UuidSchema,
    subjectTypes: z.array(ApprovalSubjectTypeSchema).min(1),
    maxAmountMinor: MinorUnitsSchema.positive().nullable().optional(),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(3).max(2000),
  });

  app.get(
    '/team/delegations',
    {
      config: { permission: 'team:read' },
      schema: {
        tags: ['team'],
        summary: 'Approval delegations (include expired/revoked with ?all=true)',
        querystring: z.object({ all: z.enum(['true', 'false']).default('false') }),
        response: {
          200: z.object({
            items: z.array(ApprovalDelegationSchema.extend({ active: z.boolean() })),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const now = new Date();
      const { rows, currency } = await tenantTx(request, async (tx) => {
        const [o] = await tx
          .select({ currency: organizations.currency })
          .from(organizations)
          .where(eq(organizations.id, org.orgId));
        const list = await tx
          .select()
          .from(approvalDelegations)
          .where(eq(approvalDelegations.orgId, org.orgId))
          .orderBy(desc(approvalDelegations.createdAt))
          .limit(200);
        return { rows: list, currency: o?.currency ?? 'USD' };
      });
      const items = rows
        .map((r) => ({
          ...delegationDto(r, currency),
          active: !r.revokedAt && r.startsAt <= now && r.endsAt > now,
        }))
        .filter((d) => request.query.all === 'true' || d.active);
      return { items, nextCursor: null };
    },
  );

  app.post(
    '/team/delegations',
    {
      config: { permission: 'team:manage_delegations' },
      schema: {
        tags: ['team'],
        summary: `Delegate approval authority for at most ${MAX_DELEGATION_DAYS} days`,
        body: CreateDelegationSchema,
        response: { 201: ApprovalDelegationSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
      const endsAt = new Date(body.endsAt);
      if (endsAt <= startsAt) throw problem('validation_failed', 'endsAt must be after startsAt.');
      if (endsAt.getTime() - startsAt.getTime() > MAX_DELEGATION_DAYS * 86_400_000) {
        throw problem(
          'validation_failed',
          `A delegation may last at most ${MAX_DELEGATION_DAYS} days.`,
        );
      }
      if (body.fromMembershipId === body.toMembershipId)
        throw problem('validation_failed', 'Delegate to someone else.');
      const dto = await tenantTx(request, async (tx) => {
        const members = await tx
          .select({ id: memberships.id, status: memberships.status })
          .from(memberships)
          .where(
            and(
              eq(memberships.orgId, org.orgId),
              inArray(memberships.id, [body.fromMembershipId, body.toMembershipId]),
            ),
          );
        if (members.length !== 2) throw problem('not_found');
        if (members.some((m) => m.status !== 'active'))
          throw problem('invalid_transition', 'Both members must be active.');
        const [o] = await tx
          .select({ currency: organizations.currency })
          .from(organizations)
          .where(eq(organizations.id, org.orgId));
        const [row] = await tx
          .insert(approvalDelegations)
          .values({
            orgId: org.orgId,
            fromMembershipId: body.fromMembershipId,
            toMembershipId: body.toMembershipId,
            subjectTypes: body.subjectTypes,
            maxAmountMinor: body.maxAmountMinor ?? null,
            startsAt,
            endsAt,
            reason: body.reason,
          })
          .returning();
        const out = delegationDto(row!, o?.currency ?? 'USD');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'team.delegation_created',
          resourceType: 'approval_delegation',
          resourceId: row!.id,
          after: out,
          reason: body.reason,
        });
        return out;
      });
      reply.status(201);
      return dto;
    },
  );

  app.post(
    '/team/delegations/:id/revoke',
    {
      config: { permission: 'team:manage_delegations' },
      schema: {
        tags: ['team'],
        summary: 'End a delegation now',
        params: IdParams,
        response: { 200: ApprovalDelegationSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [current] = await tx
          .select()
          .from(approvalDelegations)
          .where(
            and(
              eq(approvalDelegations.orgId, org.orgId),
              eq(approvalDelegations.id, request.params.id),
            ),
          );
        if (!current) throw problem('not_found');
        const [row] = current.revokedAt
          ? [current]
          : await tx
              .update(approvalDelegations)
              .set({ revokedAt: new Date() })
              .where(eq(approvalDelegations.id, current.id))
              .returning();
        const [o] = await tx
          .select({ currency: organizations.currency })
          .from(organizations)
          .where(eq(organizations.id, org.orgId));
        if (!current.revokedAt) {
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'team.delegation_revoked',
            resourceType: 'approval_delegation',
            resourceId: current.id,
          });
        }
        return delegationDto(row!, o?.currency ?? 'USD');
      });
    },
  );
};

export default teamModule;
