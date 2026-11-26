import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import {
  purchaseCommitmentAllocations as allocations,
  purchaseCommitmentDecisions as decisions,
  purchaseCommitmentRevisions as revisions,
} from '../../db/schema/enterprisePurchaseCommitments';
import {
  enterprisePurchaseCostCodes as codes,
  enterprisePurchaseOrders as orders,
} from '../../db/schema/enterprisePurchasing';

export type ProjectCommitmentScope = { orgId: string; projectId: string };
export type PurchaseCommitmentScope = ProjectCommitmentScope & { orderId: string };

export function purchaseCommitmentScope(scope: PurchaseCommitmentScope) {
  return {
    proposal: and(
      eq(revisions.orgId, scope.orgId),
      eq(revisions.projectId, scope.projectId),
      eq(revisions.orderId, scope.orderId),
    ),
    decision: and(
      eq(decisions.orgId, scope.orgId),
      eq(decisions.projectId, scope.projectId),
      eq(decisions.orderId, scope.orderId),
    ),
    allocation: and(
      eq(allocations.orgId, scope.orgId),
      eq(allocations.projectId, scope.projectId),
      eq(allocations.orderId, scope.orderId),
    ),
  };
}

export const decisionMatchesRevision = and(
  eq(decisions.orgId, revisions.orgId),
  eq(decisions.projectId, revisions.projectId),
  eq(decisions.orderId, revisions.orderId),
  eq(decisions.revisionId, revisions.id),
);

const decisionMatchesAllocation = and(
  eq(decisions.orgId, allocations.orgId),
  eq(decisions.projectId, allocations.projectId),
  eq(decisions.orderId, allocations.orderId),
  eq(decisions.revisionId, allocations.revisionId),
);

export async function activePurchaseCommitment(tx: Tx, scope: PurchaseCommitmentScope) {
  const [current] = await tx
    .select({ proposal: revisions, decision: decisions })
    .from(decisions)
    .innerJoin(revisions, decisionMatchesRevision)
    .where(and(purchaseCommitmentScope(scope).decision, isNotNull(decisions.activatedVersion)))
    .orderBy(desc(decisions.activatedVersion))
    .limit(1);
  return current;
}

export function purchaseCommitmentCostCodes(tx: Tx, scope: ProjectCommitmentScope) {
  return tx
    .select({ id: codes.id, code: codes.code, label: codes.label })
    .from(codes)
    .where(and(eq(codes.orgId, scope.orgId), eq(codes.projectId, scope.projectId)))
    .orderBy(asc(codes.code));
}

export function purchaseCommitmentBreakdown(
  tx: Tx,
  scope: PurchaseCommitmentScope,
  revisionIds: string[],
) {
  return tx
    .select({
      revisionId: allocations.revisionId,
      costCode: { id: codes.id, code: codes.code, label: codes.label },
      priorMinor: allocations.priorMinor,
      revisedMinor: allocations.revisedMinor,
      deltaMinor: allocations.deltaMinor,
    })
    .from(allocations)
    .innerJoin(
      codes,
      and(
        eq(codes.orgId, allocations.orgId),
        eq(codes.projectId, allocations.projectId),
        eq(codes.id, allocations.costCodeId),
      ),
    )
    .where(
      and(purchaseCommitmentScope(scope).allocation, inArray(allocations.revisionId, revisionIds)),
    )
    .orderBy(asc(codes.code));
}

export async function projectPurchaseCommitments(
  tx: Tx,
  scope: ProjectCommitmentScope,
  before?: Date,
) {
  const amount = sql<string>`sum(${allocations.deltaMinor})::text`;
  const rows = await tx
    .select({ costCodeId: codes.id, costCode: codes.code, amountMinor: amount })
    .from(allocations)
    .innerJoin(decisions, and(decisionMatchesAllocation, eq(decisions.outcome, 'approved')))
    .innerJoin(
      codes,
      and(
        eq(codes.orgId, scope.orgId),
        eq(codes.projectId, scope.projectId),
        eq(codes.id, allocations.costCodeId),
      ),
    )
    .where(
      and(
        eq(allocations.orgId, scope.orgId),
        eq(allocations.projectId, scope.projectId),
        before ? lt(decisions.createdAt, before) : undefined,
      ),
    )
    .groupBy(codes.id, codes.code)
    .having(sql`sum(${allocations.deltaMinor}) > 0`)
    .orderBy(asc(codes.code));
  return {
    rows,
    totalMinor: rows.reduce((total, line) => total + BigInt(line.amountMinor), 0n).toString(),
  };
}

export function orderHasCurrentCostCode(scope: ProjectCommitmentScope, code: string) {
  return sql<boolean>`exists (
    select 1
    from ${allocations}
    join ${decisions} on ${decisionMatchesAllocation}
    join ${codes} on ${codes.orgId} = ${scope.orgId} and ${codes.projectId} = ${scope.projectId}
      and ${codes.id} = ${allocations.costCodeId}
    where ${decisions.outcome} = 'approved'
      and ${allocations.orgId} = ${scope.orgId}
      and ${allocations.projectId} = ${scope.projectId}
      and ${allocations.orderId} = ${orders.id}
      and ${codes.code} = ${code}
    having sum(${allocations.deltaMinor}) > 0
  )`;
}
