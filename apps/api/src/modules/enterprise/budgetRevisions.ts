import { createHash } from 'node:crypto';
import {
  DecideEnterpriseBudgetRevision,
  EnterpriseBudgetRevision,
  EnterpriseBudgetRevisionQueue,
  ProposeEnterpriseBudgetRevision,
} from '@fieldline/contracts';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { financeBudgetBaselines as baselines } from '../../db/schema/enterpriseFinance';
import {
  financeBudgetRevisionDecisions as decisions,
  financeBudgetRevisionDeltas as deltas,
  financeBudgetRevisionRequests as revisions,
} from '../../db/schema/enterpriseBudgetRevisions';
import { enterprisePurchaseCostCodes as codes } from '../../db/schema/enterprisePurchasing';
import { memberships } from '../../db/schema/team';
import { tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { BudgetProjectParams, budgetPath, requireBudgetProject } from './budgetAccess';
import { approvedBudgetAllocation, type BudgetScope } from './budgetAllocation';

type RequestRow = typeof revisions.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;
type Actor = { membershipId: string; permissions: ReadonlySet<string> };

function requestHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function scopedRequests(scope: BudgetScope) {
  return and(
    eq(revisions.orgId, scope.orgId),
    eq(revisions.projectId, scope.projectId),
    eq(revisions.budgetId, scope.budgetId),
  );
}

async function requireBaseline(tx: Tx, scope: BudgetScope) {
  const [budget] = await tx
    .select({ id: baselines.id })
    .from(baselines)
    .where(
      and(
        eq(baselines.orgId, scope.orgId),
        eq(baselines.projectId, scope.projectId),
        eq(baselines.id, scope.budgetId),
      ),
    );
  if (!budget) throw problem('not_found');
  const allocation = await approvedBudgetAllocation(tx, scope);
  if (!allocation) throw problem('conflict', 'Approve the baseline before proposing a revision.');
  return allocation;
}

async function revisionContent(tx: Tx, scope: BudgetScope, ids: string[]) {
  return tx
    .select({
      revisionId: deltas.revisionId,
      costCode: { id: codes.id, code: codes.code, label: codes.label },
      priorMinor: deltas.priorMinor,
      deltaMinor: deltas.deltaMinor,
      proposedMinor: deltas.proposedMinor,
    })
    .from(deltas)
    .innerJoin(
      codes,
      and(
        eq(codes.orgId, deltas.orgId),
        eq(codes.projectId, deltas.projectId),
        eq(codes.id, deltas.costCodeId),
      ),
    )
    .where(
      and(
        eq(deltas.orgId, scope.orgId),
        eq(deltas.projectId, scope.projectId),
        eq(deltas.budgetId, scope.budgetId),
        inArray(deltas.revisionId, ids),
      ),
    )
    .orderBy(asc(codes.code), asc(codes.id));
}

async function loadDecision(tx: Tx, row: RequestRow) {
  const [decision] = await tx
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.orgId, row.orgId),
        eq(decisions.projectId, row.projectId),
        eq(decisions.budgetId, row.budgetId),
        eq(decisions.revisionId, row.id),
      ),
    );
  return decision;
}

type RevisionContent = Awaited<ReturnType<typeof revisionContent>>;

async function revisionDto(
  tx: Tx,
  row: RequestRow,
  decision: DecisionRow | undefined,
  version: number,
  actor: Actor,
  content?: RevisionContent,
) {
  const changes = content ?? (await revisionContent(tx, row, [row.id]));
  const state =
    decision?.outcome ?? (row.baseVersion === version ? ('pending' as const) : ('stale' as const));
  return {
    id: row.id,
    budgetId: row.budgetId,
    baseVersion: row.baseVersion,
    kind: row.kind,
    reason: row.reason,
    reviewerMembershipId: row.reviewerMembershipId,
    createdAt: row.createdAt.toISOString(),
    state,
    deltas: changes.map(({ revisionId: _revisionId, priorMinor, proposedMinor, ...change }) => ({
      ...change,
      priorMinor: priorMinor.toString(),
      proposedMinor: proposedMinor.toString(),
    })),
    decision: decision
      ? {
          outcome: decision.outcome,
          reason: decision.reason,
          decidedAt: decision.createdAt.toISOString(),
          activatedVersion: decision.activatedVersion,
        }
      : null,
    canDecide:
      !decision &&
      actor.permissions.has('enterprise_budget:approve') &&
      actor.membershipId === row.reviewerMembershipId,
  };
}

const projectBudget = BudgetProjectParams.extend({ budgetId: z.uuid() });
const path = budgetPath + '/:budgetId/revisions';

