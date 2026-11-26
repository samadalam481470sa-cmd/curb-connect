import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import {
  enterpriseActualBillAllocations as allocations,
  enterpriseActualBillPostings as postings,
} from '../../db/schema/enterpriseActualBillCosts';
import { enterprisePurchaseCostCodes as codes } from '../../db/schema/enterprisePurchasing';

export async function actualBillCostTotals(
  tx: Tx,
  scope: { orgId: string; projectId: string },
  asOf: string,
) {
  const rows = await tx
    .select({
      currency: postings.currency,
      costCodeId: codes.id,
      costCode: codes.code,
      amountMinor: sql<string>`sum(${allocations.amountMinor})::text`,
    })
    .from(postings)
    .innerJoin(
      allocations,
      and(
        eq(allocations.orgId, postings.orgId),
        eq(allocations.projectId, postings.projectId),
        eq(allocations.postingId, postings.id),
      ),
    )
    .innerJoin(
      codes,
      and(
        eq(codes.orgId, allocations.orgId),
        eq(codes.projectId, allocations.projectId),
        eq(codes.id, allocations.costCodeId),
      ),
    )
    .where(
      and(
        eq(postings.orgId, scope.orgId),
        eq(postings.projectId, scope.projectId),
        lte(postings.postingDate, asOf),
      ),
    )
    .groupBy(postings.currency, codes.id, codes.code)
    .orderBy(asc(postings.currency), asc(codes.code));
  type Line = Omit<(typeof rows)[number], 'currency'>;
  const byCurrency = new Map<string, { totalMinor: bigint; rows: Line[] }>();
  for (const { currency, ...line } of rows) {
    const totals = byCurrency.get(currency) ?? { totalMinor: 0n, rows: [] };
    totals.totalMinor += BigInt(line.amountMinor);
    totals.rows.push(line);
    byCurrency.set(currency, totals);
  }
  return Array.from(byCurrency, ([currency, { totalMinor, rows }]) => ({
    currency,
    totalMinor: totalMinor.toString(),
    rows,
  }));
}
