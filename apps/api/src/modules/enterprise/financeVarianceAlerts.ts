import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { enterprisePurchaseOrders as purchaseOrders } from '../../db/schema/enterprisePurchasing';
import { memberships } from '../../db/schema/team';
import { enqueue } from '../../jobs/outbox';
import { notify } from '../../services/notifications';
import { currentFinanceVarianceRule } from './financeVarianceRules';
import { triggersVarianceAlert } from './evaluateFinanceVariance';
import { loadPurchaseVarianceBudget, type PurchaseOrder } from './purchaseVarianceData';

export async function queueDraftPurchaseAdvisory(
  tx: Tx,
  order: PurchaseOrder,
  correlationId: string,
) {
  const { orgId, projectId, id: orderId, revision: orderRevision } = order;
  const policy = await currentFinanceVarianceRule(tx, orgId);
  if (!policy?.ownerMembershipId || policy.rule.kind === 'off' || order.status !== 'draft') return;
  const budget = await loadPurchaseVarianceBudget(tx, { orgId, projectId });
  if (!budget) return;
  const projected = BigInt(budget.committedMinor) + BigInt(order.amountMinor);
  if (!triggersVarianceAlert(policy.rule, budget.allocationMinor, projected)) return;
  await enqueue(tx, {
    orgId,
    task: 'variance.advisory_triggered',
    aggregateType: 'enterprise_purchase_order',
    aggregateId: orderId,
    payload: { projectId, orderId, orderRevision, ruleRevision: policy.revision },
    correlationId,
    jobKey: 'variance.advisory_triggered:' + orderId + ':' + orderRevision + ':' + policy.revision,
  });
}

type Delivery = {
  orgId: string;
  projectId: string;
  orderId: string;
  orderRevision: number;
  ruleRevision: number;
  eventId: string;
};

export async function deliverDraftPurchaseAdvisory(tx: Tx, scope: Delivery) {
  const [settings] = await tx
    .select({ enabled: enterpriseSettings.enabled })
    .from(enterpriseSettings)
    .where(eq(enterpriseSettings.orgId, scope.orgId))
    .for('share');
  if (!settings?.enabled) return;
  const policy = await currentFinanceVarianceRule(tx, scope.orgId);
  if (
    policy?.revision !== scope.ruleRevision ||
    !policy.ownerMembershipId ||
    policy.rule.kind === 'off'
  )
    return;

  const [order] = await tx
    .select({ amountMinor: purchaseOrders.amountMinor })
    .from(purchaseOrders)
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, scope.orgId),
        eq(memberships.id, policy.ownerMembershipId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['owner', 'admin']),
      ),
    )
    .where(
      and(
        eq(purchaseOrders.orgId, scope.orgId),
        eq(purchaseOrders.projectId, scope.projectId),
        eq(purchaseOrders.id, scope.orderId),
        eq(purchaseOrders.revision, scope.orderRevision),
        eq(purchaseOrders.status, 'draft'),
      ),
    );
  if (!order) return;
  const budget = await loadPurchaseVarianceBudget(tx, scope);
  if (
    !budget ||
    !triggersVarianceAlert(
      policy.rule,
      budget.allocationMinor,
      BigInt(budget.committedMinor) + BigInt(order.amountMinor),
    )
  )
    return;

  await notify(tx, {
    orgId: scope.orgId,
    recipientMembershipId: policy.ownerMembershipId,
    title: 'A draft purchase order reached your variance alert threshold',
    category: 'system',
    link:
      '/enterprise/projects/' + scope.projectId + '/purchase-orders/' + scope.orderId + '/variance',
    dedupeKey:
      'variance.advisory_triggered:' +
      scope.orderId +
      ':' +
      scope.orderRevision +
      ':' +
      scope.ruleRevision,
    channels: ['in_app'],
    correlationId: scope.eventId,
  });
}
