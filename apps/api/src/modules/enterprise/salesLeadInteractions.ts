import { createHash } from 'node:crypto';
import {
  LogEnterpriseSalesInteraction,
  SalesInteractionReceipt,
  SalesInteractionView,
} from '@fieldline/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  salesLeadConversations as conversations,
  salesLeadFollowUps as followUps,
  salesLeadInteractions as interactions,
} from '../../db/schema/enterpriseSalesInteractions';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import { salesFollowUpPolicy } from './salesFollowUpPolicy';
import { leadScope } from './salesLeads';

const path = '/enterprise/sales/leads/:leadId/interactions';
const config = { permission: 'enterprise_sales:intake' } as const;
const params = z.object({ leadId: z.uuid() });
const tags = ['enterprise'];
const cache = 'private, no-store';
type Row = typeof interactions.$inferSelect;
type FollowUp = typeof followUps.$inferSelect;
type Conversation = { id: string; title: string };
type Scope = { orgId: string; leadId: string };

function interactionScope({ orgId, leadId }: Scope) {
  return and(eq(interactions.orgId, orgId), eq(interactions.leadId, leadId));
}

function records(tx: Tx) {
  return tx
    .select({
      row: interactions,
      linkedConversation: { id: conversations.id, title: conversations.title },
      followUp: followUps,
    })
    .from(interactions)
    .leftJoin(
      conversations,
      and(
        eq(conversations.orgId, interactions.orgId),
        eq(conversations.leadId, interactions.leadId),
        eq(conversations.id, interactions.conversationId),
      ),
    )
    .leftJoin(
      followUps,
      and(
        eq(followUps.orgId, interactions.orgId),
        eq(followUps.leadId, interactions.leadId),
        eq(followUps.interactionId, interactions.id),
      ),
    );
}

function dto({
  row,
  linkedConversation,
  followUp,
}: {
  row: Row;
  linkedConversation: Conversation | null;
  followUp: FollowUp | null;
}) {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    channel: row.channel,
    outcome: row.outcome,
    notes: row.notes,
    linkedConversation,
    followUp: followUp
      ? {
          id: followUp.id,
          dueAt: followUp.dueAt.toISOString(),
          reminderScheduled: followUp.reminderScheduled,
        }
      : null,
  };
}

