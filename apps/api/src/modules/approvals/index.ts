// `approvals` module (CP-059, OPS-065 R, COS-326..336 governance): tenant + jurisdiction approval
// policies, named sign-off capacities, separation of duties, delegation, withdrawal that reverts
// the estimate to review, and immutable approval records carrying the rule version and evidence.
// POST /v1/estimates/{id}/approve re-evaluates EVERY gate on the server at decision time.
import {
  ApprovalPolicySchema,
  ApprovalSchema,
  CreateApprovalPolicyRequestSchema,
  type GatingResult,
  type SignoffRole,
  SignoffRequestSchema,
  type SiteCondition,
  UuidSchema,
  WithdrawApprovalRequestSchema,
  estimateMachine,
} from '@fieldline/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { approvalDelegations, approvalPolicies, approvals, domainEvents, estimateRevisions, estimates, memberships, users } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { idempotent } from '../../http/idempotency';
import { HttpProblem, problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { evaluateGating, loadEstimate, loadGatingFacts } from '../estimates/service';
import { loadProperty } from '../properties/service';
import { type PolicyRow, policyRuleVersion, resolvePolicy } from './policy';

const IdParams = z.object({ id: UuidSchema });
type ApprovalRow = typeof approvals.$inferSelect;

async function approvalDto(tx: Tx, a: ApprovalRow) {
  const [who] = await tx
    .select({ userId: memberships.userId, displayName: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.id, a.approverMembershipId));
  return {
    id: a.id,
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    signoffRole: a.signoffRole,
    decision: a.decision,
    approver: { userId: who?.userId ?? null, displayName: who?.displayName ?? null },
    ruleVersion: a.ruleVersion,
    evidence: (a.evidence as Record<string, unknown> | null) ?? null,
    comment: a.comment,
    decidedAt: a.decidedAt.toISOString(),
    withdrawnAt: a.withdrawnAt?.toISOString() ?? null,
    withdrawnReason: a.withdrawnReason,
    policyId: a.policyId,
    delegationId: a.delegationId,
    actingForMembershipId: a.actingForMembershipId,
  };
}

function policyDto(p: PolicyRow) {
  return {
    id: p.id,
    orgId: p.orgId,
    revision: p.revision,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    name: p.name,
    subjectType: p.subjectType,
    productLine: p.productLine,
    jurisdictionId: p.jurisdictionId,
    requiredSignoffs: p.requiredSignoffs,
    separationOfDuties: p.separationOfDuties,
    minAmountMinor: p.minAmountMinor,
    eligibleRoles: p.eligibleRoles as Record<string, never[]>,
    active: p.active,
    ruleVersion: policyRuleVersion(p),
  };
}

async function activeApprovals(tx: Tx, orgId: string, revisionId: string) {
  return tx
    .select()
    .from(approvals)
    .where(and(eq(approvals.orgId, orgId), eq(approvals.subjectType, 'estimate_revision'), eq(approvals.subjectId, revisionId), eq(approvals.decision, 'approved'), isNull(approvals.withdrawnAt)))
    .orderBy(asc(approvals.decidedAt));
}

const SignoffResponseSchema = z.object({
  approval: ApprovalSchema,
  estimate: z.object({ id: UuidSchema, status: z.string(), revision: z.number().int(), approvedRevisionId: UuidSchema.nullable() }),
  outstandingSignoffs: z.array(z.string()),
  policy: z.object({ ruleVersion: z.string(), requiredSignoffs: z.array(z.string()), separationOfDuties: z.boolean() }),
});

const approvalsModule: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------------ policies
  app.get(
    '/approval-policies',
    {
      config: { permission: 'approval:read' },
      schema: { tags: ['approvals'], summary: 'Approval policies', response: { 200: z.object({ items: z.array(ApprovalPolicySchema) }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => ({
        items: (await tx.select().from(approvalPolicies).where(eq(approvalPolicies.orgId, org.orgId)).orderBy(asc(approvalPolicies.createdAt))).map(policyDto),
      }));
    },
  );

  app.post(
    '/approval-policies',
    {
      config: { permission: 'approval_policy:manage' },
      schema: { tags: ['approvals'], summary: 'Create an approval policy (tenant + optional jurisdiction)', body: CreateApprovalPolicyRequestSchema, response: { 201: ApprovalPolicySchema } },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      return idempotent(request, reply, {}, async (tx) => {
        const b = request.body;
        const [row] = await tx
          .insert(approvalPolicies)
          .values({
            orgId: org.orgId,
            name: b.name,
            subjectType: b.subjectType,
            productLine: b.productLine,
            jurisdictionId: b.jurisdictionId,
            requiredSignoffs: [...new Set(b.requiredSignoffs)],
            separationOfDuties: b.separationOfDuties,
            minAmountMinor: b.minAmountMinor,
            eligibleRoles: b.eligibleRoles,
          })
          .returning();
        const out = policyDto(row!);
        await auditRequest(request, tx, { orgId: org.orgId, action: 'approval_policy.created', resourceType: 'approval_policy', resourceId: row!.id, after: out });
        return { status: 201, body: out };
      });
    },
  );

  app.post(
    '/approval-policies/:id/deactivate',
    {
      config: { permission: 'approval_policy:manage' },
      schema: { tags: ['approvals'], summary: 'Deactivate a policy (kept for the rule-version trail)', params: IdParams, response: { 200: ApprovalPolicySchema } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [row] = await tx
          .update(approvalPolicies)
          .set({ active: false, revision: sql`${approvalPolicies.revision} + 1` })
          .where(and(eq(approvalPolicies.orgId, org.orgId), eq(approvalPolicies.id, request.params.id)))
          .returning();
        if (!row) throw problem('not_found');
        await auditRequest(request, tx, { orgId: org.orgId, action: 'approval_policy.deactivated', resourceType: 'approval_policy', resourceId: row.id, after: { active: false } });
        return policyDto(row);
      });
    },
  );

  // ------------------------------------------------------------------ approvals
  app.get(
    '/approvals',
    {
      config: { permission: 'approval:read' },
      schema: { tags: ['approvals'], summary: 'Approval records for a subject', querystring: z.object({ subjectId: UuidSchema }), response: { 200: z.object({ items: z.array(ApprovalSchema) }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx.select().from(approvals).where(and(eq(approvals.orgId, org.orgId), eq(approvals.subjectId, request.query.subjectId))).orderBy(asc(approvals.decidedAt));
        const items = [];
        for (const r of rows) items.push(await approvalDto(tx, r));
        return { items };
      });
    },
  );

  app.post(
    '/estimates/:id/approve',
    {
      // estimate:signoff is checked in the handler: a member WITHOUT it may still sign through an
      // active delegation from someone who holds the capacity.
      config: { permission: 'approval:read' },
      schema: {
        tags: ['approvals'],
        summary: 'Record a named sign-off; the estimate is approved when the policy is satisfied. Every gate is enforced server-side.',
        params: IdParams,
        body: SignoffRequestSchema,
        response: { 201: SignoffResponseSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const b = request.body;
      if (!b.delegationId) assertCan(request, 'estimate:signoff');
      return idempotent(request, reply, { required: true }, async (tx) => {
        const now = new Date();
        const e = await loadEstimate(tx, org.orgId, request.params.id, true);
        if (!e) throw problem('not_found');
        if (e.currentRevisionId !== b.revisionId) {
          throw new HttpProblem({
            code: 'revision_conflict',
            detail: 'A newer estimate revision exists. Review it before signing.',
            conflict: { aggregateId: e.id, expectedRevision: e.revision, serverRevision: e.revision, diff: [{ field: 'currentRevisionId', server: e.currentRevisionId, yours: b.revisionId }] },
          });
        }
        const [rev] = await tx.select().from(estimateRevisions).where(and(eq(estimateRevisions.orgId, org.orgId), eq(estimateRevisions.id, b.revisionId)));
        const stored = rev!.gatingResult as GatingResult;
        // Re-evaluate the gates that can change after pricing (risk flags, jurisdiction, scope,
        // staleness) and keep the pricing gates frozen in the revision.
        const facts = await loadGatingFacts(tx, org.orgId, e, rev!.siteConditions as Record<string, SiteCondition>);
        const live = evaluateGating(facts, { status: 'priced', firm: true, lines: [], flags: [], rangeDrivers: [] } as never, { stale: [], conflicts: [], fallback: false } as never, stored.requiredSignoffs);
        const blockers = [...stored.blockers, ...live.blockers.filter((l) => !stored.blockers.some((s) => s.code === l.code && s.riskFlagId === l.riskFlagId))];
        if (blockers.length > 0 || rev!.quoteKind !== 'firm') {
          throw problem('gate_blocked', `Approval blocked by ${blockers.length} unresolved item(s); this can only be offered as a ${rev!.quoteKind.replace('_', ' ')}.`, {
            errors: blockers.map((x) => ({ path: `gating.${x.code}`, message: x.message, code: x.code })),
          });
        }
        const warnings = [...stored.warnings, ...live.warnings.filter((l) => !stored.warnings.some((s) => s.code === l.code))];
        const unacknowledged = warnings.filter((w) => !b.acknowledgedWarnings.includes(w.code));
        if (unacknowledged.length) {
          throw problem('validation_failed', 'Acknowledge every warning before signing.', {
            errors: unacknowledged.map((w) => ({ path: 'body.acknowledgedWarnings', message: `${w.code}: ${w.message}`, code: w.code })),
          });
        }
        const property = e.propertyId ? await loadProperty(tx, org.orgId, e.propertyId) : null;
        const policy = await resolvePolicy(tx, org.orgId, { subjectType: 'estimate_revision', productLine: e.productLine, jurisdictionId: property?.jurisdictionId ?? null, amountMinor: rev!.totalMinor });
        if (!policy.requiredSignoffs.includes(b.signoffRole)) {
          throw problem('validation_failed', `The policy (${policy.ruleVersion}) does not require a ${b.signoffRole} sign-off.`, {
            errors: [{ path: 'body.signoffRole', message: `required: ${policy.requiredSignoffs.join(', ')}` }],
          });
        }
        // Capacity: myself, or the delegator through an active delegation.
        let capacityRole = org.role;
        let delegationId: string | null = null;
        let actingFor: string | null = null;
        if (b.delegationId) {
          const [d] = await tx.select().from(approvalDelegations).where(and(eq(approvalDelegations.orgId, org.orgId), eq(approvalDelegations.id, b.delegationId)));
          const valid =
            d &&
            d.toMembershipId === org.membershipId &&
            d.revokedAt === null &&
            d.startsAt <= now &&
            d.endsAt > now &&
            d.subjectTypes.includes('estimate_revision') &&
            (d.maxAmountMinor === null || (rev!.totalMinor !== null && rev!.totalMinor <= d.maxAmountMinor));
          if (!valid) throw problem('forbidden', 'The delegation is not active for this approval.');
          const [from] = await tx.select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.id, d.fromMembershipId)));
          if (!from || from.status !== 'active') throw problem('forbidden', 'The delegating member is no longer active.');
          capacityRole = from.role;
          delegationId = d.id;
          actingFor = from.id;
        }
        const eligible = policy.eligibleRoles[b.signoffRole as SignoffRole] ?? [];
        if (!eligible.includes(capacityRole)) {
          throw problem('forbidden', `A ${capacityRole} cannot sign as ${b.signoffRole} under ${policy.ruleVersion}.`);
        }
        const existing = await activeApprovals(tx, org.orgId, rev!.id);
        if (existing.some((a) => a.signoffRole === b.signoffRole)) throw problem('duplicate', `The ${b.signoffRole} sign-off already exists.`);
        if (policy.separationOfDuties) {
          if (rev!.createdByUserId === org.userId) throw problem('approval_separation_of_duties', 'You priced this revision; another person must sign it.');
          const mine = existing.filter((a) => a.approverMembershipId === org.membershipId || (actingFor !== null && a.actingForMembershipId === actingFor) || a.approverMembershipId === actingFor);
          if (mine.length) throw problem('approval_separation_of_duties', 'One person may hold only one sign-off on a revision.');
        }
        const [approval] = await tx
          .insert(approvals)
          .values({
            orgId: org.orgId,
            subjectType: 'estimate_revision',
            subjectId: rev!.id,
            signoffRole: b.signoffRole,
            decision: 'approved',
            approverMembershipId: org.membershipId,
            delegationId,
            actingForMembershipId: actingFor,
            policyId: policy.policyId,
            ruleVersion: policy.ruleVersion,
            amountMinor: rev!.totalMinor,
            comment: b.comment ?? null,
            decidedAt: now,
            evidence: {
              estimateId: e.id,
              revisionNumber: rev!.revisionNumber,
              inputHash: rev!.inputHash,
              priceBookRevisionId: rev!.priceBookRevisionId,
              engineVersions: rev!.engineVersions,
              gatingRulesVersion: (rev!.engineVersions as Record<string, string>).gating ?? null,
              acknowledgedWarnings: warnings.map((w) => w.code),
              unresolvedFlags: [],
              evidenceRefs: b.evidenceRefs,
            },
          })
          .returning();
        const roles = new Set([...existing.map((a) => a.signoffRole), b.signoffRole]);
        const outstanding = policy.requiredSignoffs.filter((r) => !roles.has(r));
        let updated = e;
        if (outstanding.length === 0) {
          if (!estimateMachine.canTransition(e.status, 'approved')) throw problem('invalid_transition', `An estimate in ${e.status} cannot be approved.`);
          const [u] = await tx
            .update(estimates)
            .set({ status: 'approved', approvedRevisionId: rev!.id, revision: e.revision + 1 })
            .where(eq(estimates.id, e.id))
            .returning();
          updated = u!;
          await tx.insert(domainEvents).values({ orgId: org.orgId, eventType: 'estimate.approved', aggregateType: 'estimate', aggregateId: e.id, payload: { revisionId: rev!.id, ruleVersion: policy.ruleVersion }, correlationId: request.id });
        }
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: outstanding.length === 0 ? 'estimate.approved' : 'estimate.signoff_recorded',
          resourceType: 'estimate',
          resourceId: e.id,
          before: { status: e.status },
          after: { status: updated.status, approvalId: approval!.id, signoffRole: b.signoffRole, ruleVersion: policy.ruleVersion, outstanding },
        });
        return {
          status: 201,
          body: {
            approval: await approvalDto(tx, approval!),
            estimate: { id: updated.id, status: updated.status, revision: updated.revision, approvedRevisionId: updated.approvedRevisionId },
            outstandingSignoffs: outstanding,
            policy: { ruleVersion: policy.ruleVersion, requiredSignoffs: policy.requiredSignoffs, separationOfDuties: policy.separationOfDuties },
          },
        };
      });
    },
  );

  app.post(
    '/approvals/:id/withdraw',
    {
      config: { permission: 'approval:read' },
      schema: {
        tags: ['approvals'],
        summary: 'Withdraw a sign-off (the estimate reverts to review_required)',
        params: IdParams,
        body: WithdrawApprovalRequestSchema,
        response: { 200: ApprovalSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [a] = await tx.select().from(approvals).where(and(eq(approvals.orgId, org.orgId), eq(approvals.id, request.params.id))).for('update');
        if (!a) throw problem('not_found');
        if (a.approverMembershipId !== org.membershipId && !org.permissions.has('approval:withdraw')) throw problem('forbidden');
        if (a.withdrawnAt) throw problem('conflict', 'This sign-off was already withdrawn.');
        const now = new Date();
        const [w] = await tx.update(approvals).set({ withdrawnAt: now, withdrawnReason: request.body.reason }).where(eq(approvals.id, a.id)).returning();
        let reverted: string | null = null;
        if (a.subjectType === 'estimate_revision') {
          // CP-059 S: a withdrawn required approval reverts the quote to pending review.
          const [e] = await tx
            .select()
            .from(estimates)
            .where(and(eq(estimates.orgId, org.orgId), sql`(${estimates.approvedRevisionId} = ${a.subjectId} or ${estimates.currentRevisionId} = ${a.subjectId})`))
            .for('update');
          if (e && e.status === 'approved') {
            await tx.update(estimates).set({ status: 'review_required', approvedRevisionId: null, revision: e.revision + 1 }).where(eq(estimates.id, e.id));
            reverted = e.id;
            await tx.insert(domainEvents).values({ orgId: org.orgId, eventType: 'estimate.approval_withdrawn', aggregateType: 'estimate', aggregateId: e.id, payload: { approvalId: a.id }, correlationId: request.id });
          }
        }
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'approval.withdrawn',
          resourceType: 'approval',
          resourceId: a.id,
          before: { withdrawnAt: null },
          after: { withdrawnAt: now.toISOString(), revertedEstimateId: reverted },
          reason: request.body.reason,
        });
        return approvalDto(tx, w!);
      });
    },
  );
};

export default approvalsModule;
