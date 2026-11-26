import { createHash } from 'node:crypto';
import {
  DecideEnterprisePurchaseVariance,
  EnterprisePurchaseVariance,
  EnterprisePurchaseVarianceView,
  RequestEnterprisePurchaseVariance,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { enterprisePurchaseOrders as orders } from '../../db/schema/enterprisePurchasing';
import {
  purchaseVarianceDecisions as decisions,
  purchaseVarianceRequests as requests,
} from '../../db/schema/enterprisePurchaseVariances';
import { type requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { BudgetProjectParams, requireBudgetProject } from './budgetAccess';
import {
  isCurrentVariance,
  latestPurchaseVariance,
  purchaseVarianceBasis,
  purchaseVarianceGate,
  purchaseVarianceScope,
  varianceDecisionMatches,
  type Basis,
  type Scope,
  type VarianceDecision,
  type VarianceRequest,
} from './purchaseVarianceData';

const path = '/enterprise/projects/:projectId/purchase-orders/:orderId/variances';
const params = BudgetProjectParams.extend({ orderId: z.uuid() });
type Actor = ReturnType<typeof requireOrg>;

function requestBasis(row: VarianceRequest): Basis {
  const { budgetId, budgetVersion, orderRevision, allocationMinor, committedMinor, overrunMinor } =
    row;
  return {
    budgetId,
    budgetVersion,
    orderRevision,
    allocationMinor,
    committedMinor,
    overrunMinor,
    orderMinor: String(row.orderMinor),
  };
}

function dto(
  row: VarianceRequest,
  decision: VarianceDecision | null,
  current: Basis | null,
  actor: Actor,
) {
  const pending = !decision && isCurrentVariance(row, current);
  return {
    ...requestBasis(row),
    id: row.id,
    orderId: row.orderId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    status: decision?.outcome ?? (pending ? ('awaiting_review' as const) : ('superseded' as const)),
    canDecide:
      pending &&
      actor.userId !== row.requestedByUserId &&
      actor.permissions.has('enterprise_budget:approve_overrun'),
    decision: decision
      ? {
          outcome: decision.outcome,
          authorizedDeltaMinor: decision.authorizedDeltaMinor,
          reason: decision.reason,
          decidedAt: decision.createdAt.toISOString(),
        }
      : null,
  };
}

async function loadOrder(tx: Tx, scope: Scope, lock: boolean) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.orgId, scope.orgId),
        eq(orders.projectId, scope.projectId),
        eq(orders.id, scope.orderId),
      ),
    )
    .for(lock ? 'update' : 'share');
  if (!order) throw problem('not_found');
  return order;
}

function digest(input: object) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

