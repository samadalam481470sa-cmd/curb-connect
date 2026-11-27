import { createHash } from 'node:crypto';
import {
  AssignEnterpriseSalesLead,
  SalesLeadAssignment,
  SalesLeadAssignmentOptions,
  SALES_TERMINAL_STAGES,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { users } from '../../db/schema/auth';
import { salesLeadAssignments as assignments } from '../../db/schema/enterpriseSalesAssignments';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { memberships } from '../../db/schema/team';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import {
  activeSalesCommunities,
  assignmentPolicy,
  candidateTerritories,
  lockSalesAssignments,
} from './salesAssignmentEligibility';

const path = '/enterprise/sales/leads/:leadId/assignments';
const params = z.object({ leadId: z.uuid() });
const manage = { permission: 'enterprise_sales:manage' } as const;
type Scope = { orgId: string; leadId: string };
type Row = typeof assignments.$inferSelect;

function dto(
  { id, revision, mode, ownerMembershipId, previousOwnerMembershipId, reason, createdAt }: Row,
  name: string,
) {
  return {
    id,
    revision,
    mode,
    owner: { id: ownerMembershipId, name },
    previousOwnerMembershipId,
    reason,
    assignedAt: createdAt.toISOString(),
  };
}

function assignmentScope({ orgId, leadId }: Scope) {
  return and(eq(assignments.orgId, orgId), eq(assignments.leadId, leadId));
}

function assignmentRecords(tx: Tx) {
  return tx
    .select({ row: assignments, name: users.displayName })
    .from(assignments)
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, assignments.orgId),
        eq(memberships.id, assignments.ownerMembershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId));
}

async function eligibleForLead(tx: Tx, lead: typeof leads.$inferSelect) {
  if (SALES_TERMINAL_STAGES.some((stage) => stage === lead.pipelineStage)) return [];
  if (lead.communityId) {
    const choices = await activeSalesCommunities(tx, lead.orgId);
    if (!choices.some(({ id }) => id === lead.communityId)) return [];
  }
  const candidates = await candidateTerritories(tx, lead.orgId, lead.communityId);
  return candidates.filter(({ id }) => id !== lead.ownerMembershipId);
}

const salesLeadAssignments: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: manage,
      schema: { tags: ['enterprise'], params, response: { 200: SalesLeadAssignmentOptions } },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const { leadId } = request.params;
      const data = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const [lead] = await tx
          .select()
          .from(leads)
          .where(and(eq(leads.orgId, orgId), eq(leads.id, leadId)));
        if (!lead) throw problem('not_found');
        const [candidates, [policy], history] = await Promise.all([
          eligibleForLead(tx, lead),
          assignmentPolicy(tx, orgId, 1),
          assignmentRecords(tx)
            .where(assignmentScope({ orgId, leadId }))
            .orderBy(desc(assignments.revision))
            .limit(30),
        ]);
        const revisions = history.map(({ row, name }) => dto(row, name));
        return {
          id: lead.id,
          name: lead.name,
          revision: lead.revision,
          owner: revisions[0]?.owner ?? null,
          roundRobinEnabled: policy?.enabled ?? false,
          candidates,
          history: revisions,
        };
      });
      setEtag(reply, data.revision);
      return reply.header('cache-control', 'private, no-store').send(data);
    },
  );

  app.post(
    path,
    {
      config: { ...manage, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params,
        body: AssignEnterpriseSalesLead,
        response: { 200: SalesLeadAssignment, 201: SalesLeadAssignment },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { leadId } = request.params;
      const input = request.body;
      const expected = parseIfMatch(request);
      const requestHash = createHash('sha256')
        .update(JSON.stringify([input, expected]))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await lockSalesAssignments(tx, orgId);
        const scope = and(eq(leads.orgId, orgId), eq(leads.id, leadId));
        const [lead] = await tx.select().from(leads).where(scope).for('update');
        if (!lead) throw problem('not_found');
        const [receipt] = await assignmentRecords(tx).where(
          and(
            assignmentScope({ orgId, leadId }),
            eq(assignments.clientRequestId, input.clientRequestId),
          ),
        );
        if (receipt) {
          if (receipt.row.actorUserId !== userId || receipt.row.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved a different assignment.');
          return { created: false, data: dto(receipt.row, receipt.name) };
        }
        assertRevision(lead.revision, expected);
        const candidates = await eligibleForLead(tx, lead);
        if (input.mode === 'round_robin') {
          const [policy] = await assignmentPolicy(tx, orgId, 1);
          if (!policy?.enabled)
            throw problem('conflict', 'Round robin is off for this sales pipeline.');
        }
        const next =
          input.mode === 'direct'
            ? candidates.find(({ id }) => id === input.ownerMembershipId)
            : candidates[0];
        if (!next)
          throw problem(
            'conflict',
            'Choose an active salesperson with capacity in the lead’s territory.',
          );
        const [saved] = await tx
          .insert(assignments)
          .values({
            orgId,
            leadId,
            ownerMembershipId: next.id,
            previousOwnerMembershipId: lead.ownerMembershipId,
            territoryRevisionId: next.territoryId,
            mode: input.mode,
            revision: expected + 1,
            reason: input.reason,
            actorUserId: userId,
            clientRequestId: input.clientRequestId,
            requestHash,
            createdAt: new Date(),
          })
          .returning();
        if (!saved) throw problem('internal');
        await tx
          .update(leads)
          .set({ ownerMembershipId: next.id, revision: saved.revision })
          .where(scope);
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.lead_assigned',
          resourceType: 'enterprise_sales_lead_assignment',
          resourceId: saved.id,
          before: { ownerMembershipId: lead.ownerMembershipId, revision: lead.revision },
          after: {
            leadId,
            ownerMembershipId: next.id,
            territoryRevisionId: next.territoryId,
            revision: saved.revision,
            mode: input.mode,
          },
          reason: input.reason,
        });
        await enqueue(tx, {
          orgId,
          task: 'sales.lead_assigned',
          aggregateType: 'enterprise_sales_lead_assignment',
          aggregateId: saved.id,
          payload: { leadId, assignmentId: saved.id },
          correlationId: request.id,
          jobKey: 'sales.lead_assigned:' + saved.id,
        });
        return { created: true, data: dto(saved, next.name) };
      });
      setEtag(reply, result.data.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default salesLeadAssignments;
