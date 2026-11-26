// `warranty` module (builder operations section, item 1): warranty tickets against jobs,
// service work orders that fix them, and the staff/homeowner message thread. Homeowners reach
// their tickets through the existing job-status portal link (scope 'job') — the same token,
// resolved through the `portal.warranty` platform operation and scoped to the token's own
// org + job. Nothing here decides coverage: the builder does, and the ticket records it.
import {
  CreateWarrantyMessageRequestSchema,
  CreateWarrantyTicketRequestSchema,
  CreateWarrantyWorkOrderRequestSchema,
  PortalCreateWarrantyTicketRequestSchema,
  PortalTokenRequestSchema,
  PortalWarrantyListSchema,
  PortalWarrantyMessageRequestSchema,
  PortalWarrantyTicketSchema,
  UpdateWarrantyTicketRequestSchema,
  UpdateWarrantyWorkOrderRequestSchema,
  WarrantyMessageSchema,
  WarrantyTicketListSchema,
  WarrantyTicketSchema,
  WarrantyWorkOrderSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { jobs, portalTokens, warrantyMessages, warrantyTickets, warrantyWorkOrders } from '../../db/schema';
import { platformTx, requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { jobStatusTokenHash } from '../portal/jobStatus';

const READ = 'warranty:read';
const WRITE = 'warranty:write';

type TicketRow = typeof warrantyTickets.$inferSelect;
type WorkOrderRow = typeof warrantyWorkOrders.$inferSelect;
type MessageRow = typeof warrantyMessages.$inferSelect;

function ticketDto(row: TicketRow) {
  return {
    id: row.id,
    jobId: row.jobId,
    customerId: row.customerId,
    title: row.title,
    description: row.description,
    status: row.status,
    reportedBy: row.reportedBy,
    coverageNote: row.coverageNote,
    openedAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function workOrderDto(row: WorkOrderRow) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    title: row.title,
    scope: row.scope,
    status: row.status,
    assigneeMembershipId: row.assigneeMembershipId,
    scheduledOn: row.scheduledOn,
    completedAt: row.completedAt?.toISOString() ?? null,
    costMinor: row.costMinor,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function messageDto(row: MessageRow) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorKind: row.authorKind,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

const IdParams = z.object({ id: z.uuid() });

const warrantyModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/warranty/tickets',
    {
      config: { permission: READ },
      schema: {
        tags: ['warranty'],
        summary: 'Warranty tickets for this company, newest first',
        querystring: z.object({
          status: z
            .enum(['new', 'under_review', 'approved', 'denied', 'in_progress', 'completed', 'closed'])
            .optional(),
          jobId: z.uuid().optional(),
        }),
        response: { 200: WarrantyTicketListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(warrantyTickets)
          .where(
            and(
              eq(warrantyTickets.orgId, orgId),
              q.status ? eq(warrantyTickets.status, q.status) : undefined,
              q.jobId ? eq(warrantyTickets.jobId, q.jobId) : undefined,
            ),
          )
          .orderBy(desc(warrantyTickets.createdAt))
          .limit(200),
      );
      return { items: rows.map(ticketDto) };
    },
  );

  app.post(
    '/warranty/tickets',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['warranty'],
        summary: 'Open a warranty ticket against a job',
        body: CreateWarrantyTicketRequestSchema,
        response: { 201: WarrantyTicketSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.orgId, orgId), eq(jobs.id, request.body.jobId)))
          .limit(1);
        if (!job) throw problem('not_found', 'That job does not exist in this company.');
        const [created] = await tx
          .insert(warrantyTickets)
          .values({
            orgId,
            jobId: request.body.jobId,
            title: request.body.title,
            description: request.body.description,
            status: 'new',
            reportedBy: 'staff',
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'warranty.ticket_created',
          resourceType: 'warranty_ticket',
          resourceId: created.id,
          after: { jobId: created.jobId, title: created.title },
        });
        return created;
      });
      reply.code(201);
      return ticketDto(row);
    },
  );

  app.get(
    '/warranty/tickets/:id',
    {
      config: { permission: READ },
      schema: {
        tags: ['warranty'],
        summary: 'One warranty ticket with its work orders and message thread',
        params: IdParams,
        response: {
          200: z.object({
            ticket: WarrantyTicketSchema,
            workOrders: z.array(WarrantyWorkOrderSchema),
            messages: z.array(WarrantyMessageSchema),
          }),
        },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [ticket] = await tx
          .select()
          .from(warrantyTickets)
          .where(and(eq(warrantyTickets.orgId, orgId), eq(warrantyTickets.id, request.params.id)))
          .limit(1);
        if (!ticket) throw problem('not_found');
        const workOrders = await tx
          .select()
          .from(warrantyWorkOrders)
          .where(
            and(eq(warrantyWorkOrders.orgId, orgId), eq(warrantyWorkOrders.ticketId, ticket.id)),
          )
          .orderBy(asc(warrantyWorkOrders.createdAt));
        const messages = await tx
          .select()
          .from(warrantyMessages)
          .where(and(eq(warrantyMessages.orgId, orgId), eq(warrantyMessages.ticketId, ticket.id)))
          .orderBy(asc(warrantyMessages.createdAt), asc(warrantyMessages.id));
        return {
          ticket: ticketDto(ticket),
          workOrders: workOrders.map(workOrderDto),
          messages: messages.map(messageDto),
        };
      });
    },
  );

  app.patch(
    '/warranty/tickets/:id',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['warranty'],
        summary: 'Update a ticket status or coverage note',
        params: IdParams,
        body: UpdateWarrantyTicketRequestSchema,
        response: { 200: WarrantyTicketSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(warrantyTickets)
          .where(and(eq(warrantyTickets.orgId, orgId), eq(warrantyTickets.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        const nextStatus = request.body.status ?? existing.status;
        const [updated] = await tx
          .update(warrantyTickets)
          .set({
            status: nextStatus,
            ...(request.body.coverageNote !== undefined && {
              coverageNote: request.body.coverageNote,
            }),
            closedAt: nextStatus === 'closed' ? (existing.closedAt ?? new Date()) : existing.closedAt,
            revision: existing.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(warrantyTickets.orgId, orgId), eq(warrantyTickets.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'warranty.ticket_updated',
          resourceType: 'warranty_ticket',
          resourceId: updated.id,
          before: { status: existing.status },
          after: { status: updated.status },
        });
        return updated;
      });
      return ticketDto(row);
    },
  );

  app.post(
    '/warranty/tickets/:id/work-orders',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['warranty'],
        summary: 'Open a service work order on a ticket',
        params: IdParams,
        body: CreateWarrantyWorkOrderRequestSchema,
        response: { 201: WarrantyWorkOrderSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [ticket] = await tx
          .select({ id: warrantyTickets.id })
          .from(warrantyTickets)
          .where(and(eq(warrantyTickets.orgId, orgId), eq(warrantyTickets.id, request.params.id)))
          .limit(1);
        if (!ticket) throw problem('not_found');
        const [created] = await tx
          .insert(warrantyWorkOrders)
          .values({
            orgId,
            ticketId: ticket.id,
            title: request.body.title,
            scope: request.body.scope,
            status: 'scheduled',
            assigneeMembershipId: request.body.assigneeMembershipId ?? null,
            scheduledOn: request.body.scheduledOn ?? null,
            costMinor: request.body.costMinor ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'warranty.work_order_created',
          resourceType: 'warranty_work_order',
          resourceId: created.id,
          after: { ticketId: ticket.id, title: created.title },
        });
        return created;
      });
      reply.code(201);
      return workOrderDto(row);
    },
  );

  app.patch(
    '/warranty/work-orders/:id',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['warranty'],
        summary: 'Update a service work order (status, schedule, assignee, cost)',
        params: IdParams,
        body: UpdateWarrantyWorkOrderRequestSchema,
        response: { 200: WarrantyWorkOrderSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(warrantyWorkOrders)
          .where(
            and(eq(warrantyWorkOrders.orgId, orgId), eq(warrantyWorkOrders.id, request.params.id)),
          )
          .limit(1);
        if (!existing) throw problem('not_found');
        const nextStatus = request.body.status ?? existing.status;
        const [updated] = await tx
          .update(warrantyWorkOrders)
          .set({
            status: nextStatus,
            ...(request.body.scheduledOn !== undefined && { scheduledOn: request.body.scheduledOn }),
            ...(request.body.assigneeMembershipId !== undefined && {
              assigneeMembershipId: request.body.assigneeMembershipId,
            }),
            ...(request.body.costMinor !== undefined && { costMinor: request.body.costMinor }),
            completedAt:
              nextStatus === 'completed' ? (existing.completedAt ?? new Date()) : existing.completedAt,
            updatedAt: new Date(),
          })
          .where(and(eq(warrantyWorkOrders.orgId, orgId), eq(warrantyWorkOrders.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'warranty.work_order_updated',
          resourceType: 'warranty_work_order',
          resourceId: updated.id,
          before: { status: existing.status },
          after: { status: updated.status },
        });
        return updated;
      });
      return workOrderDto(row);
    },
  );

  app.post(
    '/warranty/tickets/:id/messages',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['warranty'],
        summary: 'Post a staff message on the ticket thread',
        params: IdParams,
        body: CreateWarrantyMessageRequestSchema,
        response: { 201: WarrantyMessageSchema },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [ticket] = await tx
          .select({ id: warrantyTickets.id })
          .from(warrantyTickets)
          .where(and(eq(warrantyTickets.orgId, orgId), eq(warrantyTickets.id, request.params.id)))
          .limit(1);
        if (!ticket) throw problem('not_found');
        const [created] = await tx
          .insert(warrantyMessages)
          .values({
            orgId,
            ticketId: ticket.id,
            authorKind: 'staff',
            authorUserId: userId,
            body: request.body.body,
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return messageDto(row);
    },
  );

  // ---------------------------------------------------------- homeowner (portal token)

  async function resolvePortalJob(request: Parameters<typeof platformTx>[0], token: string) {
    const hash = jobStatusTokenHash(token);
    return platformTx(request, 'portal.warranty', async (tx) => {
      const now = new Date();
      const [link] = await tx
        .select()
        .from(portalTokens)
        .where(and(eq(portalTokens.tokenHash, hash), eq(portalTokens.scope, 'job')))
        .limit(1);
      if (!link || link.revokedAt || link.expiresAt <= now) return null;
      if (link.maxUses !== null && link.useCount >= link.maxUses) return null;
      await tx
        .update(portalTokens)
        .set({ lastUsedAt: now, useCount: sql`${portalTokens.useCount} + 1` })
        .where(and(eq(portalTokens.orgId, link.orgId), eq(portalTokens.id, link.id)));
      return { orgId: link.orgId, jobId: link.subjectId };
    });
  }

  app.post(
    '/portal/warranty/tickets',
    {
      config: { auth: 'none', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['portal', 'warranty'],
        summary: 'Homeowner: warranty tickets for the job on this link (no account)',
        body: PortalTokenRequestSchema,
        response: { 200: PortalWarrantyListSchema },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store');
      reply.header('x-robots-tag', 'noindex, nofollow');
      const scope = await resolvePortalJob(request, request.body.token);
      if (!scope) throw problem('not_found', 'This job-status link is not valid or has expired.');
      const items = await platformTx(request, 'portal.warranty', async (tx) => {
        const tickets = await tx
          .select()
          .from(warrantyTickets)
          .where(
            and(eq(warrantyTickets.orgId, scope.orgId), eq(warrantyTickets.jobId, scope.jobId)),
          )
          .orderBy(desc(warrantyTickets.createdAt))
          .limit(100);
        const out = [];
        for (const ticket of tickets) {
          const messages = await tx
            .select()
            .from(warrantyMessages)
            .where(
              and(
                eq(warrantyMessages.orgId, scope.orgId),
                eq(warrantyMessages.ticketId, ticket.id),
              ),
            )
            .orderBy(asc(warrantyMessages.createdAt), asc(warrantyMessages.id));
          out.push({
            id: ticket.id,
            title: ticket.title,
            description: ticket.description,
            status: ticket.status,
            coverageNote: ticket.coverageNote,
            openedAt: ticket.createdAt.toISOString(),
            closedAt: ticket.closedAt?.toISOString() ?? null,
            messages: messages.map(messageDto),
          });
        }
        return out;
      });
      return { items };
    },
  );

  app.post(
    '/portal/warranty/tickets/create',
    {
      config: { auth: 'none', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['portal', 'warranty'],
        summary: 'Homeowner: file a warranty ticket for the job on this link',
        body: PortalCreateWarrantyTicketRequestSchema,
        response: { 201: PortalWarrantyTicketSchema },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store');
      const scope = await resolvePortalJob(request, request.body.token);
      if (!scope) throw problem('not_found', 'This job-status link is not valid or has expired.');
      const ticket = await platformTx(request, 'portal.warranty', async (tx) => {
        const [created] = await tx
          .insert(warrantyTickets)
          .values({
            orgId: scope.orgId,
            jobId: scope.jobId,
            title: request.body.title,
            description: request.body.description,
            status: 'new',
            reportedBy: 'homeowner',
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return {
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        coverageNote: ticket.coverageNote,
        openedAt: ticket.createdAt.toISOString(),
        closedAt: ticket.closedAt?.toISOString() ?? null,
        messages: [],
      };
    },
  );

  app.post(
    '/portal/warranty/tickets/:id/messages',
    {
      config: { auth: 'none', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['portal', 'warranty'],
        summary: 'Homeowner: reply on one of their tickets',
        params: IdParams,
        body: PortalWarrantyMessageRequestSchema,
        response: { 201: WarrantyMessageSchema },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store');
      const scope = await resolvePortalJob(request, request.body.token);
      if (!scope) throw problem('not_found', 'This job-status link is not valid or has expired.');
      const message = await platformTx(request, 'portal.warranty', async (tx) => {
        const [ticket] = await tx
          .select({ id: warrantyTickets.id })
          .from(warrantyTickets)
          .where(
            and(
              eq(warrantyTickets.orgId, scope.orgId),
              eq(warrantyTickets.jobId, scope.jobId),
              eq(warrantyTickets.id, request.params.id),
            ),
          )
          .limit(1);
        if (!ticket) throw problem('not_found');
        const [created] = await tx
          .insert(warrantyMessages)
          .values({
            orgId: scope.orgId,
            ticketId: ticket.id,
            authorKind: 'homeowner',
            body: request.body.body,
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return messageDto(message);
    },
  );
};

export default warrantyModule;
