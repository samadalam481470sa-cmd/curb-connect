import { createHash } from 'node:crypto';
import {
  EnterpriseCostScenario,
  EnterpriseCostScenarioPage,
  EnterpriseCostScenarioResult,
  RunEnterpriseCostScenario,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { enterpriseCostForecastSnapshots as forecasts } from '../../db/schema/enterpriseCostForecasts';
import { enterpriseCostScenarios as scenarios } from '../../db/schema/enterpriseCostScenarios';
import { tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { BudgetProjectParams, requireBudgetProject } from './budgetAccess';
import { calculateCostForecast, type ForecastEstimate } from './calculateCostForecast';
import { loadForecastLines } from './costForecasts';

type Scope = { orgId: string; projectId: string };
const root = '/enterprise/projects/:projectId/cost-scenarios';

function scoped(scope: Scope) {
  return and(eq(scenarios.orgId, scope.orgId), eq(scenarios.projectId, scope.projectId));
}

function scenarioDto(row: typeof scenarios.$inferSelect) {
  const { id, projectId, forecastId, scenarioName, createdByUserId, createdAt } = row;
  return {
    ...row.result,
    id,
    projectId,
    forecastId,
    scenarioName,
    createdByUserId,
    createdAt: createdAt.toISOString(),
  };
}

const costScenarios: FastifyPluginAsyncZod = async (app) => {
  app.get(
    root,
    {
      config: { permission: 'enterprise_budget:read' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(30).default(10),
          forecastId: z.uuid().optional(),
        }),
        response: { 200: EnterpriseCostScenarioPage },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { limit, forecastId } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const rows = await tx
          .select()
          .from(scenarios)
          .where(
            and(
              scoped({ orgId: org.orgId, projectId }),
              beforeCursor(scenarios.createdAt, scenarios.id, cursor),
              forecastId ? eq(scenarios.forecastId, forecastId) : undefined,
            ),
          )
          .orderBy(desc(msTrunc(scenarios.createdAt)), desc(scenarios.id))
          .limit(limit + 1);
        return pageResult(rows, limit, ({ createdAt, id }) => ({ at: createdAt, id }), scenarioDto);
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    root,
    {
      config: { permission: 'enterprise_budget:run_scenario' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        body: RunEnterpriseCostScenario,
        response: { 200: EnterpriseCostScenario, 201: EnterpriseCostScenario },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { forecastId, scenarioName, clientRequestId } = request.body;
      const overrides = [...request.body.overrides].sort((left, right) =>
        left.costCodeId.localeCompare(right.costCodeId),
      );
      const expected = parseIfMatch(request);
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ forecastId, scenarioName, overrides, expected }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const [source] = await tx
          .select()
          .from(forecasts)
          .where(
            and(
              eq(forecasts.orgId, org.orgId),
              eq(forecasts.projectId, projectId),
              eq(forecasts.id, forecastId),
            ),
          );
        if (!source) throw problem('not_found');
        const [receipt] = await tx
          .select()
          .from(scenarios)
          .where(and(scoped(scope), eq(scenarios.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved a different scenario.');
          return { created: false, data: scenarioDto(receipt) };
        }
        assertRevision(source.budgetVersion, expected);
        const baseLines = await loadForecastLines(tx, scope, [forecastId]);
        const codeById = new Map(baseLines.map(({ costCode }) => [costCode.id, costCode]));
        const allocation = new Map<string, bigint>();
        const actuals = new Map<string, bigint>();
        const estimates = new Map<string, ForecastEstimate>();
        for (const line of baseLines) {
          const costCodeId = line.costCode.id;
          allocation.set(costCodeId, BigInt(line.approvedBudgetMinor));
          if (BigInt(line.actualMinor) > 0n) actuals.set(costCodeId, BigInt(line.actualMinor));
          if (line.method === 'percent_complete' && line.percentCompleteBps !== null)
            estimates.set(costCodeId, {
              costCodeId,
              method: line.method,
              percentCompleteBps: line.percentCompleteBps,
            });
          if (line.method === 'remaining_cost' && line.remainingMinor !== null)
            estimates.set(costCodeId, {
              costCodeId,
              method: line.method,
              remainingMinor: BigInt(line.remainingMinor),
            });
        }
        for (const adjustment of overrides) estimates.set(adjustment.costCodeId, adjustment);
        const {
          lines,
          contractMinor: _contractMinor,
          ...totals
        } = calculateCostForecast({
          configuredCodeIds: new Set(codeById.keys()),
          allocation,
          actuals,
          estimates: [...estimates.values()],
          contractMinor: source.contractMinor === null ? null : BigInt(source.contractMinor),
          unconvertedCurrencies: source.unconvertedCurrencies,
        });
        const summary = EnterpriseCostScenarioResult.parse({
          ...totals,
          sourceVersion: source.budgetVersion,
          asOf: source.asOf,
          currency: source.currency,
          priorEacMinor: source.eacMinor,
          priorMarginMinor: source.marginMinor,
          eacDifferenceMinor:
            totals.eacMinor === null || source.eacMinor === null
              ? null
              : (BigInt(totals.eacMinor) - BigInt(source.eacMinor)).toString(),
          unconvertedCurrencies: source.unconvertedCurrencies,
          overrides,
          lines: lines.map(({ costCodeId, ...line }) => ({
            ...line,
            costCode: codeById.get(costCodeId),
          })),
        });
        const [saved] = await tx
          .insert(scenarios)
          .values({
            ...scope,
            forecastId,
            scenarioName,
            result: summary,
            createdByUserId: org.userId,
            clientRequestId,
            requestHash,
          })
          .returning();
        if (!saved) throw problem('internal');
        const data = scenarioDto(saved);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'forecast.scenario_created',
          resourceType: 'enterprise_cost_scenario',
          resourceId: saved.id,
          before: null,
          after: data,
        });
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'forecast.scenario_created',
          aggregateType: 'enterprise_cost_scenario',
          aggregateId: saved.id,
          payload: { projectId, scenarioId: saved.id },
          jobKey: 'forecast.scenario_created:' + saved.id,
          correlationId: request.id,
        });
        return { created: true, data };
      });
      setEtag(reply, result.data.sourceVersion);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default costScenarios;
