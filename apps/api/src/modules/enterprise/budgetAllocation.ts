import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import {
  financeBudgetApprovals as baselineApprovals,
  financeBudgetLines as baselineLines,
} from '../../db/schema/enterpriseFinance';
import {
  financeBudgetRevisionDecisions as decisions,
  financeBudgetRevisionDeltas as deltas,
} from '../../db/schema/enterpriseBudgetRevisions';

export type BudgetScope = { orgId: string; projectId: string; budgetId: string };

export async function approvedBudgetAllocation(tx: Tx, scope: BudgetScope, before?: Date) {
  const [baseline] = await tx
    .select({
      version: baselineApprovals.revision,
      amountMinor: baselineApprovals.amountMinor,
    })
    .from(baselineApprovals)
    .where(
      and(
        eq(baselineApprovals.orgId, scope.orgId),
        eq(baselineApprovals.projectId, scope.projectId),
        eq(baselineApprovals.budgetId, scope.budgetId),
        before ? lt(baselineApprovals.createdAt, before) : undefined,
      ),
    );
  if (!baseline) return null;

  const [latest] = await tx
    .select({ version: decisions.activatedVersion })
    .from(decisions)
    .where(
      and(
        eq(decisions.orgId, scope.orgId),
        eq(decisions.projectId, scope.projectId),
        eq(decisions.budgetId, scope.budgetId),
        isNotNull(decisions.activatedVersion),
        before ? lt(decisions.createdAt, before) : undefined,
      ),
    )
    .orderBy(desc(decisions.activatedVersion))
    .limit(1);

  const base = await tx
    .select({ costCodeId: baselineLines.costCodeId, amountMinor: baselineLines.amountMinor })
    .from(baselineLines)
    .where(
      and(
        eq(baselineLines.orgId, scope.orgId),
        eq(baselineLines.projectId, scope.projectId),
        eq(baselineLines.budgetId, scope.budgetId),
        lt(baselineLines.revision, baseline.version),
      ),
    );

  const changes = await tx
    .select({
      costCodeId: deltas.costCodeId,
      amountMinor: sql<string>`sum(${deltas.deltaMinor})::text`,
    })
    .from(deltas)
    .innerJoin(
      decisions,
      and(
        eq(decisions.orgId, deltas.orgId),
        eq(decisions.projectId, deltas.projectId),
        eq(decisions.budgetId, deltas.budgetId),
        eq(decisions.revisionId, deltas.revisionId),
        eq(decisions.outcome, 'approved'),
      ),
    )
    .where(
      and(
        eq(deltas.orgId, scope.orgId),
        eq(deltas.projectId, scope.projectId),
        eq(deltas.budgetId, scope.budgetId),
        before ? lt(decisions.createdAt, before) : undefined,
      ),
    )
    .groupBy(deltas.costCodeId);

  const byCostCode = new Map(
    base.map(({ costCodeId, amountMinor }) => [costCodeId, BigInt(amountMinor)]),
  );
  let approvedChangeMinor = 0n;
  for (const { costCodeId, amountMinor } of changes) {
    const amount = BigInt(amountMinor);
    byCostCode.set(costCodeId, (byCostCode.get(costCodeId) ?? 0n) + amount);
    approvedChangeMinor += amount;
  }
  return {
    version: latest?.version ?? baseline.version,
    baseMinor: baseline.amountMinor,
    approvedChangeMinor,
    currentMinor: baseline.amountMinor + approvedChangeMinor,
    byCostCode,
  };
}
