// External identity -> internal user (PLT-013 D/S). Identity is (issuer, subject), never email.
// A new (issuer, subject) whose email already belongs to an existing user is NOT silently attached
// and NOT turned into a duplicate account: sign-in stops with `account_link_required`, and the
// user links the new identity explicitly (audited) after signing in with the original one.
import { and, eq, ne, sql } from 'drizzle-orm';
import type { IdentityProvider } from '@fieldline/contracts';
import type { Database } from '../../db/client';
import { externalIdentities, users } from '../../db/schema';
import type { VerifiedIdentity } from './oidc';

export type IdentityResolution =
  | { kind: 'existing'; userId: string; identityId: string; userActive: boolean }
  | { kind: 'created'; userId: string; identityId: string }
  | { kind: 'link_required' };

export async function resolveIdentity(
  db: Database,
  provider: IdentityProvider,
  identity: VerifiedIdentity,
  now = new Date(),
): Promise<IdentityResolution> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ id: externalIdentities.id, userId: externalIdentities.userId, status: users.status })
      .from(externalIdentities)
      .innerJoin(users, eq(users.id, externalIdentities.userId))
      .where(and(eq(externalIdentities.issuer, identity.issuer), eq(externalIdentities.subject, identity.subject)))
      .limit(1);
    if (found) {
      await tx
        .update(externalIdentities)
        .set({ lastSeenAt: now, emailAtLogin: identity.email })
        .where(eq(externalIdentities.id, found.id));
      if (found.status === 'active') {
        await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, found.userId));
      }
      return { kind: 'existing', userId: found.userId, identityId: found.id, userActive: found.status === 'active' };
    }

    if (identity.email) {
      // Same address already known under a different issuer: require explicit linking.
      const [clash] = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(externalIdentities, eq(externalIdentities.userId, users.id))
        .where(and(sql`lower(${users.email}) = lower(${identity.email})`, ne(externalIdentities.issuer, identity.issuer)))
        .limit(1);
      if (clash) return { kind: 'link_required' };
    }

    const [user] = await tx
      .insert(users)
      .values({
        displayName: identity.name ?? identity.email ?? 'New user',
        email: identity.email,
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

export type LinkResult = { kind: 'linked'; identityId: string } | { kind: 'already_linked' } | { kind: 'in_use' };

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
      .where(and(eq(externalIdentities.issuer, identity.issuer), eq(externalIdentities.subject, identity.subject)))
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
