import { createHash } from 'node:crypto';
import {
  DecideEnterprisePurchaseAmendment,
  EnterprisePurchaseCommitmentHistory,
  EnterprisePurchaseCommitmentRevision,
  ProposeEnterprisePurchaseAmendment,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  purchaseCommitmentAllocations as allocations,
  purchaseCommitmentDecisions as decisions,
  purchaseCommitmentRevisions as revisions,
} from '../../db/schema/enterprisePurchaseCommitments';
import { enterprisePurchaseOrders as orders } from '../../db/schema/enterprisePurchasing';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import {
  activePurchaseCommitment,
  decisionMatchesRevision,
  purchaseCommitmentBreakdown,
  purchaseCommitmentCostCodes,
  purchaseCommitmentScope,
  type PurchaseCommitmentScope,
} from './purchaseCommitmentData';

type Proposal = typeof revisions.$inferSelect;
type Decision = typeof decisions.$inferSelect;
type Breakdown = Awaited<ReturnType<typeof purchaseCommitmentBreakdown>>;
type Actor = ReturnType<typeof requireOrg>;

const address = '/enterprise/projects/:projectId/purchase-orders/:orderId/commitments';
const params = z.object({ projectId: z.uuid(), orderId: z.uuid() });
const read = { permission: 'supplier_order:read' } as const;
const write = {
  permission: 'org:settings_update',
  rateLimit: { max: 30, timeWindow: '1 minute' },
} as const;

async function checkIssuedOrder(tx: Tx, scope: PurchaseCommitmentScope, lock: boolean) {
  await checkEnabled(tx, scope.orgId);
  const [order] = await tx
    .select({ status: orders.status })
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
  if (order.status !== 'issued')
    throw problem('conflict', 'Issue the purchase order before recording an amendment.');
  const current = await activePurchaseCommitment(tx, scope);
  const version = current?.decision.activatedVersion;
  if (!current || version === null || version === undefined) throw problem('internal');
  return { ...current, version };
}

function hash(input: object) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function commitmentDto(
  proposal: Proposal,
  decision: Decision | null,
  allocation: Breakdown,
  activeVersion: number,
  actor: Actor,
) {
  const state =
    decision?.outcome ??
    (proposal.baseVersion === activeVersion ? ('pending' as const) : ('stale' as const));
  return {
    id: proposal.id,
    orderId: proposal.orderId,
    kind: proposal.kind,
    baseVersion: proposal.baseVersion,
    totalMinor: proposal.totalMinor,
    reason: proposal.reason,
    createdAt: proposal.createdAt.toISOString(),
    state,
    allocations: allocation.map(({ revisionId: _revisionId, ...line }) => line),
    canDecide:
      !decision &&
      actor.userId !== proposal.requestedByUserId &&
      actor.permissions.has('org:settings_update'),
    decision: decision
      ? {
          outcome: decision.outcome,
          reason: decision.reason,
          activatedVersion: decision.activatedVersion,
          decidedAt: decision.createdAt.toISOString(),
        }
      : null,
  };
}

export function enqueuePurchaseCommitment(
  tx: Tx,
  scope: PurchaseCommitmentScope,
  revisionId: string,
  correlationId: string,
) {
  return enqueue(tx, {
    orgId: scope.orgId,
    task: 'cost.commitment_created',
    aggregateType: 'enterprise_purchase_commitment',
    aggregateId: revisionId,
    payload: { projectId: scope.projectId, orderId: scope.orderId, revisionId },
    jobKey: 'cost.commitment_created:' + revisionId,
    correlationId,
  });
}

