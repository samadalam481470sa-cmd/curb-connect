// Delete your own account (POST /v1/auth/account/delete).
//
// What happens, in order, inside one platform transaction (BYPASSRLS, scoped by the session's
// user id — never by a client-supplied id):
//   1. Memberships are read. If the person is the only active owner of a workspace that still
//      has other active members, deletion is refused: they must transfer ownership first
//      (POST /v1/team/transfer-ownership), because the workspace would be left ownerless.
//   2. Workspaces where the person is the only member are closed: every tenant row the
//      database allows to delete is deleted, then the workspace status becomes 'closed'.
//   3. Shared workspaces only lose the person's membership.
//   4. The person's auth records go: sessions, password credentials, external identities,
//      email verifications, password resets, and the users row.
//
// Why "closed" and not hard-deleted: the database deliberately makes some records immutable.
// Append-only tables (audit events, ledger entries, usage, consents, settings history, locked
// versions) reject DELETE with FL001/FL002, and every workspace has at least one settings
// revision from creation, so the workspace row itself can never be deleted while those rows
// exist. Closing keeps the promise the Privacy policy already makes — signed proposals, issued
// reports and payment records are retained as evidence — while the closed workspace has no
// members, so nobody can open it. Tables that still hold rows are reported back as
// `retainedTables`, so the caller can say so plainly instead of pretending everything is gone.
//
// What is deliberately NOT deleted: trial claims (keyed by email, so a deleted account cannot
// claim a second free trial) and the enterprise_suite append-only records (audit events,
// documents), which the platform role cannot delete by design.
//
// Deleting the account never cancels a Stripe subscription: there is no server-side cancel call
// in the billing code, only the checkout and the webhook. `hadActiveSubscription` tells the
// caller to show the cancel-by-email warning.
import { eq, sql } from 'drizzle-orm';
import type { DeleteAccountResponse } from '@fieldline/contracts';
import { approvalDelegations, emailVerifications, externalIdentities, memberships, organizations, passwordCredentials, passwordResets, sessions, users } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';

interface OrgTable {
  table_schema: string;
  table_name: string;
}

/** Tables with an org_id column, in the schemas the app owns tenant data in. */
async function tenantTables(tx: Tx): Promise<OrgTable[]> {
  const rows = (await tx.execute(sql`
    select table_schema, table_name from information_schema.columns
    where table_schema in ('public', 'enterprise_suite')
      and column_name = 'org_id'
    group by table_schema, table_name
    order by table_schema, table_name
  `)) as unknown as OrgTable[];
  return rows;
}

/** Rows left for one workspace across the given tables (one count query per table). */
async function remainingByTable(
  tx: Tx,
  tables: OrgTable[],
  orgId: string,
): Promise<Map<string, number>> {
  const remaining = new Map<string, number>();
  for (const table of tables) {
    const rows = (await tx.execute(sql`
      select count(*)::int as c from ${sql.identifier(table.table_schema)}.${sql.identifier(table.table_name)}
      where org_id = ${orgId}
    `)) as unknown as { c: number }[];
    const count = rows[0]?.c ?? 0;
    if (count > 0) remaining.set(`${table.table_schema}.${table.table_name}`, count);
  }
  return remaining;
}

async function totalRemaining(tx: Tx, tables: OrgTable[], orgId: string): Promise<number> {
  let total = 0;
  for (const count of (await remainingByTable(tx, tables, orgId)).values()) total += count;
  return total;
}

/**
 * Delete every deletable tenant row for one workspace. Each table's delete runs under its own
 * savepoint: a table the database refuses to delete (append-only records, locked versions,
 * enterprise_suite tables the platform role has no DELETE grant on) rolls back just that table
 * and is reported as retained, instead of failing the whole account deletion.
 */
