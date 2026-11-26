import { and, desc, eq } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { financeBudgetBaselines as budgets } from '../../db/schema/enterpriseFinance';
import type { enterprisePurchaseOrders as orders } from '../../db/schema/enterprisePurchasing';
import {
  purchaseVarianceRequests as requests,
  purchaseVarianceDecisions as decisions,
} from '../../db/schema/enterprisePurchaseVariances';
import { problem } from '../../http/problem';
import { approvedBudgetAllocation } from './budgetAllocation';
import { projectPurchaseCommitments } from './purchaseCommitmentData';

export type PurchaseOrder = typeof orders.$inferSelect;
export type VarianceRequest = typeof requests.$inferSelect;
export type VarianceDecision = typeof decisions.$inferSelect;
export type Scope = { orgId: string; projectId: string; orderId: string };

export function purchaseVarianceScope(scope: Scope) {
  return {
    request: and(
      eq(requests.orgId, scope.orgId),
      eq(requests.projectId, scope.projectId),
      eq(requests.orderId, scope.orderId),
    ),
    decision: and(
      eq(decisions.orgId, scope.orgId),
      eq(decisions.projectId, scope.projectId),
      eq(decisions.orderId, scope.orderId),
    ),
  };
}

export const varianceDecisionMatches = and(
  eq(decisions.orgId, requests.orgId),
  eq(decisions.projectId, requests.projectId),
  eq(decisions.orderId, requests.orderId),
  eq(decisions.varianceId, requests.id),
);

export async function latestPurchaseVariance(tx: Tx, scope: Scope) {
  const [record] = await tx
    .select({ request: requests, decision: decisions })
    .from(requests)
    .leftJoin(decisions, varianceDecisionMatches)
    .where(purchaseVarianceScope(scope).request)
    .orderBy(desc(requests.createdAt), desc(requests.id))
    .limit(1);
  return record;
}

export async function purchaseVarianceBasis(tx: Tx, scope: Scope, order: PurchaseOrder) {
  if (order.status !== 'draft') return null;
  const [budget] = await tx
    .select({ id: budgets.id, currency: budgets.currency })
    .from(budgets)
    .where(and(eq(budgets.orgId, scope.orgId), eq(budgets.projectId, scope.projectId)));
  if (!budget || budget.currency !== 'USD') return null;
  const allocation = await approvedBudgetAllocation(tx, { ...scope, budgetId: budget.id });
  if (!allocation) return null;
  const commitments = await projectPurchaseCommitments(tx, scope);
  const overrun =
    BigInt(commitments.totalMinor) + BigInt(order.amountMinor) - allocation.currentMinor;
  if (overrun <= 0n) return null;
  return {
    budgetId: budget.id,
    budgetVersion: allocation.version,
    orderRevision: order.revision,
    allocationMinor: allocation.currentMinor.toString(),
    committedMinor: commitments.totalMinor,
    orderMinor: String(order.amountMinor),
    overrunMinor: overrun.toString(),
  };
}

export type Basis = NonNullable<Awaited<ReturnType<typeof purchaseVarianceBasis>>>;

export function isCurrentVariance(request: VarianceRequest, current: Basis | null) {
  return (
    current !== null &&
    request.budgetId === current.budgetId &&
    request.budgetVersion === current.budgetVersion &&
    request.orderRevision === current.orderRevision &&
    request.committedMinor === current.committedMinor &&
    String(request.orderMinor) === current.orderMinor
  );
}

export function purchaseVarianceGate(
  reviewed: Awaited<ReturnType<typeof latestPurchaseVariance>>,
  basis: Basis | null,
) {
  if (!reviewed || !basis) return 'clear' as const;
  if (
    isCurrentVariance(reviewed.request, basis) &&
    reviewed.decision?.outcome === 'approved' &&
    BigInt(reviewed.decision.authorizedDeltaMinor) >= BigInt(basis.overrunMinor)
  )
    return 'approved' as const;
  return 'review_required' as const;
}

export async function assertPurchaseVarianceCleared(tx: Tx, order: PurchaseOrder) {
  const scope = { orgId: order.orgId, projectId: order.projectId, orderId: order.id };
  const checked = await latestPurchaseVariance(tx, scope);
  if (!checked) return;
  const current = await purchaseVarianceBasis(tx, scope, order);
  if (purchaseVarianceGate(checked, current) === 'review_required')
    throw problem(
      'conflict',
      'An owner must approve the current overrun before issuing this order.',
    );
}
