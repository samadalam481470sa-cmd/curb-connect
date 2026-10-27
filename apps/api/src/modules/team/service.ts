// Team domain helpers shared by the team routes and the worker (PLT-015).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Member } from '@fieldline/contracts';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { approvalDelegations, memberships, users } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { enqueue } from '../../jobs/outbox';

export const INVITATION_TTL_DAYS = 7;
export const MAX_DELEGATION_DAYS = 90;

type MembershipRow = typeof memberships.$inferSelect;

export function memberDto(row: MembershipRow, user: { displayName: string; email: string | null }): Member {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    userId: row.userId,
    displayName: user.displayName,
    email: user.email,
    role: row.role,
    status: row.status,
    title: row.title,
    joinedAt: row.joinedAt.toISOString(),
  };
}

export async function loadMember(tx: Tx, orgId: string, membershipId: string) {
  const [row] = await tx
    .select({ m: memberships, displayName: users.displayName, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.id, membershipId)))
    .limit(1);
  return row ?? null;
}

/**
 * PLT-015 S: removing a member takes effect on their next request (auth-context re-checks the
 * membership), their delegations end now, and the `membership.revoked` job releases or cancels
 * their review work so no stale approval can be completed under their name.
 */
export async function onMembershipRemoved(
  tx: Tx,
  input: { orgId: string; membershipId: string; correlationId: string; reason: string | null },
): Promise<void> {
  const now = new Date();
  await tx
    .update(approvalDelegations)
    .set({ revokedAt: now })
    .where(
      and(
        eq(approvalDelegations.orgId, input.orgId),
        isNull(approvalDelegations.revokedAt),
        or(
          eq(approvalDelegations.fromMembershipId, input.membershipId),
          eq(approvalDelegations.toMembershipId, input.membershipId),
        ),
      ),
    );
  await enqueue(tx, {
    orgId: input.orgId,
    task: 'membership.revoked',
    aggregateType: 'membership',
    aggregateId: input.membershipId,
    payload: { membershipId: input.membershipId, reason: input.reason },
    correlationId: input.correlationId,
    jobKey: `membership.revoked:${input.membershipId}`,
  });
}

/** Delegations that are in force right now (expiry is honoured at read time). */
export async function activeDelegationsTo(tx: Tx, orgId: string, membershipId: string, now = new Date()) {
  return tx
    .select()
    .from(approvalDelegations)
    .where(
      and(
        eq(approvalDelegations.orgId, orgId),
        eq(approvalDelegations.toMembershipId, membershipId),
        isNull(approvalDelegations.revokedAt),
        lte(approvalDelegations.startsAt, now),
        gt(approvalDelegations.endsAt, now),
      ),
    );
}

// ---------------------------------------------------------------- invitation tokens
export function newInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function invitationTokenHash(token: string): string {
  return createHash('sha256').update(`invitation:${token}`).digest('hex');
}

/**
 * Job payloads are stored in clear text by graphile-worker, so the invitation token is sealed
 * (AES-256-GCM, key derived from SESSION_SECRET) before it enters the outbox.
 */
function sealKey(secret: string): Buffer {
  return createHash('sha256').update(`fieldline-seal-v1:${secret}`).digest();
}

export function sealSecret(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unsealSecret(secret: string, sealed: string): string {
  const raw = Buffer.from(sealed, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', sealKey(secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export function invitationAcceptUrl(appOrigin: string, token: string): string {
  return `${appOrigin}/invitations/accept#token=${token}`;
}
