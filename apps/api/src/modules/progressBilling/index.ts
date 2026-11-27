// `progressBilling` module (blueprint gap 2): schedules of values per job and
// periodic progress-billing applications against them. An application moves
// draft -> submitted -> approved/rejected -> invoiced; approval freezes the
// computed totals, and invoice generation creates a regular customer invoice
// (kind 'progress', draft) linked back to the application. AR aging is read
// from the existing invoices table. Retainage percent is a contractor-entered
// contract term; percents complete are contractor-entered. Nothing is invented.
import {
  ArAgingResponseSchema,
  CreateApplicationRequestSchema,
  CreateSovRequestSchema,
  ProgressBillingApplicationSchema,
  ProgressBillingPdfResponseSchema,
  ScheduleOfValuesSchema,
  UpdateApplicationRequestSchema,
  UpdateSovRequestSchema,
} from '@fieldline/contracts';
import { renderToBuffer, type ProgressBillingSnapshot } from '@fieldline/pdf';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  customers,
  invoiceLines,
  invoices,
  jobs,
  organizations,
  progressBillingApplications,
  progressBillingLines,
  schedulesOfValues,
  sovLines,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import {
  computeApplication,
  validateApplicationLines,
  type ComputedApplication,
  type PreviousBillingForCalc,
} from './calc';

const READ = 'draw:read';
const WRITE = 'draw:write';
const APPROVE = 'draw:approve';

const UUID = z.uuid();
const JobParams = z.object({ jobId: UUID });
const SovParams = z.object({ sovId: UUID });
const AppParams = z.object({ applicationId: UUID });

type SovRow = typeof schedulesOfValues.$inferSelect;
type SovLineRow = typeof sovLines.$inferSelect;
type AppRow = typeof progressBillingApplications.$inferSelect;

async function requireJob(tx: Tx, orgId: string, jobId: string) {
  const [job] = await tx.select().from(jobs).where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)));
  if (!job) throw problem('not_found');
  return job;
}

async function loadSov(tx: Tx, orgId: string, sovId: string) {
  const [sov] = await tx
    .select()
    .from(schedulesOfValues)
    .where(and(eq(schedulesOfValues.orgId, orgId), eq(schedulesOfValues.id, sovId)));
  if (!sov) throw problem('not_found');
  const lines = await tx
    .select()
    .from(sovLines)
    .where(and(eq(sovLines.orgId, orgId), eq(sovLines.sovId, sovId)))
    .orderBy(asc(sovLines.sortOrder), asc(sovLines.createdAt));
  return { sov, lines };
}

function sovDto(sov: SovRow, lines: SovLineRow[]) {
  return {
    id: sov.id,
    jobId: sov.jobId,
    name: sov.name,
    contractMinor: sov.contractMinor,
    linesTotalMinor: lines.reduce((s, l) => s + l.scheduledValueMinor, 0),
    retainagePct: Number(sov.retainagePct),
    currency: sov.currency,
    status: sov.status,
    lines: lines.map((l) => ({
      id: l.id,
      itemNumber: l.itemNumber,
      description: l.description,
      costCode: l.costCode,
      scheduledValueMinor: l.scheduledValueMinor,
      sortOrder: l.sortOrder,
    })),
    revision: sov.revision,
    createdAt: sov.createdAt.toISOString(),
    updatedAt: sov.updatedAt.toISOString(),
  };
}

/**
 * Previous billing = the latest approved/invoiced application with a lower
 * number on the same SOV. Its frozen totals carry the completed+stored per
 * line (recomputed from its stored line inputs) and total retainage withheld.
 */
