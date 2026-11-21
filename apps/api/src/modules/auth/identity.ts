// External identity -> internal user (PLT-013 D/S). Identity is (issuer, subject), never email.
// A new (issuer, subject) whose provider-verified email already belongs to an existing user is
// attached to that user automatically (no duplicate account, no "link in Settings" step).
// Unverified emails never reach this point.
import { and, eq, sql } from 'drizzle-orm';
import type { IdentityProvider } from '@fieldline/contracts';
import type { Database } from '../../db/client';
import { externalIdentities, users } from '../../db/schema';
import type { VerifiedIdentity } from './oidc';

export type IdentityResolution =
  | { kind: 'existing'; userId: string; identityId: string; userActive: boolean }
  | { kind: 'created'; userId: string; identityId: string }
  | { kind: 'link_required' }
  | { kind: 'unverified_email' };

export async function resolveIdentity(
  db: Database,
  provider: IdentityProvider,
  identity: VerifiedIdentity,
  now = new Date(),
): Promise<IdentityResolution> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        id: externalIdentities.id,
        userId: externalIdentities.userId,
        status: users.status,
      })
      .from(externalIdentities)
      .innerJoin(users, eq(users.id, externalIdentities.userId))
      .where(
        and(
          eq(externalIdentities.issuer, identity.issuer),
          eq(externalIdentities.subject, identity.subject),
        ),
      )
      .limit(1);
    if (found) {
      await tx
        .update(externalIdentities)
        .set({ lastSeenAt: now, emailAtLogin: identity.email })
        .where(eq(externalIdentities.id, found.id));
      if (found.status === 'active') {
        await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, found.userId));
      }
      return {
        kind: 'existing',
        userId: found.userId,
        identityId: found.id,
        userActive: found.status === 'active',
      };
    }

    // A new account needs an email the provider has verified, so nobody can claim someone else's
    // address (or its 7-day trial) with an unverified sign-in. Existing accounts are not affected.
    if (!identity.email || !identity.emailVerified) return { kind: 'unverified_email' };

    // Same address already belongs to a user (password account, or another provider). The provider has
    // verified this email, so attach the new sign-in to that user instead of stopping. The user gets
    // straight into the app; the trial / subscription / activation-key check still runs after this.
    const [owner] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${identity.email})`)
      .limit(1);
    if (owner) {
      const [linked] = await tx
        .insert(externalIdentities)
        .values({
          userId: owner.id,
          provider,
          issuer: identity.issuer,
          subject: identity.subject,
          emailAtLogin: identity.email,
          lastSeenAt: now,
        })
        .returning({ id: externalIdentities.id });
      if (owner.status === 'active') {
        await tx
          .update(users)
          // A raw Date inside sql`` reaches the driver untyped and crashes the sign-in, so pass it
          // as an ISO string with an explicit timestamptz cast.
          .set({
            lastLoginAt: now,
            emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now.toISOString()}::timestamptz)`,
          })
          .where(eq(users.id, owner.id));
      }
      return {
        kind: 'existing',
        userId: owner.id,
        identityId: linked!.id,
        userActive: owner.status === 'active',
      };
    }

    const [user] = await tx
      .insert(users)
      .values({
        displayName: identity.name ?? identity.email ?? 'New user',
        email: identity.email,
        // The provider has confirmed this address (its email_verified claim), so no link is needed.
        emailVerifiedAt: identity.emailVerified ? now : null,
        lastLoginAt: now,
      })
      .returning({ id: users.id });
    const [created] = await tx
      .insert(externalIdentities)
      .values({
        userId: user!.id,
        provider,
        issuer: identity.issuer,
        subject: identity.subject,
        emailAtLogin: identity.email,
        lastSeenAt: now,
      })
      .returning({ id: externalIdentities.id });
    return { kind: 'created', userId: user!.id, identityId: created!.id };
  });
}

export type LinkResult =
  { kind: 'linked'; identityId: string } | { kind: 'already_linked' } | { kind: 'in_use' };

/** Explicit account linking: attaches (issuer, subject) to the signed-in user. */
export async function linkIdentity(
  db: Database,
  userId: string,
  provider: IdentityProvider,
  identity: VerifiedIdentity,
): Promise<LinkResult> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ id: externalIdentities.id, userId: externalIdentities.userId })
      .from(externalIdentities)
      .where(
        and(
          eq(externalIdentities.issuer, identity.issuer),
          eq(externalIdentities.subject, identity.subject),
        ),
      )
      .limit(1);
    if (found) return found.userId === userId ? { kind: 'already_linked' } : { kind: 'in_use' };
    const [created] = await tx
      .insert(externalIdentities)
      .values({
        userId,
        provider,
        issuer: identity.issuer,
        subject: identity.subject,
        emailAtLogin: identity.email,
        lastSeenAt: new Date(),
      })
      .returning({ id: externalIdentities.id });
    return { kind: 'linked', identityId: created!.id };
  });
}
