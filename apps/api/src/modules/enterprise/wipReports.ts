import { createHash } from 'node:crypto';
import {
  EnterpriseWipOptions,
  EnterpriseWipReport,
  EnterpriseWipReportInput,
  EnterpriseWipReportPage,
  QueueEnterpriseWipReport,
} from '@fieldline/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { enterpriseCostPeriodRevisions as periods } from '../../db/schema/enterpriseActualBillCosts';
import { enterpriseProjects as projects } from '../../db/schema/enterprise';
import { enterpriseWipReports as reports } from '../../db/schema/enterpriseWipReports';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import { lockPeriod } from './actualBillCosts';
import { grantedFinanceProjectIds, requireBudgetProject } from './budgetAccess';
import { combineWipTotals, wipProjectRow } from './wipReportData';

const path = '/enterprise/finance/wip';
const permission = { permission: 'bill:approve' } as const;
const periodFields = {
  id: periods.id,
  monthStart: periods.monthStart,
  through: sql<string>`(${periods.monthStart} + interval '1 month' - interval '1 day')::date::text`,
  state: periods.state,
  revision: periods.revision,
};
const reportFields = {
  id: reports.id,
  request: reports.snapshot,
  status: reports.status,
  digest: reports.digest,
  completedAt: reports.completedAt,
  createdAt: reports.createdAt,
  errorCode: reports.errorCode,
};
type ReportRow = typeof reports.$inferSelect;
type Report = Pick<
  ReportRow,
  'id' | 'status' | 'digest' | 'completedAt' | 'createdAt' | 'errorCode'
> & {
  request: ReportRow['snapshot'];
};
type Actor = ReturnType<typeof requireOrg>;
const pageParams = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

function dto(row: Report) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function authorScope(org: Actor) {
  return and(eq(reports.orgId, org.orgId), eq(reports.requestedByUserId, org.userId));
}

async function selectReport(tx: Tx, org: Actor, reportId: string, withCsv = false) {
  const [row] = await tx
    .select({
      ...reportFields,
      projectIds: reports.projectIds,
      csvText: withCsv ? reports.csvText : sql<string | null>`null`,
    })
    .from(reports)
    .where(and(authorScope(org), eq(reports.id, reportId)));
  if (!row) throw problem('not_found');
  return row;
}

async function reportReceipt(tx: Tx, org: Actor, clientRequestId: string, hash: string) {
  const [prior] = await tx
    .select({ ...reportFields, requestHash: reports.requestHash })
    .from(reports)
    .where(and(authorScope(org), eq(reports.clientRequestId, clientRequestId)));
  if (!prior) return undefined;
  if (prior.requestHash !== hash)
    throw problem('conflict', 'This request already queued a different WIP report.');
  const { requestHash: _priorHash, ...report } = prior;
  return dto(report);
}