const purchaseCommitments: FastifyPluginAsyncZod = async (app) => {
  app.get(
    address,
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: { 200: EnterprisePurchaseCommitmentHistory },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const scope = { orgId: actor.orgId, ...request.params };
      const cursor = decodeCursor(request.query.cursor);
      const { limit } = request.query;
      const result = await tenantTx(request, async (tx) => {
        const active = await checkIssuedOrder(tx, scope, false);
        const history = await tx
          .select({ proposal: revisions, decision: decisions })
          .from(revisions)
          .leftJoin(decisions, decisionMatchesRevision)
          .where(
            and(
              purchaseCommitmentScope(scope).proposal,
              beforeCursor(revisions.createdAt, revisions.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(revisions.createdAt)), desc(revisions.id))
          .limit(limit + 1);
        const page = pageResult(
          history,
          limit,
          ({ proposal }) => ({ at: proposal.createdAt, id: proposal.id }),
          (row) => row,
        );
        const identifiers = new Set([
          active.proposal.id,
          ...page.items.map(({ proposal }) => proposal.id),
        ]);
        const [codes, breakdown] = await Promise.all([
          purchaseCommitmentCostCodes(tx, scope),
          purchaseCommitmentBreakdown(tx, scope, [...identifiers]),
        ]);
        const byRevision = new Map<string, Breakdown>();
        for (const line of breakdown) {
          const lines = byRevision.get(line.revisionId) ?? [];
          lines.push(line);
          byRevision.set(line.revisionId, lines);
        }
        function describe(proposal: Proposal, decision: Decision | null) {
          return commitmentDto(
            proposal,
            decision,
            byRevision.get(proposal.id) ?? [],
            active.version,
            actor,
          );
        }
        return {
          active: describe(active.proposal, active.decision),
          items: page.items.map(({ proposal, decision }) => describe(proposal, decision)),
          nextCursor: page.nextCursor,
          costCodes: codes,
          canPropose: actor.permissions.has('org:settings_update'),
        };
      });
      setEtag(reply, result.active.decision?.activatedVersion ?? 0);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    address,
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params,
        body: ProposeEnterprisePurchaseAmendment,
        response: {
          200: EnterprisePurchaseCommitmentRevision,
          201: EnterprisePurchaseCommitmentRevision,
        },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const scope = { orgId: actor.orgId, ...request.params };
      const expected = parseIfMatch(request);
      const { reason, clientRequestId } = request.body;
      const proposed = [...request.body.allocations].sort((left, right) =>
        left.costCodeId.localeCompare(right.costCodeId),
      );
      const requestHash = hash({ expected, reason, proposed });
      const result = await tenantTx(request, async (tx) => {
        const active = await checkIssuedOrder(tx, scope, true);
        const conditions = purchaseCommitmentScope(scope);
        const [prior] = await tx
          .select()
          .from(revisions)
          .where(and(conditions.proposal, eq(revisions.clientRequestId, clientRequestId)));
        if (prior) {
          if (prior.requestedByUserId !== actor.userId || prior.requestHash !== requestHash)
            throw problem('conflict', 'This request already proposed a different amendment.');
          const lines = await purchaseCommitmentBreakdown(tx, scope, [prior.id]);
          return {
            created: false,
            data: commitmentDto(prior, null, lines, prior.baseVersion, actor),
          };
        }
        assertRevision(active.version, expected);
        const totalMinor = proposed.reduce((sum, line) => sum + line.amountMinor, 0);
        if (totalMinor > 1_000_000_000_000)
          throw problem('validation_failed', 'The revised amount is outside the supported range.');
        const configuredCodes = new Set(
          (await purchaseCommitmentCostCodes(tx, scope)).map(({ id }) => id),
        );
        if (proposed.some(({ costCodeId }) => !configuredCodes.has(costCodeId)))
          throw problem('validation_failed', 'Choose cost codes from this project.');
        const current = await purchaseCommitmentBreakdown(tx, scope, [active.proposal.id]);
        const priorAmounts = new Map(
          current
            .filter(({ revisedMinor }) => revisedMinor > 0)
            .map(({ costCode, revisedMinor }) => [costCode.id, revisedMinor]),
        );
        const nextAmounts = new Map(
          proposed.map(({ costCodeId, amountMinor }) => [costCodeId, amountMinor]),
        );
        const codeIds = new Set([...priorAmounts.keys(), ...nextAmounts.keys()]);
        const changes = [...codeIds].map((costCodeId) => ({
          costCodeId,
          priorMinor: priorAmounts.get(costCodeId) ?? 0,
          revisedMinor: nextAmounts.get(costCodeId) ?? 0,
        }));
        if (changes.every(({ priorMinor, revisedMinor }) => priorMinor === revisedMinor))
          throw problem('validation_failed', 'Change at least one cost-code allocation.');
        const [saved] = await tx
          .insert(revisions)
          .values({
            ...scope,
            kind: 'amendment',
            baseVersion: expected,
            totalMinor,
            reason,
            requestedByUserId: actor.userId,
            clientRequestId,
            requestHash,
          })
          .returning();
        if (!saved) throw problem('internal');
        await tx.insert(allocations).values(
          changes.map((line) => ({
            ...scope,
            revisionId: saved.id,
            ...line,
          })),
        );
        const lines = await purchaseCommitmentBreakdown(tx, scope, [saved.id]);
        const data = commitmentDto(saved, null, lines, expected, actor);
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          resourceType: 'enterprise_purchase_commitment',
          resourceId: saved.id,
          action: 'cost.commitment_amendment_requested',
          reason,
          before: { ...scope, version: expected, totalMinor: active.proposal.totalMinor },
          after: { ...scope, revisionId: saved.id, totalMinor, changes },
        });
        return { created: true, data };
      });
      setEtag(reply, result.data.baseVersion);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );

  app.post(
    address + '/:revisionId/decision',
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: params.extend({ revisionId: z.uuid() }),
        body: DecideEnterprisePurchaseAmendment,
        response: {
          200: EnterprisePurchaseCommitmentRevision,
          201: EnterprisePurchaseCommitmentRevision,
        },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { projectId, orderId, revisionId } = request.params;
      const scope = { orgId: actor.orgId, projectId, orderId };
      const expected = parseIfMatch(request);
      const { outcome, reason, clientRequestId } = request.body;
      const requestHash = hash({ expected, revisionId, outcome, reason });
      const result = await tenantTx(request, async (tx) => {
        const active = await checkIssuedOrder(tx, scope, true);
        const conditions = purchaseCommitmentScope(scope);
        const [proposal] = await tx
          .select()
          .from(revisions)
          .where(
            and(conditions.proposal, eq(revisions.id, revisionId), eq(revisions.kind, 'amendment')),
          );
        if (!proposal) throw problem('not_found');
        if (proposal.requestedByUserId === actor.userId)
          throw problem('forbidden', 'Another purchasing manager must review this amendment.');
        const [receipt] = await tx
          .select()
          .from(decisions)
          .where(and(conditions.decision, eq(decisions.clientRequestId, clientRequestId)));
        if (
          receipt &&
          (receipt.decidedByUserId !== actor.userId || receipt.requestHash !== requestHash)
        )
          throw problem('conflict', 'This request already recorded a different decision.');
        const lines = await purchaseCommitmentBreakdown(tx, scope, [revisionId]);
        if (receipt)
          return {
            created: false,
            data: commitmentDto(proposal, receipt, lines, active.version, actor),
          };
        const [existing] = await tx
          .select({ revisionId: decisions.revisionId })
          .from(decisions)
          .where(and(conditions.decision, eq(decisions.revisionId, revisionId)));
        if (existing) throw problem('conflict', 'This amendment already has a decision.');
        assertRevision(proposal.baseVersion, expected);
        if (outcome === 'approved') assertRevision(active.version, expected);
        const [saved] = await tx
          .insert(decisions)
          .values({
            ...scope,
            revisionId,
            outcome,
            reason,
            decidedByUserId: actor.userId,
            clientRequestId,
            requestHash,
            activatedVersion: outcome === 'approved' ? active.version + 1 : null,
          })
          .returning();
        if (!saved) throw problem('internal');
        const data = commitmentDto(proposal, saved, lines, active.version, actor);
        await auditRequest(request, tx, {
          orgId: actor.orgId,
          resourceType: 'enterprise_purchase_commitment',
          resourceId: revisionId,
          action:
            outcome === 'approved'
              ? 'cost.commitment_created'
              : 'cost.commitment_amendment_rejected',
          reason,
          before: { ...scope, totalMinor: active.proposal.totalMinor, version: active.version },
          after: {
            ...scope,
            revisionId,
            totalMinor: proposal.totalMinor,
            outcome,
            allocations: lines,
            activatedVersion: saved.activatedVersion,
          },
        });
        if (outcome === 'approved')
          await enqueuePurchaseCommitment(tx, scope, revisionId, request.id);
        return { created: true, data };
      });
      setEtag(reply, result.data.decision?.activatedVersion ?? result.data.baseVersion);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default purchaseCommitments;