async function previousBilling(
  tx: Tx,
  orgId: string,
  sov: SovRow,
  lines: SovLineRow[],
  beforeNumber: number,
): Promise<PreviousBillingForCalc> {
  const [prior] = await tx
    .select()
    .from(progressBillingApplications)
    .where(
      and(
        eq(progressBillingApplications.orgId, orgId),
        eq(progressBillingApplications.sovId, sov.id),
        inArray(progressBillingApplications.status, ['approved', 'invoiced']),
        sql`${progressBillingApplications.number} < ${beforeNumber}`,
      ),
    )
    .orderBy(desc(progressBillingApplications.number))
    .limit(1);
  if (!prior) return { completedStoredByLine: new Map(), retainageWithheldMinor: 0 };
  const priorLines = await tx
    .select()
    .from(progressBillingLines)
    .where(
      and(
        eq(progressBillingLines.orgId, orgId),
        eq(progressBillingLines.applicationId, prior.id),
      ),
    );
  const computed = computeApplication(
    lines.map((l) => ({ id: l.id, scheduledValueMinor: l.scheduledValueMinor })),
    priorLines.map((l) => ({
      sovLineId: l.sovLineId,
      percentComplete: Number(l.percentComplete),
      storedMaterialsMinor: l.storedMaterialsMinor,
    })),
    { completedStoredByLine: new Map(), retainageWithheldMinor: 0 },
    Number(sov.retainagePct),
  );
  return {
    completedStoredByLine: new Map(computed.lines.map((l) => [l.sovLineId, l.completedStoredToDateMinor])),
    retainageWithheldMinor: prior.retainageToDateMinor ?? computed.retainageToDateMinor,
  };
}

async function applicationDto(tx: Tx, orgId: string, app: AppRow) {
  const { sov, lines } = await loadSov(tx, orgId, app.sovId);
  const appLines = await tx
    .select()
    .from(progressBillingLines)
    .where(and(eq(progressBillingLines.orgId, orgId), eq(progressBillingLines.applicationId, app.id)));
  const previous = await previousBilling(tx, orgId, sov, lines, app.number);
  const computed: ComputedApplication = computeApplication(
    lines.map((l) => ({ id: l.id, scheduledValueMinor: l.scheduledValueMinor })),
    appLines.map((l) => ({
      sovLineId: l.sovLineId,
      percentComplete: Number(l.percentComplete),
      storedMaterialsMinor: l.storedMaterialsMinor,
    })),
    previous,
    Number(sov.retainagePct),
  );
  const lineById = new Map(lines.map((l) => [l.id, l]));
  let invoiceNumber: string | null = null;
  if (app.invoiceId) {
    const [inv] = await tx
      .select({ number: invoices.number })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), eq(invoices.id, app.invoiceId)));
    invoiceNumber = inv?.number ?? null;
  }
  // Approved/invoiced applications show their frozen totals, not a recomputation.
  const frozen = app.currentDueMinor !== null;
  return {
    id: app.id,
    sovId: app.sovId,
    jobId: app.jobId,
    number: app.number,
    periodStart: app.periodStart,
    periodEnd: app.periodEnd,
    status: app.status,
    invoiceId: app.invoiceId,
    invoiceNumber,
    note: app.note,
    submittedAt: app.submittedAt?.toISOString() ?? null,
    decidedAt: app.decidedAt?.toISOString() ?? null,
    currency: sov.currency,
    lines: computed.lines.map((l) => ({
      sovLineId: l.sovLineId,
      itemNumber: lineById.get(l.sovLineId)?.itemNumber ?? '',
      description: lineById.get(l.sovLineId)?.description ?? '',
      scheduledValueMinor: l.scheduledValueMinor,
      percentComplete: l.percentComplete,
      completedToDateMinor: l.completedToDateMinor,
      storedMaterialsMinor: l.storedMaterialsMinor,
      completedStoredToDateMinor: l.completedStoredToDateMinor,
      previousCompletedStoredMinor: l.previousCompletedStoredMinor,
      thisPeriodMinor: l.thisPeriodMinor,
      balanceToFinishMinor: l.balanceToFinishMinor,
      overbilled: l.overbilled,
    })),
    totals: frozen
      ? {
          scheduledTotalMinor: app.scheduledTotalMinor ?? computed.scheduledTotalMinor,
          completedStoredTotalMinor: app.completedStoredTotalMinor ?? computed.completedStoredTotalMinor,
          previousCompletedStoredMinor: app.previousCompletedStoredMinor ?? computed.previousCompletedStoredMinor,
          thisPeriodGrossMinor: app.thisPeriodGrossMinor ?? computed.thisPeriodGrossMinor,
          retainageToDateMinor: app.retainageToDateMinor ?? computed.retainageToDateMinor,
          retainageThisPeriodMinor: app.retainageThisPeriodMinor ?? computed.retainageThisPeriodMinor,
          currentDueMinor: app.currentDueMinor ?? computed.currentDueMinor,
          balanceToFinishMinor: app.balanceToFinishMinor ?? computed.balanceToFinishMinor,
          overbilled: computed.overbilled,
        }
      : {
          scheduledTotalMinor: computed.scheduledTotalMinor,
          completedStoredTotalMinor: computed.completedStoredTotalMinor,
          previousCompletedStoredMinor: computed.previousCompletedStoredMinor,
          thisPeriodGrossMinor: computed.thisPeriodGrossMinor,
          retainageToDateMinor: computed.retainageToDateMinor,
          retainageThisPeriodMinor: computed.retainageThisPeriodMinor,
          currentDueMinor: computed.currentDueMinor,
          balanceToFinishMinor: computed.balanceToFinishMinor,
          overbilled: computed.overbilled,
        },
    revision: app.revision,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  };
}

