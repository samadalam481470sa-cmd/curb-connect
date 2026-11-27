// `concrete` module (blueprint gap 5): mix designs (contractor-entered),
// concrete orders with a dispatch board by day, per-load tickets with manual
// status flow (scheduled -> batched -> en_route -> on_site -> pouring ->
// complete), and an invoice handoff (delivered yards on completed loads ×
// entered price per yard -> draft customer invoice; never auto-sent). Trucks
// come from the fleet registry; drivers/plants/ETA are entered values — no
// GPS provider is connected, so nothing here fakes live tracking.
import {
  ConcreteOrderSchema,
  CreateLoadRequestSchema,
  CreateMixDesignRequestSchema,
  CreateOrderRequestSchema,
  DispatchBoardResponseSchema,
  LoadSchema,
  MixDesignSchema,
  SetStatusRequestSchema,
  TruckOptionSchema,
  UpdateLoadRequestSchema,
  UpdateMixDesignRequestSchema,
  UpdateOrderRequestSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  concreteLoads,
  concreteMixDesigns,
  concreteOrders,
  fleetAssets,
  invoiceLines,
  invoices,
  jobs,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { canTransition, invoiceAmountMinor, loadTotals, type ConcreteStatus } from './flow';

const READ = 'concrete:read';
const WRITE = 'concrete:write';

const UUID = z.uuid();
const MixParams = z.object({ mixId: UUID });
const OrderParams = z.object({ orderId: UUID });
const LoadParams = z.object({ loadId: UUID });
const BoardQuery = z.object({ from: z.iso.date(), to: z.iso.date() });
const OrderListQuery = z.object({
  jobId: UUID.optional(),
  status: z
    .enum(['scheduled', 'batched', 'en_route', 'on_site', 'pouring', 'complete', 'cancelled'])
    .optional(),
});

type MixRow = typeof concreteMixDesigns.$inferSelect;
type OrderRow = typeof concreteOrders.$inferSelect;
type LoadRow = typeof concreteLoads.$inferSelect;

const num = (v: string | null) => (v === null ? null : Number(v));

function mixDto(m: MixRow) {
  return {
    id: m.id,
    name: m.name,
    strength: m.strength,
    slump: m.slump,
    aggregate: m.aggregate,
    admixtures: m.admixtures,
    pricePerYardMinor: m.pricePerYardMinor,
    active: m.active,
    revision: m.revision,
  };
}

async function truckName(tx: Tx, orgId: string, assetId: string | null) {
  if (!assetId) return null;
  const [asset] = await tx
    .select({ name: fleetAssets.name })
    .from(fleetAssets)
    .where(and(eq(fleetAssets.orgId, orgId), eq(fleetAssets.id, assetId)));
  return asset?.name ?? null;
}

async function loadDto(tx: Tx, orgId: string, l: LoadRow) {
  const photoRefs = z
    .array(z.object({ label: z.string().default(''), reference: z.string() }))
    .safeParse(l.photoRefs);
  return {
    id: l.id,
    orderId: l.orderId,
    truckAssetId: l.truckAssetId,
    truckName: await truckName(tx, orgId, l.truckAssetId),
    driverName: l.driverName,
    batchTime: l.batchTime?.toISOString() ?? null,
    yardsLoaded: num(l.yardsLoaded),
    yardsDelivered: num(l.yardsDelivered),
    yardsReturned: num(l.yardsReturned),
    ticketNumber: l.ticketNumber,
    status: l.status,
    photoRefs: photoRefs.success ? photoRefs.data : [],
    signatureName: l.signatureName,
    signedAt: l.signedAt?.toISOString() ?? null,
    note: l.note,
    revision: l.revision,
  };
}

async function orderDto(tx: Tx, orgId: string, order: OrderRow) {
  const [job] = await tx
    .select({ number: jobs.number, title: jobs.title })
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, order.jobId)));
  const [mix] = await tx
    .select()
    .from(concreteMixDesigns)
    .where(and(eq(concreteMixDesigns.orgId, orgId), eq(concreteMixDesigns.id, order.mixDesignId)));
  const loads = await tx
    .select()
    .from(concreteLoads)
    .where(and(eq(concreteLoads.orgId, orgId), eq(concreteLoads.orderId, order.id)))
    .orderBy(asc(concreteLoads.createdAt));
  const totals = loadTotals(
    loads.map((l) => ({
      status: l.status,
      yardsLoaded: num(l.yardsLoaded),
      yardsDelivered: num(l.yardsDelivered),
      yardsReturned: num(l.yardsReturned),
    })),
  );
  let invoiceNumber: string | null = null;
  if (order.invoiceId) {
    const [inv] = await tx
      .select({ number: invoices.number })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), eq(invoices.id, order.invoiceId)));
    invoiceNumber = inv?.number ?? null;
  }
  const loadDtos = [];
  for (const l of loads) loadDtos.push(await loadDto(tx, orgId, l));
  return {
    id: order.id,
    jobId: order.jobId,
    jobNumber: job?.number ?? '',
    jobTitle: job?.title ?? '',
    mixDesignId: order.mixDesignId,
    mixName: mix?.name ?? '',
    pourLocation: order.pourLocation,
    volumeYards: Number(order.volumeYards),
    requestedOn: order.requestedOn,
    windowStart: order.windowStart,
    windowEnd: order.windowEnd,
    pumpNeeded: order.pumpNeeded,
    contactName: order.contactName,
    contactPhone: order.contactPhone,
    status: order.status,
    plantName: order.plantName,
    truckAssetId: order.truckAssetId,
    truckName: await truckName(tx, orgId, order.truckAssetId),
    driverName: order.driverName,
    enteredEta: order.enteredEta,
    invoiceId: order.invoiceId,
    invoiceNumber,
    note: order.note,
    loads: loadDtos,
    totals: {
      ...totals,
      billableAmountMinor: invoiceAmountMinor(totals.billableYards, mix?.pricePerYardMinor ?? null),
    },
    revision: order.revision,
    createdAt: order.createdAt.toISOString(),
  };
}

