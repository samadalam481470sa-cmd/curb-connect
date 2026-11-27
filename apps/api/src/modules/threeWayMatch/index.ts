// `threeWayMatch` module (blueprint gap 4): PO receiving + invoice↔PO↔receipt
// matching. Receipts are recorded against supplier orders (PO lines live in
// supplier_orders.lines jsonb, referenced by index). A match links an AP
// invoice to a PO with invoice-side figures entered from the supplier's
// invoice (billed qty/unit price per line, tax, freight, vendor, cost code)
// and computes matched / price_variance / quantity_variance / unmatched.
// When a match record exists, AP approval (jobCost decide handler) is blocked
// until the invoice is matched or a variance is approved with a reason.
// Duplicate detection: same vendor + invoice number + amount.
import {
  ApInvoiceMatchSchema,
  CreateReceiptRequestSchema,
  DecideMatchRequestSchema,
  MatchApInvoiceRequestSchema,
  OrderListItemSchema,
  PoReceiptSchema,
  ReceivingSummarySchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { apInvoiceMatches, apInvoices, poReceiptLines, poReceipts, supplierOrders } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { evaluateMatch, findDuplicates, type PoLineForMatch } from './match';

const READ = 'ap:read';
const WRITE = 'ap:write';
const APPROVE = 'ap:approve';

const UUID = z.uuid();
const OrderParams = z.object({ orderId: UUID });
const InvoiceParams = z.object({ invoiceId: UUID });

const PoLineJson = z.object({
  label: z.string().default(''),
  quantity: z.number().default(0),
  unit: z.string().default('each'),
  unitPriceMinor: z.number().int().nullable().default(null),
});

function parsePoLines(raw: unknown): Array<z.infer<typeof PoLineJson>> {
  const parsed = z.array(PoLineJson).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

type OrderRow = typeof supplierOrders.$inferSelect;
type MatchRow = typeof apInvoiceMatches.$inferSelect;

async function loadOrder(tx: Tx, orgId: string, orderId: string) {
  const [order] = await tx
    .select()
    .from(supplierOrders)
    .where(and(eq(supplierOrders.orgId, orgId), eq(supplierOrders.id, orderId)));
  if (!order) throw problem('not_found');
  return order;
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

function summaryDto(order: OrderRow, received: Map<number, number>) {
  const lines = parsePoLines(order.lines);
  return {
    supplierOrderId: order.id,
    supplierName: order.supplierName,
    status: order.status,
    lines: lines.map((l, i) => ({
      lineIndex: i,
      label: l.label,
      unit: l.unit,
      orderedQty: l.quantity,
      receivedQty: received.get(i) ?? 0,
      unitPriceMinor: l.unitPriceMinor,
    })),
  };
}

async function matchDto(tx: Tx, orgId: string, match: MatchRow) {
  const [invoice] = await tx
    .select()
    .from(apInvoices)
    .where(and(eq(apInvoices.orgId, orgId), eq(apInvoices.id, match.apInvoiceId)));
  if (!invoice) throw problem('not_found');
  const order = match.supplierOrderId ? await loadOrder(tx, orgId, match.supplierOrderId) : null;
  const received = order ? await receivedByLine(tx, orgId, order.id) : new Map<number, number>();
  const poLines: PoLineForMatch[] = order
    ? parsePoLines(order.lines).map((l, i) => ({
        lineIndex: i,
        label: l.label,
        orderedQty: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
      }))
    : [];
  const billedLines = z
    .array(z.object({ lineIndex: z.number(), billedQty: z.number(), billedUnitPriceMinor: z.number() }))
    .safeParse(match.billedLines);
  const result = evaluateMatch({
    poLines,
    receipts: [...received.entries()].map(([lineIndex, receivedQty]) => ({ lineIndex, receivedQty })),
    billedLines: billedLines.success ? billedLines.data : [],
    billedTaxMinor: match.billedTaxMinor,
    billedFreightMinor: match.billedFreightMinor,
    invoiceAmountMinor: invoice.amountMinor,
    poSupplierName: order?.supplierName ?? '',
    billedVendorName: match.billedVendorName,
    apCostCode: invoice.costCode,
    billedCostCode: match.billedCostCode,
  });
  const allInvoices = await tx
    .select({
      id: apInvoices.id,
      vendorName: apInvoices.vendorName,
      invoiceNumber: apInvoices.invoiceNumber,
      amountMinor: apInvoices.amountMinor,
    })
    .from(apInvoices)
    .where(eq(apInvoices.orgId, orgId))
    .limit(2000);
  const duplicates = findDuplicates(allInvoices, {
    id: invoice.id,
    vendorName: invoice.vendorName,
    invoiceNumber: invoice.invoiceNumber,
    amountMinor: invoice.amountMinor,
  });
  const storedReasons = z.array(z.string()).safeParse(match.reasons);
  return {
    id: match.id,
    apInvoiceId: match.apInvoiceId,
    supplierOrderId: match.supplierOrderId,
    status: match.status,
    billedLines: billedLines.success ? billedLines.data : [],
    billedTaxMinor: match.billedTaxMinor,
    billedFreightMinor: match.billedFreightMinor,
    billedVendorName: match.billedVendorName,
    billedCostCode: match.billedCostCode,
    computedBilledTotalMinor: match.computedBilledTotalMinor,
    invoiceAmountMinor: invoice.amountMinor,
    amountMatchesInvoice: result.amountMatchesInvoice,
    vendorMatches: result.vendorMatches,
    costCodeMatches: result.costCodeMatches,
    lines: result.lines,
    reasons: storedReasons.success ? storedReasons.data : result.reasons,
    varianceReason: match.varianceReason,
    decidedAt: match.decidedAt?.toISOString() ?? null,
    matchedAt: match.matchedAt?.toISOString() ?? null,
    duplicateInvoiceIds: duplicates.map((d) => d.id),
    revision: match.revision,
  };
}

const threeWayMatchModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/three-way-match/orders',
    {
      config: { permission: READ },
      schema: {
        tags: ['three-way-match'],
        summary: 'Supplier orders available for receiving/matching (flag-free read for the match flow).',
        response: { 200: z.object({ items: z.array(OrderListItemSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(supplierOrders)
          .where(eq(supplierOrders.orgId, orgId))
          .orderBy(desc(supplierOrders.createdAt))
          .limit(200);
        return {
          items: rows.map((r) => ({
            id: r.id,
            supplierName: r.supplierName,
            status: r.status,
            reference: r.reference,
            totalMinor: r.totalMinor,
            jobId: r.jobId,
          })),
        };
      });
    },
  );

  app.post(
    '/three-way-match/orders/:orderId/receipts',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['three-way-match'],
        params: OrderParams,
        body: CreateReceiptRequestSchema,
        summary: 'Record a receipt against a supplier order (full or partial, with shortage/damage notes).',
        response: { 201: PoReceiptSchema },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const created = await tenantTx(request, async (tx) => {
        const order = await loadOrder(tx, orgId, request.params.orderId);
        const poLines = parsePoLines(order.lines);
        for (const l of request.body.lines) {
          if (l.lineIndex >= poLines.length) {
            throw problem('validation_failed', `Receipt line ${l.lineIndex} does not exist on this order.`);
          }
        }
        const [receipt] = await tx
          .insert(poReceipts)
          .values({
            orgId,
            supplierOrderId: order.id,
            receivedOn: request.body.receivedOn,
            receivedByUserId: userId,
            note: request.body.note ?? null,
          })
          .returning();
        if (!receipt) throw problem('internal');
        const lines = await tx
          .insert(poReceiptLines)
          .values(
            request.body.lines.map((l) => ({
              orgId,
              receiptId: receipt.id,
              lineIndex: l.lineIndex,
              qtyReceived: String(l.qtyReceived),
              condition: l.condition,
              note: l.note ?? null,
            })),
          )
          .returning();
        await auditRequest(request, tx, {
          orgId,
          action: 'three_way_match.receipt_recorded',
          resourceType: 'po_receipt',
          resourceId: receipt.id,
          after: { supplierOrderId: order.id, lineCount: lines.length },
        });
        return { receipt, lines };
      });
      return reply.code(201).send({
        id: created.receipt.id,
        supplierOrderId: created.receipt.supplierOrderId,
        receivedOn: created.receipt.receivedOn,
        note: created.receipt.note,
        lines: created.lines.map((l) => ({
          id: l.id,
          lineIndex: l.lineIndex,
          qtyReceived: Number(l.qtyReceived),
          condition: l.condition,
          note: l.note,
        })),
        createdAt: created.receipt.createdAt.toISOString(),
      });
    },
  );

  app.get(
    '/three-way-match/orders/:orderId/receipts',
    {
      config: { permission: READ },
      schema: {
        tags: ['three-way-match'],
        params: OrderParams,
        summary: 'Receipts recorded against a supplier order, newest first.',
        response: { 200: z.object({ items: z.array(PoReceiptSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const order = await loadOrder(tx, orgId, request.params.orderId);
        const receipts = await tx
          .select()
          .from(poReceipts)
          .where(and(eq(poReceipts.orgId, orgId), eq(poReceipts.supplierOrderId, order.id)))
          .orderBy(desc(poReceipts.receivedOn), desc(poReceipts.createdAt))
          .limit(100);
        const items = [];
        for (const r of receipts) {
          const lines = await tx
            .select()
            .from(poReceiptLines)
            .where(and(eq(poReceiptLines.orgId, orgId), eq(poReceiptLines.receiptId, r.id)))
            .orderBy(asc(poReceiptLines.lineIndex));
          items.push({
            id: r.id,
            supplierOrderId: r.supplierOrderId,
            receivedOn: r.receivedOn,
            note: r.note,
            lines: lines.map((l) => ({
              id: l.id,
              lineIndex: l.lineIndex,
              qtyReceived: Number(l.qtyReceived),
              condition: l.condition,
              note: l.note,
            })),
            createdAt: r.createdAt.toISOString(),
          });
        }
        return { items };
      });
    },
  );

  app.get(
    '/three-way-match/orders/:orderId/receiving-summary',
    {
      config: { permission: READ },
      schema: {
        tags: ['three-way-match'],
        params: OrderParams,
        summary: 'Ordered vs received quantities per PO line.',
        response: { 200: ReceivingSummarySchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const order = await loadOrder(tx, orgId, request.params.orderId);
        const received = await receivedByLine(tx, orgId, order.id);
        return summaryDto(order, received);
      });
    },
  );

  app.post(
    '/three-way-match/ap-invoices/:invoiceId/match',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['three-way-match'],
        params: InvoiceParams,
        body: MatchApInvoiceRequestSchema,
        summary:
          'Match an AP invoice to a PO with invoice-side figures entered from the supplier invoice. Computes matched / price_variance / quantity_variance / unmatched.',
        response: { 200: ApInvoiceMatchSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const match = await tenantTx(request, async (tx) => {
        const [invoice] = await tx
          .select()
          .from(apInvoices)
          .where(and(eq(apInvoices.orgId, orgId), eq(apInvoices.id, request.params.invoiceId)));
        if (!invoice) throw problem('not_found');
        const order = await loadOrder(tx, orgId, request.body.supplierOrderId);
        const received = await receivedByLine(tx, orgId, order.id);
        const poLines: PoLineForMatch[] = parsePoLines(order.lines).map((l, i) => ({
          lineIndex: i,
          label: l.label,
          orderedQty: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
        }));
        const result = evaluateMatch({
          poLines,
          receipts: [...received.entries()].map(([lineIndex, receivedQty]) => ({ lineIndex, receivedQty })),
          billedLines: request.body.billedLines,
          billedTaxMinor: request.body.billedTaxMinor,
          billedFreightMinor: request.body.billedFreightMinor,
          invoiceAmountMinor: invoice.amountMinor,
          poSupplierName: order.supplierName,
          billedVendorName: request.body.billedVendorName,
          apCostCode: invoice.costCode,
          billedCostCode: request.body.billedCostCode ?? null,
        });
        const values = {
          orgId,
          apInvoiceId: invoice.id,
          supplierOrderId: order.id,
          status: result.status,
          billedLines: request.body.billedLines,
          billedTaxMinor: request.body.billedTaxMinor,
          billedFreightMinor: request.body.billedFreightMinor,
          billedVendorName: request.body.billedVendorName,
          billedCostCode: request.body.billedCostCode ?? null,
          computedBilledTotalMinor: result.computedBilledTotalMinor,
          reasons: result.reasons,
          varianceReason: null,
          decidedByUserId: null,
          decidedAt: null,
          matchedAt: new Date(),
        };
        const [existing] = await tx
          .select()
          .from(apInvoiceMatches)
          .where(
            and(eq(apInvoiceMatches.orgId, orgId), eq(apInvoiceMatches.apInvoiceId, invoice.id)),
          )
          .for('update');
        let row: MatchRow;
        if (existing) {
          const [updated] = await tx
            .update(apInvoiceMatches)
            .set({ ...values, revision: existing.revision + 1, updatedAt: new Date() })
            .where(and(eq(apInvoiceMatches.orgId, orgId), eq(apInvoiceMatches.id, existing.id)))
            .returning();
          if (!updated) throw problem('internal');
          row = updated;
        } else {
          const [inserted] = await tx.insert(apInvoiceMatches).values(values).returning();
          if (!inserted) throw problem('internal');
          row = inserted;
        }
        await auditRequest(request, tx, {
          orgId,
          action: 'three_way_match.matched',
          resourceType: 'ap_invoice_match',
          resourceId: row.id,
          after: { status: row.status, supplierOrderId: order.id },
        });
        return row;
      });
      return tenantTx(request, (tx) => matchDto(tx, orgId, match));
    },
  );

  app.get(
    '/three-way-match/ap-invoices/:invoiceId/match',
    {
      config: { permission: READ },
      schema: {
        tags: ['three-way-match'],
        params: InvoiceParams,
        summary: 'Current match record for an AP invoice (404 when none exists).',
        response: { 200: ApInvoiceMatchSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [match] = await tx
          .select()
          .from(apInvoiceMatches)
          .where(
            and(
              eq(apInvoiceMatches.orgId, orgId),
              eq(apInvoiceMatches.apInvoiceId, request.params.invoiceId),
            ),
          );
        if (!match) throw problem('not_found');
        return matchDto(tx, orgId, match);
      });
    },
  );

  app.post(
    '/three-way-match/ap-invoices/:invoiceId/decide',
    {
      config: { permission: APPROVE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['three-way-match'],
        params: InvoiceParams,
        body: DecideMatchRequestSchema,
        summary: 'Approve or reject a match variance with a reason. Approved variances unblock AP approval.',
        response: { 200: ApInvoiceMatchSchema },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      const match = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(apInvoiceMatches)
          .where(
            and(
              eq(apInvoiceMatches.orgId, orgId),
              eq(apInvoiceMatches.apInvoiceId, request.params.invoiceId),
            ),
          )
          .for('update');
        if (!existing) throw problem('not_found');
        if (!['unmatched', 'price_variance', 'quantity_variance'].includes(existing.status)) {
          throw problem('conflict', `A match in status '${existing.status}' has no open variance to decide.`);
        }
        const [updated] = await tx
          .update(apInvoiceMatches)
          .set({
            status: request.body.decision === 'approve_variance' ? 'variance_approved' : 'variance_rejected',
            varianceReason: request.body.reason,
            decidedByUserId: userId,
            decidedAt: new Date(),
            revision: existing.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(apInvoiceMatches.orgId, orgId), eq(apInvoiceMatches.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: `three_way_match.${request.body.decision}`,
          resourceType: 'ap_invoice_match',
          resourceId: updated.id,
          before: { status: existing.status },
          after: { status: updated.status },
        });
        return updated;
      });
      return tenantTx(request, (tx) => matchDto(tx, orgId, match));
    },
  );
};

export default threeWayMatchModule;
