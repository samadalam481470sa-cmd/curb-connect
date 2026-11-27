// `reports` module: business-wide rollups over the job-cost ledger (budgets, actuals),
// draw requests, and AP invoices the builder already entered. Nothing here invents a
// number: a job with no budget gets percentSpent null, a job with no draw contract
// gets margin/earned null — the UI shows "insufficient data" for those cells.
import {
  ApAgingReportSchema,
  DrawForecastReportSchema,
  JobMarginsReportSchema,
  WipReportSchema,
} from '@fieldline/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Tx } from '../../db/runtime';
import { apInvoices, drawRequests, jobCostBudgets, jobCostEntries, jobs } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';

const READ = 'analytics:read';

const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

interface JobRollup {
  jobId: string;
  jobNumber: string;
  jobTitle: string;
  currency: string;
  budgetMinor: number;
  actualMinor: number;
  contractMinor: number | null;
  billedMinor: number;
  draftDrawsMinor: number;
  submittedDrawsMinor: number;
  approvedDrawsMinor: number;
}

async function rollupJobs(tx: Tx, orgId: string): Promise<JobRollup[]> {
  const jobRows = await tx
    .select({ id: jobs.id, number: jobs.number, title: jobs.title, currency: jobs.currency })
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), isNull(jobs.deletedAt)))
    .limit(1000);
  const budgets = await tx
    .select({
      jobId: jobCostBudgets.jobId,
      total: sql<number>`coalesce(sum(${jobCostBudgets.budgetMinor}), 0)::bigint`,
    })
    .from(jobCostBudgets)
    .where(eq(jobCostBudgets.orgId, orgId))
    .groupBy(jobCostBudgets.jobId);
  const actuals = await tx
    .select({
      jobId: jobCostEntries.jobId,
      total: sql<number>`coalesce(sum(${jobCostEntries.amountMinor}), 0)::bigint`,
    })
    .from(jobCostEntries)
    .where(eq(jobCostEntries.orgId, orgId))
    .groupBy(jobCostEntries.jobId);
  const draws = await tx
    .select()
    .from(drawRequests)
    .where(eq(drawRequests.orgId, orgId))
    .orderBy(drawRequests.number);

  const budgetByJob = new Map(budgets.map((b) => [b.jobId, Number(b.total)]));
  const actualByJob = new Map(actuals.map((a) => [a.jobId, Number(a.total)]));
  const drawByJob = new Map<string, typeof draws>();
  for (const d of draws) {
    const arr = drawByJob.get(d.jobId) ?? [];
    arr.push(d);
    drawByJob.set(d.jobId, arr);
  }

  return jobRows.map((job) => {
    const jobDraws = drawByJob.get(job.id) ?? [];
    const latest = jobDraws[jobDraws.length - 1];
    const sumBy = (status: string) =>
      jobDraws.filter((d) => d.status === status).reduce((s, d) => s + d.requestedMinor, 0);
    return {
      jobId: job.id,
      jobNumber: job.number,
      jobTitle: job.title,
      currency: job.currency,
      budgetMinor: budgetByJob.get(job.id) ?? 0,
      actualMinor: actualByJob.get(job.id) ?? 0,
      contractMinor: latest ? latest.contractMinor : null,
      billedMinor: sumBy('paid'),
      draftDrawsMinor: sumBy('draft'),
      submittedDrawsMinor: sumBy('submitted'),
      approvedDrawsMinor: sumBy('approved'),
    };
  });
}

const reportsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/reports/job-margins',
    {
      config: { permission: READ },
      schema: {
        tags: ['reports'],
        summary: 'Budget vs actual vs contract margin per job',
        response: { 200: JobMarginsReportSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rollups = await tenantTx(request, (tx) => rollupJobs(tx, orgId));
      const rows = rollups
        .filter((r) => r.budgetMinor > 0 || r.actualMinor > 0 || r.contractMinor !== null)
        .map((r) => ({
          jobId: r.jobId,
          jobNumber: r.jobNumber,
          jobTitle: r.jobTitle,
          currency: r.currency,
          budgetMinor: r.budgetMinor,
          actualMinor: r.actualMinor,
          varianceMinor: r.budgetMinor - r.actualMinor,
          contractMinor: r.contractMinor,
          marginMinor: r.contractMinor === null ? null : r.contractMinor - r.actualMinor,
          percentSpent: pct(r.actualMinor, r.budgetMinor),
        }));
      return {
        rows,
        totals: {
          budgetMinor: rows.reduce((s, r) => s + r.budgetMinor, 0),
          actualMinor: rows.reduce((s, r) => s + r.actualMinor, 0),
          varianceMinor: rows.reduce((s, r) => s + r.varianceMinor, 0),
          jobCount: rows.length,
        },
      };
    },
  );

  app.get(
    '/reports/wip',
    {
      config: { permission: READ },
      schema: {
        tags: ['reports'],
        summary: 'Work in progress: percent complete, earned, over/under billed per job',
        response: { 200: WipReportSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rollups = await tenantTx(request, (tx) => rollupJobs(tx, orgId));
      const rows = rollups
        .filter((r) => r.budgetMinor > 0 || r.actualMinor > 0 || r.contractMinor !== null)
        .map((r) => {
          const percentComplete = pct(r.actualMinor, r.budgetMinor);
          const earnedMinor =
            r.contractMinor !== null && percentComplete !== null
              ? Math.round((r.contractMinor * percentComplete) / 100)
              : null;
          return {
            jobId: r.jobId,
            jobNumber: r.jobNumber,
            jobTitle: r.jobTitle,
            currency: r.currency,
            contractMinor: r.contractMinor,
            budgetMinor: r.budgetMinor,
            costsToDateMinor: r.actualMinor,
            billedToDateMinor: r.billedMinor,
            percentComplete,
            earnedMinor,
            overUnderBilledMinor: earnedMinor === null ? null : r.billedMinor - earnedMinor,
          };
        });
      return { rows };
    },
  );

  app.get(
    '/reports/draw-forecast',
    {
      config: { permission: READ },
      schema: {
        tags: ['reports'],
        summary: 'Remaining contract value and open draw pipeline per job',
        response: { 200: DrawForecastReportSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rollups = await tenantTx(request, (tx) => rollupJobs(tx, orgId));
      const rows = rollups
        .filter(
          (r) =>
            r.contractMinor !== null ||
            r.draftDrawsMinor > 0 ||
            r.submittedDrawsMinor > 0 ||
            r.approvedDrawsMinor > 0,
        )
        .map((r) => ({
          jobId: r.jobId,
          jobNumber: r.jobNumber,
          jobTitle: r.jobTitle,
          currency: r.currency,
          contractMinor: r.contractMinor,
          billedToDateMinor: r.billedMinor,
          remainingContractMinor: r.contractMinor === null ? null : r.contractMinor - r.billedMinor,
          draftDrawsMinor: r.draftDrawsMinor,
          submittedDrawsMinor: r.submittedDrawsMinor,
          approvedDrawsMinor: r.approvedDrawsMinor,
        }));
      return {
        rows,
        totals: {
          draftDrawsMinor: rows.reduce((s, r) => s + r.draftDrawsMinor, 0),
          submittedDrawsMinor: rows.reduce((s, r) => s + r.submittedDrawsMinor, 0),
          approvedDrawsMinor: rows.reduce((s, r) => s + r.approvedDrawsMinor, 0),
        },
      };
    },
  );

  app.get(
    '/reports/ap-aging',
    {
      config: { permission: READ },
      schema: {
        tags: ['reports'],
        summary: 'Open payables by due-date bucket and status',
        response: { 200: ApAgingReportSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select({
            status: apInvoices.status,
            dueOn: apInvoices.dueOn,
            amountMinor: apInvoices.amountMinor,
          })
          .from(apInvoices)
          .where(eq(apInvoices.orgId, orgId))
          .limit(5000),
      );
      const today = new Date().toISOString().slice(0, 10);
      const in7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const openStatuses = new Set(['captured', 'pending_approval', 'approved']);
      const bucketNames = ['overdue', 'due_7_days', 'due_30_days', 'due_later', 'no_due_date'] as const;
      const buckets = new Map<string, { count: number; amountMinor: number }>(
        bucketNames.map((b) => [b, { count: 0, amountMinor: 0 }]),
      );
      const byStatus = new Map<string, { count: number; amountMinor: number }>();
      let openTotalMinor = 0;
      for (const row of rows) {
        const st = byStatus.get(row.status) ?? { count: 0, amountMinor: 0 };
        st.count += 1;
        st.amountMinor += row.amountMinor;
        byStatus.set(row.status, st);
        if (!openStatuses.has(row.status)) continue;
        openTotalMinor += row.amountMinor;
        const bucket = !row.dueOn
          ? 'no_due_date'
          : row.dueOn < today
            ? 'overdue'
            : row.dueOn <= in7
              ? 'due_7_days'
              : row.dueOn <= in30
                ? 'due_30_days'
                : 'due_later';
        const b = buckets.get(bucket);
        if (b) {
          b.count += 1;
          b.amountMinor += row.amountMinor;
        }
      }
      return {
        buckets: bucketNames.map((bucket) => ({ bucket, ...(buckets.get(bucket) ?? { count: 0, amountMinor: 0 }) })),
        byStatus: [...byStatus.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([status, v]) => ({ status, ...v })),
        openTotalMinor,
      };
    },
  );
};

export default reportsModule;