const purchaseVariances: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'enterprise_budget:read' },
      schema: {
        tags: ['enterprise'],
        params,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: { 200: EnterprisePurchaseVarianceView },
      },
    },
    async (request, reply) => {
      const { projectId, orderId } = request.params;
      const cursor = decodeCursor(request.query.cursor);
      const { limit } = request.query;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId, orderId };
        const order = await loadOrder(tx, scope, false);
        const current = await purchaseVarianceBasis(tx, scope, order);
        const latest = await latestPurchaseVariance(tx, scope);
        const rows = await tx
          .select({ request: requests, decision: decisions })
          .from(requests)
          .leftJoin(decisions, varianceDecisionMatches)
          .where(
            and(
              purchaseVarianceScope(scope).request,
              beforeCursor(requests.createdAt, requests.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(requests.createdAt)), desc(requests.id))
          .limit(limit + 1);
        return {
          ...pageResult(
            rows,
            limit,
            ({ request }) => ({ at: request.createdAt, id: request.id }),
            (row) => dto(row.request, row.decision, current, org),
          ),
          version: order.revision,
          gate: purchaseVarianceGate(latest, current),
          canRequest:
            current !== null &&
            org.permissions.has('enterprise_budget:request_overrun') &&
            (!latest || !isCurrentVariance(latest.request, current)),
          current,
        };
      });
      const { version, ...visible } = result;
      setEtag(reply, version);
      return reply.header('cache-control', 'private, no-store').send(visible);
    },
  );

  app.post(
    path,
    {
      config: { permission: 'enterprise_budget:request_overrun' },
      schema: {
        tags: ['enterprise'],
        params,
        body: RequestEnterprisePurchaseVariance,
        response: { 200: EnterprisePurchaseVariance, 201: EnterprisePurchaseVariance },
      },
    },
    async (request, reply) => {
      const { projectId, orderId } = request.params;
      const { reason, clientRequestId, reviewedBudgetVersion, reviewedCommittedMinor } =
        request.body;
      const expected = parseIfMatch(request);
      const requestHash = digest({
        expected,
        reason,
        reviewedBudgetVersion,
        reviewedCommittedMinor,
      });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId, orderId };
        const order = await loadOrder(tx, scope, true);
        const [receipt] = await tx
          .select()
          .from(requests)
          .where(
            and(
              purchaseVarianceScope(scope).request,
              eq(requests.clientRequestId, clientRequestId),
            ),
          );
        if (receipt) {
          if (receipt.requestHash !== requestHash || receipt.requestedByUserId !== org.userId)
            throw problem('conflict', 'This request already submitted a different variance.');
          return { created: false, data: dto(receipt, null, requestBasis(receipt), org) };
        }
        assertRevision(order.revision, expected);
        const current = await purchaseVarianceBasis(tx, scope, order);
        if (!current)
          throw problem(
            'conflict',
            'The current order has no overrun against an approved USD budget.',
          );
        if (
          current.budgetVersion !== reviewedBudgetVersion ||
          current.committedMinor !== reviewedCommittedMinor
        )
          throw problem(
            'precondition_failed',
            'The budget or commitments changed. Review the current amounts.',
          );
        const latest = await latestPurchaseVariance(tx, scope);
        if (latest && isCurrentVariance(latest.request, current))
          throw problem('conflict', 'This purchase variance already has a review record.');
        const [saved] = await tx
          .insert(requests)
          .values({
            ...scope,
            orderRevision: current.orderRevision,
            budgetId: current.budgetId,
            budgetVersion: current.budgetVersion,
            allocationMinor: current.allocationMinor,
            committedMinor: current.committedMinor,
            orderMinor: order.amountMinor,
            reason,
            requestedByUserId: org.userId,
            clientRequestId,
            requestHash,
          })
          .returning();
        if (!saved) throw problem('internal');
        const data = dto(saved, null, current, org);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'variance.threshold_crossed',
          resourceType: 'enterprise_purchase_variance',
          resourceId: saved.id,
          before: null,
          after: data,
          reason,
        });
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'variance.threshold_crossed',
          aggregateType: 'enterprise_purchase_variance',
          aggregateId: saved.id,
          payload: { projectId, orderId, varianceId: saved.id },
          correlationId: request.id,
          jobKey: 'variance.threshold_crossed:' + saved.id,
        });
        return { created: true, data };
      });
      setEtag(reply, result.data.orderRevision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );

  app.post(
    path + '/:varianceId/decision',
    {
      config: { permission: 'enterprise_budget:approve_overrun' },
      schema: {
        tags: ['enterprise'],
        params: params.extend({ varianceId: z.uuid() }),
        body: DecideEnterprisePurchaseVariance,
        response: { 200: EnterprisePurchaseVariance, 201: EnterprisePurchaseVariance },
      },
    },
    async (request, reply) => {
      const { projectId, orderId, varianceId } = request.params;
      const { decision: outcome, authorizedDeltaMinor, reason, clientRequestId } = request.body;
      const expected = parseIfMatch(request);
      const requestHash = digest({ expected, varianceId, outcome, authorizedDeltaMinor, reason });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId, orderId };
        const order = await loadOrder(tx, scope, true);
        const conditions = purchaseVarianceScope(scope);
        const [requested] = await tx
          .select()
          .from(requests)
          .where(and(conditions.request, eq(requests.id, varianceId)));
        if (!requested) throw problem('not_found');
        if (requested.requestedByUserId === org.userId)
          throw problem('forbidden', 'A separate owner must review this company commitment.');
        const [receipt] = await tx
          .select()
          .from(decisions)
          .where(and(conditions.decision, eq(decisions.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.requestHash !== requestHash || receipt.decidedByUserId !== org.userId)
            throw problem(
              'conflict',
              'This request already recorded a different variance decision.',
            );
          return { created: false, data: dto(requested, receipt, null, org) };
        }
        const [existing] = await tx
          .select({ varianceId: decisions.varianceId })
          .from(decisions)
          .where(and(conditions.decision, eq(decisions.varianceId, varianceId)));
        if (existing) throw problem('conflict', 'This variance already has an owner decision.');
        assertRevision(requested.orderRevision, expected);
        if (outcome === 'approved') {
          const current = await purchaseVarianceBasis(tx, scope, order);
          const latest = await latestPurchaseVariance(tx, scope);
          if (latest?.request.id !== varianceId || !isCurrentVariance(requested, current))
            throw problem(
              'precondition_failed',
              'The purchase or budget changed. Review the current variance.',
            );
          if (BigInt(authorizedDeltaMinor) > BigInt(requested.overrunMinor))
            throw problem(
              'validation_failed',
              'The approved amount cannot exceed the reviewed overrun.',
            );
        }
        const [saved] = await tx
          .insert(decisions)
          .values({
            ...scope,
            varianceId,
            outcome,
            authorizedDeltaMinor,
            reason,
            decidedByUserId: org.userId,
            clientRequestId,
            requestHash,
          })
          .returning();
        if (!saved) throw problem('internal');
        const data = dto(requested, saved, null, org);
        const task = outcome === 'approved' ? 'variance.approved' : 'variance.rejected';
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: task,
          resourceType: 'enterprise_purchase_variance',
          resourceId: varianceId,
          before: requestBasis(requested),
          after: data,
          reason,
        });
        await enqueue(tx, {
          orgId: org.orgId,
          task,
          aggregateType: 'enterprise_purchase_variance',
          aggregateId: varianceId,
          payload: { projectId, orderId, varianceId },
          correlationId: request.id,
          jobKey: task + ':' + varianceId,
        });
        return { created: true, data };
      });
      setEtag(reply, result.data.orderRevision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default purchaseVariances;
