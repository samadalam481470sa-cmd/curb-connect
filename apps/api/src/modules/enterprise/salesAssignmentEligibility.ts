import { and, asc, count, desc, eq, gt, isNull, ne, notExists, or, sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import {
  salesAssignmentPolicyRevisions as policy,
  salesLeadAssignments as assignments,
  salesTerritoryRevisions as territories,
} from '../../db/schema/enterpriseSalesAssignments';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { landCommunities as communities } from '../../db/schema/landManagement';
import { users } from '../../db/schema/auth';
import { memberships, permissionOverrides } from '../../db/schema/team';

export const pipelineKey = 'home_sales' as const;

export function lockSalesAssignments(tx: Tx, orgId: string) {
  return tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'sales-assignment:' + orgId}, 0))`,
  );
}

export function salespeople(tx: Tx, orgId: string) {
  const deny = tx
    .select({ id: permissionOverrides.id })
    .from(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.orgId, orgId),
        eq(permissionOverrides.membershipId, memberships.id),
        eq(permissionOverrides.action, 'enterprise_sales:intake'),
        eq(permissionOverrides.effect, 'deny'),
        or(isNull(permissionOverrides.expiresAt), gt(permissionOverrides.expiresAt, new Date())),
      ),
    );
  return tx
    .select({ id: memberships.id, name: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.status, 'active'),
        eq(memberships.role, 'salesperson'),
        notExists(deny),
      ),
    );
}

export function activeSalesCommunities(tx: Tx, orgId: string) {
  return tx
    .select({ id: communities.id, name: communities.name })
    .from(communities)
    .where(and(eq(communities.orgId, orgId), ne(communities.status, 'built_out')));
}

export function latestTerritories(tx: Tx, orgId: string) {
  return tx
    .selectDistinctOn([territories.membershipId, territories.communityId])
    .from(territories)
    .where(eq(territories.orgId, orgId))
    .orderBy(territories.membershipId, territories.communityId, desc(territories.revision));
}

export function assignmentPolicy(tx: Tx, orgId: string, limit: number) {
  return tx
    .select()
    .from(policy)
    .where(and(eq(policy.orgId, orgId), eq(policy.pipelineKey, pipelineKey)))
    .orderBy(desc(policy.revision))
    .limit(limit);
}

export async function candidateTerritories(tx: Tx, orgId: string, communityId: string | null) {
  const roster = salespeople(tx, orgId).as('assignment_roster');
  const currentTerritories = latestTerritories(tx, orgId).as('latest_sales_territories');
  const openLeads = tx
    .select({
      membershipId: leads.ownerMembershipId,
      total: count().as('active_leads'),
    })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), sql`${leads.ownerMembershipId} is not null`))
    .groupBy(leads.ownerMembershipId)
    .as('lead_counts');
  const queueOrder = tx
    .select({
      membershipId: assignments.ownerMembershipId,
      last: sql<Date>`max(${assignments.createdAt})`.as('last_assignment'),
    })
    .from(assignments)
    .where(and(eq(assignments.orgId, orgId), eq(assignments.mode, 'round_robin')))
    .groupBy(assignments.ownerMembershipId)
    .as('queue_order');
  const rows = await tx
    .select({
      id: roster.id,
      name: roster.name,
      territoryId: currentTerritories.id,
      capacity: currentTerritories.capacity,
      activeLeads: sql<number>`coalesce(${openLeads.total}, 0)`.mapWith(Number),
    })
    .from(currentTerritories)
    .innerJoin(roster, eq(roster.id, currentTerritories.membershipId))
    .leftJoin(openLeads, eq(openLeads.membershipId, roster.id))
    .leftJoin(queueOrder, eq(queueOrder.membershipId, roster.id))
    .where(
      and(
        eq(currentTerritories.active, true),
        communityId
          ? eq(currentTerritories.communityId, communityId)
          : isNull(currentTerritories.communityId),
        sql`coalesce(${openLeads.total}, 0) < ${currentTerritories.capacity}`,
      ),
    )
    .orderBy(sql`${queueOrder.last} asc nulls first`, asc(roster.id));
  return rows;
}

export async function activeTerritoryCount(tx: Tx, orgId: string) {
  const roster = salespeople(tx, orgId).as('sales_roster');
  const territory = latestTerritories(tx, orgId).as('assignment_territories');
  const community = activeSalesCommunities(tx, orgId).as('active_sales_communities');
  const [result] = await tx
    .select({ total: count() })
    .from(territory)
    .innerJoin(roster, eq(roster.id, territory.membershipId))
    .leftJoin(community, eq(community.id, territory.communityId))
    .where(
      and(
        eq(territory.active, true),
        or(isNull(territory.communityId), sql`${community.id} is not null`),
      ),
    );
  return result?.total ?? 0;
}
