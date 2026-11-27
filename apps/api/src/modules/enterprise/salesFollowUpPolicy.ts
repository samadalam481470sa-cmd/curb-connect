import { createHash } from 'node:crypto';
import { SalesFollowUpPolicy, SetSalesFollowUpPolicy } from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Tx } from '../../db/runtime';
import { salesFollowUpPolicyRevisions as rules } from '../../db/schema/enterpriseSalesInteractions';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import { lockSalesAssignments, pipelineKey } from './salesAssignmentEligibility';

export async function salesFollowUpPolicy(tx: Tx, orgId: string, limit = 1) {
  const history = await tx
    .select()
    .from(rules)
    .where(and(eq(rules.orgId, orgId), eq(rules.pipelineKey, pipelineKey)))
    .orderBy(desc(rules.revision))
    .limit(limit);
  return {
    enabled: history[0]?.enabled ?? true,
    revision: history[0]?.revision ?? 0,
    history: history.map(({ enabled, reason, revision, createdAt }) => ({
      enabled,
      reason,
      revision,
      recordedAt: createdAt.toISOString(),
    })),
  };
}

const path = '/enterprise/sales/assignment-settings/follow-up-reminders';
const config = { permission: 'enterprise_sales:manage' } as const;
const tags = ['enterprise'];

const salesFollowUpSettings: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    { config, schema: { tags, response: { 200: SalesFollowUpPolicy } } },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const policy = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        return salesFollowUpPolicy(tx, orgId, 25);
      });
      setEtag(reply, policy.revision);
      return reply.header('cache-control', 'private, no-store').send(policy);
    },
  );

  app.put(
    path,
    {
      config,
      schema: { tags, body: SetSalesFollowUpPolicy, response: { 200: SalesFollowUpPolicy } },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const expected = parseIfMatch(request);
      const { clientRequestId, enabled, reason } = request.body;
      const requestHash = createHash('sha256')
        .update(JSON.stringify([request.body, expected]))
        .digest('hex');
      const policy = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await lockSalesAssignments(tx, orgId);
        const [receipt] = await tx
          .select()
          .from(rules)
          .where(
            and(
              eq(rules.orgId, orgId),
              eq(rules.pipelineKey, pipelineKey),
              eq(rules.clientRequestId, clientRequestId),
            ),
          );
        if (receipt) {
          if (receipt.actorUserId !== userId || receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved different reminder settings.');
          return salesFollowUpPolicy(tx, orgId, 25);
        }
        const before = await salesFollowUpPolicy(tx, orgId);
        assertRevision(before.revision, expected);
        if (before.enabled === enabled)
          throw problem('conflict', 'The reminder setting already has this value.');
        const [row] = await tx
          .insert(rules)
          .values({
            ...request.body,
            orgId,
            pipelineKey,
            revision: expected + 1,
            actorUserId: userId,
            requestHash,
          })
          .returning();
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.follow_up_policy_saved',
          resourceType: 'enterprise_sales_follow_up_policy',
          resourceId: row.id,
          before: { enabled: before.enabled, revision: before.revision },
          after: { enabled, revision: row.revision },
          reason,
        });
        return salesFollowUpPolicy(tx, orgId, 25);
      });
      setEtag(reply, policy.revision);
      return reply.header('cache-control', 'private, no-store').send(policy);
    },
  );
};

export default salesFollowUpSettings;
