import { createHash } from 'node:crypto';
import {
  EnterpriseApprovedBillSources,
  EnterpriseBillActualPosting,
  EnterpriseBillActuals,
  EnterpriseCostPeriods,
  EnterpriseScheduleDate,
  PostEnterpriseBillActual,
  SetEnterpriseCostPeriod,
} from '@fieldline/contracts';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { auditEvents, networkBills as bills } from '../../db/schema';
import {
  enterpriseActualBillAllocations as allocations,
  enterpriseActualBillPostings as postings,
  enterpriseCostPeriodRevisions as periods,
} from '../../db/schema/enterpriseActualBillCosts';
import { enterprisePurchaseCostCodes as codes } from '../../db/schema/enterprisePurchasing';
import { tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { BudgetProjectParams, requireBudgetProject } from './budgetAccess';
import { purchaseCommitmentCostCodes } from './purchaseCommitmentData';

const root = '/enterprise/projects/:projectId/actual-costs';
const periodRoute = root + '/periods/:monthStart';
const permission = { permission: 'bill:approve' } as const;
const month = EnterpriseScheduleDate.refine((date) => date.endsWith('-01'));
const pageQuery = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
type Source = z.infer<typeof EnterpriseApprovedBillSources>['items'][number];
type Period = typeof periods.$inferSelect;
type Posting = typeof postings.$inferSelect;
type Scope = { orgId: string; projectId: string };

function digest(input: object) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function periodDto(row: Period | undefined) {
  if (!row) return null;
  const { id, monthStart, revision, state, reason } = row;
  return { id, monthStart, revision, state, reason, recordedAt: row.createdAt.toISOString() };
}

async function latestPeriod(tx: Tx, orgId: string, monthStart: string) {
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

function matchingApproval(orgId: string) {
  return and(
    eq(auditEvents.orgId, orgId),
    eq(auditEvents.resourceType, 'network_bill'),
    eq(auditEvents.action, 'bill.approved'),
    eq(auditEvents.resourceId, bills.id),
  );
}

const sourceColumns = {
  sourceId: bills.id,
  sourceRevisionId: auditEvents.id,
  billNumber: bills.number,
  issuerName: bills.issuerName,
  currency: bills.currency,
  totalMinor: bills.totalMinor,
  status: bills.status,
  approvedAt: bills.approvedAt,
};

function approvedBill(
  row: {
    status: string;
    approvedAt: Date | null;
  } & Omit<Source, 'status' | 'approvedAt'>,
): Source {
  if (!row.approvedAt || (row.status !== 'approved' && row.status !== 'paid'))
    throw problem('conflict', 'The source bill has no recorded approval.');
  return { ...row, status: row.status, approvedAt: row.approvedAt.toISOString() };
}

function postingScope(scope: Scope) {
  return and(eq(postings.orgId, scope.orgId), eq(postings.projectId, scope.projectId));
}

function billAllocations(tx: Tx, scope: Scope, postingIds: string[]) {
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

type AllocationRows = Awaited<ReturnType<typeof billAllocations>>;

function postingDto(row: Posting, lines: AllocationRows) {
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
    periodStart: row.monthStart,
    createdAt: row.createdAt.toISOString(),
    allocations: lines.map(({ postingId: _postingId, ...line }) => line),
  };
}

const actualBillCosts: FastifyPluginAsyncZod = async (app) => {
  app.get(
    periodRoute,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams.extend({ monthStart: month }),
        response: { 200: EnterpriseCostPeriods },
      },
    },
    async (request, reply) => {
      const { projectId, monthStart } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        return {
          period: periodDto(await latestPeriod(tx, org.orgId, monthStart)),
        };
      });
      setEtag(reply, result.period?.revision ?? 0);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.put(
    periodRoute,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams.extend({ monthStart: month }),
        body: SetEnterpriseCostPeriod,
        response: { 200: EnterpriseCostPeriods },
      },
    },
    async (request, reply) => {
      const { projectId, monthStart } = request.params;
      const { state, reason, clientRequestId } = request.body;
      const expected = parseIfMatch(request);
      const requestHash = digest({ monthStart, state, reason, expected });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        await lockPeriod(tx, org.orgId, monthStart);
        const [receipt] = await tx
          .select()
          .from(periods)
          .where(and(eq(periods.orgId, org.orgId), eq(periods.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.actorUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem(
              'conflict',
              'This request already changed a different accounting period.',
            );
          return { period: periodDto(receipt) };
        }
        const prior = await latestPeriod(tx, org.orgId, monthStart);
        assertRevision(prior?.revision ?? 0, expected);
        if (state === 'open' && prior)
          throw problem('conflict', 'An existing or closed period cannot be opened again.');
        if (state === 'closed' && prior?.state !== 'open')
          throw problem('conflict', 'Choose an open accounting period.');
        const [saved] = await tx
          .insert(periods)
          .values({
            orgId: org.orgId,
            monthStart,
            revision: expected + 1,
            state,
            reason,
            actorUserId: org.userId,
            clientRequestId,
            requestHash,
          })
          .returning();
        if (!saved) throw problem('internal');
        const period = periodDto(saved);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: state === 'open' ? 'cost.period_opened' : 'cost.period_closed',
          resourceType: 'enterprise_cost_period',
          resourceId: saved.id,
          before: periodDto(prior),
          after: period,
          reason,
        });
        return { period };
      });
      setEtag(reply, result.period?.revision ?? 0);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.get(
    root + '/sources',
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        querystring: pageQuery,
        response: { 200: EnterpriseApprovedBillSources },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { limit } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const page = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const rows = await tx
          .select({ ...sourceColumns, occurredAt: auditEvents.occurredAt })
          .from(bills)
          .innerJoin(auditEvents, matchingApproval(org.orgId))
          .leftJoin(postings, and(eq(postings.orgId, org.orgId), eq(postings.sourceId, bills.id)))
          .where(
            and(
              eq(bills.orgId, org.orgId),
              inArray(bills.status, ['approved', 'paid']),
              isNotNull(bills.approvedAt),
              sql`${bills.totalMinor} > 0`,
              isNull(postings.id),
              beforeCursor(auditEvents.occurredAt, auditEvents.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(auditEvents.occurredAt)), desc(auditEvents.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          ({ occurredAt, sourceRevisionId }) => ({ at: occurredAt, id: sourceRevisionId }),
          ({ occurredAt: _occurredAt, ...row }) => approvedBill(row),
        );
      });
      return reply.header('cache-control', 'private, no-store').send(page);
    },
  );

  app.get(
    root,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        querystring: pageQuery,
        response: { 200: EnterpriseBillActuals },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { limit } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const page = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId };
        const rows = await tx
          .select()
          .from(postings)
          .where(and(postingScope(scope), beforeCursor(postings.createdAt, postings.id, cursor)))
          .orderBy(desc(msTrunc(postings.createdAt)), desc(postings.id))
          .limit(limit + 1);
        const page = pageResult(
          rows,
          limit,
          (row) => ({ at: row.createdAt, id: row.id }),
          (row) => row,
        );
        const allocations = await billAllocations(
          tx,
          scope,
          page.items.map(({ id }) => id),
        );
        const byPosting = new Map<string, AllocationRows>();
        for (const line of allocations) {
          const list = byPosting.get(line.postingId) ?? [];
          list.push(line);
          byPosting.set(line.postingId, list);
        }
        return {
          ...page,
          items: page.items.map((row) => postingDto(row, byPosting.get(row.id) ?? [])),
        };
      });
      return reply.header('cache-control', 'private, no-store').send(page);
    },
  );

  app.post(
    root,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        body: PostEnterpriseBillActual,
        response: { 200: EnterpriseBillActualPosting, 201: EnterpriseBillActualPosting },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { sourceId, sourceRevisionId, postingDate, clientRequestId } = request.body;
      const split = [...request.body.allocations].sort((a, b) =>
        a.costCodeId.localeCompare(b.costCodeId),
      );
      const expected = parseIfMatch(request);
      const periodStart = postingDate.slice(0, 7) + '-01';
      const requestHash = digest({
        projectId,
        sourceId,
        sourceRevisionId,
        postingDate,
        split,
        expected,
      });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        await lockPeriod(tx, org.orgId, periodStart);
        const [receipt] = await tx
          .select()
          .from(postings)
          .where(and(eq(postings.orgId, org.orgId), eq(postings.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.postedByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already posted a different cost.');
          return {
            created: false,
            data: postingDto(receipt, await billAllocations(tx, scope, [receipt.id])),
          };
        }
        const period = await latestPeriod(tx, org.orgId, periodStart);
        if (period?.state !== 'open')
          throw problem('conflict', 'Choose an open accounting period.');
        assertRevision(period.revision, expected);
        const [source] = await tx
          .select(sourceColumns)
          .from(bills)
          .innerJoin(auditEvents, matchingApproval(org.orgId))
          .where(
            and(
              eq(bills.orgId, org.orgId),
              eq(bills.id, sourceId),
              eq(auditEvents.id, sourceRevisionId),
            ),
          );
        if (!source) throw problem('not_found', 'The approved bill revision is unavailable.');
        const bill = approvedBill(source);
        if (
          split.reduce((total, line) => total + BigInt(line.amountMinor), 0n) !==
          BigInt(bill.totalMinor)
        )
          throw problem(
            'validation_failed',
            'The cost-code allocations must equal the approved bill amount.',
          );
        const configured = new Set(
          (await purchaseCommitmentCostCodes(tx, scope)).map(({ id }) => id),
        );
        if (split.some(({ costCodeId }) => !configured.has(costCodeId)))
          throw problem('validation_failed', 'Choose cost codes from this project.');
        const [saved] = await tx
          .insert(postings)
          .values({
            ...scope,
            sourceId,
            sourceRevisionId,
            postingDate,
            monthStart: periodStart,
            periodRevisionId: period.id,
            billNumber: bill.billNumber,
            issuerName: bill.issuerName,
            currency: bill.currency,
            totalMinor: bill.totalMinor,
            postedByUserId: org.userId,
            clientRequestId,
            requestHash,
          })
          .onConflictDoNothing()
          .returning();
        if (!saved) throw problem('conflict', 'This approved bill already has a job-cost posting.');
        await tx.insert(allocations).values(
          split.map((line) => ({
            ...scope,
            postingId: saved.id,
            ...line,
          })),
        );
        const data = postingDto(saved, await billAllocations(tx, scope, [saved.id]));
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'cost.actual_posted',
          resourceType: 'enterprise_actual_bill_cost',
          resourceId: saved.id,
          before: null,
          after: data,
        });
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'cost.actual_posted',
          aggregateType: 'enterprise_actual_bill_cost',
          aggregateId: saved.id,
          payload: { projectId, postingId: saved.id },
          correlationId: request.id,
          jobKey: 'cost.actual_posted:' + saved.id,
        });
        return { created: true, data };
      });
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default actualBillCosts;
