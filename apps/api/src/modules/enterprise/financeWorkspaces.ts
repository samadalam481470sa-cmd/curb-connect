import {
  EnterpriseFinanceProjectActivity,
  EnterpriseFinanceProjectPage,
} from '@fieldline/contracts';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { enterpriseProjects as projects } from '../../db/schema/enterprise';
import { enterpriseCostForecastSnapshots as forecasts } from '../../db/schema/enterpriseCostForecasts';
import { financeBudgetRevisionDecisions as budgetDecisions } from '../../db/schema/enterpriseBudgetRevisions';
import {
  financeBudgetApprovals as approvals,
  financeBudgetBaselines as budgets,
} from '../../db/schema/enterpriseFinance';
import { enterprisePurchaseOrders as orders } from '../../db/schema/enterprisePurchasing';
import {
  purchaseVarianceDecisions as varianceDecisions,
  purchaseVarianceRequests as variances,
} from '../../db/schema/enterprisePurchaseVariances';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { checkEnabled } from './access';
import {
  BudgetProjectParams,
  grantedFinanceProjectIds,
  requireBudgetProject,
} from './budgetAccess';
import { loadPurchaseVarianceBudget, varianceDecisionMatches } from './purchaseVarianceData';

const path = '/enterprise/finance/projects';
const permission = { permission: 'enterprise_budget:read' } as const;
type Activity = z.infer<typeof EnterpriseFinanceProjectActivity>['activity'][number];