async function loadApplication(tx: Tx, orgId: string, applicationId: string) {
  const [app] = await tx
    .select()
    .from(progressBillingApplications)
    .where(
      and(
        eq(progressBillingApplications.orgId, orgId),
        eq(progressBillingApplications.id, applicationId),
      ),
    )
    .for('update');
  if (!app) throw problem('not_found');
  return app;
}

/** Same numbering scheme as the invoices module (advisory lock + INV-YYYY-NNNN). */
async function nextInvoiceNumber(tx: Tx, orgId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoices:${orgId}`}))`);
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(eq(invoices.orgId, orgId));
  const year = new Date().getFullYear();
  for (let sequence = (row?.count ?? 0) + 1; ; sequence += 1) {
    const candidate = `INV-${year}-${String(sequence).padStart(4, '0')}`;
    const [taken] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), eq(invoices.number, candidate)))
      .limit(1);
    if (!taken) return candidate;
  }
}

const progressBillingModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/progress-billing/jobs/:jobId/sov',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['progress-billing'],
        params: JobParams,
        body: CreateSovRequestSchema,
        summary: 'Create a schedule of values for a job (contract sum + entered retainage percent + lines).',
        response: { 201: ScheduleOfValuesSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        await requireJob(tx, orgId, request.params.jobId);
        const [sov] = await tx
          .insert(schedulesOfValues)
          .values({
            orgId,
            jobId: request.params.jobId,
            name: request.body.name,
            contractMinor: request.body.contractMinor,
            retainagePct: String(request.body.retainagePct),
          })
          .returning();
        if (!sov) throw problem('internal');
        const lines = await tx
          .insert(sovLines)
          .values(
            request.body.lines.map((l, i) => ({
              orgId,
              sovId: sov.id,
              itemNumber: l.itemNumber,
              description: l.description,
              costCode: l.costCode ?? null,
              scheduledValueMinor: l.scheduledValueMinor,
              sortOrder: i,
            })),
          )
          .returning();
        await auditRequest(request, tx, {
          orgId,
          action: 'progress_billing.sov_created',
          resourceType: 'schedule_of_values',
          resourceId: sov.id,
          after: { name: sov.name, contractMinor: sov.contractMinor, lineCount: lines.length },
        });
        return { sov, lines };
      });
      return reply.code(201).send(sovDto(result.sov, result.lines));
    },
  );

  app.get(
    '/progress-billing/jobs/:jobId/sov',
    {
      config: { permission: READ },
      schema: {
        tags: ['progress-billing'],
        params: JobParams,
        summary: 'List schedules of values for a job.',
        response: { 200: z.object({ items: z.array(ScheduleOfValuesSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await requireJob(tx, orgId, request.params.jobId);
        const sovs = await tx
          .select()
          .from(schedulesOfValues)
          .where(and(eq(schedulesOfValues.orgId, orgId), eq(schedulesOfValues.jobId, request.params.jobId)))
          .orderBy(desc(schedulesOfValues.createdAt))
          .limit(50);
        const items = [];
        for (const sov of sovs) {
          const { lines } = await loadSov(tx, orgId, sov.id);
          items.push(sovDto(sov, lines));
        }
        return { items };
      });
    },
  );

  app.patch(
    '/progress-billing/sov/:sovId',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['progress-billing'],
        params: SovParams,
        body: UpdateSovRequestSchema,
        summary: 'Update a schedule of values. Lines can only be replaced before any application exists.',
        response: { 200: ScheduleOfValuesSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const { sov } = await loadSov(tx, orgId, request.params.sovId);
        if (request.body.lines) {
          const existing = await tx
            .select({ id: progressBillingApplications.id })
            .from(progressBillingApplications)
            .where(
              and(
                eq(progressBillingApplications.orgId, orgId),
                eq(progressBillingApplications.sovId, sov.id),
              ),
            )
            .limit(1);
          if (existing.length > 0) {
            throw problem(
              'conflict',
              'Lines cannot change once applications exist — create a new schedule of values instead.',
            );
          }
          await tx
            .delete(sovLines)
            .where(and(eq(sovLines.orgId, orgId), eq(sovLines.sovId, sov.id)));
          await tx.insert(sovLines).values(
            request.body.lines.map((l, i) => ({
              orgId,
              sovId: sov.id,
              itemNumber: l.itemNumber,
              description: l.description,
              costCode: l.costCode ?? null,
              scheduledValueMinor: l.scheduledValueMinor,
              sortOrder: i,
            })),
          );
        }
        const [updated] = await tx
          .update(schedulesOfValues)
          .set({
            ...(request.body.name !== undefined && { name: request.body.name }),
            ...(request.body.contractMinor !== undefined && { contractMinor: request.body.contractMinor }),
            ...(request.body.retainagePct !== undefined && { retainagePct: String(request.body.retainagePct) }),
            ...(request.body.status !== undefined && { status: request.body.status }),
            revision: sov.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(schedulesOfValues.orgId, orgId), eq(schedulesOfValues.id, sov.id)))
          .returning();
        if (!updated) throw problem('internal');
        const { lines } = await loadSov(tx, orgId, sov.id);
        return sovDto(updated, lines);
      });
    },
  );

  app.post(
    '/progress-billing/sov/:sovId/applications',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['progress-billing'],
        params: SovParams,
        body: CreateApplicationRequestSchema,
        summary: 'Create a draft progress-billing application (percent complete + stored materials per line).',
        response: { 201: ProgressBillingApplicationSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      if (request.body.periodEnd < request.body.periodStart) {
        throw problem('validation_failed', 'Period end must be on or after the period start.');
      }
      const app = await tenantTx(request, async (tx) => {
        const { sov, lines } = await loadSov(tx, orgId, request.params.sovId);
        const invalid = validateApplicationLines(
          lines.map((l) => ({ id: l.id, scheduledValueMinor: l.scheduledValueMinor })),
          request.body.lines,
        );
        if (invalid) throw problem('validation_failed', invalid);
        const [maxRow] = await tx
          .select({ max: sql<number>`coalesce(max(${progressBillingApplications.number}), 0)::int` })
          .from(progressBillingApplications)
          .where(
            and(
              eq(progressBillingApplications.orgId, orgId),
              eq(progressBillingApplications.sovId, sov.id),
            ),
          );
        const [created] = await tx
          .insert(progressBillingApplications)
          .values({
            orgId,
            sovId: sov.id,
            jobId: sov.jobId,
            number: (maxRow?.max ?? 0) + 1,
            periodStart: request.body.periodStart,
            periodEnd: request.body.periodEnd,
            note: request.body.note ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        if (request.body.lines.length > 0) {
          await tx.insert(progressBillingLines).values(
            request.body.lines.map((l) => ({
              orgId,
              applicationId: created.id,
              sovLineId: l.sovLineId,
              percentComplete: String(l.percentComplete),
              storedMaterialsMinor: l.storedMaterialsMinor,
            })),
          );
        }
        await auditRequest(request, tx, {
          orgId,
          action: 'progress_billing.application_created',
          resourceType: 'progress_billing_application',
          resourceId: created.id,
          after: { number: created.number },
        });
        return created;
      });
      const dto = await tenantTx(request, (tx) => applicationDto(tx, orgId, app));
      return reply.code(201).send(dto);
    },
  );

  app.get(
    '/progress-billing/sov/:sovId/applications',
    {
      config: { permission: READ },
      schema: {
        tags: ['progress-billing'],
        params: SovParams,
        summary: 'List applications for a schedule of values, newest first.',
        response: { 200: z.object({ items: z.array(ProgressBillingApplicationSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await loadSov(tx, orgId, request.params.sovId);
        const apps = await tx
          .select()
          .from(progressBillingApplications)
          .where(
            and(
              eq(progressBillingApplications.orgId, orgId),
              eq(progressBillingApplications.sovId, request.params.sovId),
            ),
          )
          .orderBy(desc(progressBillingApplications.number))
          .limit(50);
        const items = [];
        for (const a of apps) items.push(await applicationDto(tx, orgId, a));
        return { items };
      });
    },
  );

  app.patch(
    '/progress-billing/applications/:applicationId',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['progress-billing'],
        params: AppParams,
        body: UpdateApplicationRequestSchema,
        summary: 'Edit a draft (or rejected) application. Approved applications are frozen.',
        response: { 200: ProgressBillingApplicationSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const app = await tenantTx(request, async (tx) => {
        const current = await loadApplication(tx, orgId, request.params.applicationId);
        if (!['draft', 'rejected'].includes(current.status)) {
          throw problem('conflict', 'Only draft or rejected applications can be edited.');
        }
        const { lines } = await loadSov(tx, orgId, current.sovId);
        if (request.body.lines) {
          const invalid = validateApplicationLines(
            lines.map((l) => ({ id: l.id, scheduledValueMinor: l.scheduledValueMinor })),
            request.body.lines,
          );
          if (invalid) throw problem('validation_failed', invalid);
          await tx
            .delete(progressBillingLines)
            .where(
              and(
                eq(progressBillingLines.orgId, orgId),
                eq(progressBillingLines.applicationId, current.id),
              ),
            );
          if (request.body.lines.length > 0) {
            await tx.insert(progressBillingLines).values(
              request.body.lines.map((l) => ({
                orgId,
                applicationId: current.id,
                sovLineId: l.sovLineId,
                percentComplete: String(l.percentComplete),
                storedMaterialsMinor: l.storedMaterialsMinor,
              })),
            );
          }
        }
        const [updated] = await tx
          .update(progressBillingApplications)
          .set({
            ...(request.body.periodStart !== undefined && { periodStart: request.body.periodStart }),
            ...(request.body.periodEnd !== undefined && { periodEnd: request.body.periodEnd }),
            ...(request.body.note !== undefined && { note: request.body.note }),
            status: 'draft',
            decidedAt: null,
            decidedByUserId: null,
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(progressBillingApplications.orgId, orgId),
              eq(progressBillingApplications.id, current.id),
            ),
          )
          .returning();
        if (!updated) throw problem('internal');
        return updated;
      });
      return tenantTx(request, (tx) => applicationDto(tx, orgId, app));
    },
  );

  const transition = (
    path: string,
    permission: 'draw:write' | 'draw:approve',
    from: string[],
    apply: (tx: Tx, orgId: string, app: AppRow, userId: string) => Promise<Partial<AppRow>>,
    action: string,
  ) =>
    app.post(
      path,
      {
        config: { permission, rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
          tags: ['progress-billing'],
          params: AppParams,
          summary: `Progress-billing application transition: ${action}.`,
          response: { 200: ProgressBillingApplicationSchema },
        },
      },
      async (request) => {
        const { orgId, userId } = requireOrg(request);
        const updated = await tenantTx(request, async (tx) => {
          const current = await loadApplication(tx, orgId, request.params.applicationId);
          if (!from.includes(current.status)) {
            throw problem('conflict', `An application in status '${current.status}' cannot do that.`);
          }
          const patch = await apply(tx, orgId, current, userId);
          const [row] = await tx
            .update(progressBillingApplications)
            .set({ ...patch, revision: current.revision + 1, updatedAt: new Date() })
            .where(
              and(
                eq(progressBillingApplications.orgId, orgId),
                eq(progressBillingApplications.id, current.id),
              ),
            )
            .returning();
          if (!row) throw problem('internal');
          await auditRequest(request, tx, {
            orgId,
            action: `progress_billing.${action}`,
            resourceType: 'progress_billing_application',
            resourceId: row.id,
            before: { status: current.status },
            after: { status: row.status },
          });
          return row;
        });
        return tenantTx(request, (tx) => applicationDto(tx, orgId, updated));
      },
    );

  transition('/progress-billing/applications/:applicationId/submit', WRITE, ['draft'], async (tx, orgId, current) => {
    const dto = await applicationDto(tx, orgId, current);
    if (dto.totals.overbilled) {
      throw problem(
        'validation_failed',
        'A line bills more than its scheduled value. Reduce percent complete or stored materials before submitting.',
      );
    }
    return { status: 'submitted', submittedAt: new Date() };
  }, 'submitted');

  transition('/progress-billing/applications/:applicationId/approve', APPROVE, ['submitted'], async (tx, orgId, current, userId) => {
    const dto = await applicationDto(tx, orgId, current);
    if (dto.totals.overbilled) {
      throw problem('validation_failed', 'A line bills more than its scheduled value; it cannot be approved.');
    }
    return {
      status: 'approved',
      decidedAt: new Date(),
      decidedByUserId: userId,
      scheduledTotalMinor: dto.totals.scheduledTotalMinor,
      completedStoredTotalMinor: dto.totals.completedStoredTotalMinor,
      previousCompletedStoredMinor: dto.totals.previousCompletedStoredMinor,
      thisPeriodGrossMinor: dto.totals.thisPeriodGrossMinor,
      retainageToDateMinor: dto.totals.retainageToDateMinor,
      retainageThisPeriodMinor: dto.totals.retainageThisPeriodMinor,
      currentDueMinor: dto.totals.currentDueMinor,
      balanceToFinishMinor: dto.totals.balanceToFinishMinor,
    };
  }, 'approved');

  transition('/progress-billing/applications/:applicationId/reject', APPROVE, ['submitted'], async (_tx, _orgId, _current, userId) => ({
    status: 'rejected',
    decidedAt: new Date(),
    decidedByUserId: userId,
  }), 'rejected');

  app.post(
    '/progress-billing/applications/:applicationId/generate-invoice',
    {
      config: { permission: 'invoice:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['progress-billing'],
        params: AppParams,
        summary:
          'Generate a draft customer invoice (kind: progress) from an approved application. The invoice is a draft — issuing/sending stays in the invoices flow.',
        response: { 200: ProgressBillingApplicationSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const updated = await tenantTx(request, async (tx) => {
        const current = await loadApplication(tx, orgId, request.params.applicationId);
        if (current.status !== 'approved') {
          throw problem('conflict', 'Only an approved application can generate an invoice.');
        }
        const job = await requireJob(tx, orgId, current.jobId);
        const dto = await applicationDto(tx, orgId, current);
        const number = await nextInvoiceNumber(tx, orgId);
        const [invoice] = await tx
          .insert(invoices)
          .values({
            orgId,
            number,
            kind: 'progress',
            status: 'draft',
            customerId: job.customerId,
            contactId: job.contactId,
            jobId: current.jobId,
            currency: dto.currency,
            subtotalMinor: dto.totals.currentDueMinor,
            taxMinor: 0,
            totalMinor: dto.totals.currentDueMinor,
            memo: `Progress billing application #${current.number} (${current.periodStart} to ${current.periodEnd}). Amount due is this period’s work less retainage withheld.`,
          })
          .returning();
        if (!invoice) throw problem('internal');
        const lineRows = dto.lines
          .filter((l) => l.thisPeriodMinor !== 0)
          .map((l, i) => ({
            orgId,
            invoiceId: invoice.id,
            sortOrder: i,
            description: `${l.itemNumber ? `${l.itemNumber} — ` : ''}${l.description} (progress to ${l.percentComplete}%)`,
            quantity: '1',
            unit: 'each' as const,
            unitPriceMinor: l.thisPeriodMinor,
            amountMinor: l.thisPeriodMinor,
            taxRate: '0',
            taxMinor: 0,
            sourceType: 'progress_billing_application',
            sourceId: current.id,
          }));
        if (dto.totals.retainageThisPeriodMinor !== 0) {
          lineRows.push({
            orgId,
            invoiceId: invoice.id,
            sortOrder: lineRows.length,
            description: 'Less retainage withheld this period',
            quantity: '1',
            unit: 'each' as const,
            unitPriceMinor: -dto.totals.retainageThisPeriodMinor,
            amountMinor: -dto.totals.retainageThisPeriodMinor,
            taxRate: '0',
            taxMinor: 0,
            sourceType: 'progress_billing_application',
            sourceId: current.id,
          });
        }
        if (lineRows.length > 0) await tx.insert(invoiceLines).values(lineRows);
        const [row] = await tx
          .update(progressBillingApplications)
          .set({
            status: 'invoiced',
            invoiceId: invoice.id,
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(progressBillingApplications.orgId, orgId),
              eq(progressBillingApplications.id, current.id),
            ),
          )
          .returning();
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'progress_billing.invoice_generated',
          resourceType: 'progress_billing_application',
          resourceId: row.id,
          after: { invoiceId: invoice.id, invoiceNumber: invoice.number },
        });
        return row;
      });
      return tenantTx(request, (tx) => applicationDto(tx, orgId, updated));
    },
  );

  app.post(
    '/progress-billing/applications/:applicationId/pdf',
    {
      config: { permission: READ, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['progress-billing'],
        params: AppParams,
        summary: 'Render the application as a generic progress-billing PDF (not an AIA form).',
        response: { 200: ProgressBillingPdfResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const snapshot = await tenantTx(request, async (tx) => {
        const [appRow] = await tx
          .select()
          .from(progressBillingApplications)
          .where(
            and(
              eq(progressBillingApplications.orgId, orgId),
              eq(progressBillingApplications.id, request.params.applicationId),
            ),
          );
        if (!appRow) throw problem('not_found');
        const job = await requireJob(tx, orgId, appRow.jobId);
        const { sov } = await loadSov(tx, orgId, appRow.sovId);
        const dto = await applicationDto(tx, orgId, appRow);
        const [org] = await tx
          .select({ displayName: organizations.displayName })
          .from(organizations)
          .where(eq(organizations.id, orgId));
        const now = new Date();
        const documentId = `PB-${now.toISOString().slice(0, 10)}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
        const snap: ProgressBillingSnapshot = {
          kind: 'progress_billing',
          meta: {
            documentId,
            revision: 1,
            issuedAt: now.toISOString(),
            organization: { name: org?.displayName ?? 'Field Pro' },
            productName: 'Field Pro',
          },
          projectName: `${job.number} — ${job.title}`,
          applicationNumber: appRow.number,
          periodStart: appRow.periodStart,
          periodEnd: appRow.periodEnd,
          status: appRow.status,
          retainagePct: Number(sov.retainagePct),
          lines: dto.lines.map((l) => ({
            itemNumber: l.itemNumber,
            description: l.description,
            scheduledValueCents: l.scheduledValueMinor,
            percentComplete: l.percentComplete,
            completedToDateCents: l.completedToDateMinor,
            storedMaterialsCents: l.storedMaterialsMinor,
            previousCompletedStoredCents: l.previousCompletedStoredMinor,
            thisPeriodCents: l.thisPeriodMinor,
            balanceToFinishCents: l.balanceToFinishMinor,
          })),
          scheduledTotalCents: dto.totals.scheduledTotalMinor,
          completedStoredTotalCents: dto.totals.completedStoredTotalMinor,
          previousCompletedStoredCents: dto.totals.previousCompletedStoredMinor,
          thisPeriodGrossCents: dto.totals.thisPeriodGrossMinor,
          retainageToDateCents: dto.totals.retainageToDateMinor,
          retainageThisPeriodCents: dto.totals.retainageThisPeriodMinor,
          currentDueCents: dto.totals.currentDueMinor,
          balanceToFinishCents: dto.totals.balanceToFinishMinor,
          invoiceNumber: dto.invoiceNumber,
        };
        return snap;
      });
      const rendered = await renderToBuffer(snapshot);
      return {
        filename: `${snapshot.meta.documentId}.pdf`,
        contentBase64: rendered.buffer.toString('base64'),
        sha256Hex: rendered.sha256,
        pages: rendered.pageCount,
      };
    },
  );

  app.get(
    '/progress-billing/ar-aging',
    {
      config: { permission: 'invoice:read' },
      schema: {
        tags: ['progress-billing'],
        summary: 'Accounts-receivable aging from issued customer invoices (outstanding = total - paid - refunded).',
        response: { 200: ArAgingResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const asOf = new Date().toISOString().slice(0, 10);
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select({
            id: invoices.id,
            number: invoices.number,
            customerId: invoices.customerId,
            jobId: invoices.jobId,
            status: invoices.status,
            dueOn: invoices.dueOn,
            currency: invoices.currency,
            totalMinor: invoices.totalMinor,
            amountPaidMinor: invoices.amountPaidMinor,
            amountRefundedMinor: invoices.amountRefundedMinor,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.orgId, orgId),
              inArray(invoices.status, ['issued', 'partially_paid']),
            ),
          )
          .orderBy(asc(invoices.dueOn))
          .limit(500);
        const customerIds = [...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x))];
        const custRows = customerIds.length
          ? await tx
              .select({ id: customers.id, displayName: customers.displayName, companyName: customers.companyName })
              .from(customers)
              .where(and(eq(customers.orgId, orgId), inArray(customers.id, customerIds)))
          : [];
        const custById = new Map(custRows.map((c) => [c.id, c.companyName ?? c.displayName]));
        const dayMs = 86_400_000;
        const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
        const bucketOf = (dueOn: string | null) => {
          if (!dueOn) return { bucket: 'no_due_date' as const, daysOverdue: null };
          const days = Math.floor((asOfMs - Date.parse(`${dueOn}T00:00:00Z`)) / dayMs);
          if (days <= 0) return { bucket: 'current' as const, daysOverdue: days };
          if (days <= 30) return { bucket: 'days_1_30' as const, daysOverdue: days };
          if (days <= 60) return { bucket: 'days_31_60' as const, daysOverdue: days };
          if (days <= 90) return { bucket: 'days_61_90' as const, daysOverdue: days };
          return { bucket: 'days_90_plus' as const, daysOverdue: days };
        };
        const bucketNames = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_90_plus', 'no_due_date'] as const;
        const buckets = new Map(bucketNames.map((b) => [b, { bucket: b, invoiceCount: 0, outstandingMinor: 0 }]));
        const items = rows.map((r) => {
          const outstandingMinor = r.totalMinor - r.amountPaidMinor - r.amountRefundedMinor;
          const { bucket, daysOverdue } = bucketOf(r.dueOn);
          const agg = buckets.get(bucket)!;
          agg.invoiceCount += 1;
          agg.outstandingMinor += outstandingMinor;
          return {
            id: r.id,
            number: r.number,
            customerName: r.customerId ? (custById.get(r.customerId) ?? null) : null,
            jobId: r.jobId,
            status: r.status,
            dueOn: r.dueOn,
            totalMinor: r.totalMinor,
            amountPaidMinor: r.amountPaidMinor,
            outstandingMinor,
            daysOverdue,
          };
        });
        return {
          currency: rows[0]?.currency ?? 'USD',
          asOf,
          buckets: bucketNames.map((b) => buckets.get(b)!),
          totalOutstandingMinor: items.reduce((s, i) => s + i.outstandingMinor, 0),
          invoices: items,
        };
      });
    },
  );
};

export default progressBillingModule;
