import {
  PreviewSalesReport,
  QueueSalesReport,
  SalesReport,
  SalesReportPage,
  SalesReportPreview,
} from '@fieldline/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { salesEstimatePricingApprovals as pricing } from '../../db/schema/enterpriseSalesEstimatePricing';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import {
  salesReportRuns as reports,
  type SalesReportRow,
} from '../../db/schema/enterpriseSalesReports';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import { leadDto, salesPipelineRows, salesPipelineScope } from './salesPipeline';
import { permittedContact, reportContactFieldsMatch, reportHash } from './salesReportWorker';

type Actor = ReturnType<typeof requireOrg>;
type Input = z.infer<typeof PreviewSalesReport>;
type Run = typeof reports.$inferSelect;
const path = '/enterprise/sales/reports';
const config = { permission: 'enterprise_sales:manage' } as const;
const tags = ['enterprise'];
const params = z.object({ reportId: z.uuid() });
const maxRows = 10_000;

function reportScope(actor: Actor) {
  if (!actor.permissions.has('enterprise_sales:intake')) throw problem('forbidden');
  return and(
    eq(reports.orgId, actor.orgId),
    eq(reports.requestedByUserId, actor.userId),
    eq(reports.requestedByMembershipId, actor.membershipId),
  );
}

function dto(run: Run) {
  return {
    id: run.id,
    filters: run.filters,
    columns: run.columns,
    omittedColumns: run.omittedColumns,
    format: run.format,
    rowCount: run.rowCount,
    status: run.status,
    sha256: run.sha256,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

async function preview(tx: Tx, actor: Actor, input: Input) {
  const contactPurpose = actor.permissions.has('enterprise_sales:export_contacts')
    ? input.contactPurpose
    : undefined;
  const canInclude = (column: Input['columns'][number]) =>
    (column !== 'email' && column !== 'phone') || Boolean(contactPurpose);
  const includedColumns = input.columns.filter(canInclude);
  const omittedColumns = input.columns.filter((column) => !canInclude(column));
  const selected = await salesPipelineRows(tx)
    .where(salesPipelineScope(actor, input.filters))
    .orderBy(desc(msTrunc(leads.createdAt)), desc(leads.id))
    .limit(maxRows + 1);
  if (selected.length > maxRows) {
    throw problem('validation_failed', 'Narrow the pipeline filters to 10,000 leads or fewer.');
  }
  const includePrices =
    includedColumns.includes('approved_sell_minor') || includedColumns.includes('currency');
  const approved =
    includePrices && selected.length
      ? await tx
          .selectDistinctOn([pricing.opportunityId], {
            opportunityId: pricing.opportunityId,
            totalMinor: sql<number>`(${pricing.approvalSnapshot}->>'totalMinor')::bigint`.mapWith(
              Number,
            ),
            currency: sql<string>`${pricing.approvalSnapshot}->>'currency'`,
          })
          .from(pricing)
          .where(
            and(
              eq(pricing.orgId, actor.orgId),
              inArray(
                pricing.opportunityId,
                selected.map((row) => row.lead.id),
              ),
            ),
          )
          .orderBy(pricing.opportunityId, desc(pricing.revision))
      : [];
  const prices = new Map(approved.map((entry) => [entry.opportunityId, entry]));
  const rows: SalesReportRow[] = selected.map((row) => {
    const lead = leadDto(row);
    const price = prices.get(lead.id);
    const fields: SalesReportRow['fields'] = {
      lead_name: lead.name,
      source: lead.source.name,
      community: lead.community?.name ?? null,
      owner: lead.owner?.name ?? null,
      stage: lead.stage.key,
      entered_stage_at: lead.stageEnteredAt,
      last_activity_at: lead.lastActivityAt,
      next_activity_at: lead.nextActivityAt,
      approved_sell_minor: price?.totalMinor ?? null,
      currency: price?.currency ?? null,
      converted: lead.stage.key === 'project_created',
      email: contactPurpose ? permittedContact(row.lead, contactPurpose, 'email') : null,
      phone: contactPurpose ? permittedContact(row.lead, contactPurpose, 'phone') : null,
    };
    return {
      id: lead.id,
      fields: Object.fromEntries(includedColumns.map((column) => [column, fields[column]])),
    };
  });
  return {
    contactPurpose: includedColumns.some((column) => column === 'email' || column === 'phone')
      ? contactPurpose
      : undefined,
    rows,
    summary: {
      rowCount: rows.length,
      includedColumns,
      omittedColumns,
      viewFingerprint: reportHash(JSON.stringify([input, includedColumns, rows])),
    },
  };
}

export const salesReports: FastifyPluginAsyncZod = async (app) => {
  app.post(
    path + '/preview',
    {
      config,
      schema: { tags, body: PreviewSalesReport, response: { 200: SalesReportPreview } },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      reportScope(actor);
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        return (await preview(tx, actor, request.body)).summary;
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    path,
    {
      config,
      schema: { tags, body: QueueSalesReport, response: { 200: SalesReport, 201: SalesReport } },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const scope = reportScope(actor);
      const { viewFingerprint, clientRequestId, ...input } = request.body;
      const requestHash = reportHash(JSON.stringify([input, viewFingerprint]));
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const existing = () =>
          tx
            .select()
            .from(reports)
            .where(and(scope, eq(reports.clientRequestId, clientRequestId)));
        async function replay(prior: Run) {
          if (prior.requestHash !== requestHash) {
            throw problem('conflict', 'This request ID already belongs to a different report.');
          }
          return { created: false, run: prior };
        }
        const [prior] = await existing();
        if (prior) return replay(prior);
        const { summary, rows, contactPurpose } = await preview(tx, actor, input);
        if (summary.viewFingerprint !== viewFingerprint) {
          throw problem(
            'conflict',
            'The pipeline changed. Review the updated export before queuing.',
          );
        }
        if (!summary.includedColumns.length) {
          throw problem('validation_failed', 'Select at least one permitted report column.');
        }
        const [run] = await tx
          .insert(reports)
          .values({
            orgId: actor.orgId,
            requestedByUserId: actor.userId,
            requestedByMembershipId: actor.membershipId,
            pipelineId: input.pipelineId,
            filters: input.filters,
            format: input.format,
            columns: summary.includedColumns,
            omittedColumns: summary.omittedColumns,
            contactPurpose,
            snapshot: rows,
            rowCount: summary.rowCount,
            clientRequestId,
            requestHash,
          })
          .onConflictDoNothing()
          .returning();
        if (!run) {
          const [concurrent] = await existing();
          if (!concurrent) throw problem('conflict', 'Retry the report request.');
          return replay(concurrent);
        }
        await auditRequest(request, tx, {
          orgId: actor.orgId,
          action: 'sales.report_export_queued',
          resourceType: 'enterprise_sales_report',
          resourceId: run.id,
          after: {
            filterKeys: Object.keys(run.filters),
            columns: run.columns,
            rowCount: run.rowCount,
            format: run.format,
            omittedColumns: run.omittedColumns,
          },
        });
        await enqueue(tx, {
          orgId: actor.orgId,
          task: 'sales.report_export',
          aggregateType: 'enterprise_sales_report',
          aggregateId: run.id,
          payload: { salesReportId: run.id },
          correlationId: request.id,
          jobKey: 'sales.report_export:' + run.id,
        });
        return { created: true, run };
      });
      return reply
        .code(result.created ? 201 : 200)
        .header('cache-control', 'private, no-store')
        .send(dto(result.run));
    },
  );

  app.get(
    path,
    {
      config,
      schema: {
        tags,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: { 200: SalesReportPage },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { cursor, limit } = request.query;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const runs = await tx
          .select()
          .from(reports)
          .where(
            and(
              reportScope(actor),
              beforeCursor(reports.createdAt, reports.id, decodeCursor(cursor)),
            ),
          )
          .orderBy(desc(msTrunc(reports.createdAt)), desc(reports.id))
          .limit(limit + 1);
        return pageResult(runs, limit, (run) => ({ at: run.createdAt, id: run.id }), dto);
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.get(
    path + '/:reportId/file',
    { config, schema: { tags, params } },
    async (request, reply) => {
      const actor = requireOrg(request);
      const run = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const [found] = await tx
          .select()
          .from(reports)
          .where(and(reportScope(actor), eq(reports.id, request.params.reportId)));
        if (!found) throw problem('not_found');
        if (found.status !== 'ready')
          throw problem('conflict', 'This export is not ready to download.');
        if (found.contactPurpose) {
          if (!actor.permissions.has('enterprise_sales:export_contacts'))
            throw problem('forbidden');
          if (!(await reportContactFieldsMatch(tx, found))) {
            throw problem(
              'conflict',
              'Contact permissions or details changed. Review a new export.',
            );
          }
        }
        return found;
      });
      return reply
        .header('cache-control', 'private, no-store')
        .header(
          'content-disposition',
          'attachment; filename="sales-report-' + run.id + '.' + run.format + '"',
        )
        .header('etag', '"' + run.sha256 + '"')
        .type(run.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8')
        .send(run.fileText);
    },
  );
};
