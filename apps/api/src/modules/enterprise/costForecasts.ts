import { createHash } from 'node:crypto';
import {
  CreateEnterpriseCostForecast,
  EnterpriseScheduleDate,
  EnterpriseCostForecast,
  EnterpriseCostForecastPage,
} from '@fieldline/contracts';
import { and, asc, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { organizations } from '../../db/schema';
import { enterpriseChangeOrders as changes } from '../../db/schema/enterprise';
import { financeBudgetBaselines as budgets } from '../../db/schema/enterpriseFinance';
import {
  enterpriseCostForecastLines as lines,
  enterpriseCostForecastSnapshots as snapshots,
} from '../../db/schema/enterpriseCostForecasts';
import { enterprisePurchaseCostCodes as codes } from '../../db/schema/enterprisePurchasing';
import { tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { actualBillCostTotals } from './actualBillCostTotals';
import { BudgetProjectParams, requireBudgetProject } from './budgetAccess';
import { approvedBudgetAllocation } from './budgetAllocation';
import { calculateCostForecast } from './calculateCostForecast';
import { purchaseCommitmentCostCodes } from './purchaseCommitmentData';

type Scope = { orgId: string; projectId: string };
type Snapshot = typeof snapshots.$inferSelect;
const root = '/enterprise/projects/:projectId/forecasts';

function forecastScope(scope: Scope) {
  return and(eq(snapshots.orgId, scope.orgId), eq(snapshots.projectId, scope.projectId));
}

function loadForecastLines(tx: Tx, scope: Scope, forecastIds: string[]) {
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

type ForecastLines = Awaited<ReturnType<typeof loadForecastLines>>;

function dto(row: Snapshot, lines: ForecastLines) {
  const {
    orgId: _orgId,
    requestHash: _requestHash,
    clientRequestId: _clientRequestId,
    ...visible
  } = row;
  return {
    ...visible,
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

const costForecasts: FastifyPluginAsyncZod = async (app) => {
  app.get(
    root,
    {
      config: { permission: 'enterprise_budget:read' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          asOf: EnterpriseScheduleDate.optional(),
          limit: z.coerce.number().int().min(1).max(30).default(10),
        }),
        response: { 200: EnterpriseCostForecastPage },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const cursor = decodeCursor(request.query.cursor);
      const { limit, asOf } = request.query;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId };
        const saved = await tx
          .select()
          .from(snapshots)
          .where(
            and(
              forecastScope(scope),
              beforeCursor(snapshots.createdAt, snapshots.id, cursor),
              asOf ? lte(snapshots.asOf, asOf) : undefined,
            ),
          )
          .orderBy(desc(msTrunc(snapshots.createdAt)), desc(snapshots.id))
          .limit(limit + 1);
        const page = pageResult(
          saved,
          limit,
          (row) => ({ at: row.createdAt, id: row.id }),
          (row) => row,
        );
        const detail = await loadForecastLines(
          tx,
          scope,
          page.items.map(({ id }) => id),
        );
        const byForecast = new Map<string, ForecastLines>();
        for (const line of detail) {
          const prior = byForecast.get(line.forecastId) ?? [];
          prior.push(line);
          byForecast.set(line.forecastId, prior);
        }
        return { ...page, items: page.items.map((row) => dto(row, byForecast.get(row.id) ?? [])) };
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    root,
    {
      config: { permission: 'enterprise_budget:approve' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        body: CreateEnterpriseCostForecast,
        response: { 200: EnterpriseCostForecast, 201: EnterpriseCostForecast },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { asOf, assumptions, clientRequestId } = request.body;
      const estimates = [...request.body.remainingCostByCode].sort((left, right) =>
        left.costCodeId.localeCompare(right.costCodeId),
      );
      const expected = parseIfMatch(request);
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ asOf, assumptions, estimates, expected }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const { org, project } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const [receipt] = await tx
          .select()
          .from(snapshots)
          .where(and(forecastScope(scope), eq(snapshots.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved a different forecast.');
          return {
            created: false,
            data: dto(receipt, await loadForecastLines(tx, scope, [receipt.id])),
          };
        }
        const [budget] = await tx
          .select({ id: budgets.id, currency: budgets.currency, effectiveOn: budgets.effectiveOn })
          .from(budgets)
          .where(and(eq(budgets.orgId, org.orgId), eq(budgets.projectId, projectId)));
        if (!budget)
          throw problem('conflict', 'Approve the project budget before saving a forecast.');
        const allocation = await approvedBudgetAllocation(tx, { ...scope, budgetId: budget.id });
        if (!allocation)
          throw problem('conflict', 'Approve the project budget before saving a forecast.');
        if (asOf < budget.effectiveOn)
          throw problem(
            'validation_failed',
            'Choose a date on or after the budget effective date.',
          );
        assertRevision(allocation.version, expected);

        const [actualRows, costCodes, contractMinor] = await Promise.all([
          actualBillCostTotals(tx, scope, asOf),
          purchaseCommitmentCostCodes(tx, scope),
          contractValue(tx, scope, asOf, budget.currency, project.originalContractMinor),
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
            createdByUserId: org.userId,
            clientRequestId,
            requestHash,
          })
          .returning();
        if (!saved) throw problem('internal');
        if (breakdown.length > 0) {
          await tx.insert(lines).values(
            breakdown.map((line) => ({
              ...scope,
              ...line,
              forecastId: saved.id,
            })),
          );
        }
        const data = dto(saved, await loadForecastLines(tx, scope, [saved.id]));
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'forecast.snapshot_created',
          resourceType: 'enterprise_cost_forecast',
          resourceId: saved.id,
          before: null,
          after: data,
        });
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'forecast.snapshot_created',
          aggregateType: 'enterprise_cost_forecast',
          aggregateId: saved.id,
          payload: { projectId, forecastId: saved.id },
          correlationId: request.id,
          jobKey: 'forecast.snapshot_created:' + saved.id,
        });
        return { created: true, data };
      });
      setEtag(reply, result.data.budgetVersion);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default costForecasts;
