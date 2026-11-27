import type { EnterpriseApprovedBillSources, PostEnterpriseBillActual } from '@fieldline/contracts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { auditEvents, networkBills as bills } from '../../db/schema';
import {
  enterpriseActualBillAllocations as allocations,
  enterpriseActualBillPostings as postings,
  enterpriseCostPeriodRevisions as periods,
} from '../../db/schema/enterpriseActualBillCosts';
import { enterprisePurchaseCostCodes as codes } from '../../db/schema/enterprisePurchasing';
import { problem } from '../../http/problem';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { purchaseCommitmentCostCodes } from './purchaseCommitmentData';
import { queueForecastRefresh } from './costForecastRefreshData';

type Source = z.infer<typeof EnterpriseApprovedBillSources>['items'][number];
type Period = typeof periods.$inferSelect;
type Posting = typeof postings.$inferSelect;
type Scope = { orgId: string; projectId: string };

export async function latestPeriod(tx: Tx, orgId: string, monthStart: string) {
  const [period] = await tx
    .select()
    .from(periods)
    .where(and(eq(periods.orgId, orgId), eq(periods.monthStart, monthStart)))
    .orderBy(desc(periods.revision))
    .limit(1);
  return period;
}

export async function lockPeriod(tx: Tx, orgId: string, monthStart: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${'cost-period:' + orgId + ':' + monthStart}))`,
  );
}

export function matchingApproval(orgId: string) {
  return and(
    eq(auditEvents.orgId, orgId),
    eq(auditEvents.resourceType, 'network_bill'),
    eq(auditEvents.action, 'bill.approved'),
    eq(auditEvents.resourceId, bills.id),
  );
}

export const sourceColumns = {
  sourceId: bills.id,
  sourceRevisionId: auditEvents.id,
  billNumber: bills.number,
  issuerName: bills.issuerName,
  currency: bills.currency,
  totalMinor: bills.totalMinor,
  status: bills.status,
  approvedAt: bills.approvedAt,
};

export function approvedBill(
  row: {
    status: string;
    approvedAt: Date | null;
  } & Omit<Source, 'status' | 'approvedAt'>,
): Source {
  if (!row.approvedAt || (row.status !== 'approved' && row.status !== 'paid'))
    throw problem('conflict', 'The source bill has no recorded approval.');
  return { ...row, status: row.status, approvedAt: row.approvedAt.toISOString() };
}

export function postingScope(scope: Scope) {
  return and(eq(postings.orgId, scope.orgId), eq(postings.projectId, scope.projectId));
}

export function billAllocations(tx: Tx, scope: Scope, postingIds: string[]) {
  return tx
    .select({
      postingId: allocations.postingId,
      amountMinor: allocations.amountMinor,
      costCode: { id: codes.id, code: codes.code, label: codes.label },
    })
    .from(allocations)
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
        eq(allocations.orgId, scope.orgId),
        eq(allocations.projectId, scope.projectId),
        inArray(allocations.postingId, postingIds),
      ),
    )
    .orderBy(asc(codes.code));
}

export type AllocationRows = Awaited<ReturnType<typeof billAllocations>>;

export function postingDto(row: Posting, lines: AllocationRows) {
  const {
    id,
    projectId,
    sourceId,
    sourceRevisionId,
    billNumber,
    issuerName,
    currency,
    totalMinor,
    postingDate,
  } = row;
  return {
    id,
    projectId,
    sourceId,
    sourceRevisionId,
    billNumber,
    issuerName,
    currency,
    totalMinor,
    postingDate,
    ...(row.adjustmentRequestId ? { adjustmentRequestId: row.adjustmentRequestId } : {}),
    periodStart: row.monthStart,
    createdAt: row.createdAt.toISOString(),
    allocations: lines.map(({ postingId: _postingId, ...line }) => line),
  };
}

type BillInput = z.infer<typeof PostEnterpriseBillActual>;

export async function validateBillCostInput(tx: Tx, scope: Scope, input: BillInput) {
  const [source] = await tx
    .select(sourceColumns)
    .from(bills)
    .innerJoin(auditEvents, matchingApproval(scope.orgId))
    .where(
      and(
        eq(bills.orgId, scope.orgId),
        eq(bills.id, input.sourceId),
        eq(auditEvents.id, input.sourceRevisionId),
      ),
    );
  if (!source) throw problem('not_found', 'The approved bill revision is unavailable.');
  const bill = approvedBill(source);
  const allocationTotal = input.allocations.reduce(
    (total, line) => total + BigInt(line.amountMinor),
    0n,
  );
  if (allocationTotal !== BigInt(bill.totalMinor))
    throw problem(
      'validation_failed',
      'The cost-code allocations must equal the approved bill amount.',
    );
  const configured = new Set((await purchaseCommitmentCostCodes(tx, scope)).map(({ id }) => id));
  if (input.allocations.some(({ costCodeId }) => !configured.has(costCodeId)))
    throw problem('validation_failed', 'Choose cost codes from this project.');
  return bill;
}

type PostingCommand = {
  scope: Scope;
  actorUserId: string;
  input: BillInput;
  period: Period;
  requestHash: string;
  adjustmentRequestId?: string;
};

export async function writeBillPosting(tx: Tx, request: FastifyRequest, command: PostingCommand) {
  const { scope, actorUserId, input, period, requestHash, adjustmentRequestId } = command;
  const bill = await validateBillCostInput(tx, scope, input);
  const [saved] = await tx
    .insert(postings)
    .values({
      ...scope,
      sourceId: input.sourceId,
      sourceRevisionId: input.sourceRevisionId,
      postingDate: input.postingDate,
      monthStart: period.monthStart,
      periodRevisionId: period.id,
      billNumber: bill.billNumber,
      issuerName: bill.issuerName,
      currency: bill.currency,
      totalMinor: bill.totalMinor,
      postedByUserId: actorUserId,
      clientRequestId: input.clientRequestId,
      requestHash,
      adjustmentRequestId,
    })
    .onConflictDoNothing()
    .returning();
  if (!saved) throw problem('conflict', 'This approved bill already has a job-cost posting.');
  await tx
    .insert(allocations)
    .values(input.allocations.map((line) => ({ ...scope, postingId: saved.id, ...line })));
  const data = postingDto(saved, await billAllocations(tx, scope, [saved.id]));
  await auditRequest(request, tx, {
    orgId: scope.orgId,
    action: 'cost.actual_posted',
    resourceType: 'enterprise_actual_bill_cost',
    resourceId: saved.id,
    before: null,
    after: data,
  });
  await enqueue(tx, {
    orgId: scope.orgId,
    task: 'cost.actual_posted',
    aggregateType: 'enterprise_actual_bill_cost',
    aggregateId: saved.id,
    payload: { projectId: scope.projectId, postingId: saved.id },
    correlationId: request.id,
    jobKey: 'cost.actual_posted:' + saved.id,
  });
  await queueForecastRefresh(tx, scope, {
    kind: 'actual_bill',
    resourceId: saved.id,
    actorUserId,
    effectiveOn: saved.postingDate,
    correlationId: request.id,
  });
  return data;
}
