import type { z } from 'zod';
import type { EnterpriseForecastRefreshSource, ForecastCostInput } from '@fieldline/contracts';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { organizations } from '../../db/schema';
import { enterpriseChangeOrders as changes } from '../../db/schema/enterprise';
import { financeBudgetBaselines as budgets } from '../../db/schema/enterpriseFinance';
import {
  enterpriseCostForecastLines as lines,
  enterpriseCostForecastSnapshots as snapshots,
} from '../../db/schema/enterpriseCostForecasts';
import { enterprisePurchaseCostCodes as codes } from '../../db/schema/enterprisePurchasing';
import { problem } from '../../http/problem';
import { actualBillCostTotals } from './actualBillCostTotals';
import { approvedBudgetAllocation } from './budgetAllocation';
import { calculateCostForecast } from './calculateCostForecast';
import { purchaseCommitmentCostCodes } from './purchaseCommitmentData';

type Scope = { orgId: string; projectId: string };
type Snapshot = typeof snapshots.$inferSelect;

export function forecastScope(scope: Scope) {
  return and(eq(snapshots.orgId, scope.orgId), eq(snapshots.projectId, scope.projectId));
}

export function loadForecastLines(tx: Tx, scope: Scope, forecastIds: string[]) {
  return tx
    .select({
      forecastId: lines.forecastId,
      costCode: { id: codes.id, code: codes.code, label: codes.label },
      approvedBudgetMinor: lines.approvedBudgetMinor,
      actualMinor: lines.actualMinor,
      remainingMinor: lines.remainingMinor,
      method: lines.method,
      percentCompleteBps: lines.percentCompleteBps,
    })
    .from(lines)
    .innerJoin(
      codes,
      and(
        eq(codes.orgId, lines.orgId),
        eq(codes.projectId, lines.projectId),
        eq(codes.id, lines.costCodeId),
      ),
    )
    .where(
      and(
        eq(lines.orgId, scope.orgId),
        eq(lines.projectId, scope.projectId),
        inArray(lines.forecastId, forecastIds),
      ),
    )
    .orderBy(asc(codes.code));
}

export type ForecastLines = Awaited<ReturnType<typeof loadForecastLines>>;

export function forecastDto(row: Snapshot, lines: ForecastLines) {
  const {
    orgId: _orgId,
    requestHash: _requestHash,
    clientRequestId: _clientRequestId,
    refreshKind,
    refreshResourceId,
    refreshEventId,
    priorForecastId,
    ...visible
  } = row;
  return {
    ...visible,
    ...(refreshKind && refreshResourceId && refreshEventId && priorForecastId
      ? {
          refreshSource: {
            kind: refreshKind,
            resourceId: refreshResourceId,
            sourceEventId: refreshEventId,
            priorForecastId,
          },
        }
      : {}),
    createdAt: row.createdAt.toISOString(),
    lines: lines.map(({ forecastId: _forecastId, ...line }) => line),
  };
}

async function contractValue(
  tx: Tx,
  scope: Scope,
  asOf: string,
  currency: string,
  original: number,
) {
  const [company] = await tx
    .select({
      currency: organizations.currency,
      timeZone: sql<string>`case when exists (
      select 1 from pg_catalog.pg_timezone_names where name = ${organizations.timezone}
    ) then ${organizations.timezone} else 'UTC' end`,
    })
    .from(organizations)
    .where(eq(organizations.id, scope.orgId));
  if (!company) throw problem('not_found');
  if (company.currency !== currency) return null;
  const [approved] = await tx
    .select({
      amount: sql<string>`coalesce(sum(${changes.amountDeltaMinor}), 0)::text`,
    })
    .from(changes)
    .where(
      and(
        eq(changes.orgId, scope.orgId),
        eq(changes.projectId, scope.projectId),
        eq(changes.status, 'approved'),
        lt(
          changes.approvedAt,
          sql`((${asOf}::date + 1)::timestamp at time zone ${company.timeZone})`,
        ),
      ),
    );
  return BigInt(original) + BigInt(approved?.amount ?? '0');
}

export async function buildForecastBasis(tx: Tx, scope: Scope) {
  const [budget] = await tx
    .select({ id: budgets.id, currency: budgets.currency, effectiveOn: budgets.effectiveOn })
    .from(budgets)
    .where(and(eq(budgets.orgId, scope.orgId), eq(budgets.projectId, scope.projectId)));
  if (!budget) return null;
  const allocation = await approvedBudgetAllocation(tx, { ...scope, budgetId: budget.id });
  return allocation ? { budget, allocation } : null;
}

type Basis = NonNullable<Awaited<ReturnType<typeof buildForecastBasis>>>;
type SaveInput = {
  asOf: string;
  estimates: z.infer<typeof ForecastCostInput>[];
  assumptions: string;
  originalContractMinor: number;
  actorUserId: string;
  clientRequestId: string;
  requestHash: string;
  refresh?: z.infer<typeof EnterpriseForecastRefreshSource>;
};

export async function writeForecastSnapshot(tx: Tx, scope: Scope, basis: Basis, input: SaveInput) {
  const { budget, allocation } = basis;
  const {
    asOf,
    assumptions,
    estimates,
    originalContractMinor,
    actorUserId,
    clientRequestId,
    requestHash,
    refresh,
  } = input;
  const [actualRows, costCodes, contractMinor] = await Promise.all([
    actualBillCostTotals(tx, scope, asOf),
    purchaseCommitmentCostCodes(tx, scope),
    contractValue(tx, scope, asOf, budget.currency, originalContractMinor),
  ]);
  const localActuals = actualRows.find(({ currency }) => currency === budget.currency);
  const actuals = new Map(
    localActuals?.rows.map((line) => [line.costCodeId, BigInt(line.amountMinor)]),
  );
  const unconvertedCurrencies = actualRows
    .map(({ currency }) => currency)
    .filter((currency) => currency !== budget.currency);
  const { lines: breakdown, ...totals } = calculateCostForecast({
    configuredCodeIds: new Set(costCodes.map(({ id }) => id)),
    allocation: allocation.byCostCode,
    actuals,
    estimates,
    contractMinor,
    unconvertedCurrencies,
  });
  const [saved] = await tx
    .insert(snapshots)
    .values({
      ...scope,
      ...totals,
      budgetId: budget.id,
      budgetVersion: allocation.version,
      currency: budget.currency,
      assumptions,
      asOf,
      unconvertedCurrencies,
      createdByUserId: actorUserId,
      clientRequestId,
      requestHash,
      createdAt: sql`clock_timestamp()`,
      ...(refresh && {
        refreshKind: refresh.kind,
        refreshResourceId: refresh.resourceId,
        refreshEventId: refresh.sourceEventId,
        priorForecastId: refresh.priorForecastId,
      }),
    })
    .returning();
  if (!saved) throw problem('internal');
  if (breakdown.length > 0) {
    await tx
      .insert(lines)
      .values(breakdown.map((line) => ({ ...scope, ...line, forecastId: saved.id })));
  }
  return forecastDto(saved, await loadForecastLines(tx, scope, [saved.id]));
}
