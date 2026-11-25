// `supplierOrders` module (Phase D, item 17): supplier material order drafts.
//
// The screen and API stay switched OFF by default behind `ops.supplier_orders`
// (defaultEnabled: false in contracts). When off, every route answers
// feature_unavailable and the web route shows as unavailable. When a company turns the
// flag on, drafts can be created and listed, but submission stays blocked: no supplier
// integration exists in this repo, so nothing is ever sent to a supplier from here.
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { jobs, supplierOrders } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { flagsFor } from '../../services/flags';
import { SUPPLIER_ORDERS_FLAG, supplierOrdersGate, supplierOrderTotalMinor, supplierSubmitGate } from './gate';

const LineInput = z.object({
  label: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(40),
  unitPriceMinor: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
});

const CreateInput = z.object({
  jobId: z.uuid(),
  supplierName: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(200).nullable().optional(),
  requestedDeliveryOn: z.iso.date().nullable().optional(),
  lines: z.array(LineInput).min(1).max(200),
});

const orderDto = (r: typeof supplierOrders.$inferSelect) => ({
  id: r.id,
  jobId: r.jobId,
  supplierName: r.supplierName,
  status: r.status,
  /** 'manual' when created through the flag-free manual flow; null for flag-path orders. */
  origin: r.origin,
  reference: r.reference,
  lines: r.lines,
  totalMinor: r.totalMinor,
  currency: r.currency,
  requestedDeliveryOn: r.requestedDeliveryOn,
  createdAt: r.createdAt.toISOString(),
});

/** Shared draft creation for both order paths. The job must belong to this company;
 * the origin marks which path created the draft. Drafts only — submission stays blocked
 * in both paths until a supplier integration exists. */
async function createOrderDraft(
  tx: Tx,
  orgId: string,
  input: z.infer<typeof CreateInput>,
  origin: 'manual' | null,
  request: FastifyRequest,
) {
  const lines = input.lines.map((l) => ({
    label: l.label, quantity: l.quantity, unit: l.unit,
    unitPriceMinor: l.unitPriceMinor ?? null,
  }));
  const [job] = await tx.select().from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, input.jobId)));
  if (!job) throw problem('not_found');
  const [created] = await tx.insert(supplierOrders).values({
    orgId,
    jobId: input.jobId,
    supplierName: input.supplierName,
    origin,
    reference: input.reference ?? null,
    requestedDeliveryOn: input.requestedDeliveryOn ?? null,
    lines,
    totalMinor: supplierOrderTotalMinor(lines),
    status: 'draft',
  }).returning();
  if (!created) throw problem('internal');
  await auditRequest(request, tx, {
    orgId, action: 'supplier_order.draft_created',
    resourceType: 'supplier_order', resourceId: created.id,
    after: { supplierName: created.supplierName, jobId: created.jobId, origin },
  });
  return created;
}

async function requireSupplierOrdersOn(
  request: Parameters<typeof tenantTx>[0],
  orgId: string,
): Promise<void> {
  const flags = await tenantTx(request, (tx) => flagsFor(tx, orgId));
  const decision = supplierOrdersGate(flags[SUPPLIER_ORDERS_FLAG]);
  if (!decision.allowed) throw problem(decision.code, decision.message);
}

const supplierOrdersModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/supplier-orders',
    {
      config: { permission: 'supplier_order:read' },
      schema: { tags: ['supplier-orders'], summary: 'Supplier order drafts for this company' },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      await requireSupplierOrdersOn(request, orgId);
      const rows = await tenantTx(request, (tx) =>
        tx.select().from(supplierOrders)
          .where(eq(supplierOrders.orgId, orgId))
          .orderBy(desc(supplierOrders.createdAt)).limit(100));
      return { items: rows.map(orderDto) };
    },
  );

  app.post(
    '/supplier-orders',
    {
      config: { permission: 'supplier_order:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['supplier-orders'], body: CreateInput, summary: 'Create a supplier order draft' },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      await requireSupplierOrdersOn(request, orgId);
      const row = await tenantTx(request, (tx) =>
        createOrderDraft(tx, orgId, request.body, null, request),
      );
      reply.code(201);
      return orderDto(row);
    },
  );

  // Manual orders (SupplyPro GM): the same draft, created for a manually created
  // customer/job without the flag-gated path. No flag check here — the manual flow is
  // first-class — but everything else is identical: drafts only, submission still blocked
  // by supplierSubmitGate() until a supplier integration exists. The old flag-gated
  // routes above are unchanged.
  app.get(
    '/supplier-orders/manual',
    {
      config: { permission: 'supplier_order:read' },
      schema: { tags: ['supplier-orders'], summary: 'Manual supplier order drafts for this company' },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx.select().from(supplierOrders)
          .where(and(eq(supplierOrders.orgId, orgId), eq(supplierOrders.origin, 'manual')))
          .orderBy(desc(supplierOrders.createdAt)).limit(100));
      return { items: rows.map(orderDto) };
    },
  );

  app.post(
    '/supplier-orders/manual',
    {
      config: { permission: 'supplier_order:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['supplier-orders'], body: CreateInput, summary: 'Create a manual supplier order draft (no flag needed)' },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, (tx) =>
        createOrderDraft(tx, orgId, request.body, 'manual', request),
      );
      reply.code(201);
      return orderDto(row);
    },
  );

  app.post(
    '/supplier-orders/:id/submit',
    {
      config: { permission: 'supplier_order:submit', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['supplier-orders'], params: z.object({ id: z.uuid() }),
        summary: 'Submit a draft to the supplier (blocked until an integration exists)',
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      // Manual orders (origin 'manual') were created through the flag-free flow, so
      // submitting one must not demand the flag either — the answer is the same honest
      // block either way (no supplier integration), just without the wrong reason.
      const [order] = await tenantTx(request, (tx) =>
        tx.select({ origin: supplierOrders.origin }).from(supplierOrders)
          .where(and(eq(supplierOrders.orgId, orgId), eq(supplierOrders.id, request.params.id)))
          .limit(1));
      if (!order) throw problem('not_found');
      if (order.origin !== 'manual') await requireSupplierOrdersOn(request, orgId);
      const decision = supplierSubmitGate();
      if (!decision.allowed) throw problem(decision.code, decision.message);
      return { ok: true };
    },
  );
};

export default supplierOrdersModule;
