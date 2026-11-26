import { createHash } from 'node:crypto';
import {
  ApproveEnterpriseBudgetBaseline,
  CreateEnterpriseBudgetBaseline,
  EnterpriseBudgetApproved,
  EnterpriseBudgetCreated,
  EnterpriseBudgetLineReceipt,
  EnterpriseBudgetSummary,
  EnterpriseScheduleDate,
  RecordEnterpriseBudgetDraftLine,
} from '@fieldline/contracts';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  financeBudgetApprovals as approvals,
  financeBudgetBaselines as baselines,
  financeBudgetLines as lines,
} from '../../db/schema/enterpriseFinance';
import { enterprisePurchaseCostCodes as codes } from '../../db/schema/enterprisePurchasing';
import { organizations } from '../../db/schema/orgs';
import { tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import budgetGrants, {
  BudgetProjectParams,
  budgetPath,
  requireBudgetProject,
} from './budgetAccess';
import { approvedBudgetAllocation } from './budgetAllocation';
import budgetRevisions from './budgetRevisions';
import { projectPurchaseCommitments } from './purchaseCommitmentData';
import { actualBillCostTotals } from './actualBillCostTotals';

type Scope = { orgId: string; projectId: string };
type Budget = typeof baselines.$inferSelect;
type Line = typeof lines.$inferSelect;
type Approval = typeof approvals.$inferSelect;
type CostCode = Pick<typeof codes.$inferSelect, 'id' | 'code' | 'label'>;

function scopeFor(scope: Scope) {
  return {
    budget: and(eq(baselines.orgId, scope.orgId), eq(baselines.projectId, scope.projectId)),
    line: and(eq(lines.orgId, scope.orgId), eq(lines.projectId, scope.projectId)),
    approval: and(eq(approvals.orgId, scope.orgId), eq(approvals.projectId, scope.projectId)),
    costCode: and(eq(codes.orgId, scope.orgId), eq(codes.projectId, scope.projectId)),
  };
}

function requestHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function creationReceipt(row: Budget) {
  return {
    id: row.id,
    currency: row.currency,
    effectiveOn: row.effectiveOn,
    createdAt: row.createdAt.toISOString(),
    revision: 1,
  };
}

function approvalReceipt(row: Approval) {
  return {
    budgetId: row.budgetId,
    amountMinor: row.amountMinor.toString(),
    approvedAt: row.createdAt.toISOString(),
    reason: row.reason,
    revision: row.revision,
  };
}

function lineDto(row: Line, costCode: CostCode, currency: string) {
  const { id, amountMinor, description, unit, phase, fundingSource, createdAt } = row;
  return {
    id,
    costCodeId: costCode.id,
    costCode,
    currency,
    description,
    amountMinor,
    unit,
    phase,
    fundingSource,
    createdAt: createdAt.toISOString(),
  };
}

async function currentBudget(tx: Tx, scope: Scope) {
  const [budget] = await tx.select().from(baselines).where(scopeFor(scope).budget);
  return budget;
}

async function currentApproval(tx: Tx, scope: Scope, budgetId: string) {
  const [approval] = await tx
    .select()
    .from(approvals)
    .where(and(scopeFor(scope).approval, eq(approvals.budgetId, budgetId)));
  return approval;
}

async function readCostCode(tx: Tx, scope: Scope, id: string) {
  const [code] = await tx
    .select({ id: codes.id, code: codes.code, label: codes.label })
    .from(codes)
    .where(and(scopeFor(scope).costCode, eq(codes.id, id)));
  if (!code) throw problem('validation_failed', 'Choose a cost code from this project.');
  return code;
}

async function listLines(tx: Tx, scope: Scope, budget: Budget, before?: Date) {
  return tx
    .select({ row: lines, costCode: { id: codes.id, code: codes.code, label: codes.label } })
    .from(lines)
    .innerJoin(
      codes,
      and(
        eq(codes.orgId, lines.orgId),
        eq(codes.projectId, lines.projectId),
        eq(codes.id, lines.costCodeId),
      ),
    )
    .where(
      and(
        scopeFor(scope).line,
        eq(lines.budgetId, budget.id),
        before ? lt(lines.createdAt, before) : undefined,
      ),
    )
    .orderBy(asc(codes.code), asc(lines.id));
}

const budgets: FastifyPluginAsyncZod = async (app) => {
  await app.register(budgetGrants);
  await app.register(budgetRevisions);

  app.get(
    budgetPath,
    {
      config: { permission: 'enterprise_budget:read' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        querystring: z.object({
          asOf: EnterpriseScheduleDate.optional(),
          costCodeId: z.uuid().optional(),
        }),
        response: { 200: EnterpriseBudgetSummary },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const now = new Date();
      const { asOf: requestedDate, costCodeId } = request.query;
      const result = await tenantTx(request, async (tx) => {
        const { org, project } = await requireBudgetProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId };
        const budget = await currentBudget(tx, scope);
        const [company] = await tx
          .select({
            currency: organizations.currency,
            timeZone: sql<string>`case when exists (
              select 1 from pg_catalog.pg_timezone_names where name = ${organizations.timezone}
            ) then ${organizations.timezone} else 'UTC' end`,
          })
          .from(organizations)
          .where(eq(organizations.id, org.orgId));
        if (!company) throw problem('not_found');
        const localDate = sql`(${now.toISOString()}::timestamptz at time zone ${company.timeZone})::date`;
        const [calendar] = await tx.execute<{ today: string; cutoff_ms: string }>(sql`
          select (${localDate})::text as today,
                 extract(epoch from (
                   (coalesce(${requestedDate ?? null}::date, ${localDate}) + 1)::timestamp
                   at time zone ${company.timeZone}
                 )) * 1000 as cutoff_ms
        `);
        if (!calendar) throw problem('internal');
        const today = calendar.today;
        const asOf = requestedDate ?? today;
        const cutoff = new Date(Number(calendar.cutoff_ms));
        const costCodes = await tx
          .select({ id: codes.id, code: codes.code, label: codes.label })
          .from(codes)
          .where(scopeFor(scope).costCode)
          .orderBy(asc(codes.code));
        if (costCodeId && !costCodes.some(({ id }) => id === costCodeId))
          throw problem('validation_failed', 'Choose a cost code from this project.');
        const [commitments, actualBillCosts] = await Promise.all([
          projectPurchaseCommitments(tx, scope, cutoff),
          actualBillCostTotals(tx, scope, asOf),
        ]);
        const base = {
          asOf,
          readAt: now.toISOString(),
          projectName: project.name,
          companyCurrency: company.currency,
          allocation: null,
          purchaseCommitments: { currency: 'USD' as const, ...commitments },
          actualBillCosts,
          availableCostCodes: costCodes,
          canManageGrants: org.permissions.has('enterprise_budget:manage_grants'),
          canCreate: !budget && asOf === today && org.permissions.has('enterprise_budget:approve'),
        };
        if (!budget || budget.createdAt >= cutoff) {
          return { ...base, baseline: null, canEditDraft: false, canApprove: false };
        }

        const savedApproval = await currentApproval(tx, scope, budget.id);
        const approved =
          savedApproval && savedApproval.createdAt < cutoff ? savedApproval : undefined;
        const allocation = approved
          ? await approvedBudgetAllocation(tx, { ...scope, budgetId: budget.id }, cutoff)
          : null;
        const entries = await listLines(tx, scope, budget, cutoff);
        const total = entries.reduce((sum, entry) => sum + BigInt(entry.row.amountMinor), 0n);
        const revision =
          approved?.revision ??
          entries.reduce((latest, entry) => Math.max(latest, entry.row.revision), 1);
        const visible = costCodeId
          ? entries.filter(({ costCode }) => costCode.id === costCodeId)
          : entries;
        return {
          ...base,
          allocation: allocation
            ? {
                version: allocation.version,
                baselineMinor: allocation.baseMinor.toString(),
                approvedChangeMinor: allocation.approvedChangeMinor.toString(),
                currentMinor: allocation.currentMinor.toString(),
                byCostCode: costCodes.flatMap(({ id }) => {
                  const amountMinor = allocation.byCostCode.get(id);
                  return amountMinor === undefined
                    ? []
                    : [{ costCodeId: id, amountMinor: amountMinor.toString() }];
                }),
              }
            : null,
          canEditDraft:
            !savedApproval && asOf === today && org.permissions.has('enterprise_budget:edit_draft'),
          canApprove:
            !savedApproval &&
            asOf === today &&
            entries.length > 0 &&
            org.permissions.has('enterprise_budget:approve'),
          baseline: {
            ...creationReceipt(budget),
            amountMinor: total.toString(),
            revision,
            status: approved ? ('approved' as const) : ('draft' as const),
            approvedAt: approved?.createdAt.toISOString() ?? null,
            approvalReason: approved?.reason ?? null,
            lines: visible.map(({ row, costCode }) => lineDto(row, costCode, budget.currency)),
          },
        };
      });
      setEtag(reply, result.baseline?.revision ?? 0);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    budgetPath,
    {
      config: { permission: 'enterprise_budget:approve' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        body: CreateEnterpriseBudgetBaseline,
        response: { 200: EnterpriseBudgetCreated, 201: EnterpriseBudgetCreated },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const expected = parseIfMatch(request);
      const { currency, effectiveOn, clientRequestId } = request.body;
      const hash = requestHash({ currency, effectiveOn, expected });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const existing = await currentBudget(tx, scope);
        if (existing?.clientRequestId === clientRequestId) {
          if (existing.requestHash !== hash || existing.createdByUserId !== org.userId)
            throw problem('conflict', 'This request already created a different baseline.');
          return { created: false, budget: creationReceipt(existing) };
        }
        if (existing) throw problem('conflict', 'This project already has a budget baseline.');
        assertRevision(0, expected);
        const [saved] = await tx
          .insert(baselines)
          .values({
            ...scope,
            currency,
            effectiveOn,
            clientRequestId,
            requestHash: hash,
            createdByUserId: org.userId,
          })
          .returning();
        if (!saved) throw problem('internal');
        const budget = creationReceipt(saved);
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          resourceType: 'enterprise_budget_baseline',
          resourceId: saved.id,
          action: 'budget.baseline_created',
          after: budget,
        });
        return { created: true, budget };
      });
      setEtag(reply, result.budget.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.budget);
    },
  );

  app.post(
    budgetPath + '/:budgetId/lines',
    {
      config: { permission: 'enterprise_budget:edit_draft' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams.extend({ budgetId: z.uuid() }),
        body: RecordEnterpriseBudgetDraftLine,
        response: { 200: EnterpriseBudgetLineReceipt, 201: EnterpriseBudgetLineReceipt },
      },
    },
    async (request, reply) => {
      const { projectId, budgetId } = request.params;
      const expected = parseIfMatch(request);
      const { clientRequestId, currency, ...details } = request.body;
      const hash = requestHash({ currency, ...details, expected });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const budget = await currentBudget(tx, scope);
        if (budget?.id !== budgetId) throw problem('not_found');
        const lineScope = and(scopeFor(scope).line, eq(lines.budgetId, budgetId));
        const [existing] = await tx
          .select()
          .from(lines)
          .where(and(lineScope, eq(lines.clientRequestId, clientRequestId)));
        if (existing) {
          if (existing.requestHash !== hash || existing.createdByUserId !== org.userId)
            throw problem('conflict', 'This request already created a different budget line.');
          const currentCode = await readCostCode(tx, scope, existing.costCodeId);
          return {
            created: false,
            receipt: {
              line: lineDto(existing, currentCode, budget.currency),
              revision: existing.revision,
            },
          };
        }
        if (await currentApproval(tx, scope, budgetId))
          throw problem('conflict', 'Submit a budget revision to change an approved baseline.');
        assertRevision(budget.revision, expected);
        if (currency !== budget.currency)
          throw problem('validation_failed', 'Use the baseline currency for every budget line.');
        const code = await readCostCode(tx, scope, details.costCodeId);
        const [duplicate] = await tx
          .select({ id: lines.id })
          .from(lines)
          .where(and(lineScope, eq(lines.costCodeId, code.id)));
        if (duplicate) throw problem('conflict', 'This cost code already has a line in the draft.');
        const revision = expected + 1;
        const [saved] = await tx
          .insert(lines)
          .values({
            ...scope,
            ...details,
            budgetId,
            revision,
            clientRequestId,
            requestHash: hash,
            createdByUserId: org.userId,
          })
          .returning();
        if (!saved) throw problem('internal');
        await tx
          .update(baselines)
          .set({ revision })
          .where(and(scopeFor(scope).budget, eq(baselines.id, budgetId)));
        const line = lineDto(saved, code, budget.currency);
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          resourceType: 'enterprise_budget_line',
          resourceId: saved.id,
          action: 'budget.draft_line_created',
          after: { budgetId, revision, line },
        });
        return { created: true, receipt: { line, revision } };
      });
      setEtag(reply, result.receipt.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.receipt);
    },
  );

  app.post(
    budgetPath + '/:budgetId/approval',
    {
      config: { permission: 'enterprise_budget:approve' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams.extend({ budgetId: z.uuid() }),
        body: ApproveEnterpriseBudgetBaseline,
        response: { 200: EnterpriseBudgetApproved, 201: EnterpriseBudgetApproved },
      },
    },
    async (request, reply) => {
      const { projectId, budgetId } = request.params;
      const expected = parseIfMatch(request);
      const { clientRequestId, reason } = request.body;
      const hash = requestHash({ reason, expected });
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const budget = await currentBudget(tx, scope);
        if (budget?.id !== budgetId) throw problem('not_found');
        const existing = await currentApproval(tx, scope, budgetId);
        if (existing?.clientRequestId === clientRequestId) {
          if (existing.requestHash !== hash || existing.approvedByUserId !== org.userId)
            throw problem('conflict', 'This request already recorded a different approval.');
          return { created: false, receipt: approvalReceipt(existing) };
        }
        if (existing) throw problem('conflict', 'This budget baseline is already approved.');
        assertRevision(budget.revision, expected);
        const [totals] = await tx
          .select({
            count: sql`count(*)`.mapWith(Number),
            amountMinor: sql`coalesce(sum(${lines.amountMinor}), 0)`.mapWith(BigInt),
          })
          .from(lines)
          .where(and(scopeFor(scope).line, eq(lines.budgetId, budgetId)));
        if (!totals?.count)
          throw problem('validation_failed', 'Add a budget line before approval.');
        const revision = expected + 1;
        const [saved] = await tx
          .insert(approvals)
          .values({
            ...scope,
            budgetId,
            revision,
            amountMinor: totals.amountMinor,
            reason,
            clientRequestId,
            requestHash: hash,
            approvedByUserId: org.userId,
          })
          .returning();
        if (!saved) throw problem('internal');
        await tx
          .update(baselines)
          .set({ revision })
          .where(and(scopeFor(scope).budget, eq(baselines.id, budgetId)));
        const receipt = approvalReceipt(saved);
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          resourceType: 'enterprise_budget_baseline',
          resourceId: budgetId,
          action: 'budget.baseline_approved',
          reason,
          before: { revision: expected, status: 'draft' },
          after: { ...receipt, status: 'approved', currency: budget.currency },
        });
        return { created: true, receipt };
      });
      setEtag(reply, result.receipt.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.receipt);
    },
  );
};

export default budgets;
