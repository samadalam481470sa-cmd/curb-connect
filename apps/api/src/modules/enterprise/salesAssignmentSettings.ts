import { createHash } from 'node:crypto';
import {
  SalesAssignmentPolicy,
  SalesTerritory,
  SalesTerritoryInput,
  SalesTerritoryOptions,
  SetSalesAssignmentPolicy,
} from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Tx } from '../../db/runtime';
import {
  salesAssignmentPolicyRevisions as policy,
  salesTerritoryRevisions as territories,
} from '../../db/schema/enterpriseSalesAssignments';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import {
  activeSalesCommunities,
  activeTerritoryCount,
  assignmentPolicy,
  latestTerritories,
  lockSalesAssignments,
  pipelineKey,
  salespeople,
} from './salesAssignmentEligibility';

const path = '/enterprise/sales/assignment-settings';
const manage = { permission: 'enterprise_sales:manage' } as const;
type Person = { id: string; name: string };
type Territory = typeof territories.$inferSelect;

function territoryDto(row: Territory, membership: Person, community: Person | null) {
  const { id, capacity, active, revision, reason } = row;
  return { id, membership, community, capacity, active, revision, reason };
}

function requestHash(input: unknown, expected: number) {
  return createHash('sha256')
    .update(JSON.stringify([input, expected]))
    .digest('hex');
}

async function policySettings(tx: Tx, orgId: string) {
  const [rows, count] = await Promise.all([
    assignmentPolicy(tx, orgId, 20),
    activeTerritoryCount(tx, orgId),
  ]);
  return {
    enabled: rows[0]?.enabled ?? false,
    revision: rows[0]?.revision ?? 0,
    history: rows.map(({ enabled, revision, reason, createdAt }) => ({
      enabled,
      revision,
      reason,
      recordedAt: createdAt.toISOString(),
    })),
    activeTerritoryCount: count,
  };
}

const salesAssignmentSettings: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path + '/territories',
    {
      config: manage,
      schema: { tags: ['enterprise'], response: { 200: SalesTerritoryOptions } },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const [roster, communities, records] = await Promise.all([
          salespeople(tx, orgId),
          activeSalesCommunities(tx, orgId),
          latestTerritories(tx, orgId),
        ]);
        const byRep = new Map(roster.map((item) => [item.id, item]));
        const byCommunity = new Map(communities.map((item) => [item.id, item]));
        return {
          salespeople: roster,
          communities,
          territories: records.flatMap((row) => {
            const rep = byRep.get(row.membershipId);
            const community = row.communityId ? byCommunity.get(row.communityId) : null;
            return rep && community !== undefined ? [territoryDto(row, rep, community)] : [];
          }),
        };
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.put(
    path + '/territories',
    {
      config: manage,
      schema: {
        tags: ['enterprise'],
        body: SalesTerritoryInput,
        response: { 200: SalesTerritory },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const expected = parseIfMatch(request);
      const { membershipId, communityId, reason, clientRequestId } = request.body;
      const hash = requestHash(request.body, expected);
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await lockSalesAssignments(tx, orgId);
        const [roster, communities] = await Promise.all([
          salespeople(tx, orgId),
          activeSalesCommunities(tx, orgId),
        ]);
        const membership = roster.find(({ id }) => id === membershipId);
        const community = communityId ? communities.find(({ id }) => id === communityId) : null;
        if (!membership || community === undefined)
          throw problem('not_found', 'Choose an active salesperson and an available community.');
        const [receipt] = await tx
          .select()
          .from(territories)
          .where(
            and(eq(territories.orgId, orgId), eq(territories.clientRequestId, clientRequestId)),
          );
        if (receipt) {
          if (receipt.actorUserId !== userId || receipt.requestHash !== hash)
            throw problem('conflict', 'This request already saved different territory settings.');
          return territoryDto(receipt, membership, community);
        }
        const current = (await latestTerritories(tx, orgId)).find(
          (row) => row.membershipId === membershipId && row.communityId === communityId,
        );
        assertRevision(current?.revision ?? 0, expected);
        const [row] = await tx
          .insert(territories)
          .values({
            ...request.body,
            orgId,
            requestHash: hash,
            actorUserId: userId,
            revision: expected + 1,
          })
          .returning();
        if (!row) throw problem('internal');
        const after = territoryDto(row, membership, community);
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.territory_saved',
          resourceType: 'enterprise_sales_territory',
          resourceId: row.id,
          before: current ? territoryDto(current, membership, community) : null,
          after,
          reason,
        });
        return after;
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.get(
    path + '/round-robin',
    {
      config: manage,
      schema: { tags: ['enterprise'], response: { 200: SalesAssignmentPolicy } },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        return policySettings(tx, orgId);
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.put(
    path + '/round-robin',
    {
      config: manage,
      schema: {
        tags: ['enterprise'],
        body: SetSalesAssignmentPolicy,
        response: { 200: SalesAssignmentPolicy },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const expected = parseIfMatch(request);
      const { enabled, reason, clientRequestId } = request.body;
      const hash = requestHash(request.body, expected);
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await lockSalesAssignments(tx, orgId);
        const [receipt] = await tx
          .select()
          .from(policy)
          .where(
            and(
              eq(policy.orgId, orgId),
              eq(policy.pipelineKey, pipelineKey),
              eq(policy.clientRequestId, clientRequestId),
            ),
          );
        if (receipt) {
          if (receipt.actorUserId !== userId || receipt.requestHash !== hash)
            throw problem('conflict', 'This request already saved a different pipeline setting.');
          return policySettings(tx, orgId);
        }
        const current = await policySettings(tx, orgId);
        assertRevision(current.revision, expected);
        if (enabled && current.activeTerritoryCount === 0)
          throw problem(
            'conflict',
            'Configure an active sales territory before enabling round robin.',
          );
        const [row] = await tx
          .insert(policy)
          .values({
            ...request.body,
            orgId,
            pipelineKey,
            actorUserId: userId,
            requestHash: hash,
            revision: expected + 1,
          })
          .returning({ id: policy.id });
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.assignment_policy_saved',
          resourceType: 'enterprise_sales_assignment_policy',
          resourceId: row.id,
          before: { revision: current.revision, enabled: current.enabled },
          after: {
            revision: expected + 1,
            enabled,
            activeTerritoryCount: current.activeTerritoryCount,
          },
          reason,
        });
        return policySettings(tx, orgId);
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
};

export default salesAssignmentSettings;