const budgetRevisions: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'enterprise_budget:read' },
      schema: {
        tags: ['enterprise'],
        params: projectBudget,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: {
          200: EnterpriseBudgetRevisionQueue,
        },
      },
    },
    async (request, reply) => {
      const { projectId, budgetId } = request.params;
      const cursor = decodeCursor(request.query.cursor);
      const { limit } = request.query;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId, budgetId };
        const allocation = await requireBaseline(tx, scope);
        const current = await tx
          .select({ proposal: revisions, decision: decisions })
          .from(revisions)
          .leftJoin(
            decisions,
            and(
              eq(decisions.orgId, revisions.orgId),
              eq(decisions.projectId, revisions.projectId),
              eq(decisions.budgetId, revisions.budgetId),
              eq(decisions.revisionId, revisions.id),
            ),
          )
          .where(
            and(scopedRequests(scope), beforeCursor(revisions.createdAt, revisions.id, cursor)),
          )
          .orderBy(desc(msTrunc(revisions.createdAt)), desc(revisions.id))
          .limit(limit + 1);
        const page = pageResult(
          current,
          limit,
          ({ proposal }) => ({ at: proposal.createdAt, id: proposal.id }),
          (row) => row,
        );
        const content = await revisionContent(
          tx,
          scope,
          page.items.map(({ proposal }) => proposal.id),
        );
        const byRevision = new Map<string, RevisionContent>();
        for (const row of content) {
          const records = byRevision.get(row.revisionId) ?? [];
          records.push(row);
          byRevision.set(row.revisionId, records);
        }
        const items = await Promise.all(
          page.items.map(({ proposal, decision }) =>
            revisionDto(
              tx,
              proposal,
              decision ?? undefined,
              allocation.version,
              org,
              byRevision.get(proposal.id) ?? [],
            ),
          ),
        );
        return { activeVersion: allocation.version, items, nextCursor: page.nextCursor };
      });
      setEtag(reply, result.activeVersion);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    path,
    {
      config: { permission: 'enterprise_budget:approve' },
      schema: {
        tags: ['enterprise'],
        params: projectBudget,
        body: ProposeEnterpriseBudgetRevision,
        response: { 200: EnterpriseBudgetRevision, 201: EnterpriseBudgetRevision },
      },
    },
    async (request, reply) => {
      const { projectId, budgetId } = request.params;
      const expected = parseIfMatch(request);
      const { clientRequestId, kind, reason, reviewerMembershipId } = request.body;
      const proposed = [...request.body.deltas].sort((left, right) =>
        left.costCodeId.localeCompare(right.costCodeId),
      );
      const hash = requestHash({ expected, kind, reason, reviewerMembershipId, proposed });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId, budgetId };
        const allocation = await requireBaseline(tx, scope);
        const [existing] = await tx
          .select()
          .from(revisions)
          .where(and(scopedRequests(scope), eq(revisions.clientRequestId, clientRequestId)));
        if (existing) {
          if (existing.requestHash !== hash || existing.createdByUserId !== org.userId)
            throw problem('conflict', 'This request already proposed a different budget revision.');
          return {
            created: false,
            data: await revisionDto(tx, existing, undefined, existing.baseVersion, org),
          };
        }
        assertRevision(allocation.version, expected);
        const [reviewer] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.orgId, scope.orgId),
              eq(memberships.id, reviewerMembershipId),
              eq(memberships.status, 'active'),
              inArray(memberships.role, ['owner', 'admin']),
            ),
          );
        if (!reviewer)
          throw problem('validation_failed', 'Choose an active manager to review the revision.');
        const allowed = await tx
          .select({ id: codes.id })
          .from(codes)
          .where(
            and(
              eq(codes.orgId, scope.orgId),
              eq(codes.projectId, scope.projectId),
              inArray(
                codes.id,
                proposed.map(({ costCodeId }) => costCodeId),
              ),
            ),
          );
        if (allowed.length !== proposed.length)
          throw problem('validation_failed', 'Choose cost codes from this project.');
        const net = proposed.reduce((sum, change) => sum + BigInt(change.deltaMinor), 0n);
        if (kind === 'transfer' && net !== 0n)
          throw problem(
            'validation_failed',
            'A transfer must balance increases and decreases exactly.',
          );
        const items = proposed.map(({ costCodeId, deltaMinor }) => {
          const priorMinor = allocation.byCostCode.get(costCodeId) ?? 0n;
          const proposedMinor = priorMinor + BigInt(deltaMinor);
          if (proposedMinor < 0n)
            throw problem('validation_failed', 'A cost-code allocation cannot fall below zero.');
          return { costCodeId, deltaMinor, priorMinor, proposedMinor };
        });
        const [saved] = await tx
          .insert(revisions)
          .values({
            ...scope,
            baseVersion: expected,
            kind,
            reason,
            reviewerMembershipId,
            createdByUserId: org.userId,
            clientRequestId,
            requestHash: hash,
          })
          .returning();
        if (!saved) throw problem('internal');
        await tx
          .insert(deltas)
          .values(items.map((item) => ({ ...scope, ...item, revisionId: saved.id })));
        await enqueue(tx, {
          orgId: scope.orgId,
          task: 'budget.revision_requested',
          aggregateType: 'enterprise_budget_revision',
          aggregateId: saved.id,
          payload: { projectId, budgetId, revisionId: saved.id },
          correlationId: request.id,
          jobKey: 'budget.revision_requested:' + saved.id,
        });
        const data = await revisionDto(tx, saved, undefined, allocation.version, org);
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          resourceType: 'enterprise_budget_revision',
          resourceId: saved.id,
          action: 'budget.revision_requested',
          reason,
          after: {
            projectId,
            budgetId,
            baseVersion: expected,
            reviewerMembershipId,
            netMinor: net.toString(),
          },
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
    path + '/:revisionId/decision',
    {
      config: { permission: 'enterprise_budget:approve' },
      schema: {
        tags: ['enterprise'],
        params: projectBudget.extend({ revisionId: z.uuid() }),
        body: DecideEnterpriseBudgetRevision,
        response: { 200: EnterpriseBudgetRevision, 201: EnterpriseBudgetRevision },
      },
    },
    async (request, reply) => {
      const { projectId, budgetId, revisionId } = request.params;
      const expected = parseIfMatch(request);
      const { clientRequestId, outcome, reason } = request.body;
      const hash = requestHash({ revisionId, expected, outcome, reason });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId, budgetId };
        const [proposal] = await tx
          .select()
          .from(revisions)
          .where(and(scopedRequests(scope), eq(revisions.id, revisionId)));
        if (!proposal || proposal.reviewerMembershipId !== org.membershipId)
          throw problem('not_found');
        const allocation = await requireBaseline(tx, scope);
        const [receipt] = await tx
          .select()
          .from(decisions)
          .where(
            and(
              eq(decisions.orgId, scope.orgId),
              eq(decisions.projectId, scope.projectId),
              eq(decisions.budgetId, scope.budgetId),
              eq(decisions.clientRequestId, clientRequestId),
            ),
          );
        if (receipt) {
          if (receipt.requestHash !== hash || receipt.decidedByUserId !== org.userId)
            throw problem('conflict', 'This request already recorded a different decision.');
          return {
            created: false,
            data: await revisionDto(tx, proposal, receipt, allocation.version, org),
          };
        }
        if (await loadDecision(tx, proposal))
          throw problem('conflict', 'This budget revision already has a decision.');
        assertRevision(proposal.baseVersion, expected);
        if (outcome === 'approved') assertRevision(allocation.version, proposal.baseVersion);
        const activatedVersion = outcome === 'approved' ? allocation.version + 1 : null;
        const [saved] = await tx
          .insert(decisions)
          .values({
            ...scope,
            revisionId,
            outcome,
            reason,
            activatedVersion,
            decidedByUserId: org.userId,
            clientRequestId,
            requestHash: hash,
          })
          .returning();
        if (!saved) throw problem('internal');
        if (outcome === 'approved') {
          await enqueue(tx, {
            orgId: scope.orgId,
            task: 'budget.revision_approved',
            aggregateType: 'enterprise_budget_revision',
            aggregateId: revisionId,
            payload: { projectId, budgetId, revisionId },
            correlationId: request.id,
            jobKey: 'budget.revision_approved:' + revisionId,
          });
        }
        const data = await revisionDto(
          tx,
          proposal,
          saved,
          activatedVersion ?? allocation.version,
          org,
        );
        const net = data.deltas.reduce((sum, delta) => sum + BigInt(delta.deltaMinor), 0n);
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          resourceType: 'enterprise_budget_revision',
          resourceId: revisionId,
          action: outcome === 'approved' ? 'budget.revision_approved' : 'budget.revision_rejected',
          reason,
          before: {
            activeVersion: allocation.version,
            amountMinor: allocation.currentMinor.toString(),
          },
          after: {
            projectId,
            budgetId,
            outcome,
            activeVersion: activatedVersion ?? allocation.version,
            amountMinor: (outcome === 'approved'
              ? allocation.currentMinor + net
              : allocation.currentMinor
            ).toString(),
          },
        });
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

export default budgetRevisions;
