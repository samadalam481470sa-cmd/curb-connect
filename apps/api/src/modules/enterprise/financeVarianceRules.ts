import { createHash } from 'node:crypto';
import {
  FinanceVariancePolicyPreview,
  FinanceVariancePolicyView,
  FinanceVarianceRuleRevision,
  PreviewFinanceVarianceRule,
  SetFinanceVarianceRule,
} from '@fieldline/contracts';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { financeVarianceRuleRevisions as policies } from '../../db/schema/enterpriseFinanceVariancePolicy';
import { enterprisePurchaseOrders as orders } from '../../db/schema/enterprisePurchasing';
import { memberships, users } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import { requireBudgetProject } from './budgetAccess';
import { triggersVarianceAlert } from './evaluateFinanceVariance';
import { loadPurchaseVarianceBudget } from './purchaseVarianceData';

const path = '/enterprise/finance/variance-policy';
const controller = { permission: 'bill:approve' } as const;
function dto(row: typeof policies.$inferSelect) {
  const { id, revision, reason, ownerMembershipId, createdAt } = row;
  let rule: z.infer<typeof FinanceVarianceRuleRevision>['rule'] = { kind: 'off' };
  if (row.kind === 'amount' && row.amountMinor !== null)
    rule = { kind: 'amount', amountMinor: row.amountMinor };
  if (row.kind === 'percent' && row.percentBps !== null)
    rule = { kind: 'percent', percentBps: row.percentBps };
  return { id, revision, rule, ownerMembershipId, reason, createdAt: createdAt.toISOString() };
}

export async function currentFinanceVarianceRule(tx: Tx, orgId: string) {
  const [row] = await tx
    .select()
    .from(policies)
    .where(eq(policies.orgId, orgId))
    .orderBy(desc(policies.revision))
    .limit(1);
  return row ? dto(row) : null;
}

function eligibleRecipient(orgId: string) {
  return and(
    eq(memberships.orgId, orgId),
    eq(memberships.status, 'active'),
    inArray(memberships.role, ['owner', 'admin']),
  );
}

const financeVarianceRules: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: controller,
      schema: { tags: ['enterprise'], response: { 200: FinanceVariancePolicyView } },
    },
    async (request, reply) => {
      const result = await tenantTx(request, async (tx) => {
        const { orgId } = requireOrg(request);
        await checkEnabled(tx, orgId);
        const [entries, recipients] = await Promise.all([
          tx
            .select()
            .from(policies)
            .where(eq(policies.orgId, orgId))
            .orderBy(desc(policies.revision))
            .limit(20),
          tx
            .select({ id: memberships.id, name: users.displayName })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(eligibleRecipient(orgId))
            .orderBy(users.displayName, memberships.id),
        ]);
        const history = entries.map(dto);
        return { current: history[0] ?? null, history, recipients };
      });
      setEtag(reply, result.current?.revision ?? 0);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    path + '/preview',
    {
      config: controller,
      schema: {
        tags: ['enterprise'],
        body: PreviewFinanceVarianceRule,
        response: { 200: FinanceVariancePolicyPreview },
      },
    },
    async (request, reply) => {
      const { projectId, orderId, rule } = request.body;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const [order] = await tx
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.orgId, org.orgId),
              eq(orders.projectId, projectId),
              eq(orders.id, orderId),
              eq(orders.status, 'draft'),
            ),
          );
        if (!order) throw problem('not_found');
        const basis = await loadPurchaseVarianceBudget(tx, { orgId: org.orgId, projectId });
        if (!basis)
          throw problem('conflict', 'Approve a USD project allocation before previewing an order.');
        const active = await currentFinanceVarianceRule(tx, org.orgId);
        const [activeRecipient] = active?.ownerMembershipId
          ? await tx
              .select({ id: memberships.id })
              .from(memberships)
              .where(
                and(eligibleRecipient(org.orgId), eq(memberships.id, active.ownerMembershipId)),
              )
          : [];
        const projected = BigInt(basis.committedMinor) + BigInt(order.amountMinor);
        return {
          projectId,
          orderId,
          orderRevision: order.revision,
          budgetVersion: basis.budgetVersion,
          allocationMinor: basis.allocationMinor.toString(),
          committedMinor: basis.committedMinor,
          proposedMinor: projected.toString(),
          currentAlert: Boolean(
            active &&
            activeRecipient &&
            triggersVarianceAlert(active.rule, basis.allocationMinor, projected),
          ),
          proposedAlert: triggersVarianceAlert(rule, basis.allocationMinor, projected),
        };
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.put(
    path,
    {
      config: controller,
      schema: {
        tags: ['enterprise'],
        body: SetFinanceVarianceRule,
        response: { 200: FinanceVarianceRuleRevision },
      },
    },
    async (request, reply) => {
      const expected = parseIfMatch(request);
      const { clientRequestId, rule, ownerMembershipId, reason } = request.body;
      const hash = createHash('sha256')
        .update(JSON.stringify({ expected, rule, ownerMembershipId, reason }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const { orgId, userId } = requireOrg(request);
        await tx
          .select({ orgId: enterpriseSettings.orgId })
          .from(enterpriseSettings)
          .where(eq(enterpriseSettings.orgId, orgId))
          .for('update');
        await checkEnabled(tx, orgId);
        const [receipt] = await tx
          .select()
          .from(policies)
          .where(and(eq(policies.orgId, orgId), eq(policies.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.requestHash !== hash || receipt.createdByUserId !== userId)
            throw problem('conflict', 'This request already saved a different threshold.');
          return dto(receipt);
        }
        const current = await currentFinanceVarianceRule(tx, orgId);
        assertRevision(current?.revision ?? 0, expected);
        if (ownerMembershipId) {
          const [recipient] = await tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(and(eligibleRecipient(orgId), eq(memberships.id, ownerMembershipId)));
          if (!recipient)
            throw problem('validation_failed', 'Choose an active company owner or administrator.');
        }
        const [row] = await tx
          .insert(policies)
          .values({
            orgId,
            revision: expected + 1,
            kind: rule.kind,
            amountMinor: rule.kind === 'amount' ? rule.amountMinor : null,
            percentBps: rule.kind === 'percent' ? rule.percentBps : null,
            ownerMembershipId,
            reason,
            createdByUserId: userId,
            clientRequestId,
            requestHash: hash,
          })
          .returning();
        if (!row) throw problem('internal');
        const saved = dto(row);
        await auditRequest(request, tx, {
          orgId,
          resourceType: 'enterprise_finance_variance_rule',
          resourceId: saved.id,
          action: 'variance.policy_changed',
          reason,
          before: current,
          after: saved,
        });
        return saved;
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
};

export default financeVarianceRules;