async function deleteTenantRows(tx: Tx, tables: OrgTable[], orgId: string): Promise<void> {
  const deletable = tables.filter((t) => t.table_schema === 'public');
  const failed = new Set<string>();
  // Passes converge because child rows go before their parents (FK RESTRICT blocks a parent
  // delete while children remain; the next pass retries it). The pass cap is the table count.
  for (let pass = 0; pass <= deletable.length + 1; pass += 1) {
    const before = await totalRemaining(tx, deletable, orgId);
    if (before === 0) return;
    for (const table of deletable) {
      if (failed.has(table.table_name)) continue;
      try {
        await tx.execute(sql`SAVEPOINT account_delete_table`);
        await tx.execute(sql`
          delete from ${sql.identifier('public')}.${sql.identifier(table.table_name)}
          where org_id = ${orgId}
        `);
        await tx.execute(sql`RELEASE SAVEPOINT account_delete_table`);
      } catch {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT account_delete_table`);
        await tx.execute(sql`RELEASE SAVEPOINT account_delete_table`);
        failed.add(table.table_name);
      }
    }
    const after = await totalRemaining(tx, deletable, orgId);
    if (after >= before) return;
  }
}

/** Queued worker jobs for a closed workspace carry its data in their payload; drop them. */
async function deleteWorkerJobs(tx: Tx, orgId: string): Promise<void> {
  try {
    const rows = (await tx.execute(sql`
      select has_table_privilege('graphile_worker._private_jobs', 'DELETE') as allowed
    `)) as unknown as { allowed: boolean }[];
    if (!rows[0]?.allowed) return;
    await tx.execute(sql`
      delete from graphile_worker._private_jobs where payload ->> 'orgId' = ${orgId}
    `);
  } catch {
    // Job cleanup is best-effort: a leftover job fails harmlessly once its workspace is closed.
  }
}

export async function deleteAccountForUser(tx: Tx, userId: string): Promise<DeleteAccountResponse> {
  const memberRows = await tx
    .select({
      membershipId: memberships.id,
      orgId: memberships.orgId,
      role: memberships.role,
      status: memberships.status,
      orgDisplayName: organizations.displayName,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId));

  const orgIds = [...new Set(memberRows.map((m) => m.orgId))];
  const orgName = new Map(memberRows.map((m) => [m.orgId, m.orgDisplayName]));

  // A paid subscription keeps billing in Stripe after the account is gone: report it so the
  // caller warns the person to cancel by email first.
  const [activeSub] =
    orgIds.length > 0
      ? ((await tx.execute(sql`
          select id from ${sql.identifier('public')}.${sql.identifier('subscriptions')}
          where org_id = any(${orgIds}::uuid[])
            and status in ('trialing', 'active', 'past_due')
            and provider_subscription_id is not null
          limit 1
        `)) as unknown as { id: string }[])
      : [];
  const hadActiveSubscription = Boolean(activeSub);

  // Sole-owner guard: a workspace with other members must keep an owner.
  const organizationsClosed: { id: string; displayName: string }[] = [];
  const membershipsRemoved: { id: string; displayName: string }[] = [];
  const closeOrgIds: string[] = [];
  for (const orgId of orgIds) {
    const members = memberRows.filter((m) => m.orgId === orgId && m.status !== 'revoked');
    const myRow = memberRows.find((m) => m.orgId === orgId);
    const activeMembers = members.filter((m) => m.status === 'active');
    const activeOwners = activeMembers.filter((m) => m.role === 'owner');
    if (
      myRow?.role === 'owner' &&
      activeOwners.length === 1 &&
      activeOwners[0]?.membershipId === myRow.membershipId &&
      activeMembers.length > 1
    ) {
      throw problem(
        'conflict',
        `Transfer ownership of ${orgName.get(orgId) ?? 'this workspace'} first: it still has other members and would be left without an owner. Use Team to transfer ownership, then delete your account.`,
      );
    }
    if (members.length === 1) closeOrgIds.push(orgId);
    else membershipsRemoved.push({ id: orgId, displayName: orgName.get(orgId) ?? '' });
  }

  const tables = await tenantTables(tx);

  // Delegations name the person's memberships; they end when the membership ends.
  const myMembershipIds = memberRows.map((m) => m.membershipId);
  if (myMembershipIds.length > 0) {
    await tx
      .delete(approvalDelegations)
      .where(
        sql`${approvalDelegations.fromMembershipId} = any(${myMembershipIds}::uuid[]) or ${approvalDelegations.toMembershipId} = any(${myMembershipIds}::uuid[])`,
      );
  }
  await tx.delete(memberships).where(eq(memberships.userId, userId));

  // Close each solely-owned workspace: delete what the database allows, then close it.
  for (const orgId of closeOrgIds) {
    await deleteTenantRows(tx, tables, orgId);
    await deleteWorkerJobs(tx, orgId);
    await tx
      .update(organizations)
      .set({ status: 'closed' })
      .where(eq(organizations.id, orgId));
    organizationsClosed.push({ id: orgId, displayName: orgName.get(orgId) ?? '' });
  }

  // What is left behind, named honestly: append-only and locked records the database refuses
  // to delete, plus the enterprise_suite records the platform role cannot delete by design.
  const retainedTables: string[] = [];
  let enterpriseRecordsRetained = false;
  for (const orgId of closeOrgIds) {
    const remaining = await remainingByTable(tx, tables, orgId);
    for (const name of remaining.keys()) {
      if (!retainedTables.includes(name)) retainedTables.push(name);
      if (name.startsWith('enterprise_suite.')) enterpriseRecordsRetained = true;
    }
  }
  retainedTables.sort();

  // Auth records. memberships.user_id is RESTRICT, so memberships go first (done above); the
  // users row cascades to sessions, identities and password credentials, but each is deleted
  // explicitly so the result does not depend on the cascade. Email verifications and password
  // resets carry no foreign key, so they must be deleted explicitly.
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.delete(passwordCredentials).where(eq(passwordCredentials.userId, userId));
  await tx.delete(externalIdentities).where(eq(externalIdentities.userId, userId));
  await tx.delete(emailVerifications).where(eq(emailVerifications.userId, userId));
  await tx.delete(passwordResets).where(eq(passwordResets.userId, userId));
  await tx.delete(users).where(eq(users.id, userId));

  return {
    deleted: true as const,
    organizationsClosed,
    membershipsRemoved,
    retainedTables,
    enterpriseRecordsRetained,
    hadActiveSubscription,
  };
}
