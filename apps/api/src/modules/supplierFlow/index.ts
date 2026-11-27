// `supplierFlow` module (builder operations section, item 7): purchase orders that flow
// between two Field Pro companies over an existing network connection. Each company owns its
// mirrored row; the `network.order` platform operation verifies an active connection on BOTH
// sides before writing the mirror (the same pattern as network bills). Sending also drops an
// in-app notification in the supplier's account immediately, and an email goes out through
// the outbox when a mail path is connected — otherwise the order honestly records
// emailState 'not_connected'. This only works when BOTH companies are on Field Pro and
// connected; the UI says so plainly. SKU mapping translates builder package names into
// supplier SKUs (builder-entered). Dispatch is a lite ordered-stop route plan.
import { randomUUID } from 'node:crypto';
import {
  CreateDispatchRouteRequestSchema,
  CreateSkuMappingRequestSchema,
  CreateSupplierFieldReportRequestSchema,
  DecideNetworkOrderRequestSchema,
  DispatchRouteListSchema,
  DispatchRouteSchema,
  NetworkOrderListSchema,
  NetworkOrderSchema,
  SendNetworkOrderRequestSchema,
  SkuMappingListSchema,
  SkuMappingSchema,
  SupplierFieldReportListSchema,
  SupplierFieldReportSchema,
  UpdateDispatchRouteRequestSchema,
  type NetworkOrderHistoryEntry,
  type NetworkOrderLine,
  type NetworkOrderStatus,
} from '@fieldline/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  dispatchRoutes,
  networkOrders,
  organizations,
  skuMappings,
  supplierFieldReports,
} from '../../db/schema';
import { platformTx, requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import {
  EMAIL_NOT_CONNECTED_NOTE,
  emailConfigured,
  notifyPartnerAdmins,
  verifyActiveConnection,
} from '../../services/networkNotify';

const READ = 'network_order:read';
const WRITE = 'network_order:write';

const IdParams = z.object({ id: z.uuid() });

type OrderRow = typeof networkOrders.$inferSelect;

function orderDto(row: OrderRow) {
  return {
    id: row.id,
    orderKey: row.orderKey,
    side: row.side,
    partnerOrgId: row.partnerOrgId,
    partnerDisplayName: row.partnerDisplayName,
    reference: row.reference,
    status: row.status,
    lines: (row.lines as NetworkOrderLine[] | null) ?? [],
    totalMinor: row.totalMinor,
    currency: row.currency,
    requestedDeliveryOn: row.requestedDeliveryOn,
    deliveryAddress: row.deliveryAddress,
    note: row.note,
    history: (row.history as NetworkOrderHistoryEntry[] | null) ?? [],
    sentAt: row.sentAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    emailState: row.emailState,
    emailSentAt: row.emailSentAt?.toISOString() ?? null,
    emailNote: row.emailNote,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Order total in minor units, or null when any line is unpriced (never invented). */
export function orderTotal(lines: NetworkOrderLine[]): number | null {
  if (!lines.every((l) => l.unitPriceMinor !== null && l.unitPriceMinor !== undefined)) return null;
  return lines.reduce((s, l) => s + Math.round(l.quantity * (l.unitPriceMinor ?? 0)), 0);
}

export const ORDER_TRANSITIONS: Record<
  string,
  { to: NetworkOrderStatus; from: NetworkOrderStatus[]; bySide: 'buyer' | 'supplier' }
> = {
  accept: { to: 'accepted', from: ['sent'], bySide: 'supplier' },
  decline: { to: 'declined', from: ['sent'], bySide: 'supplier' },
  start_production: { to: 'in_production', from: ['accepted'], bySide: 'supplier' },
  ship: { to: 'shipped', from: ['in_production'], bySide: 'supplier' },
  deliver: { to: 'delivered', from: ['shipped'], bySide: 'supplier' },
  cancel: { to: 'cancelled', from: ['sent', 'accepted'], bySide: 'buyer' },
};

const supplierFlowModule: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------- network orders

  app.get(
    '/supplier-flow/orders',
    {
      config: { permission: READ },
      schema: {
        tags: ['supplier-flow'],
        summary: 'Purchase orders between this company and connected companies, newest first',
        querystring: z.object({
          side: z.enum(['buyer', 'supplier']).optional(),
          status: z
            .enum(['sent', 'accepted', 'declined', 'in_production', 'shipped', 'delivered', 'cancelled'])
            .optional(),
          /** Delta sync: only rows changed since this ISO timestamp. */
          updatedSince: z.string().datetime().optional(),
        }),
        response: { 200: NetworkOrderListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const since = q.updatedSince ? new Date(q.updatedSince) : null;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(networkOrders)
          .where(
            and(
              eq(networkOrders.orgId, orgId),
              q.side ? eq(networkOrders.side, q.side) : undefined,
              q.status ? eq(networkOrders.status, q.status) : undefined,
              since ? sql`${networkOrders.updatedAt} > ${since}` : undefined,
            ),
          )
          .orderBy(desc(networkOrders.createdAt))
          .limit(200),
      );
      return {
        items: rows.map(orderDto),
        deletedIds: [],
        serverTime: new Date().toISOString(),
      };
    },
  );

  app.post(
    '/supplier-flow/orders',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['supplier-flow'],
        summary: 'Send a purchase order to a connected supplier company',
        body: SendNetworkOrderRequestSchema,
        response: { 201: NetworkOrderSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const partnerOrgId = request.body.partnerOrgId;
      if (partnerOrgId === org.orgId) {
        throw problem('validation_failed', 'You cannot send an order to your own company.');
      }
      const orderKey = randomUUID();
      const lines = request.body.lines;
      const totalMinor = orderTotal(lines);
      const emailReady = emailConfigured(request.server.config);
      const now = new Date();
      const history: NetworkOrderHistoryEntry[] = [
        { status: 'sent', at: now.toISOString(), bySide: 'buyer', note: request.body.note ?? null },
      ];

      const buyerRow = await platformTx(request, 'network.order', async (tx) => {
        await verifyActiveConnection(tx, org.orgId, partnerOrgId);
        const [me] = await tx
          .select({ displayName: organizations.displayName })
          .from(organizations)
          .where(eq(organizations.id, org.orgId))
          .limit(1);
        const [partner] = await tx
          .select({ displayName: organizations.displayName })
          .from(organizations)
          .where(eq(organizations.id, partnerOrgId))
          .limit(1);
        if (!me || !partner) throw problem('not_found');
        const shared = {
          orderKey,
          partnerDisplayName: partner.displayName,
          reference: request.body.reference,
          status: 'sent' as const,
          lines,
          totalMinor,
          requestedDeliveryOn: request.body.requestedDeliveryOn ?? null,
          deliveryAddress: request.body.deliveryAddress ?? null,
          note: request.body.note ?? null,
          history,
          sentAt: now,
          emailState: emailReady ? ('queued' as const) : ('not_connected' as const),
          emailNote: emailReady ? null : EMAIL_NOT_CONNECTED_NOTE,
        };
        const [buyer] = await tx
          .insert(networkOrders)
          .values({ ...shared, orgId: org.orgId, side: 'buyer', partnerOrgId })
          .returning();
        if (!buyer) throw problem('internal');
        await tx.insert(networkOrders).values({
          ...shared,
          orgId: partnerOrgId,
          side: 'supplier',
          partnerOrgId: org.orgId,
          partnerDisplayName: me.displayName,
        });
        await notifyPartnerAdmins(tx, {
          partnerOrgId,
          category: 'work_assigned',
          title: `New purchase order ${request.body.reference} from ${me.displayName}`,
          body: request.body.note ?? null,
          link: '/network-orders',
          subjectType: 'assignment',
          subjectId: buyer.id,
          dedupeKey: `order:${orderKey}`,
        });
        return buyer;
      });

      if (emailReady) {
        await tenantTx(request, async (tx) => {
          await enqueue(tx, {
            orgId: org.orgId,
            task: 'order.email',
            aggregateType: 'network_order',
            aggregateId: buyerRow.id,
            payload: { orderKey, senderUserId: org.userId },
            jobKey: `order-email:${orderKey}`,
          });
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'network_order.sent',
            resourceType: 'network_order',
            resourceId: buyerRow.id,
            after: { partnerOrgId, reference: request.body.reference },
          });
        });
      } else {
        await tenantTx(request, (tx) =>
          auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'network_order.sent',
            resourceType: 'network_order',
            resourceId: buyerRow.id,
            after: { partnerOrgId, reference: request.body.reference, emailState: 'not_connected' },
          }),
        );
      }

      reply.code(201);
      return orderDto(buyerRow);
    },
  );

  app.get(
    '/supplier-flow/orders/:id',
    {
      config: { permission: READ },
      schema: {
        tags: ['supplier-flow'],
        summary: 'One purchase order with its full status history',
        params: IdParams,
        response: { 200: NetworkOrderSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [found] = await tx
          .select()
          .from(networkOrders)
          .where(and(eq(networkOrders.orgId, orgId), eq(networkOrders.id, request.params.id)))
          .limit(1);
        return found ?? null;
      });
      if (!row) throw problem('not_found');
      return orderDto(row);
    },
  );

  app.post(
    '/supplier-flow/orders/:id/decide',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['supplier-flow'],
        summary: 'Accept, decline, produce, ship, deliver, or cancel an order',
        params: IdParams,
        body: DecideNetworkOrderRequestSchema,
        response: { 200: NetworkOrderSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const transition = ORDER_TRANSITIONS[request.body.decision];
      if (!transition) throw problem('validation_failed', 'Unknown decision.');
      const mine = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(networkOrders)
          .where(and(eq(networkOrders.orgId, org.orgId), eq(networkOrders.id, request.params.id)))
          .limit(1);
        return row ?? null;
      });
      if (!mine) throw problem('not_found');
      if (mine.side !== transition.bySide) {
        throw problem(
          'conflict',
          transition.bySide === 'supplier'
            ? 'Only the supplier company can do that on this order.'
            : 'Only the buyer company can do that on this order.',
        );
      }
      if (!transition.from.includes(mine.status)) {
        throw problem('conflict', `A ${mine.status} order cannot move to ${transition.to}.`);
      }
      const now = new Date();
      const history: NetworkOrderHistoryEntry[] = [
        ...((mine.history as NetworkOrderHistoryEntry[] | null) ?? []),
        {
          status: transition.to,
          at: now.toISOString(),
          bySide: mine.side,
          note: request.body.note ?? null,
        },
      ];
      const updated = await platformTx(request, 'network.order', async (tx) => {
        await verifyActiveConnection(tx, org.orgId, mine.partnerOrgId);
        const [row] = await tx
          .update(networkOrders)
          .set({
            status: transition.to,
            history,
            respondedAt: mine.side === 'supplier' ? (mine.respondedAt ?? now) : mine.respondedAt,
            revision: mine.revision + 1,
            updatedAt: now,
          })
          .where(eq(networkOrders.orderKey, mine.orderKey))
          .returning();
        const [mineNow] = await tx
          .select()
          .from(networkOrders)
          .where(and(eq(networkOrders.orgId, org.orgId), eq(networkOrders.id, mine.id)))
          .limit(1);
        await notifyPartnerAdmins(tx, {
          partnerOrgId: mine.partnerOrgId,
          category: 'work_assigned',
          title: `Purchase order ${mine.reference} is now ${transition.to}`,
          body: request.body.note ?? null,
          link: '/network-orders',
          subjectType: 'assignment',
          subjectId: mine.id,
          dedupeKey: `order:${mine.orderKey}:${transition.to}`,
        });
        return mineNow ?? row;
      });
      if (!updated) throw problem('internal');
      await tenantTx(request, (tx) =>
        auditRequest(request, tx, {
          orgId: org.orgId,
          action: `network_order.${request.body.decision}`,
          resourceType: 'network_order',
          resourceId: updated.id,
          before: { status: mine.status },
          after: { status: updated.status },
        }),
      );
      return orderDto(updated);
    },
  );

  app.post(
    '/supplier-flow/orders/:id/resend-email',
    {
      config: { permission: WRITE, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['supplier-flow'],
        summary: 'Re-send the order email (only queues when email is connected)',
        params: IdParams,
        response: { 200: NetworkOrderSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const mine = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(networkOrders)
          .where(and(eq(networkOrders.orgId, org.orgId), eq(networkOrders.id, request.params.id)))
          .limit(1);
        return row ?? null;
      });
      if (!mine) throw problem('not_found');
      if (mine.side !== 'buyer') {
        throw problem('conflict', 'Only the buyer company can re-send the order email.');
      }
      if (!emailConfigured(request.server.config)) {
        throw problem(
          'dependency_unavailable',
          'Email is not connected yet (the mailer/SMTP setup is outstanding), so the email cannot go out. The in-app notification was already delivered.',
          { retryable: true },
        );
      }
      await tenantTx(request, async (tx) => {
        await tx
          .update(networkOrders)
          .set({ emailState: 'queued', emailNote: null, updatedAt: new Date() })
          .where(and(eq(networkOrders.orgId, org.orgId), eq(networkOrders.id, mine.id)));
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'order.email',
          aggregateType: 'network_order',
          aggregateId: mine.id,
          payload: { orderKey: mine.orderKey, senderUserId: org.userId },
          jobKey: `order-email:${mine.orderKey}:resend:${Date.now()}`,
        });
      });
      const refreshed = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(networkOrders)
          .where(and(eq(networkOrders.orgId, org.orgId), eq(networkOrders.id, mine.id)))
          .limit(1);
        return row ?? mine;
      });
      return orderDto(refreshed);
    },
  );

  // ---------------------------------------------------------- SKU mappings

  app.get(
    '/supplier-flow/sku-mappings',
    {
      config: { permission: READ },
      schema: {
        tags: ['supplier-flow'],
        summary: 'Builder package name → supplier SKU translations',
        response: { 200: SkuMappingListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(skuMappings)
          .where(eq(skuMappings.orgId, orgId))
          .orderBy(asc(skuMappings.packageName))
          .limit(500),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          partnerOrgId: r.partnerOrgId,
          packageName: r.packageName,
          supplierSku: r.supplierSku,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/supplier-flow/sku-mappings',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['supplier-flow'],
        summary: 'Map a builder package name to a supplier SKU',
        body: CreateSkuMappingRequestSchema,
        response: { 201: SkuMappingSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(skuMappings)
          .values({
            orgId,
            packageName: request.body.packageName,
            supplierSku: request.body.supplierSku,
            partnerOrgId: request.body.partnerOrgId ?? null,
            note: request.body.note ?? null,
          })
          .onConflictDoUpdate({
            target: [skuMappings.orgId, skuMappings.packageName],
            set: {
              supplierSku: request.body.supplierSku,
              partnerOrgId: request.body.partnerOrgId ?? null,
              note: request.body.note ?? null,
              updatedAt: new Date(),
            },
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return {
        id: row.id,
        partnerOrgId: row.partnerOrgId,
        packageName: row.packageName,
        supplierSku: row.supplierSku,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );

  // ---------------------------------------------------------- dispatch (lite)

  app.get(
    '/supplier-flow/dispatch-routes',
    {
      config: { permission: READ },
      schema: {
        tags: ['supplier-flow'],
        summary: 'Dispatch routes (ordered stops on a date), newest first',
        response: { 200: DispatchRouteListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(dispatchRoutes)
          .where(eq(dispatchRoutes.orgId, orgId))
          .orderBy(desc(dispatchRoutes.routeDate))
          .limit(100),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          routeDate: r.routeDate,
          driverName: r.driverName,
          status: r.status,
          stops: (r.stops as { orderId: string | null; address: string; note?: string | null }[] | null) ?? [],
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/supplier-flow/dispatch-routes',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['supplier-flow'],
        summary: 'Plan a dispatch route with ordered stops',
        body: CreateDispatchRouteRequestSchema,
        response: { 201: DispatchRouteSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(dispatchRoutes)
          .values({
            orgId,
            routeDate: request.body.routeDate,
            driverName: request.body.driverName ?? null,
            status: 'planned',
            stops: request.body.stops.map((s) => ({
              orderId: s.orderId ?? null,
              address: s.address,
              note: s.note ?? null,
            })),
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return {
        id: row.id,
        routeDate: row.routeDate,
        driverName: row.driverName,
        status: row.status,
        stops: (row.stops as { orderId: string | null; address: string; note?: string | null }[] | null) ?? [],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );

  app.patch(
    '/supplier-flow/dispatch-routes/:id',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['supplier-flow'],
        summary: 'Move a dispatch route through planned → dispatched → completed',
        params: IdParams,
        body: UpdateDispatchRouteRequestSchema,
        response: { 200: DispatchRouteSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [updated] = await tx
          .update(dispatchRoutes)
          .set({ status: request.body.status, updatedAt: new Date() })
          .where(and(eq(dispatchRoutes.orgId, orgId), eq(dispatchRoutes.id, request.params.id)))
          .returning();
        if (!updated) throw problem('not_found');
        return updated;
      });
      return {
        id: row.id,
        routeDate: row.routeDate,
        driverName: row.driverName,
        status: row.status,
        stops: (row.stops as { orderId: string | null; address: string; note?: string | null }[] | null) ?? [],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );

  // ---------------------------------------------------------- field reports

  app.get(
    '/supplier-flow/field-reports',
    {
      config: { permission: READ },
      schema: {
        tags: ['supplier-flow'],
        summary: 'Supplier field reports (delivery, site condition, damage), newest first',
        response: { 200: SupplierFieldReportListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(supplierFieldReports)
          .where(eq(supplierFieldReports.orgId, orgId))
          .orderBy(desc(supplierFieldReports.createdAt))
          .limit(200),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          orderId: r.orderId,
          reportKind: r.reportKind,
          note: r.note,
          photoMediaIds: r.photoMediaIds ?? [],
          createdByUserId: r.createdByUserId,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/supplier-flow/field-reports',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['supplier-flow'],
        summary: 'File a supplier field report (photos reference media already uploaded)',
        body: CreateSupplierFieldReportRequestSchema,
        response: { 201: SupplierFieldReportSchema },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(supplierFieldReports)
          .values({
            orgId,
            orderId: request.body.orderId ?? null,
            reportKind: request.body.reportKind,
            note: request.body.note,
            photoMediaIds: request.body.photoMediaIds,
            createdByUserId: userId,
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return {
        id: row.id,
        orderId: row.orderId,
        reportKind: row.reportKind,
        note: row.note,
        photoMediaIds: row.photoMediaIds ?? [],
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt.toISOString(),
      };
    },
  );
};

export default supplierFlowModule;
