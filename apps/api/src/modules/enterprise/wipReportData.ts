import type { EnterpriseWipReportInput } from '@fieldline/contracts';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  enterpriseActualBillAllocations as allocations,
  enterpriseActualBillPostings as postings,
} from '../../db/schema/enterpriseActualBillCosts';
import { enterpriseCostForecastSnapshots as forecasts } from '../../db/schema/enterpriseCostForecasts';

export type Snapshot = z.infer<typeof EnterpriseWipReportInput>;
type Row = Snapshot['rows'][number];
type Issue = Row['issues'][number];
type Posting = Row['postingSources'][number];
type CurrencyTotal = Snapshot['currencyTotals'][number];

export function combineWipTotals(input: CurrencyTotal[]) {
  const amounts = new Map<string, { current: bigint; cumulative: bigint }>();
  for (const line of input) {
    const total = amounts.get(line.currency) ?? { current: 0n, cumulative: 0n };
    total.current += BigInt(line.periodMinor);
    total.cumulative += BigInt(line.totalThroughPeriodMinor);
    amounts.set(line.currency, total);
  }
  return [...amounts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, { current, cumulative }]) => ({
      currency,
      periodMinor: current.toString(),
      totalThroughPeriodMinor: cumulative.toString(),
    }));
}

function signedRound(numerator: bigint, denominator: bigint) {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

export async function wipProjectRow(
  tx: Tx,
  orgId: string,
  project: { id: string; name: string },
  period: Snapshot['period'],
): Promise<Row> {
  const [forecast] = await tx
    .select({
      id: forecasts.id,
      version: forecasts.budgetVersion,
      currency: forecasts.currency,
      status: forecasts.status,
      contractMinor: forecasts.contractMinor,
      eacMinor: forecasts.eacMinor,
    })
    .from(forecasts)
    .where(
      and(
        eq(forecasts.orgId, orgId),
        eq(forecasts.projectId, project.id),
        lte(forecasts.asOf, period.through),
      ),
    )
    .orderBy(desc(forecasts.asOf), desc(forecasts.createdAt), desc(forecasts.id))
    .limit(1);
  const journal = await tx
    .select({
      postingId: postings.id,
      sourceId: postings.sourceId,
      sourceRevisionId: postings.sourceRevisionId,
      postingDate: postings.postingDate,
      currency: postings.currency,
      recordedMinor: sql<string>`${postings.totalMinor}::text`,
      allocatedMinor: sql<string>`coalesce(sum(${allocations.amountMinor}), 0)::text`,
    })
    .from(postings)
    .leftJoin(
      allocations,
      and(
        eq(allocations.orgId, postings.orgId),
        eq(allocations.projectId, postings.projectId),
        eq(allocations.postingId, postings.id),
      ),
    )
    .where(
      and(
        eq(postings.orgId, orgId),
        eq(postings.projectId, project.id),
        lte(postings.postingDate, period.through),
      ),
    )
    .groupBy(
      postings.id,
      postings.sourceId,
      postings.sourceRevisionId,
      postings.postingDate,
      postings.currency,
      postings.totalMinor,
    )
    .orderBy(asc(postings.postingDate), asc(postings.id));
  const postingSources: Posting[] = journal.map((row) => ({
    ...row,
    inPeriod: row.postingDate >= period.monthStart,
  }));
  const currencyTotals = combineWipTotals(
    postingSources.map((line) => ({
      currency: line.currency,
      periodMinor: line.inPeriod ? line.recordedMinor : '0',
      totalThroughPeriodMinor: line.recordedMinor,
    })),
  );

  const issues: Issue[] = [];
  if (!forecast) issues.push('missing_forecast');
  if (forecast?.status === 'incomplete') issues.push('incomplete_forecast');
  if (forecast && forecast.contractMinor === null) issues.push('missing_contract');
  if (forecast && currencyTotals.some(({ currency }) => currency !== forecast.currency))
    issues.push('different_currency');
  if (postingSources.some((line) => line.recordedMinor !== line.allocatedMinor))
    issues.push('unmatched_allocations');
  const eac = forecast?.eacMinor ? BigInt(forecast.eacMinor) : null;
  if (eac !== null && eac <= 0n) issues.push('invalid_completion_basis');

  let percentCompleteBps: number | null = null;
  let earnedToDateMinor: string | null = null;
  if (!issues.length && forecast && eac !== null && eac > 0n && forecast.contractMinor !== null) {
    const actual = BigInt(
      currencyTotals.find(({ currency }) => currency === forecast.currency)
        ?.totalThroughPeriodMinor ?? '0',
    );
    const progress = actual > eac ? eac : actual;
    percentCompleteBps = Number(signedRound(progress * 10000n, eac));
    earnedToDateMinor = signedRound(BigInt(forecast.contractMinor) * progress, eac).toString();
  }
  return {
    projectId: project.id,
    projectName: project.name,
    sourceForecastId: forecast?.id ?? null,
    sourceBudgetVersion: forecast?.version ?? null,
    forecastCurrency: forecast?.currency ?? null,
    contractMinor: forecast?.contractMinor ?? null,
    estimatedAtCompletionMinor: forecast?.eacMinor ?? null,
    earnedToDateMinor,
    percentCompleteBps,
    currencyTotals,
    issues,
    postingSources,
  };
}
