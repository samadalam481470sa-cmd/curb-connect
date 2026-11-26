// `jobCost` module (builder operations section, items 2–4): the in-app job-cost ledger
// (budget lines per cost code + actual entries, budget-to-actual summary), draw/progress
// billing against a contract amount, the AP workflow (capture → approval → payment recorded;
// moving money stays gated on a payments provider), and lien-release document tracking.
// Every number is builder-entered or carried from an existing record — never invented.
// Lien releases track paperwork (Texas has statutory waiver forms); they are not legal advice.
import {
  ApInvoiceListSchema,
  ApInvoiceSchema,
  CreateApInvoiceRequestSchema,
  CreateDrawRequestSchema,
  CreateJobCostEntryRequestSchema,
  CreateLienReleaseRequestSchema,
  DecideApInvoiceRequestSchema,
  DrawRequestListSchema,
  DrawRequestSchema,
  JobCostEntrySchema,
  JobCostSummarySchema,
  LienReleaseListSchema,
  LienReleaseSchema,
  UpdateDrawRequestSchema,
  UpdateLienReleaseRequestSchema,
  UpsertJobCostBudgetRequestSchema,
  JobCostBudgetLineSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { apInvoices, drawRequests, jobCostBudgets, jobCostEntries, jobs, lienReleases } from '../../db/schema';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';

const COST_READ = 'job_cost:read';
const COST_WRITE = 'job_cost:write';
const DRAW_READ = 'draw:read';
const DRAW_WRITE = 'draw:write';
const DRAW_APPROVE = 'draw:approve';
const AP_READ = 'ap:read';
const AP_WRITE = 'ap:write';
const AP_APPROVE = 'ap:approve';
const LIEN_READ = 'lien_release:read';
const LIEN_WRITE = 'lien_release:write';

const IdParams = z.object({ id: z.uuid() });
const JobIdParams = z.object({ jobId: z.uuid() });

type BudgetRow = typeof jobCostBudgets.$inferSelect;
type EntryRow = typeof jobCostEntries.$inferSelect;
type DrawRow = typeof drawRequests.$inferSelect;
type ApRow = typeof apInvoices.$inferSelect;
type LienRow = typeof lienReleases.$inferSelect;

function budgetDto(row: BudgetRow) {
  return {
    id: row.id,
    jobId: row.jobId,
    costCode: row.costCode,
    label: row.label,
    budgetMinor: row.budgetMinor,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function entryDto(row: EntryRow) {
  return {
    id: row.id,
    jobId: row.jobId,
    costCode: row.costCode,
    description: row.description,
    amountMinor: row.amountMinor,
    currency: row.currency,
    source: row.source,
    sourceId: row.sourceId,
    incurredOn: row.incurredOn,
    createdAt: row.createdAt.toISOString(),
  };
}

function drawDto(row: DrawRow, previouslyPaidMinor: number) {
  return {
    id: row.id,
    jobId: row.jobId,
    number: row.number,
    status: row.status,
    contractMinor: row.contractMinor,
    requestedMinor: row.requestedMinor,
    previouslyPaidMinor,
    retainagePct: Number(row.retainagePct),
    currency: row.currency,
    note: row.note,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function apDto(row: ApRow) {
  return {
    id: row.id,
    vendorName: row.vendorName,
    invoiceNumber: row.invoiceNumber,
    jobId: row.jobId,
    costCode: row.costCode,
    amountMinor: row.amountMinor,
    currency: row.currency,
    dueOn: row.dueOn,
    status: row.status,
    source: row.source,
    sourceId: row.sourceId,
    approvalNote: row.approvalNote,
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    paymentRecordedAt: row.paymentRecordedAt?.toISOString() ?? null,
    lienReleaseId: row.lienReleaseId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function lienDto(row: LienRow) {
  return {
    id: row.id,
    jobId: row.jobId,
    apInvoiceId: row.apInvoiceId,
    claimantName: row.claimantName,
    kind: row.kind,
    status: row.status,
    amountMinor: row.amountMinor,
    currency: row.currency,
    throughOn: row.throughOn,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const jobCostModule: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------- job cost

  app.get(
    '/job-cost/jobs/:jobId/summary',
    {
      config: { permission: COST_READ },
      schema: {
        tags: ['job-cost'],
        summary: 'Budget vs actual per cost code for one job (actuals from recorded entries only)',
        params: JobIdParams,
        response: { 200: JobCostSummarySchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { jobId } = request.params;
      return tenantTx(request, async (tx) => {
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)))
          .limit(1);
        if (!job) throw problem('not_found');
        const budgets = await tx
          .select()
          .from(jobCostBudgets)
          .where(and(eq(jobCostBudgets.orgId, orgId), eq(jobCostBudgets.jobId, jobId)))
          .orderBy(asc(jobCostBudgets.costCode));
        const entries = await tx
          .select()
          .from(jobCostEntries)
          .where(and(eq(jobCostEntries.orgId, orgId), eq(jobCostEntries.jobId, jobId)));
        const byCode = new Map<string, { label: string | null; budget: number | null; actual: number; count: number }>();
        for (const b of budgets) {
          byCode.set(b.costCode, { label: b.label, budget: b.budgetMinor, actual: 0, count: 0 });
        }
        for (const e of entries) {
          const line = byCode.get(e.costCode) ?? { label: null, budget: null, actual: 0, count: 0 };
          line.actual += e.amountMinor;
          line.count += 1;
          byCode.set(e.costCode, line);
        }
        const lines = [...byCode.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([costCode, v]) => ({
            costCode,
            label: v.label,
            budgetMinor: v.budget,
            actualMinor: v.actual,
            remainingMinor: v.budget === null ? null : v.budget - v.actual,
            entryCount: v.count,
          }));
        const totalBudget = budgets.length ? budgets.reduce((s, b) => s + b.budgetMinor, 0) : null;
        const totalActual = entries.reduce((s, e) => s + e.amountMinor, 0);
        return {
          jobId,
          lines,
          totalBudgetMinor: totalBudget,
          totalActualMinor: totalActual,
          currency: budgets[0]?.currency ?? entries[0]?.currency ?? 'USD',
        };
      });
    },
  );

  app.post(
    '/job-cost/jobs/:jobId/budgets',
    {
      config: { permission: COST_WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['job-cost'],
        summary: 'Set (or replace) the budget line for one cost code on a job',
        params: JobIdParams,
        body: UpsertJobCostBudgetRequestSchema,
        response: { 200: JobCostBudgetLineSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { jobId } = request.params;
      const row = await tenantTx(request, async (tx) => {
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)))
          .limit(1);
        if (!job) throw problem('not_found');
        const [upserted] = await tx
          .insert(jobCostBudgets)
          .values({
            orgId,
            jobId,
            costCode: request.body.costCode,
            label: request.body.label,
            budgetMinor: request.body.budgetMinor,
          })
          .onConflictDoUpdate({
            target: [jobCostBudgets.orgId, jobCostBudgets.jobId, jobCostBudgets.costCode],
            set: { label: request.body.label, budgetMinor: request.body.budgetMinor, updatedAt: new Date() },
          })
          .returning();
        if (!upserted) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'job_cost.budget_set',
          resourceType: 'job_cost_budget',
          resourceId: upserted.id,
          after: { jobId, costCode: upserted.costCode, budgetMinor: upserted.budgetMinor },
        });
        return upserted;
      });
      return budgetDto(row);
    },
  );

  app.get(
    '/job-cost/jobs/:jobId/entries',
    {
      config: { permission: COST_READ },
      schema: {
        tags: ['job-cost'],
        summary: 'Actual cost entries recorded against a job, newest first',
        params: JobIdParams,
        response: { 200: z.object({ items: z.array(JobCostEntrySchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(jobCostEntries)
          .where(
            and(
              eq(jobCostEntries.orgId, orgId),
              eq(jobCostEntries.jobId, request.params.jobId),
            ),
          )
          .orderBy(desc(jobCostEntries.incurredOn), desc(jobCostEntries.createdAt))
          .limit(500),
      );
      return { items: rows.map(entryDto) };
    },
  );

  app.post(
    '/job-cost/jobs/:jobId/entries',
    {
      config: { permission: COST_WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['job-cost'],
        summary: 'Record an actual cost against a job and cost code',
        params: JobIdParams,
        body: CreateJobCostEntryRequestSchema,
        response: { 201: JobCostEntrySchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const { jobId } = request.params;
      const row = await tenantTx(request, async (tx) => {
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)))
          .limit(1);
        if (!job) throw problem('not_found');
        const [created] = await tx
          .insert(jobCostEntries)
          .values({
            orgId,
            jobId,
            costCode: request.body.costCode,
            description: request.body.description,
            amountMinor: request.body.amountMinor,
            source: request.body.source,
            sourceId: request.body.sourceId ?? null,
            incurredOn: request.body.incurredOn,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'job_cost.entry_recorded',
          resourceType: 'job_cost_entry',
          resourceId: created.id,
          after: { jobId, costCode: created.costCode, amountMinor: created.amountMinor },
        });
        return created;
      });
      reply.code(201);
      return entryDto(row);
    },
  );

  // ---------------------------------------------------------- draws

  app.get(
    '/job-cost/draws',
    {
      config: { permission: DRAW_READ },
      schema: {
        tags: ['job-cost'],
        summary: 'Draw (progress billing) requests, newest first; filter by job or status',
        querystring: z.object({
          jobId: z.uuid().optional(),
          status: z.enum(['draft', 'submitted', 'approved', 'paid', 'rejected']).optional(),
        }),
        response: { 200: DrawRequestListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(drawRequests)
          .where(
            and(
              eq(drawRequests.orgId, orgId),
              q.jobId ? eq(drawRequests.jobId, q.jobId) : undefined,
              q.status ? eq(drawRequests.status, q.status) : undefined,
            ),
          )
          .orderBy(desc(drawRequests.createdAt))
          .limit(200);
        // previouslyPaid per draw = sum of earlier-numbered paid draws on the same job.
        const paidByJob = new Map<string, { number: number; requestedMinor: number }[]>();
        for (const r of rows) {
          if (r.status === 'paid') {
            const list = paidByJob.get(r.jobId) ?? [];
            list.push({ number: r.number, requestedMinor: r.requestedMinor });
            paidByJob.set(r.jobId, list);
          }
        }
        return {
          items: rows.map((r) =>
            drawDto(
              r,
              (paidByJob.get(r.jobId) ?? [])
                .filter((p) => p.number < r.number)
                .reduce((s, p) => s + p.requestedMinor, 0),
            ),
          ),
        };
      });
    },
  );

  app.post(
    '/job-cost/draws',
    {
      config: { permission: DRAW_WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['job-cost'],
        summary: 'Create a draw request against a job contract amount',
        body: CreateDrawRequestSchema,
        response: { 201: DrawRequestSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.orgId, orgId), eq(jobs.id, request.body.jobId)))
          .limit(1);
        if (!job) throw problem('not_found');
        const [maxRow] = await tx
          .select({ max: sql<number>`coalesce(max(${drawRequests.number}), 0)` })
          .from(drawRequests)
          .where(and(eq(drawRequests.orgId, orgId), eq(drawRequests.jobId, request.body.jobId)));
        const number = Number(maxRow?.max ?? 0) + 1;
        const [created] = await tx
          .insert(drawRequests)
          .values({
            orgId,
            jobId: request.body.jobId,
            number,
            status: 'draft',
            contractMinor: request.body.contractMinor,
            requestedMinor: request.body.requestedMinor,
            retainagePct: String(request.body.retainagePct),
            note: request.body.note ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'draw.created',
          resourceType: 'draw_request',
          resourceId: created.id,
          after: { jobId: created.jobId, number, requestedMinor: created.requestedMinor },
        });
        return created;
      });
      reply.code(201);
      return drawDto(row, 0);
    },
  );

  app.patch(
    '/job-cost/draws/:id',
    {
      config: { permission: DRAW_WRITE },
      schema: {
        tags: ['job-cost'],
        summary: 'Move a draw through its workflow (submit, approve, pay, reject)',
        params: IdParams,
        body: UpdateDrawRequestSchema,
        response: { 200: DrawRequestSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const next = request.body.status;
      // Approving or paying a draw is a finance decision.
      if (next === 'approved' || next === 'paid') assertCan(request, DRAW_APPROVE as never);
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(drawRequests)
          .where(and(eq(drawRequests.orgId, org.orgId), eq(drawRequests.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        const now = new Date();
        const [updated] = await tx
          .update(drawRequests)
          .set({
            status: next,
            submittedAt: next === 'submitted' ? (existing.submittedAt ?? now) : existing.submittedAt,
            decidedAt: next === 'approved' || next === 'rejected' ? (existing.decidedAt ?? now) : existing.decidedAt,
            paidAt: next === 'paid' ? (existing.paidAt ?? now) : existing.paidAt,
            revision: existing.revision + 1,
            updatedAt: now,
          })
          .where(and(eq(drawRequests.orgId, org.orgId), eq(drawRequests.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'draw.status_changed',
          resourceType: 'draw_request',
          resourceId: updated.id,
          before: { status: existing.status },
          after: { status: updated.status },
        });
        return updated;
      });
      return drawDto(row, 0);
    },
  );

  // ---------------------------------------------------------- AP invoices

  app.get(
    '/job-cost/ap-invoices',
    {
      config: { permission: AP_READ },
      schema: {
        tags: ['job-cost'],
        summary: 'Accounts-payable invoices, newest first; filter by status',
        querystring: z.object({
          status: z
            .enum(['captured', 'pending_approval', 'approved', 'payment_recorded', 'rejected', 'disputed'])
            .optional(),
        }),
        response: { 200: ApInvoiceListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(apInvoices)
          .where(
            and(
              eq(apInvoices.orgId, orgId),
              q.status ? eq(apInvoices.status, q.status) : undefined,
            ),
          )
          .orderBy(desc(apInvoices.createdAt))
          .limit(200),
      );
      return { items: rows.map(apDto) };
    },
  );

  app.post(
    '/job-cost/ap-invoices',
    {
      config: { permission: AP_WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['job-cost'],
        summary: 'Capture an AP invoice (typed in, from Invoice Intelligence, or a network bill)',
        body: CreateApInvoiceRequestSchema,
        response: { 201: ApInvoiceSchema },
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
          .insert(apInvoices)
          .values({
            orgId,
            vendorName: request.body.vendorName,
            invoiceNumber: request.body.invoiceNumber ?? null,
            jobId: request.body.jobId ?? null,
            costCode: request.body.costCode ?? null,
            amountMinor: request.body.amountMinor,
            dueOn: request.body.dueOn ?? null,
            status: 'captured',
            source: request.body.source,
            sourceId: request.body.sourceId ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'ap.invoice_captured',
          resourceType: 'ap_invoice',
          resourceId: created.id,
          after: { vendorName: created.vendorName, amountMinor: created.amountMinor },
        });
        return created;
      });
      reply.code(201);
      return apDto(row);
    },
  );

  app.post(
    '/job-cost/ap-invoices/:id/decide',
    {
      config: { permission: AP_WRITE },
      schema: {
        tags: ['job-cost'],
        summary: 'Route an AP invoice: submit for approval, approve, reject, dispute, or record payment',
        params: IdParams,
        body: DecideApInvoiceRequestSchema,
        response: { 200: ApInvoiceSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const decision = request.body.decision;
      if (decision === 'approve' || decision === 'record_payment') {
        assertCan(request, AP_APPROVE as never);
      }
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(apInvoices)
          .where(and(eq(apInvoices.orgId, org.orgId), eq(apInvoices.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        const now = new Date();
        const statusByDecision = {
          submit_for_approval: 'pending_approval',
          approve: 'approved',
          reject: 'rejected',
          dispute: 'disputed',
          record_payment: 'payment_recorded',
        } as const;
        if (decision === 'record_payment' && existing.status !== 'approved') {
          throw problem('conflict', 'Only an approved invoice can have payment recorded.');
        }
        const [updated] = await tx
          .update(apInvoices)
          .set({
            status: statusByDecision[decision],
            ...(request.body.note !== undefined && { approvalNote: request.body.note }),
            ...(decision === 'approve' && { approvedByUserId: org.userId, approvedAt: now }),
            ...(decision === 'record_payment' && {
              paymentRecordedAt: now,
              ...(request.body.lienReleaseId !== undefined && {
                lienReleaseId: request.body.lienReleaseId,
              }),
            }),
            revision: existing.revision + 1,
            updatedAt: now,
          })
          .where(and(eq(apInvoices.orgId, org.orgId), eq(apInvoices.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        // Recording payment against a job + cost code also books the actual into job cost.
        if (decision === 'record_payment' && updated.jobId && updated.costCode) {
          await tx.insert(jobCostEntries).values({
            orgId: org.orgId,
            jobId: updated.jobId,
            costCode: updated.costCode,
            description: `AP payment — ${updated.vendorName}${updated.invoiceNumber ? ` (${updated.invoiceNumber})` : ''}`,
            amountMinor: updated.amountMinor,
            source: 'ap_invoice',
            sourceId: updated.id,
            incurredOn: now.toISOString().slice(0, 10),
          });
        }
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: `ap.invoice_${decision}`,
          resourceType: 'ap_invoice',
          resourceId: updated.id,
          before: { status: existing.status },
          after: { status: updated.status },
        });
        return updated;
      });
      return apDto(row);
    },
  );

  // ---------------------------------------------------------- lien releases

  app.get(
    '/job-cost/lien-releases',
    {
      config: { permission: LIEN_READ },
      schema: {
        tags: ['job-cost'],
        summary: 'Lien-release documents tracked against jobs and payments, newest first',
        querystring: z.object({
          status: z.enum(['draft', 'requested', 'received', 'verified', 'void']).optional(),
          jobId: z.uuid().optional(),
        }),
        response: { 200: LienReleaseListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(lienReleases)
          .where(
            and(
              eq(lienReleases.orgId, orgId),
              q.status ? eq(lienReleases.status, q.status) : undefined,
              q.jobId ? eq(lienReleases.jobId, q.jobId) : undefined,
            ),
          )
          .orderBy(desc(lienReleases.createdAt))
          .limit(200),
      );
      return { items: rows.map(lienDto) };
    },
  );

  app.post(
    '/job-cost/lien-releases',
    {
      config: { permission: LIEN_WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['job-cost'],
        summary: 'Start tracking a lien waiver (Texas statutory kinds; paperwork tracking, not legal advice)',
        body: CreateLienReleaseRequestSchema,
        response: { 201: LienReleaseSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(lienReleases)
          .values({
            orgId,
            claimantName: request.body.claimantName,
            kind: request.body.kind,
            status: 'draft',
            jobId: request.body.jobId ?? null,
            apInvoiceId: request.body.apInvoiceId ?? null,
            amountMinor: request.body.amountMinor ?? null,
            throughOn: request.body.throughOn ?? null,
            note: request.body.note ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'lien_release.created',
          resourceType: 'lien_release',
          resourceId: created.id,
          after: { claimantName: created.claimantName, kind: created.kind },
        });
        return created;
      });
      reply.code(201);
      return lienDto(row);
    },
  );

  app.patch(
    '/job-cost/lien-releases/:id',
    {
      config: { permission: LIEN_WRITE },
      schema: {
        tags: ['job-cost'],
        summary: 'Move a lien release through draft → requested → received → verified',
        params: IdParams,
        body: UpdateLienReleaseRequestSchema,
        response: { 200: LienReleaseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(lienReleases)
          .where(and(eq(lienReleases.orgId, orgId), eq(lienReleases.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        const now = new Date();
        const [updated] = await tx
          .update(lienReleases)
          .set({
            status: request.body.status,
            receivedAt:
              request.body.status === 'received' || request.body.status === 'verified'
                ? (existing.receivedAt ?? now)
                : existing.receivedAt,
            updatedAt: now,
          })
          .where(and(eq(lienReleases.orgId, orgId), eq(lienReleases.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'lien_release.status_changed',
          resourceType: 'lien_release',
          resourceId: updated.id,
          before: { status: existing.status },
          after: { status: updated.status },
        });
        return updated;
      });
      return lienDto(row);
    },
  );
};

export default jobCostModule;
