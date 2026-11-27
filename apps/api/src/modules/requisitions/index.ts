// `requisitions` module (blueprint gap 7): purchase requisitions with a
// submit/approve flow that convert into ONE draft supplier order (idempotent:
// converting an already-converted requisition returns the existing order),
// plus backorder tracking on PO lines (ordered − received, with entered
// expected dates and an aging view). Receipts come from the three-way-match
// receiving tables.
import {
  BackorderAgingResponseSchema,
  ConvertRequisitionRequestSchema,
  CreateRequisitionRequestSchema,
  RequisitionSchema,
  SetBackorderRequestSchema,
  UpdateRequisitionRequestSchema,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  jobs,
  poLineBackorders,
  poReceiptLines,
  poReceipts,
  purchaseRequisitions,
  supplierOrders,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import {
  backorderAgeDays,
  canTransitionRequisition,
  computeBackorders,
  requisitionTotalMinor,
  type RequisitionItem,
} from './logic';

const READ = 'requisition:read';
const WRITE = 'requisition:write';
const APPROVE = 'requisition:approve';

const UUID = z.uuid();
const ReqParams = z.object({ requisitionId: UUID });
const ListQuery = z.object({
  jobId: UUID.optional(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'converted']).optional(),
});

const ItemJson = z.object({
  label: z.string().default(''),
  quantity: z.number().default(0),
  unit: z.string().default('each'),
  unitPriceMinor: z.number().int().nullable().default(null),
});
const PoLineJson = ItemJson;

type ReqRow = typeof purchaseRequisitions.$inferSelect;

function parseItems(raw: unknown): RequisitionItem[] {
  const parsed = z.array(ItemJson).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

async function requisitionDto(tx: Tx, orgId: string, req: ReqRow) {
  const [job] = await tx
    .select({ number: jobs.number, title: jobs.title })
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, req.jobId)));
  const items = parseItems(req.items);
  return {
    id: req.id,
    jobId: req.jobId,
    jobNumber: job?.number ?? '',
    jobTitle: job?.title ?? '',
    costCode: req.costCode,
    supplierName: req.supplierName,
    items,
    totalMinor: requisitionTotalMinor(items),
    neededBy: req.neededBy,
    requesterUserId: req.requesterUserId,
    status: req.status,
    convertedOrderId: req.convertedOrderId,
    decidedAt: req.decidedAt?.toISOString() ?? null,
    note: req.note,
    revision: req.revision,
    createdAt: req.createdAt.toISOString(),
  };
}

async function loadRequisition(tx: Tx, orgId: string, id: string, lock = false) {
  const base = tx
    .select()
    .from(purchaseRequisitions)
    .where(and(eq(purchaseRequisitions.orgId, orgId), eq(purchaseRequisitions.id, id)));
  const [req] = lock ? await base.for('update') : await base;
  if (!req) throw problem('not_found');
  return req;
}

async function receivedByLine(tx: Tx, orgId: string, orderId: string) {
  const receipts = await tx
    .select({ id: poReceipts.id })
    .from(poReceipts)
    .where(and(eq(poReceipts.orgId, orgId), eq(poReceipts.supplierOrderId, orderId)));
  const received = new Map<number, number>();
  for (const r of receipts) {
    const lines = await tx
      .select()
      .from(poReceiptLines)
      .where(and(eq(poReceiptLines.orgId, orgId), eq(poReceiptLines.receiptId, r.id)));
    for (const l of lines) {
      received.set(l.lineIndex, (received.get(l.lineIndex) ?? 0) + Number(l.qtyReceived));
    }
  }
  return received;
}

const requisitionsModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/requisitions',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['requisitions'],
        body: CreateRequisitionRequestSchema,
        summary: 'Create a draft purchase requisition (job, cost code, items, needed-by).',
        response: { 201: RequisitionSchema },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const created = await tenantTx(request, async (tx) => {
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.orgId, orgId), eq(jobs.id, request.body.jobId)));
        if (!job) throw problem('not_found');
        const [row] = await tx
          .insert(purchaseRequisitions)
          .values({
            orgId,
            jobId: request.body.jobId,
            costCode: request.body.costCode ?? null,
            supplierName: request.body.supplierName ?? null,
            items: request.body.items.map((i) => ({
              label: i.label,
              quantity: i.quantity,
              unit: i.unit,
              unitPriceMinor: i.unitPriceMinor ?? null,
            })),
            neededBy: request.body.neededBy ?? null,
            requesterUserId: userId,
            note: request.body.note ?? null,
          })
          .returning();
        if (!row) throw problem('internal');
        return row;
      });
      const dto = await tenantTx(request, (tx) => requisitionDto(tx, orgId, created));
      return reply.code(201).send(dto);
    },
  );

  app.get(
    '/requisitions',
    {
      config: { permission: READ },
      schema: {
        tags: ['requisitions'],
        querystring: ListQuery,
        summary: 'Purchase requisitions, newest first.',
        response: { 200: z.object({ items: z.array(RequisitionSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const conditions = [eq(purchaseRequisitions.orgId, orgId)];
        if (request.query.jobId) conditions.push(eq(purchaseRequisitions.jobId, request.query.jobId));
        if (request.query.status) conditions.push(eq(purchaseRequisitions.status, request.query.status));
        const rows = await tx
          .select()
          .from(purchaseRequisitions)
          .where(and(...conditions))
          .orderBy(desc(purchaseRequisitions.createdAt))
          .limit(200);
        const items = [];
        for (const r of rows) items.push(await requisitionDto(tx, orgId, r));
        return { items };
      });
    },
  );

  app.patch(
    '/requisitions/:requisitionId',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['requisitions'],
        params: ReqParams,
        body: UpdateRequisitionRequestSchema,
        summary: 'Edit a draft (or rejected) requisition.',
        response: { 200: RequisitionSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const updated = await tenantTx(request, async (tx) => {
        const req = await loadRequisition(tx, orgId, request.params.requisitionId, true);
        if (!['draft', 'rejected'].includes(req.status)) {
          throw problem('conflict', 'Only draft or rejected requisitions can be edited.');
        }
        const b = request.body;
        const [row] = await tx
          .update(purchaseRequisitions)
          .set({
            ...(b.costCode !== undefined && { costCode: b.costCode }),
            ...(b.supplierName !== undefined && { supplierName: b.supplierName }),
            ...(b.items !== undefined && {
              items: b.items.map((i) => ({
                label: i.label,
                quantity: i.quantity,
                unit: i.unit,
                unitPriceMinor: i.unitPriceMinor ?? null,
              })),
            }),
            ...(b.neededBy !== undefined && { neededBy: b.neededBy }),
            ...(b.note !== undefined && { note: b.note }),
            status: 'draft',
            decidedAt: null,
            decidedByUserId: null,
            revision: req.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(purchaseRequisitions.orgId, orgId), eq(purchaseRequisitions.id, req.id)))
          .returning();
        if (!row) throw problem('internal');
        return row;
      });
      return tenantTx(request, (tx) => requisitionDto(tx, orgId, updated));
    },
  );

  const transition = (
    path: string,
    permission: 'requisition:write' | 'requisition:approve',
    to: 'submitted' | 'approved' | 'rejected',
    action: string,
  ) =>
    app.post(
      path,
      {
        config: { permission, rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
          tags: ['requisitions'],
          params: ReqParams,
          summary: `Requisition transition: ${action}.`,
          response: { 200: RequisitionSchema },
        },
      },
      async (request) => {
        const { orgId, userId } = requireOrg(request);
        const updated = await tenantTx(request, async (tx) => {
          const req = await loadRequisition(tx, orgId, request.params.requisitionId, true);
          if (!canTransitionRequisition(req.status, to)) {
            throw problem('conflict', `A requisition in status '${req.status}' cannot become '${to}'.`);
          }
          const [row] = await tx
            .update(purchaseRequisitions)
            .set({
              status: to,
              ...(to !== 'submitted' && { decidedByUserId: userId, decidedAt: new Date() }),
              revision: req.revision + 1,
              updatedAt: new Date(),
            })
            .where(and(eq(purchaseRequisitions.orgId, orgId), eq(purchaseRequisitions.id, req.id)))
            .returning();
          if (!row) throw problem('internal');
          await auditRequest(request, tx, {
            orgId,
            action: `requisition.${action}`,
            resourceType: 'purchase_requisition',
            resourceId: row.id,
            before: { status: req.status },
            after: { status: to },
          });
          return row;
        });
        return tenantTx(request, (tx) => requisitionDto(tx, orgId, updated));
      },
    );

  transition('/requisitions/:requisitionId/submit', WRITE, 'submitted', 'submitted');
  transition('/requisitions/:requisitionId/approve', APPROVE, 'approved', 'approved');
  transition('/requisitions/:requisitionId/reject', APPROVE, 'rejected', 'rejected');

  app.post(
    '/requisitions/:requisitionId/convert',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['requisitions'],
        params: ReqParams,
        body: ConvertRequisitionRequestSchema,
        summary:
          'Convert an approved requisition into a draft supplier order. Idempotent: converting again returns the same order — never two POs.',
        response: { 200: RequisitionSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const converted = await tenantTx(request, async (tx) => {
        const req = await loadRequisition(tx, orgId, request.params.requisitionId, true);
        // Idempotent: an already-converted requisition returns its existing order.
        if (req.status === 'converted' && req.convertedOrderId) return req;
        if (req.status !== 'approved') {
          throw problem('conflict', 'Only an approved requisition can be converted to a purchase order.');
        }
        const supplierName = request.body.supplierName ?? req.supplierName;
        if (!supplierName) {
          throw problem('validation_failed', 'Enter the supplier name to create the draft purchase order.');
        }
        const items = parseItems(req.items);
        if (items.length === 0) {
          throw problem('validation_failed', 'This requisition has no items.');
        }
        const [order] = await tx
          .insert(supplierOrders)
          .values({
            orgId,
            jobId: req.jobId,
            supplierName,
            origin: 'requisition',
            reference: request.body.reference ?? null,
            requestedDeliveryOn: req.neededBy,
            lines: items,
            totalMinor: requisitionTotalMinor(items),
            status: 'draft',
          })
          .returning();
        if (!order) throw problem('internal');
        const [row] = await tx
          .update(purchaseRequisitions)
          .set({
            status: 'converted',
            convertedOrderId: order.id,
            revision: req.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(purchaseRequisitions.orgId, orgId), eq(purchaseRequisitions.id, req.id)))
          .returning();
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'requisition.converted',
          resourceType: 'purchase_requisition',
          resourceId: row.id,
          after: { convertedOrderId: order.id },
        });
        return row;
      });
      return tenantTx(request, (tx) => requisitionDto(tx, orgId, converted));
    },
  );

  app.get(
    '/requisitions/backorders',
    {
      config: { permission: READ },
      schema: {
        tags: ['requisitions'],
        summary: 'Open backorders across supplier orders (ordered − received), with entered expected dates and aging.',
        response: { 200: BackorderAgingResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const asOf = new Date().toISOString().slice(0, 10);
      return tenantTx(request, async (tx) => {
        const orders = await tx
          .select()
          .from(supplierOrders)
          .where(eq(supplierOrders.orgId, orgId))
          .orderBy(desc(supplierOrders.createdAt))
          .limit(200);
        const items = [];
        for (const order of orders) {
          const poLines = z.array(PoLineJson).safeParse(order.lines);
          if (!poLines.success || poLines.data.length === 0) continue;
          const received = await receivedByLine(tx, orgId, order.id);
          const computed = computeBackorders(
            poLines.data.map((l, i) => ({ lineIndex: i, label: l.label, orderedQty: l.quantity })),
            received,
          );
          const open = computed.filter((c) => c.backorderedQty > 0);
          if (open.length === 0) continue;
          const expectations = await tx
            .select()
            .from(poLineBackorders)
            .where(and(eq(poLineBackorders.orgId, orgId), eq(poLineBackorders.supplierOrderId, order.id)));
          const expByLine = new Map(expectations.map((e) => [e.lineIndex, e]));
          for (const c of open) {
            const exp = expByLine.get(c.lineIndex);
            items.push({
              supplierOrderId: order.id,
              supplierName: order.supplierName,
              orderStatus: order.status,
              lineIndex: c.lineIndex,
              label: c.label,
              orderedQty: c.orderedQty,
              receivedQty: c.receivedQty,
              backorderedQty: c.backorderedQty,
              expectedOn: exp?.expectedOn ?? null,
              note: exp?.note ?? null,
              ageDays: backorderAgeDays(order.createdAt.toISOString(), asOf),
              overdue: exp?.expectedOn ? exp.expectedOn < asOf : false,
            });
          }
        }
        items.sort((a, b) => b.ageDays - a.ageDays);
        return {
          asOf,
          items,
          openCount: items.length,
          overdueCount: items.filter((i) => i.overdue).length,
        };
      });
    },
  );

  app.put(
    '/requisitions/backorders/:orderId/:lineIndex',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['requisitions'],
        params: z.object({ orderId: UUID, lineIndex: z.coerce.number().int().min(0).max(1000) }),
        body: SetBackorderRequestSchema,
        summary: 'Set the entered expected date/note for a backordered PO line.',
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [order] = await tx
          .select()
          .from(supplierOrders)
          .where(and(eq(supplierOrders.orgId, orgId), eq(supplierOrders.id, request.params.orderId)));
        if (!order) throw problem('not_found');
        const poLines = z.array(PoLineJson).safeParse(order.lines);
        if (!poLines.success || request.params.lineIndex >= poLines.data.length) {
          throw problem('validation_failed', 'That line does not exist on this order.');
        }
        const [existing] = await tx
          .select()
          .from(poLineBackorders)
          .where(
            and(
              eq(poLineBackorders.orgId, orgId),
              eq(poLineBackorders.supplierOrderId, order.id),
              eq(poLineBackorders.lineIndex, request.params.lineIndex),
            ),
          )
          .for('update');
        if (existing) {
          await tx
            .update(poLineBackorders)
            .set({
              ...(request.body.expectedOn !== undefined && { expectedOn: request.body.expectedOn }),
              ...(request.body.note !== undefined && { note: request.body.note }),
              revision: existing.revision + 1,
              updatedAt: new Date(),
            })
            .where(and(eq(poLineBackorders.orgId, orgId), eq(poLineBackorders.id, existing.id)));
        } else {
          await tx.insert(poLineBackorders).values({
            orgId,
            supplierOrderId: order.id,
            lineIndex: request.params.lineIndex,
            expectedOn: request.body.expectedOn ?? null,
            note: request.body.note ?? null,
          });
        }
        return { ok: true };
      });
    },
  );
};

export default requisitionsModule;