const salesLeadInteractions: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config,
      schema: {
        tags,
        params,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: { 200: SalesInteractionView },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const scope = { orgId: actor.orgId, leadId: request.params.leadId };
      const { cursor, limit } = request.query;
      const view = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, scope.orgId);
        const [lead] = await tx
          .select()
          .from(leads)
          .where(and(leadScope(actor), eq(leads.id, scope.leadId)));
        if (!lead) throw problem('not_found');
        const [rows, threads] = await Promise.all([
          records(tx)
            .where(
              and(
                interactionScope(scope),
                beforeCursor(interactions.occurredAt, interactions.id, decodeCursor(cursor)),
              ),
            )
            .orderBy(desc(msTrunc(interactions.occurredAt)), desc(interactions.id))
            .limit(limit + 1),
          tx
            .select({ id: conversations.id, title: conversations.title })
            .from(conversations)
            .where(
              and(eq(conversations.orgId, scope.orgId), eq(conversations.leadId, scope.leadId)),
            )
            .orderBy(asc(conversations.title), asc(conversations.id)),
        ]);
        return {
          leadId: lead.id,
          name: lead.name,
          revision: lead.revision,
          conversations: threads,
          ...pageResult(rows, limit, ({ row }) => ({ at: row.occurredAt, id: row.id }), dto),
        };
      });
      setEtag(reply, view.revision);
      return reply.header('cache-control', cache).send(view);
    },
  );

  app.post(
    path,
    {
      config: { ...config, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags,
        params,
        body: LogEnterpriseSalesInteraction,
        response: { 200: SalesInteractionReceipt, 201: SalesInteractionReceipt },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const scope = { orgId: actor.orgId, leadId: request.params.leadId };
      const expected = parseIfMatch(request);
      const {
        channel,
        occurredAt,
        outcome,
        notes,
        nextAt,
        conversationId,
        newConversationTitle,
        clientRequestId,
      } = request.body;
      const requestHash = createHash('sha256')
        .update(JSON.stringify([request.body, expected]))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, scope.orgId);
        const scopedLead = and(leadScope(actor), eq(leads.id, scope.leadId));
        const [lead] = await tx.select().from(leads).where(scopedLead).for('update');
        if (!lead) throw problem('not_found');
        const [receipt] = await records(tx).where(
          and(interactionScope(scope), eq(interactions.clientRequestId, clientRequestId)),
        );
        if (receipt) {
          if (
            receipt.row.recordedByUserId !== actor.userId ||
            receipt.row.requestHash !== requestHash
          )
            throw problem('conflict', 'This request already saved a different interaction.');
          return { created: false, revision: receipt.row.leadRevision, interaction: dto(receipt) };
        }
        assertRevision(lead.revision, expected);
        let linkedConversation: Conversation | null = null;
        if (conversationId) {
          const [thread] = await tx
            .select({ id: conversations.id, title: conversations.title })
            .from(conversations)
            .where(
              and(
                eq(conversations.orgId, scope.orgId),
                eq(conversations.leadId, scope.leadId),
                eq(conversations.id, conversationId),
              ),
            );
          if (!thread) throw problem('not_found', 'Choose a conversation on this lead.');
          linkedConversation = thread;
        } else if (newConversationTitle) {
          const [thread] = await tx
            .insert(conversations)
            .values({
              ...scope,
              title: newConversationTitle,
              openedByUserId: actor.userId,
            })
            .returning({ id: conversations.id, title: conversations.title });
          if (!thread) throw problem('internal');
          linkedConversation = thread;
        }
        const revision = expected + 1;
        const [row] = await tx
          .insert(interactions)
          .values({
            ...scope,
            channel,
            occurredAt: new Date(occurredAt),
            outcome,
            notes,
            conversationId: linkedConversation?.id,
            leadRevision: revision,
            clientRequestId,
            requestHash,
            recordedByUserId: actor.userId,
          })
          .returning();
        if (!row) throw problem('internal');
        let followUp: FollowUp | null = null;
        if (nextAt) {
          const policy = await salesFollowUpPolicy(tx, scope.orgId);
          const [task] = await tx
            .insert(followUps)
            .values({
              ...scope,
              interactionId: row.id,
              dueAt: new Date(nextAt),
              reminderScheduled: policy.enabled,
            })
            .returning();
          if (!task) throw problem('internal');
          followUp = task;
          if (policy.enabled)
            await enqueue(tx, {
              orgId: scope.orgId,
              task: 'sales.follow_up_due',
              aggregateType: 'enterprise_sales_follow_up',
              aggregateId: task.id,
              payload: {
                leadId: scope.leadId,
                followUpId: task.id,
                policyRevision: policy.revision,
              },
              correlationId: request.id,
              jobKey: 'sales.follow_up_due:' + task.id,
              runAt: task.dueAt,
            });
        }
        await tx.update(leads).set({ revision }).where(scopedLead);
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          action: 'sales.interaction_logged',
          resourceType: 'enterprise_sales_lead_interaction',
          resourceId: row.id,
          after: {
            leadId: scope.leadId,
            channel,
            outcome,
            occurredAt,
            conversationId: linkedConversation?.id ?? null,
            followUpId: followUp?.id ?? null,
            revision,
          },
        });
        return { created: true, revision, interaction: dto({ row, linkedConversation, followUp }) };
      });
      setEtag(reply, result.revision);
      return reply
        .header('cache-control', cache)
        .code(result.created ? 201 : 200)
        .send({
          revision: result.revision,
          interaction: result.interaction,
        });
    },
  );
};

export default salesLeadInteractions;
