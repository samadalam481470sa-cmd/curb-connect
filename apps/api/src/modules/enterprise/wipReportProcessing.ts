import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseWipReports as reports } from '../../db/schema/enterpriseWipReports';
import { csvCell } from '../invoiceIntel';
import type { Snapshot } from './wipReportData';

export type WipScope = { orgId: string; reportId: string };

function scoped(scope: WipScope) {
  return and(eq(reports.orgId, scope.orgId), eq(reports.id, scope.reportId));
}

const columns = [
  'record_type',
  'report_id',
  'period_start',
  'period_through',
  'period_state',
  'methodology',
  'captured_at',
  'project_id',
  'project_name',
  'currency',
  'period_actual_minor',
  'cumulative_actual_minor',
  'forecast_id',
  'budget_version',
  'forecast_contract_minor',
  'estimated_at_completion_minor',
  'percent_complete_bps',
  'earned_to_date_minor',
  'issues',
  'posting_id',
  'source_bill_id',
  'source_approval_id',
  'posting_date',
  'recorded_minor',
  'allocated_minor',
  'in_period',
] as const;

type Cell = string | number | null | boolean;
type CsvRow = Partial<Record<(typeof columns)[number], Cell>>;

export function generateWipCsv(reportId: string, input: Snapshot) {
  const metadata = {
    report_id: reportId,
    period_start: input.period.monthStart,
    period_through: input.period.through,
    period_state: input.period.state,
    methodology: input.methodologyVersion,
    captured_at: input.capturedAt,
  };
  const rows: CsvRow[] = [];
  for (const total of input.currencyTotals) {
    rows.push({
      record_type: 'report_currency_total',
      currency: total.currency,
      period_actual_minor: total.periodMinor,
      cumulative_actual_minor: total.totalThroughPeriodMinor,
    });
  }
  for (const project of input.rows) {
    const source = { project_id: project.projectId, project_name: project.projectName };
    rows.push({
      ...source,
      record_type: 'project_forecast',
      currency: project.forecastCurrency,
      forecast_id: project.sourceForecastId,
      budget_version: project.sourceBudgetVersion,
      forecast_contract_minor: project.contractMinor,
      estimated_at_completion_minor: project.estimatedAtCompletionMinor,
      percent_complete_bps: project.percentCompleteBps,
      earned_to_date_minor: project.earnedToDateMinor,
      issues: project.issues.join(' | '),
    });
    for (const total of project.currencyTotals) {
      rows.push({
        ...source,
        record_type: 'project_currency_total',
        currency: total.currency,
        period_actual_minor: total.periodMinor,
        cumulative_actual_minor: total.totalThroughPeriodMinor,
      });
    }
    for (const posting of project.postingSources) {
      rows.push({
        ...source,
        record_type: 'bill_posting',
        currency: posting.currency,
        posting_id: posting.postingId,
        source_bill_id: posting.sourceId,
        source_approval_id: posting.sourceRevisionId,
        posting_date: posting.postingDate,
        recorded_minor: posting.recordedMinor,
        allocated_minor: posting.allocatedMinor,
        in_period: posting.inPeriod,
        issues: posting.recordedMinor === posting.allocatedMinor ? '' : 'unmatched_allocations',
      });
    }
  }
  const csv =
    [
      columns.join(','),
      ...rows.map((row) => {
        const data = { ...metadata, ...row };
        return columns.map((column) => csvCell(data[column])).join(',');
      }),
    ].join('\r\n') + '\r\n';
  return { csv, digest: createHash('sha256').update(csv).digest('hex') };
}

export async function claimWipReport(tx: Tx, scope: WipScope) {
  const [row] = await tx
    .select({ snapshot: reports.snapshot, status: reports.status })
    .from(reports)
    .where(scoped(scope))
    .for('update');
  if (!row || row.status === 'ready' || row.status === 'failed') return null;
  if (row.status === 'queued') {
    await tx.update(reports).set({ status: 'processing' }).where(scoped(scope));
  }
  return row.snapshot;
}

export async function finishWipReport(
  tx: Tx,
  scope: WipScope,
  artifact: ReturnType<typeof generateWipCsv> | null,
) {
  await tx
    .update(reports)
    .set(
      artifact
        ? {
            status: 'ready',
            csvText: artifact.csv,
            digest: artifact.digest,
            completedAt: new Date(),
          }
        : {
            status: 'failed',
            errorCode: 'report_generation_failed',
            completedAt: new Date(),
          },
    )
    .where(
      and(
        scoped(scope),
        artifact
          ? eq(reports.status, 'processing')
          : inArray(reports.status, ['queued', 'processing']),
      ),
    );
}