async function loadOrder(tx: Tx, orgId: string, orderId: string, lock = false) {
  const base = tx
    .select()
    .from(concreteOrders)
    .where(and(eq(concreteOrders.orgId, orgId), eq(concreteOrders.id, orderId)));
  const [order] = lock ? await base.for('update') : await base;
  if (!order) throw problem('not_found');
  return order;
}

async function validateTruck(tx: Tx, orgId: string, assetId: string | null | undefined) {
  if (!assetId) return;
  const [asset] = await tx
    .select({ id: fleetAssets.id })
    .from(fleetAssets)
    .where(and(eq(fleetAssets.orgId, orgId), eq(fleetAssets.id, assetId)));
  if (!asset) throw problem('validation_failed', 'That truck is not in the fleet registry.');
}

/** Same numbering scheme as the invoices module (advisory lock + INV-YYYY-NNNN). */
async function nextInvoiceNumber(tx: Tx, orgId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoices:${orgId}`}))`);
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(eq(invoices.orgId, orgId));
  const year = new Date().getFullYear();
  for (let sequence = (row?.count ?? 0) + 1; ; sequence += 1) {
    const candidate = `INV-${year}-${String(sequence).padStart(4, '0')}`;
    const [taken] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), eq(invoices.number, candidate)))
      .limit(1);
    if (!taken) return candidate;
  }
}

const concreteModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/concrete/mix-designs',
    {
      config: { permission: READ },
      schema: {
        tags: ['concrete'],
        summary: 'Mix designs (contractor-entered).',
        response: { 200: z.object({ items: z.array(MixDesignSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(concreteMixDesigns)
          .where(eq(concreteMixDesigns.orgId, orgId))
          .orderBy(asc(concreteMixDesigns.name))
          .limit(200);
        return { items: rows.map(mixDto) };
      });
    },
  );

  app.post(
    '/concrete/mix-designs',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['concrete'],
        body: CreateMixDesignRequestSchema,
        summary: 'Create a mix design with entered strength/slump/aggregate/admixtures/price per yard.',
        response: { 201: MixDesignSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const created = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .insert(concreteMixDesigns)
          .values({
            orgId,
            name: request.body.name,
            strength: request.body.strength ?? null,
            slump: request.body.slump ?? null,
            aggregate: request.body.aggregate ?? null,
            admixtures: request.body.admixtures ?? null,
            pricePerYardMinor: request.body.pricePerYardMinor ?? null,
          })
          .returning();
        if (!row) throw problem('internal');
        return row;
      });
      return reply.code(201).send(mixDto(created));
    },
  );

  app.patch(
    '/concrete/mix-designs/:mixId',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['concrete'],
        params: MixParams,
        body: UpdateMixDesignRequestSchema,
        summary: 'Update a mix design.',
        response: { 200: MixDesignSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [mix] = await tx
          .select()
          .from(concreteMixDesigns)
          .where(and(eq(concreteMixDesigns.orgId, orgId), eq(concreteMixDesigns.id, request.params.mixId)));
        if (!mix) throw problem('not_found');
        const b = request.body;
        const [updated] = await tx
          .update(concreteMixDesigns)
          .set({
            ...(b.name !== undefined && { name: b.name }),
            ...(b.strength !== undefined && { strength: b.strength }),
            ...(b.slump !== undefined && { slump: b.slump }),
            ...(b.aggregate !== undefined && { aggregate: b.aggregate }),
            ...(b.admixtures !== undefined && { admixtures: b.admixtures }),
            ...(b.pricePerYardMinor !== undefined && { pricePerYardMinor: b.pricePerYardMinor }),
            ...(b.active !== undefined && { active: b.active }),
            revision: mix.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(concreteMixDesigns.orgId, orgId), eq(concreteMixDesigns.id, mix.id)))
          .returning();
        if (!updated) throw problem('internal');
        return mixDto(updated);
      });
    },
  );

  app.get(
    '/concrete/trucks',
    {
      config: { permission: READ },
      schema: {
        tags: ['concrete'],
        summary: 'Fleet assets available for truck assignment.',
        response: { 200: z.object({ items: z.array(TruckOptionSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(fleetAssets)
          .where(eq(fleetAssets.orgId, orgId))
          .orderBy(asc(fleetAssets.name))
          .limit(200);
        return {
          items: rows.map((r) => ({
            id: r.id,
            name: r.name,
            kind: r.kind,
            identifier: r.identifier,
            status: r.status,
          })),
        };
      });
    },
  );

  app.post(
    '/concrete/orders',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['concrete'],
        body: CreateOrderRequestSchema,
        summary: 'Create a concrete order (job, mix, pour location, volume, date/window, pump, contact).',
        response: { 201: ConcreteOrderSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const created = await tenantTx(request, async (tx) => {
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.orgId, orgId), eq(jobs.id, request.body.jobId)));
        if (!job) throw problem('not_found');
        const [mix] = await tx
          .select({ id: concreteMixDesigns.id, active: concreteMixDesigns.active })
          .from(concreteMixDesigns)
          .where(and(eq(concreteMixDesigns.orgId, orgId), eq(concreteMixDesigns.id, request.body.mixDesignId)));
        if (!mix) throw problem('not_found');
        if (!mix.active) throw problem('validation_failed', 'That mix design is inactive.');
        await validateTruck(tx, orgId, request.body.truckAssetId);
        const [row] = await tx
          .insert(concreteOrders)
          .values({
            orgId,
            jobId: request.body.jobId,
            mixDesignId: request.body.mixDesignId,
            pourLocation: request.body.pourLocation,
            volumeYards: String(request.body.volumeYards),
            requestedOn: request.body.requestedOn,
            windowStart: request.body.windowStart ?? null,
            windowEnd: request.body.windowEnd ?? null,
            pumpNeeded: request.body.pumpNeeded,
            contactName: request.body.contactName ?? null,
            contactPhone: request.body.contactPhone ?? null,
            plantName: request.body.plantName ?? null,
            truckAssetId: request.body.truckAssetId ?? null,
            driverName: request.body.driverName ?? null,
            note: request.body.note ?? null,
          })
          .returning();
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'concrete.order_created',
          resourceType: 'concrete_order',
          resourceId: row.id,
          after: { requestedOn: row.requestedOn, volumeYards: Number(row.volumeYards) },
        });
        return row;
      });
      const dto = await tenantTx(request, (tx) => orderDto(tx, orgId, created));
      return reply.code(201).send(dto);
    },
  );

  app.get(
    '/concrete/orders',
    {
      config: { permission: READ },
      schema: {
        tags: ['concrete'],
        querystring: OrderListQuery,
        summary: 'Concrete orders, optionally filtered by job/status.',
        response: { 200: z.object({ items: z.array(ConcreteOrderSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const conditions = [eq(concreteOrders.orgId, orgId)];
        if (request.query.jobId) conditions.push(eq(concreteOrders.jobId, request.query.jobId));
        if (request.query.status) conditions.push(eq(concreteOrders.status, request.query.status));
        const rows = await tx
          .select()
          .from(concreteOrders)
          .where(and(...conditions))
          .orderBy(desc(concreteOrders.requestedOn), desc(concreteOrders.createdAt))
          .limit(100);
        const items = [];
        for (const r of rows) items.push(await orderDto(tx, orgId, r));
        return { items };
      });
    },
  );

  app.get(
    '/concrete/dispatch-board',
    {
      config: { permission: READ },
      schema: {
        tags: ['concrete'],
        querystring: BoardQuery,
        summary: 'Dispatch board: orders grouped by requested date in a range.',
        response: { 200: DispatchBoardResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      if (request.query.to < request.query.from) {
        throw problem('validation_failed', 'Board end date must be on or after the start date.');
      }
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(concreteOrders)
          .where(
            and(
              eq(concreteOrders.orgId, orgId),
              gte(concreteOrders.requestedOn, request.query.from),
              lte(concreteOrders.requestedOn, request.query.to),
            ),
          )
          .orderBy(asc(concreteOrders.requestedOn), asc(concreteOrders.windowStart), asc(concreteOrders.createdAt))
          .limit(300);
        const byDay = new Map<string, OrderRow[]>();
        for (const r of rows) {
          const list = byDay.get(r.requestedOn) ?? [];
          list.push(r);
          byDay.set(r.requestedOn, list);
        }
        const days = [];
        for (const [date, dayRows] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          const orders = [];
          for (const r of dayRows) orders.push(await orderDto(tx, orgId, r));
          days.push({ date, orders });
        }
        return { from: request.query.from, to: request.query.to, days };
      });
    },
  );

  app.patch(
    '/concrete/orders/:orderId',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['concrete'],
        params: OrderParams,
        body: UpdateOrderRequestSchema,
        summary: 'Update order details (assignment, window, ETA, contact). Status changes go through the status endpoint.',
        response: { 200: ConcreteOrderSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const updated = await tenantTx(request, async (tx) => {
        const order = await loadOrder(tx, orgId, request.params.orderId, true);
        if (['complete', 'cancelled'].includes(order.status)) {
          throw problem('conflict', `A ${order.status} order cannot be edited.`);
        }
        await validateTruck(tx, orgId, request.body.truckAssetId);
        const b = request.body;
        const [row] = await tx
          .update(concreteOrders)
          .set({
            ...(b.pourLocation !== undefined && { pourLocation: b.pourLocation }),
            ...(b.volumeYards !== undefined && { volumeYards: String(b.volumeYards) }),
            ...(b.requestedOn !== undefined && { requestedOn: b.requestedOn }),
            ...(b.windowStart !== undefined && { windowStart: b.windowStart }),
            ...(b.windowEnd !== undefined && { windowEnd: b.windowEnd }),
            ...(b.pumpNeeded !== undefined && { pumpNeeded: b.pumpNeeded }),
            ...(b.contactName !== undefined && { contactName: b.contactName }),
            ...(b.contactPhone !== undefined && { contactPhone: b.contactPhone }),
            ...(b.plantName !== undefined && { plantName: b.plantName }),
            ...(b.truckAssetId !== undefined && { truckAssetId: b.truckAssetId }),
            ...(b.driverName !== undefined && { driverName: b.driverName }),
            ...(b.enteredEta !== undefined && { enteredEta: b.enteredEta }),
            ...(b.note !== undefined && { note: b.note }),
            revision: order.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(concreteOrders.orgId, orgId), eq(concreteOrders.id, order.id)))
          .returning();
        if (!row) throw problem('internal');
        return row;
      });
      return tenantTx(request, (tx) => orderDto(tx, orgId, updated));
    },
  );

  app.post(
    '/concrete/orders/:orderId/status',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['concrete'],
        params: OrderParams,
        body: SetStatusRequestSchema,
        summary: 'Advance an order through the status flow (scheduled -> batched -> en_route -> on_site -> pouring -> complete).',
        response: { 200: ConcreteOrderSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const updated = await tenantTx(request, async (tx) => {
        const order = await loadOrder(tx, orgId, request.params.orderId, true);
        const to = request.body.status as ConcreteStatus;
        if (!canTransition(order.status, to)) {
          throw problem('conflict', `An order cannot move from '${order.status}' to '${to}'.`);
        }
        const [row] = await tx
          .update(concreteOrders)
          .set({ status: to, revision: order.revision + 1, updatedAt: new Date() })
          .where(and(eq(concreteOrders.orgId, orgId), eq(concreteOrders.id, order.id)))
          .returning();
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'concrete.order_status',
          resourceType: 'concrete_order',
          resourceId: row.id,
          before: { status: order.status },
          after: { status: to },
        });
        return row;
      });
      return tenantTx(request, (tx) => orderDto(tx, orgId, updated));
    },
  );

  app.post(
    '/concrete/orders/:orderId/loads',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['concrete'],
        params: OrderParams,
        body: CreateLoadRequestSchema,
        summary: 'Add a load ticket to an order.',
        response: { 201: LoadSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const created = await tenantTx(request, async (tx) => {
        const order = await loadOrder(tx, orgId, request.params.orderId);
        if (['complete', 'cancelled'].includes(order.status)) {
          throw problem('conflict', `Loads cannot be added to a ${order.status} order.`);
        }
        await validateTruck(tx, orgId, request.body.truckAssetId);
        const [row] = await tx
          .insert(concreteLoads)
          .values({
            orgId,
            orderId: order.id,
            truckAssetId: request.body.truckAssetId ?? order.truckAssetId,
            driverName: request.body.driverName ?? order.driverName,
            batchTime: request.body.batchTime ? new Date(request.body.batchTime) : null,
            yardsLoaded: request.body.yardsLoaded != null ? String(request.body.yardsLoaded) : null,
            ticketNumber: request.body.ticketNumber ?? null,
            note: request.body.note ?? null,
          })
          .returning();
        if (!row) throw problem('internal');
        return row;
      });
      const dto = await tenantTx(request, (tx) => loadDto(tx, orgId, created));
      return reply.code(201).send(dto);
    },
  );

  app.patch(
    '/concrete/loads/:loadId',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['concrete'],
        params: LoadParams,
        body: UpdateLoadRequestSchema,
        summary: 'Update a load ticket (yards, ticket number, photos, signature attestation).',
        response: { 200: LoadSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const updated = await tenantTx(request, async (tx) => {
        const [load] = await tx
          .select()
          .from(concreteLoads)
          .where(and(eq(concreteLoads.orgId, orgId), eq(concreteLoads.id, request.params.loadId)))
          .for('update');
        if (!load) throw problem('not_found');
        if (load.status === 'complete' || load.status === 'cancelled') {
          throw problem('conflict', `A ${load.status} load ticket cannot be edited.`);
        }
        await validateTruck(tx, orgId, request.body.truckAssetId);
        const b = request.body;
        const [row] = await tx
          .update(concreteLoads)
          .set({
            ...(b.truckAssetId !== undefined && { truckAssetId: b.truckAssetId }),
            ...(b.driverName !== undefined && { driverName: b.driverName }),
            ...(b.batchTime !== undefined && { batchTime: b.batchTime ? new Date(b.batchTime) : null }),
            ...(b.yardsLoaded !== undefined && { yardsLoaded: b.yardsLoaded != null ? String(b.yardsLoaded) : null }),
            ...(b.yardsDelivered !== undefined && { yardsDelivered: b.yardsDelivered != null ? String(b.yardsDelivered) : null }),
            ...(b.yardsReturned !== undefined && { yardsReturned: b.yardsReturned != null ? String(b.yardsReturned) : null }),
            ...(b.ticketNumber !== undefined && { ticketNumber: b.ticketNumber }),
            ...(b.photoRefs !== undefined && { photoRefs: b.photoRefs }),
            ...(b.signatureName !== undefined && {
              signatureName: b.signatureName,
              signedAt: b.signatureName ? new Date() : null,
            }),
            ...(b.note !== undefined && { note: b.note }),
            revision: load.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(concreteLoads.orgId, orgId), eq(concreteLoads.id, load.id)))
          .returning();
        if (!row) throw problem('internal');
        return row;
      });
      return tenantTx(request, (tx) => loadDto(tx, orgId, updated));
    },
  );

  app.post(
    '/concrete/loads/:loadId/status',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['concrete'],
        params: LoadParams,
        body: SetStatusRequestSchema,
        summary: 'Advance a load ticket through the status flow.',
        response: { 200: LoadSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const updated = await tenantTx(request, async (tx) => {
        const [load] = await tx
          .select()
          .from(concreteLoads)
          .where(and(eq(concreteLoads.orgId, orgId), eq(concreteLoads.id, request.params.loadId)))
          .for('update');
        if (!load) throw problem('not_found');
        const to = request.body.status as ConcreteStatus;
        if (!canTransition(load.status, to)) {
          throw problem('conflict', `A load cannot move from '${load.status}' to '${to}'.`);
        }
        const [row] = await tx
          .update(concreteLoads)
          .set({ status: to, revision: load.revision + 1, updatedAt: new Date() })
          .where(and(eq(concreteLoads.orgId, orgId), eq(concreteLoads.id, load.id)))
          .returning();
        if (!row) throw problem('internal');
        return row;
      });
      return tenantTx(request, (tx) => loadDto(tx, orgId, updated));
    },
  );

  app.post(
    '/concrete/orders/:orderId/invoice',
    {
      config: { permission: 'invoice:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['concrete'],
        params: OrderParams,
        summary:
          'Generate a draft customer invoice for delivered yards on completed loads at the entered mix price. Draft only — never sent automatically.',
        response: { 200: ConcreteOrderSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const updated = await tenantTx(request, async (tx) => {
        const order = await loadOrder(tx, orgId, request.params.orderId, true);
        if (order.invoiceId) {
          throw problem('conflict', 'This order already has a generated invoice.');
        }
        const [mix] = await tx
          .select()
          .from(concreteMixDesigns)
          .where(and(eq(concreteMixDesigns.orgId, orgId), eq(concreteMixDesigns.id, order.mixDesignId)));
        if (!mix) throw problem('not_found');
        const loads = await tx
          .select()
          .from(concreteLoads)
          .where(and(eq(concreteLoads.orgId, orgId), eq(concreteLoads.orderId, order.id)));
        const totals = loadTotals(
          loads.map((l) => ({
            status: l.status,
            yardsLoaded: num(l.yardsLoaded),
            yardsDelivered: num(l.yardsDelivered),
            yardsReturned: num(l.yardsReturned),
          })),
        );
        const amount = invoiceAmountMinor(totals.billableYards, mix.pricePerYardMinor);
        if (amount === null) {
          throw problem(
            'validation_failed',
            `Mix "${mix.name}" has no entered price per yard. Enter a price on the mix design before invoicing — prices are never invented.`,
          );
        }
        if (totals.billableYards <= 0) {
          throw problem('validation_failed', 'No delivered yards on completed loads yet — nothing to invoice.');
        }
        const [job] = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.orgId, orgId), eq(jobs.id, order.jobId)));
        if (!job) throw problem('not_found');
        const number = await nextInvoiceNumber(tx, orgId);
        const [invoice] = await tx
          .insert(invoices)
          .values({
            orgId,
            number,
            kind: 'standalone',
            status: 'draft',
            customerId: job.customerId,
            contactId: job.contactId,
            jobId: order.jobId,
            currency: job.currency,
            subtotalMinor: amount,
            taxMinor: 0,
            totalMinor: amount,
            memo: `Concrete delivered ${order.requestedOn} — ${totals.billableYards} yd of ${mix.name} at ${order.pourLocation}.`,
          })
          .returning();
        if (!invoice) throw problem('internal');
        await tx.insert(invoiceLines).values({
          orgId,
          invoiceId: invoice.id,
          sortOrder: 0,
          description: `${mix.name} — ${totals.billableYards} yd delivered (${order.pourLocation})`,
          quantity: String(totals.billableYards),
          unit: 'cu_yd',
          unitPriceMinor: mix.pricePerYardMinor ?? 0,
          amountMinor: amount,
          taxRate: '0',
          taxMinor: 0,
          sourceType: 'concrete_order',
          sourceId: order.id,
        });
        const [row] = await tx
          .update(concreteOrders)
          .set({ invoiceId: invoice.id, revision: order.revision + 1, updatedAt: new Date() })
          .where(and(eq(concreteOrders.orgId, orgId), eq(concreteOrders.id, order.id)))
          .returning();
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'concrete.invoice_generated',
          resourceType: 'concrete_order',
          resourceId: row.id,
          after: { invoiceId: invoice.id, invoiceNumber: invoice.number, billableYards: totals.billableYards },
        });
        return row;
      });
      return tenantTx(request, (tx) => orderDto(tx, orgId, updated));
    },
  );
};

export default concreteModule;
