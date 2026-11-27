import {
  SalesDuplicatePolicy,
  SalesDuplicatePolicyHistory,
  UpdateSalesDuplicatePolicy,
} from '@fieldline/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Tx } from '../../db/runtime';
import { users } from '../../db/schema/auth';
import { salesDuplicatePolicyRevisions as policies } from '../../db/schema/enterpriseSalesDuplicateReview';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';

const path = '/enterprise/sales/duplicate-policy';
const config = { permission: 'enterprise_sales:manage' } as const;
const tags = ['enterprise'];
const cache = 'private, no-store';

function scoped(tx: Tx, orgId: string) {
  return tx
    .select({ policy: policies, updatedBy: users.displayName })
    .from(policies)
    .innerJoin(users, eq(policies.updatedByUserId, users.id))
    .where(eq(policies.orgId, orgId))
    .orderBy(desc(policies.revision));
}

function dto(row?: { policy: typeof policies.$inferSelect; updatedBy: string }) {
  return {
    enabled: row?.policy.enabled ?? true,
    revision: row?.policy.revision ?? 0,
    updatedAt: row?.policy.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
    reason: row?.policy.reason ?? null,
  };
}

export async function readDuplicatePolicy(tx: Tx, orgId: string) {
  const [row] = await tx
    .select({ enabled: policies.enabled, revision: policies.revision })
    .from(policies)
    .where(eq(policies.orgId, orgId))
    .orderBy(desc(policies.revision))
    .limit(1);
  return row ?? { enabled: true, revision: 0 };
}

export async function lockDuplicatePolicy(tx: Tx, orgId: string, shared = false) {
  const key = 'sales-duplicate-policy:' + orgId;
  if (shared) {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`);
  } else {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}

export const salesDuplicatePolicy: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config,
      schema: { tags, response: { 200: SalesDuplicatePolicyHistory } },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const response = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const rows = await scoped(tx, orgId).limit(10);
        return { current: dto(rows[0]), recent: rows.map(dto) };
      });
      setEtag(reply, response.current.revision);
      return reply.header('cache-control', cache).send(response);
    },
  );

  app.put(
    path,
    {
      config,
      schema: { tags, body: UpdateSalesDuplicatePolicy, response: { 200: SalesDuplicatePolicy } },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const expected = parseIfMatch(request);
      const { enabled, reason, clientRequestId } = request.body;
      const response = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await lockDuplicatePolicy(tx, orgId);
        const [prior] = await tx
          .select({ policy: policies, updatedBy: users.displayName })
          .from(policies)
          .innerJoin(users, eq(users.id, policies.updatedByUserId))
          .where(and(eq(policies.orgId, orgId), eq(policies.clientRequestId, clientRequestId)));
        if (prior) {
          if (
            prior.policy.enabled !== enabled ||
            prior.policy.reason !== reason ||
            prior.policy.revision !== expected + 1 ||
            prior.policy.updatedByUserId !== userId
          ) {
            throw problem('conflict', 'This request already belongs to another policy update.');
          }
          return dto(prior);
        }
        const [row] = await scoped(tx, orgId).limit(1);
        const before = dto(row);
        assertRevision(before.revision, expected);
        if (before.enabled === enabled) return before;
        const [saved] = await tx
          .insert(policies)
          .values({
            orgId,
            updatedByUserId: userId,
            revision: expected + 1,
            enabled,
            reason,
            clientRequestId,
          })
          .returning();
        if (!saved) throw problem('conflict', 'Unable to save the duplicate warning policy.');
        const [after] = await scoped(tx, orgId).limit(1);
        if (!after) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.duplicate_policy_changed',
          resourceType: 'enterprise_sales_duplicate_policy',
          resourceId: saved.id,
          before: { enabled: before.enabled, revision: before.revision },
          after: { enabled: saved.enabled, revision: saved.revision },
          reason,
        });
        return dto(after);
      });
      setEtag(reply, response.revision);
      return reply.header('cache-control', cache).send(response);
    },
  );
};
