import { createHash } from 'node:crypto';
import { EnterpriseBudgetGrant, SetEnterpriseBudgetGrant } from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { financeProjectGrants as grants } from '../../db/schema/enterpriseFinance';
import { memberships } from '../../db/schema/team';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { checkEnabled, checkProject } from './access';

export const budgetPath = '/enterprise/projects/:projectId/budget';
export const BudgetProjectParams = z.object({ projectId: z.uuid() });

async function latestGrant(tx: Tx, orgId: string, projectId: string, membershipId: string) {
  const [record] = await tx
    .select()
    .from(grants)
    .where(
      and(
        eq(grants.orgId, orgId),
        eq(grants.projectId, projectId),
        eq(grants.membershipId, membershipId),
      ),
    )
    .orderBy(desc(grants.revision))
    .limit(1);
  return record;
}

export async function requireBudgetProject(
  request: FastifyRequest,
  tx: Tx,
  projectId: string,
  lock: boolean | 'share' = 'share',
) {
  const org = requireOrg(request);
  await checkEnabled(tx, org.orgId);
  const project = await checkProject(tx, org.orgId, projectId, lock);
  if (
    !org.permissions.has('enterprise_budget:manage_grants') &&
    !(await latestGrant(tx, org.orgId, projectId, org.membershipId))?.active
  ) {
    throw problem('not_found');
  }
  return { org, project };
}

function grantDto(row: typeof grants.$inferSelect) {
  const { membershipId, active, reason, revision, createdAt } = row;
  return { membershipId, active, reason, revision, createdAt: createdAt.toISOString() };
}

const budgetGrants: FastifyPluginAsyncZod = async (app) => {
  const path = budgetPath + '/grants/:membershipId';
  const params = BudgetProjectParams.extend({ membershipId: z.uuid() });

  app.get(
    path,
    {
      config: { permission: 'enterprise_budget:manage_grants' },
      schema: {
        tags: ['enterprise'],
        params,
        response: { 200: z.object({ grant: EnterpriseBudgetGrant.nullable() }) },
      },
    },
    async (request, reply) => {
      const { projectId, membershipId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const row = await latestGrant(tx, org.orgId, projectId, membershipId);
        return row ? grantDto(row) : null;
      });
      setEtag(reply, result?.revision ?? 0);
      return reply.header('cache-control', 'private, no-store').send({ grant: result });
    },
  );

  app.put(
    path,
    {
      config: { permission: 'enterprise_budget:manage_grants' },
      schema: {
        tags: ['enterprise'],
        params,
        body: SetEnterpriseBudgetGrant,
        response: { 200: EnterpriseBudgetGrant },
      },
    },
    async (request, reply) => {
      const { projectId, membershipId } = request.params;
      const { clientRequestId, active, reason } = request.body;
      const expected = parseIfMatch(request);
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ membershipId, active, reason, expected }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = and(eq(grants.orgId, org.orgId), eq(grants.projectId, projectId));
        const [receipt] = await tx
          .select()
          .from(grants)
          .where(and(scope, eq(grants.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.requestHash !== requestHash || receipt.createdByUserId !== org.userId)
            throw problem('conflict', 'This request already changed a different budget grant.');
          return grantDto(receipt);
        }
        const [member] = await tx
          .select({ role: memberships.role, status: memberships.status })
          .from(memberships)
          .where(and(eq(memberships.orgId, org.orgId), eq(memberships.id, membershipId)));
        if (!member) throw problem('not_found');
        if (
          active &&
          (member.status !== 'active' || !['estimator', 'finance'].includes(member.role))
        )
          throw problem('conflict', 'Choose an active estimator or finance member.');
        const before = await latestGrant(tx, org.orgId, projectId, membershipId);
        const revision = before?.revision ?? 0;
        assertRevision(revision, expected);
        const [saved] = await tx
          .insert(grants)
          .values({
            orgId: org.orgId,
            projectId,
            membershipId,
            revision: revision + 1,
            clientRequestId,
            requestHash,
            active,
            reason,
            createdByUserId: org.userId,
          })
          .returning();
        if (!saved) throw problem('internal');
        const grant = grantDto(saved);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_budget_project_grant',
          resourceId: saved.id,
          action: 'budget.project_grant_changed',
          reason,
          before: before ? grantDto(before) : null,
          after: { projectId, ...grant },
        });
        return grant;
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
};

export default budgetGrants;
