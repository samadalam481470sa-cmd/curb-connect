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
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditEvents, networkBills as bills } from '../../db/schema';
import {
  enterpriseActualBillPostings as postings,
  enterpriseCostPeriodRevisions as periods,
} from '../../db/schema/enterpriseActualBillCosts';
import { tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { BudgetProjectParams, requireBudgetProject } from './budgetAccess';
import {
  type AllocationRows,
  approvedBill,
  billAllocations,
  latestPeriod,
  lockPeriod,
  matchingApproval,
  postingDto,
  postingScope,
  sourceColumns,
  writeBillPosting,
} from './actualBillPostingData';

export { lockPeriod } from './actualBillPostingData';

const root = '/enterprise/projects/:projectId/actual-costs';
const periodRoute = root + '/periods/:monthStart';
const permission = { permission: 'bill:approve' } as const;
const month = EnterpriseScheduleDate.refine((date) => date.endsWith('-01'));
const pageQuery = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
type Period = typeof periods.$inferSelect;

function digest(input: object) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function periodDto(row: Period | undefined) {
  if (!row) return null;
  const { id, monthStart, revision, state, reason } = row;
  return { id, monthStart, revision, state, reason, recordedAt: row.createdAt.toISOString() };
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
        const data = await writeBillPosting(tx, request, {
          scope,
          actorUserId: org.userId,
          input: { sourceId, sourceRevisionId, postingDate, clientRequestId, allocations: split },
          period,
          requestHash,
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