const financeWorkspaces: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          projectId: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
        response: { 200: EnterpriseFinanceProjectPage },
      },
    },
    async (request, reply) => {
      const cursor = decodeCursor(request.query.cursor);
      const { limit, projectId } = request.query;
      const data = await tenantTx(request, async (tx) => {
        const org = requireOrg(request);
        await checkEnabled(tx, org.orgId);
        const found = await tx
          .select({ id: projects.id, name: projects.name, at: projects.createdAt })
          .from(projects)
          .where(
            and(
              eq(projects.orgId, org.orgId),
              org.permissions.has('enterprise_budget:manage_grants')
                ? undefined
                : sql`${projects.id} in (${grantedFinanceProjectIds(org)})`,
              projectId ? eq(projects.id, projectId) : undefined,
              beforeCursor(projects.createdAt, projects.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(projects.createdAt)), desc(projects.id))
          .limit(limit + 1);
        const page = pageResult(
          found,
          limit,
          ({ at, id }) => ({ at, id }),
          (row) => row,
        );
        const ids = page.items.map(({ id }) => id);
        const [budgetRows, forecastRows] = await Promise.all([
          tx
            .select({
              projectId: budgets.projectId,
              id: budgets.id,
              currency: budgets.currency,
              state: sql<
                'approved' | 'draft'
              >`case when ${approvals.id} is null then 'draft' else 'approved' end`,
              version: sql<number>`coalesce((
            select max(${budgetDecisions.activatedVersion})
            from ${budgetDecisions}
            where ${budgetDecisions.orgId} = ${org.orgId}
              and ${budgetDecisions.projectId} = ${budgets.projectId}
              and ${budgetDecisions.budgetId} = ${budgets.id}
          ), ${approvals.revision}, ${budgets.revision})`,
            })
            .from(budgets)
            .leftJoin(
              approvals,
              and(
                eq(approvals.orgId, budgets.orgId),
                eq(approvals.projectId, budgets.projectId),
                eq(approvals.budgetId, budgets.id),
              ),
            )
            .where(and(eq(budgets.orgId, org.orgId), inArray(budgets.projectId, ids))),
          tx
            .selectDistinctOn([forecasts.projectId], {
              projectId: forecasts.projectId,
              id: forecasts.id,
              asOf: forecasts.asOf,
              status: forecasts.status,
              eacMinor: forecasts.eacMinor,
              currency: forecasts.currency,
            })
            .from(forecasts)
            .where(and(eq(forecasts.orgId, org.orgId), inArray(forecasts.projectId, ids)))
            .orderBy(
              asc(forecasts.projectId),
              desc(forecasts.asOf),
              desc(forecasts.createdAt),
              desc(forecasts.id),
            ),
        ]);
        const budgetByProject = new Map(
          budgetRows.map(({ projectId, ...row }) => [projectId, row]),
        );
        const forecastByProject = new Map(
          forecastRows.map(({ projectId, ...row }) => [projectId, row]),
        );
        return {
          nextCursor: page.nextCursor,
          items: page.items.map(({ id, name }) => ({
            id,
            name,
            budget: budgetByProject.get(id) ?? null,
            forecast: forecastByProject.get(id) ?? null,
          })),
        };
      });
      return reply.header('cache-control', 'private, no-store').send(data);
    },
  );

  app.get(
    path + '/:projectId/activity',
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        response: { 200: EnterpriseFinanceProjectActivity },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const data = await tenantTx(request, async (tx) => {
        const { org, project } = await requireBudgetProject(request, tx, projectId);
        const orgId = org.orgId;
        const activity = await tx.execute<
          Omit<Activity, 'recordedAt'> & { recordedAt: Date | string }
        >(sql`
        select id as "recordId", kind, recorded_at as "recordedAt", order_id as "orderId" from (
          select id, 'baseline_approved' as kind, created_at as recorded_at, null::uuid as order_id
          from enterprise_suite.finance_budget_approvals where org_id = ${orgId} and project_id = ${projectId}
          union all
          select id, 'revision_requested', created_at, null::uuid
          from enterprise_suite.finance_budget_revision_requests where org_id = ${orgId} and project_id = ${projectId}
          union all
          select id, case when outcome = 'approved' then 'revision_approved' else 'revision_rejected' end,
            created_at, null::uuid
          from enterprise_suite.finance_budget_revision_decisions where org_id = ${orgId} and project_id = ${projectId}
          union all
          select revision_id, 'purchase_committed', created_at, order_id
          from enterprise_suite.purchase_commitment_decisions
          where org_id = ${orgId} and project_id = ${projectId} and outcome = 'approved'
          union all
          select id, 'variance_requested', created_at, order_id
          from enterprise_suite.purchase_variance_requests where org_id = ${orgId} and project_id = ${projectId}
          union all
          select variance_id, 'variance_decided', created_at, order_id
          from enterprise_suite.purchase_variance_decisions where org_id = ${orgId} and project_id = ${projectId}
          union all
          select id, 'bill_posted', created_at, null::uuid
          from enterprise_suite.actual_bill_postings where org_id = ${orgId} and project_id = ${projectId}
          union all
          select id, 'forecast_saved', created_at, null::uuid
          from enterprise_suite.cost_forecast_snapshots where org_id = ${orgId} and project_id = ${projectId}
          union all
          select id, 'scenario_saved', created_at, null::uuid
          from enterprise_suite.cost_scenarios where org_id = ${orgId} and project_id = ${projectId}
        ) as events order by recorded_at desc, id desc limit 12
      `);
        const budget = await loadPurchaseVarianceBudget(tx, { orgId, projectId });
        const latest = tx
          .selectDistinctOn([variances.orderId], { id: variances.id })
          .from(variances)
          .where(and(eq(variances.orgId, orgId), eq(variances.projectId, projectId)))
          .orderBy(asc(variances.orderId), desc(variances.createdAt), desc(variances.id))
          .as('latest_variances');
        const pending = !budget
          ? []
          : await tx
              .select({
                id: variances.id,
                orderId: variances.orderId,
                overrunMinor: variances.overrunMinor,
                budgetVersion: variances.budgetVersion,
                orderRevision: variances.orderRevision,
                requestedByUserId: variances.requestedByUserId,
              })
              .from(variances)
              .innerJoin(latest, eq(latest.id, variances.id))
              .innerJoin(
                orders,
                and(
                  eq(orders.orgId, variances.orgId),
                  eq(orders.projectId, variances.projectId),
                  eq(orders.id, variances.orderId),
                  eq(orders.revision, variances.orderRevision),
                  eq(orders.amountMinor, variances.orderMinor),
                ),
              )
              .leftJoin(varianceDecisions, varianceDecisionMatches)
              .where(
                and(
                  eq(variances.orgId, orgId),
                  eq(variances.projectId, projectId),
                  eq(orders.status, 'draft'),
                  isNull(varianceDecisions.varianceId),
                  eq(variances.budgetId, budget.budgetId),
                  eq(variances.budgetVersion, budget.budgetVersion),
                  eq(variances.committedMinor, budget.committedMinor),
                  sql`${orders.amountMinor} + ${budget.committedMinor}::numeric > ${budget.allocationMinor.toString()}::numeric`,
                ),
              )
              .orderBy(desc(variances.createdAt), desc(variances.id))
              .limit(20);
        const currentVariances = pending.map(({ requestedByUserId, ...variance }) => ({
          ...variance,
          canDecide:
            org.permissions.has('enterprise_budget:approve_overrun') &&
            requestedByUserId !== org.userId,
        }));
        return {
          projectId,
          projectName: project.name,
          activity: activity.map((event) => ({
            ...event,
            recordedAt: new Date(event.recordedAt).toISOString(),
          })),
          currentVariances,
        };
      });
      return reply.header('cache-control', 'private, no-store').send(data);
    },
  );
};

export default financeWorkspaces;
