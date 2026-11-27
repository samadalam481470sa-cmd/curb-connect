import { createHash } from 'node:crypto';
import {
  CreateEnterpriseCostForecast,
  EnterpriseScheduleDate,
  EnterpriseCostForecast,
  EnterpriseCostForecastPage,
} from '@fieldline/contracts';
import { and, desc, eq, lte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { enterpriseCostForecastSnapshots as snapshots } from '../../db/schema/enterpriseCostForecasts';
import { tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { BudgetProjectParams, requireBudgetProject } from './budgetAccess';

import {
  buildForecastBasis,
  forecastDto,
  forecastScope,
  loadForecastLines,
  type ForecastLines,
  writeForecastSnapshot,
} from './costForecastData';

export { loadForecastLines } from './costForecastData';

const root = '/enterprise/projects/:projectId/forecasts';

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
        return {
          ...page,
          items: page.items.map((row) => forecastDto(row, byForecast.get(row.id) ?? [])),
        };
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
            data: forecastDto(receipt, await loadForecastLines(tx, scope, [receipt.id])),
          };
        }
        const basis = await buildForecastBasis(tx, scope);
        if (!basis)
          throw problem('conflict', 'Approve the project budget before saving a forecast.');
        if (asOf < basis.budget.effectiveOn)
          throw problem(
            'validation_failed',
            'Choose a date on or after the budget effective date.',
          );
        assertRevision(basis.allocation.version, expected);
        const data = await writeForecastSnapshot(tx, scope, basis, {
          asOf,
          estimates,
          assumptions,
          originalContractMinor: project.originalContractMinor,
          actorUserId: org.userId,
          clientRequestId,
          requestHash,
        });
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'forecast.snapshot_created',
          resourceType: 'enterprise_cost_forecast',
          resourceId: data.id,
          before: null,
          after: data,
        });
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'forecast.snapshot_created',
          aggregateType: 'enterprise_cost_forecast',
          aggregateId: data.id,
          payload: { projectId, forecastId: data.id },
          correlationId: request.id,
          jobKey: 'forecast.snapshot_created:' + data.id,
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
