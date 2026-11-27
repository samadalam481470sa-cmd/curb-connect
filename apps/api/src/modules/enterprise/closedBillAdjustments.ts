import { createHash } from 'node:crypto';
import {
  DecideEnterpriseBillAdjustment,
  EnterpriseBillAdjustment,
  EnterpriseBillAdjustmentPage,
  RequestEnterpriseBillAdjustment,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { networkBills as bills } from '../../db/schema';
import {
  enterpriseActualBillPostings as postings,
  enterpriseCostPeriodRevisions as periods,
} from '../../db/schema/enterpriseActualBillCosts';
import {
  closedBillAdjustmentDecisions as decisions,
  closedBillAdjustments as adjustments,
} from '../../db/schema/enterpriseClosedBillAdjustments';
import { tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { BudgetProjectParams, requireBudgetProject } from './budgetAccess';
import {
  billAllocations,
  latestPeriod,
  lockPeriod,
  postingDto,
  validateBillCostInput,
  writeBillPosting,
} from './actualBillPostingData';

const root = '/enterprise/projects/:projectId/actual-costs/adjustments';
const permission = { permission: 'bill:approve' } as const;
const key = BudgetProjectParams.extend({ adjustmentId: z.uuid() });
type Scope = { orgId: string; projectId: string };
type Adjustment = typeof adjustments.$inferSelect;
type Decision = typeof decisions.$inferSelect;
type Posting = z.infer<typeof EnterpriseBillAdjustment>['decision'];
type Bill = z.infer<typeof EnterpriseBillAdjustment>['bill'];
const billDetails = {
  billNumber: bills.number,
  issuerName: bills.issuerName,
  currency: bills.currency,
  totalMinor: bills.totalMinor,
};
const matchingBill = and(eq(bills.orgId, adjustments.orgId), eq(bills.id, adjustments.sourceId));

function auditHash(input: object) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function pins(row: Adjustment): z.infer<typeof RequestEnterpriseBillAdjustment> {
  return {
    sourceId: row.sourceId,
    sourceRevisionId: row.sourceRevisionId,
    postingDate: row.postingDate,
    allocations: row.split,
    reason: row.reason,
    clientRequestId: row.clientRequestId,
  };
}

function render(
  row: Adjustment,
  bill: Bill,
  currentRevision: number,
  actorUserId: string,
  decision: Decision | null,
  posted: NonNullable<Posting>['posting'] = null,
) {
  return {
    id: row.id,
    projectId: row.projectId,
    input: pins(row),
    bill,
    requestedByUserId: row.requestedByUserId,
    requestedAt: row.createdAt.toISOString(),
    periodId: row.periodRevisionId,
    periodRevision: currentRevision,
    canDecide: !decision && actorUserId !== row.requestedByUserId,
    decision: decision
      ? {
          outcome: decision.outcome,
          reason: decision.reason,
          decidedByUserId: decision.decidedByUserId,
          decidedAt: decision.createdAt.toISOString(),
          posting: posted,
        }
      : null,
  };
}

async function loadOne(tx: Tx, scope: Scope, adjustmentId: string) {
  const [entry] = await tx
    .select({
      row: adjustments,
      bill: billDetails,
      periodRevision: periods.revision,
      decision: decisions,
      posted: postings,
    })
    .from(adjustments)
    .innerJoin(bills, matchingBill)
    .innerJoin(
      periods,
      and(eq(periods.orgId, adjustments.orgId), eq(periods.id, adjustments.periodRevisionId)),
    )
    .leftJoin(
      decisions,
      and(
        eq(decisions.orgId, adjustments.orgId),
        eq(decisions.projectId, adjustments.projectId),
        eq(decisions.adjustmentId, adjustments.id),
      ),
    )
    .leftJoin(
      postings,
      and(
        eq(postings.orgId, decisions.orgId),
        eq(postings.projectId, decisions.projectId),
        eq(postings.id, decisions.postingId),
      ),
    )
    .where(
      and(
        eq(adjustments.orgId, scope.orgId),
        eq(adjustments.projectId, scope.projectId),
        eq(adjustments.id, adjustmentId),
      ),
    );
  if (!entry) throw problem('not_found');
  return entry;
}

const closedBillAdjustmentsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    root,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: { 200: EnterpriseBillAdjustmentPage },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { limit } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const data = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId };
        const rows = await tx
          .select({
            row: adjustments,
            bill: billDetails,
            periodRevision: periods.revision,
            decision: decisions,
            posted: postings,
          })
          .from(adjustments)
          .innerJoin(bills, matchingBill)
          .innerJoin(
            periods,
            and(eq(periods.orgId, adjustments.orgId), eq(periods.id, adjustments.periodRevisionId)),
          )
          .leftJoin(
            decisions,
            and(
              eq(decisions.orgId, adjustments.orgId),
              eq(decisions.projectId, adjustments.projectId),
              eq(decisions.adjustmentId, adjustments.id),
            ),
          )
          .leftJoin(
            postings,
            and(
              eq(postings.orgId, decisions.orgId),
              eq(postings.projectId, decisions.projectId),
              eq(postings.id, decisions.postingId),
            ),
          )
          .where(
            and(
              eq(adjustments.orgId, org.orgId),
              eq(adjustments.projectId, projectId),
              beforeCursor(adjustments.createdAt, adjustments.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(adjustments.createdAt)), desc(adjustments.id))
          .limit(limit + 1);
        const page = pageResult(
          rows,
          limit,
          ({ row }) => ({ at: row.createdAt, id: row.id }),
          (row) => row,
        );
        const splits = await billAllocations(
          tx,
          scope,
          page.items.flatMap(({ posted }) => (posted ? [posted.id] : [])),
        );
        return {
          nextCursor: page.nextCursor,
          items: page.items.map(({ row, bill, periodRevision, decision, posted }) =>
            render(
              row,
              bill,
              periodRevision,
              org.userId,
              decision,
              posted
                ? postingDto(
                    posted,
                    splits.filter((line) => line.postingId === posted.id),
                  )
                : null,
            ),
          ),
        };
      });
      return reply.header('cache-control', 'private, no-store').send(data);
    },
  );

  app.get(
    root + '/:adjustmentId',
    {
      config: permission,
      schema: { tags: ['enterprise'], params: key, response: { 200: EnterpriseBillAdjustment } },
    },
    async (request, reply) => {
      const { projectId, adjustmentId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId };
        const entry = await loadOne(tx, scope, adjustmentId);
        const posted = entry.posted
          ? postingDto(entry.posted, await billAllocations(tx, scope, [entry.posted.id]))
          : null;
        return render(
          entry.row,
          entry.bill,
          entry.periodRevision,
          org.userId,
          entry.decision,
          posted,
        );
      });
      setEtag(reply, result.periodRevision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    root,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        body: RequestEnterpriseBillAdjustment,
        response: { 200: EnterpriseBillAdjustment, 201: EnterpriseBillAdjustment },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const input = {
        ...request.body,
        allocations: request.body.allocations
          .map((line) => ({ ...line, costCodeId: line.costCodeId.toLowerCase() }))
          .sort((a, b) => a.costCodeId.localeCompare(b.costCodeId)),
      };
      const expected = parseIfMatch(request);
      const monthStart = input.postingDate.slice(0, 7) + '-01';
      const hash = auditHash({ projectId, expected, input });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        await lockPeriod(tx, org.orgId, monthStart);
        const [prior] = await tx
          .select()
          .from(adjustments)
          .where(
            and(
              eq(adjustments.orgId, org.orgId),
              eq(adjustments.clientRequestId, input.clientRequestId),
            ),
          );
        if (prior) {
          if (
            prior.projectId !== projectId ||
            prior.requestedByUserId !== org.userId ||
            prior.requestHash !== hash
          )
            throw problem('conflict', 'This request already saved a different adjustment.');
          const entry = await loadOne(tx, scope, prior.id);
          const posted = entry.posted
            ? postingDto(entry.posted, await billAllocations(tx, scope, [entry.posted.id]))
            : null;
          return {
            created: false,
            item: render(
              prior,
              entry.bill,
              entry.periodRevision,
              org.userId,
              entry.decision,
              posted,
            ),
          };
        }
        const period = await latestPeriod(tx, org.orgId, monthStart);
        if (period?.state !== 'closed')
          throw problem('conflict', 'Choose a closed period for an adjustment.');
        assertRevision(period.revision, expected);
        const [posted] = await tx
          .select({ id: postings.id })
          .from(postings)
          .where(and(eq(postings.orgId, org.orgId), eq(postings.sourceId, input.sourceId)));
        if (posted) throw problem('conflict', 'This approved bill already has a job-cost posting.');
        const bill = await validateBillCostInput(tx, scope, input);
        const [saved] = await tx
          .insert(adjustments)
          .values({
            ...scope,
            monthStart,
            periodRevisionId: period.id,
            sourceId: input.sourceId,
            sourceRevisionId: input.sourceRevisionId,
            postingDate: input.postingDate,
            split: input.allocations,
            reason: input.reason,
            requestedByUserId: org.userId,
            requestHash: hash,
            clientRequestId: input.clientRequestId,
          })
          .returning();
        if (!saved) throw problem('internal');
        const item = render(saved, bill, period.revision, org.userId, null);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_closed_bill_adjustment',
          resourceId: saved.id,
          action: 'cost.adjustment_requested',
          reason: input.reason,
          after: item,
        });
        return { created: true, item };
      });
      setEtag(reply, result.item.periodRevision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.item);
    },
  );

  app.post(
    root + '/:adjustmentId/decision',
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: key,
        body: DecideEnterpriseBillAdjustment,
        response: { 200: EnterpriseBillAdjustment, 201: EnterpriseBillAdjustment },
      },
    },
    async (request, reply) => {
      const { projectId, adjustmentId } = request.params;
      const { outcome, reason, clientRequestId } = request.body;
      const expected = parseIfMatch(request);
      const requestHash = auditHash({ projectId, adjustmentId, outcome, reason, expected });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const entry = await loadOne(tx, scope, adjustmentId);
        if (entry.row.requestedByUserId === org.userId)
          throw problem('forbidden', 'A separate finance reviewer must decide this adjustment.');
        if (entry.decision) {
          if (
            entry.decision.clientRequestId !== clientRequestId ||
            entry.decision.requestHash !== requestHash ||
            entry.decision.decidedByUserId !== org.userId
          )
            throw problem('conflict', 'This adjustment has a recorded decision.');
          const posted = entry.posted
            ? postingDto(entry.posted, await billAllocations(tx, scope, [entry.posted.id]))
            : null;
          return {
            created: false,
            item: render(
              entry.row,
              entry.bill,
              entry.periodRevision,
              org.userId,
              entry.decision,
              posted,
            ),
          };
        }
        await lockPeriod(tx, org.orgId, entry.row.monthStart);
        const period = await latestPeriod(tx, org.orgId, entry.row.monthStart);
        if (!period || period.state !== 'closed' || period.id !== entry.row.periodRevisionId)
          throw problem(
            'precondition_failed',
            'The accounting period changed. Review the current period.',
          );
        assertRevision(period.revision, expected);
        const posted =
          outcome === 'approved'
            ? await writeBillPosting(tx, request, {
                scope,
                actorUserId: org.userId,
                input: { ...pins(entry.row), clientRequestId },
                period,
                requestHash,
                adjustmentRequestId: adjustmentId,
              })
            : null;
        const [decision] = await tx
          .insert(decisions)
          .values({
            ...scope,
            adjustmentId,
            outcome,
            reason,
            clientRequestId,
            requestHash,
            postingId: posted?.id,
            decidedByUserId: org.userId,
          })
          .returning();
        if (!decision) throw problem('internal');
        const item = render(entry.row, entry.bill, period.revision, org.userId, decision, posted);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_closed_bill_adjustment',
          resourceId: adjustmentId,
          action: 'cost.adjustment_' + outcome,
          reason,
          after: item,
        });
        return { created: true, item };
      });
      setEtag(reply, result.item.periodRevision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.item);
    },
  );
};

export default closedBillAdjustmentsRoutes;
