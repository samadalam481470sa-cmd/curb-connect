// A user's memberships across organizations. Readable without an active org because the
// memberships/organizations RLS policies also match app.user_id (workspace switcher, /v1/me).
import type { MemberRole, MembershipStatus } from '@fieldline/contracts';
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { withTenant } from '../db/runtime';
import { memberships, organizations } from '../db/schema';

export interface MembershipSummary {
  membershipId: string;
  orgId: string;
  orgDisplayName: string;
  role: MemberRole;
  status: MembershipStatus;
  orgActive: boolean;
}

export async function membershipsForUser(db: Database, userId: string): Promise<MembershipSummary[]> {
  return withTenant(db, { orgId: null, userId }, async (tx) => {
    const rows = await tx
      .select({
        membershipId: memberships.id,
        orgId: memberships.orgId,
        orgDisplayName: organizations.displayName,
        orgStatus: organizations.status,
        role: memberships.role,
        status: memberships.status,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(organizations.displayName));
    return rows.map(({ orgStatus, ...row }) => ({ ...row, orgActive: orgStatus === 'active' }));
  });
}

/** The org to open after sign-in: only when exactly one usable membership exists (PLT-013 B). */
export function defaultActiveOrg(list: readonly MembershipSummary[]): string | null {
  const usable = list.filter((m) => m.status === 'active' && m.orgActive);
  return usable.length === 1 ? usable[0]!.orgId : null;
}
