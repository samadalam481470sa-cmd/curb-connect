// `fieldOps` module (builder operations section, item 10): mobile time tracking with labor
// cost allocation, and generic inspection checklists. Time entries record what a crew member
// actually worked (entered by the member or their lead) and allocate the hours to a job +
// cost code at a builder-entered rate — labor cost is hours × the entered rate, computed and
// labeled, never a market rate. Checklist templates are builder-defined; results record
// pass/fail per item as observed. The bilingual EN/ES labels live in the web views; stored
// values are never translated.
import {
  CreateInspectionChecklistTemplateRequestSchema,
  CreateInspectionResultRequestSchema,
  CreateTimeEntryRequestSchema,
  InspectionChecklistTemplateListSchema,
  InspectionChecklistTemplateSchema,
  InspectionResultListSchema,
  InspectionResultSchema,
  TimeEntryListSchema,
  TimeEntrySchema,
  TimeRollupSchema,
  UpdateInspectionResultRequestSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { inspectionChecklistTemplates, inspectionResults, jobs, timeEntries } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';

const TIME_READ = 'time_entry:read';
const TIME_WRITE = 'time_entry:write';
const INSP_READ = 'inspection_checklist:read';
const INSP_WRITE = 'inspection_checklist:write';

const IdParams = z.object({ id: z.uuid() });

type TimeRow = typeof timeEntries.$inferSelect;
type TemplateRow = typeof inspectionChecklistTemplates.$inferSelect;
type ResultRow = typeof inspectionResults.$inferSelect;

function laborCost(hours: number, rateMinorPerHour: number | null): number | null {
  if (rateMinorPerHour === null) return null;
  return Math.round(hours * rateMinorPerHour);
}

function timeDto(row: TimeRow) {
  const hours = Number(row.hours);
  return {
    id: row.id,
    membershipId: row.membershipId,
    workerName: row.workerName,
    jobId: row.jobId,
    costCode: row.costCode,
    workDate: row.workDate,
    hours,
    rateMinorPerHour: row.rateMinorPerHour,
    laborCostMinor: laborCost(hours, row.rateMinorPerHour),
    currency: row.currency,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function templateDto(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    items: (row.items as { key: string; label: string; required: boolean }[] | null) ?? [],
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resultDto(row: ResultRow) {
  return {
    id: row.id,
    templateId: row.templateId,
    jobId: row.jobId,
    inspectorName: row.inspectorName,
    status: row.status,
    answers:
      (row.answers as { key: string; result: 'pass' | 'fail' | 'na'; note?: string | null }[] | null) ?? [],
    photoMediaIds: row.photoMediaIds ?? [],
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const fieldOpsModule: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------- time entries

  app.get(
    '/field-ops/time-entries',
    {
      config: { permission: TIME_READ },
      schema: {
        tags: ['field-ops'],
        summary: 'Time entries, most recent work date first; filter by job or date range',
        querystring: z.object({
          jobId: z.uuid().optional(),
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
        response: { 200: TimeEntryListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.orgId, orgId),
              q.jobId ? eq(timeEntries.jobId, q.jobId) : undefined,
              q.from ? sql`${timeEntries.workDate} >= ${q.from}` : undefined,
              q.to ? sql`${timeEntries.workDate} <= ${q.to}` : undefined,
            ),
          )
          .orderBy(desc(timeEntries.workDate), desc(timeEntries.createdAt))
          .limit(500),
      );
      return { items: rows.map(timeDto) };
    },
  );

  app.post(
    '/field-ops/time-entries',
    {
      config: { permission: TIME_WRITE, rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['field-ops'],
        summary: 'Record hours worked, allocated to a job and cost code',
        body: CreateTimeEntryRequestSchema,
        response: { 201: TimeEntrySchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        if (request.body.jobId) {
          const [job] = await tx
            .select({ id: jobs.id })
            .from(jobs)
            .where(and(eq(jobs.orgId, orgId), eq(jobs.id, request.body.jobId)))
            .limit(1);
          if (!job) throw problem('not_found', 'That job does not exist in this company.');
        }
        const [created] = await tx
          .insert(timeEntries)
          .values({
            orgId,
            workerName: request.body.workerName,
            membershipId: request.body.membershipId ?? null,
            jobId: request.body.jobId ?? null,
            costCode: request.body.costCode ?? null,
            workDate: request.body.workDate,
            hours: String(request.body.hours),
            rateMinorPerHour: request.body.rateMinorPerHour ?? null,
            note: request.body.note ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'time_entry.recorded',
          resourceType: 'time_entry',
          resourceId: created.id,
          after: { workerName: created.workerName, workDate: created.workDate },
        });
        return created;
      });
      reply.code(201);
      return timeDto(row);
    },
  );

  app.get(
    '/field-ops/time-rollup',
    {
      config: { permission: TIME_READ },
      schema: {
        tags: ['field-ops'],
        summary: 'Hours and labor cost rolled up per cost code (one job, or all jobs when jobId is omitted)',
        querystring: z.object({ jobId: z.uuid().optional() }),
        response: { 200: TimeRollupSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.orgId, orgId),
              q.jobId ? eq(timeEntries.jobId, q.jobId) : undefined,
            ),
          )
          .limit(5000);
        const byCode = new Map<string | null, { hours: number; cost: number | null }>();
        let totalHours = 0;
        let totalCost: number | null = null;
        for (const r of rows) {
          const hours = Number(r.hours);
          const cost = laborCost(hours, r.rateMinorPerHour);
          totalHours += hours;
          if (cost !== null) totalCost = (totalCost ?? 0) + cost;
          const line = byCode.get(r.costCode) ?? { hours: 0, cost: null };
          line.hours += hours;
          if (cost !== null) line.cost = (line.cost ?? 0) + cost;
          byCode.set(r.costCode, line);
        }
        return {
          jobId: q.jobId ?? null,
          totalHours: Math.round(totalHours * 100) / 100,
          totalLaborCostMinor: totalCost,
          entryCount: rows.length,
          byCostCode: [...byCode.entries()]
            .sort(([a], [b]) => (a ?? '').localeCompare(b ?? ''))
            .map(([costCode, v]) => ({
              costCode,
              hours: Math.round(v.hours * 100) / 100,
              laborCostMinor: v.cost,
            })),
        };
      });
    },
  );

  // ---------------------------------------------------------- inspection checklists

  app.get(
    '/field-ops/checklist-templates',
    {
      config: { permission: INSP_READ },
      schema: {
        tags: ['field-ops'],
        summary: 'Builder-defined inspection checklist templates',
        response: { 200: InspectionChecklistTemplateListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(inspectionChecklistTemplates)
          .where(eq(inspectionChecklistTemplates.orgId, orgId))
          .orderBy(asc(inspectionChecklistTemplates.name))
          .limit(200),
      );
      return { items: rows.map(templateDto) };
    },
  );

  app.post(
    '/field-ops/checklist-templates',
    {
      config: { permission: INSP_WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['field-ops'],
        summary: 'Define an inspection checklist template',
        body: CreateInspectionChecklistTemplateRequestSchema,
        response: { 201: InspectionChecklistTemplateSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(inspectionChecklistTemplates)
          .values({
            orgId,
            name: request.body.name,
            description: request.body.description ?? null,
            items: request.body.items,
            active: true,
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return templateDto(row);
    },
  );

  app.get(
    '/field-ops/inspection-results',
    {
      config: { permission: INSP_READ },
      schema: {
        tags: ['field-ops'],
        summary: 'Inspection checklist results, newest first',
        querystring: z.object({
          jobId: z.uuid().optional(),
          status: z.enum(['in_progress', 'completed']).optional(),
        }),
        response: { 200: InspectionResultListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(inspectionResults)
          .where(
            and(
              eq(inspectionResults.orgId, orgId),
              q.jobId ? eq(inspectionResults.jobId, q.jobId) : undefined,
              q.status ? eq(inspectionResults.status, q.status) : undefined,
            ),
          )
          .orderBy(desc(inspectionResults.createdAt))
          .limit(200),
      );
      return { items: rows.map(resultDto) };
    },
  );

  app.post(
    '/field-ops/inspection-results',
    {
      config: { permission: INSP_WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['field-ops'],
        summary: 'Start an inspection from a checklist template',
        body: CreateInspectionResultRequestSchema,
        response: { 201: InspectionResultSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [template] = await tx
          .select({ id: inspectionChecklistTemplates.id })
          .from(inspectionChecklistTemplates)
          .where(
            and(
              eq(inspectionChecklistTemplates.orgId, orgId),
              eq(inspectionChecklistTemplates.id, request.body.templateId),
            ),
          )
          .limit(1);
        if (!template) throw problem('not_found', 'That checklist template does not exist.');
        const [created] = await tx
          .insert(inspectionResults)
          .values({
            orgId,
            templateId: template.id,
            jobId: request.body.jobId ?? null,
            inspectorName: request.body.inspectorName ?? null,
            status: 'in_progress',
            answers: [],
            photoMediaIds: [],
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return resultDto(row);
    },
  );

  app.patch(
    '/field-ops/inspection-results/:id',
    {
      config: { permission: INSP_WRITE },
      schema: {
        tags: ['field-ops'],
        summary: 'Record checklist answers (pass/fail/n-a as observed) and optionally complete',
        params: IdParams,
        body: UpdateInspectionResultRequestSchema,
        response: { 200: InspectionResultSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(inspectionResults)
          .where(and(eq(inspectionResults.orgId, orgId), eq(inspectionResults.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        const completing = request.body.complete === true;
        const [updated] = await tx
          .update(inspectionResults)
          .set({
            ...(request.body.answers !== undefined && { answers: request.body.answers }),
            ...(request.body.photoMediaIds !== undefined && {
              photoMediaIds: request.body.photoMediaIds,
            }),
            ...(completing && {
              status: 'completed' as const,
              completedAt: existing.completedAt ?? new Date(),
            }),
            updatedAt: new Date(),
          })
          .where(and(eq(inspectionResults.orgId, orgId), eq(inspectionResults.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: completing ? 'inspection.completed' : 'inspection.answers_recorded',
          resourceType: 'inspection_result',
          resourceId: updated.id,
          after: { status: updated.status },
        });
        return updated;
      });
      return resultDto(row);
    },
  );
};

export default fieldOpsModule;