const wipReports: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path + '/options',
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        querystring: pageParams,
        response: { 200: EnterpriseWipOptions },
      },
    },
    async (request, reply) => {
      const { limit } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const data = await tenantTx(request, async (tx) => {
        const org = requireOrg(request);
        await checkEnabled(tx, org.orgId);
        const [availablePeriods, availableProjects] = await Promise.all([
          tx
            .selectDistinctOn([periods.monthStart], periodFields)
            .from(periods)
            .where(eq(periods.orgId, org.orgId))
            .orderBy(desc(periods.monthStart), desc(periods.revision)),
          tx
            .select({ id: projects.id, name: projects.name, at: projects.createdAt })
            .from(projects)
            .where(
              and(
                eq(projects.orgId, org.orgId),
                org.permissions.has('enterprise_budget:manage_grants')
                  ? undefined
                  : sql`${projects.id} in (${grantedFinanceProjectIds(org)})`,
                beforeCursor(projects.createdAt, projects.id, cursor),
              ),
            )
            .orderBy(desc(msTrunc(projects.createdAt)), desc(projects.id))
            .limit(limit + 1),
        ]);
        const page = pageResult(
          availableProjects,
          limit,
          ({ at, id }) => ({ at, id }),
          ({ id, name }) => ({ id, name }),
        );
        return {
          periods: availablePeriods,
          projects: page.items,
          nextProjectCursor: page.nextCursor,
        };
      });
      return reply.header('cache-control', 'private, no-store').send(data);
    },
  );

  app.get(
    path,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        querystring: pageParams,
        response: { 200: EnterpriseWipReportPage },
      },
    },
    async (request, reply) => {
      const { limit } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const data = await tenantTx(request, async (tx) => {
        const org = requireOrg(request);
        await checkEnabled(tx, org.orgId);
        const rows = await tx
          .select(reportFields)
          .from(reports)
          .where(
            and(
              authorScope(org),
              org.permissions.has('enterprise_budget:manage_grants')
                ? undefined
                : sql`${reports.projectIds} <@ array(${grantedFinanceProjectIds(org)})`,
              beforeCursor(reports.createdAt, reports.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(reports.createdAt)), desc(reports.id))
          .limit(limit + 1);
        return pageResult(rows, limit, ({ id, createdAt }) => ({ id, at: createdAt }), dto);
      });
      return reply.header('cache-control', 'private, no-store').send(data);
    },
  );

  app.get(
    path + '/:reportId',
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: z.object({ reportId: z.uuid() }),
        response: { 200: EnterpriseWipReport },
      },
    },
    async (request, reply) => {
      const data = await tenantTx(request, async (tx) => {
        const org = requireOrg(request);
        await checkEnabled(tx, org.orgId);
        const {
          projectIds,
          csvText: _csv,
          ...row
        } = await selectReport(tx, org, request.params.reportId);
        for (const projectId of projectIds) await requireBudgetProject(request, tx, projectId);
        return dto(row);
      });
      return reply.header('cache-control', 'private, no-store').send(data);
    },
  );

  app.get(
    path + '/:reportId/file',
    {
      config: permission,
      schema: { tags: ['enterprise'], params: z.object({ reportId: z.uuid() }) },
    },
    async (request, reply) => {
      const file = await tenantTx(request, async (tx) => {
        const org = requireOrg(request);
        await checkEnabled(tx, org.orgId);
        const row = await selectReport(tx, org, request.params.reportId, true);
        for (const id of row.projectIds) await requireBudgetProject(request, tx, id);
        if (row.status !== 'ready' || !row.csvText || !row.digest)
          throw problem('conflict', 'The WIP report file is not ready.');
        return { csv: row.csvText, digest: row.digest, month: row.request.period.monthStart };
      });
      return reply
        .header('cache-control', 'private, no-store')
        .header('content-disposition', 'attachment; filename="wip-' + file.month + '.csv"')
        .header('etag', '"' + file.digest + '"')
        .type('text/csv; charset=utf-8')
        .send(file.csv);
    },
  );

  app.post(
    path,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        body: QueueEnterpriseWipReport,
        response: { 200: EnterpriseWipReport, 202: EnterpriseWipReport },
      },
    },
    async (request, reply) => {
      const { periodId, methodologyVersion, clientRequestId } = request.body;
      const projectIds = [...request.body.projectIds].sort();
      const expected = parseIfMatch(request);
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ projectIds, periodId, methodologyVersion, expected }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const org = requireOrg(request);
        await checkEnabled(tx, org.orgId);
        const approved = [];
        for (const projectId of projectIds) {
          const { project } = await requireBudgetProject(request, tx, projectId);
          approved.push(project);
        }
        const prior = await reportReceipt(tx, org, clientRequestId, requestHash);
        if (prior) return { created: false, data: prior };
        const [requested] = await tx
          .select({ monthStart: periods.monthStart })
          .from(periods)
          .where(and(eq(periods.orgId, org.orgId), eq(periods.id, periodId)));
        if (!requested) throw problem('not_found');
        await lockPeriod(tx, org.orgId, requested.monthStart);
        const concurrent = await reportReceipt(tx, org, clientRequestId, requestHash);
        if (concurrent) return { created: false, data: concurrent };
        const [period] = await tx
          .select(periodFields)
          .from(periods)
          .where(and(eq(periods.orgId, org.orgId), eq(periods.monthStart, requested.monthStart)))
          .orderBy(desc(periods.revision))
          .limit(1);
        if (!period) throw problem('not_found');
        assertRevision(period.revision, expected);
        if (period.id !== periodId)
          throw problem('precondition_failed', 'The selected accounting period changed.');
        const rows = await Promise.all(
          approved.map((project) => wipProjectRow(tx, org.orgId, project, period)),
        );
        const snapshot = EnterpriseWipReportInput.parse({
          period,
          methodologyVersion,
          projectIds,
          capturedAt: new Date().toISOString(),
          currencyTotals: combineWipTotals(rows.flatMap((row) => row.currencyTotals)),
          rows,
        });
        const [saved] = await tx
          .insert(reports)
          .values({
            orgId: org.orgId,
            periodId,
            monthStart: period.monthStart,
            projectIds,
            snapshot,
            requestedByUserId: org.userId,
            clientRequestId,
            requestHash,
          })
          .onConflictDoNothing()
          .returning(reportFields);
        if (!saved) throw problem('conflict', 'This WIP request is already recorded.');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'finance.wip_export_queued',
          resourceType: 'enterprise_wip_report',
          resourceId: saved.id,
          before: null,
          after: { periodId, projectIds, methodologyVersion, capturedAt: snapshot.capturedAt },
        });
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'finance.wip_export',
          aggregateType: 'enterprise_wip_report',
          aggregateId: saved.id,
          payload: { reportId: saved.id },
          correlationId: request.id,
          jobKey: 'finance.wip_export:' + saved.id,
        });
        return { created: true, data: dto(saved) };
      });
      setEtag(reply, result.data.request.period.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 202 : 200)
        .send(result.data);
    },
  );
};

export default wipReports;
