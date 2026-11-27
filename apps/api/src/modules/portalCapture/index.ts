// `portalCapture` module: Renditions-style external-order capture framework.
// Suppliers store their own builder-portal logins in an encrypted vault;
// capture runs (manual or scheduled) log in through a per-portal adapter
// with PLAIN AUTHORIZED LOGIN ONLY — no anti-bot evasion (no CAPTCHA
// solving, no fingerprint spoofing, no stealth tricks; a blocked portal is
// reported honestly as 'blocked'). ZERO live adapters ship: no real portal
// has been verified, so runs report 'no_adapters' until an adapter is added
// per builder portal against a real supplier-authorized account.
//
// Captured orders are normalized through the org's existing SKU mappings
// (exact match; unmapped lines stay flagged) and deduped by
// (org, connection, builder PO number) — a re-capture is a revision, never a
// duplicate. Conversion into a draft supplier order is a human-confirmed,
// idempotent action; captured orders never auto-commit money. Portal
// secrets are write-only: accepted on create/update, sealed at rest with
// STORAGE_ENCRYPTION_KEY, and never returned or logged.
import {
  CaptureRunSchema,
  ConvertExternalOrderRequestSchema,
  CreatePortalConnectionRequestSchema,
  ExternalOrderLineSchema,
  ExternalOrderSchema,
  PortalCaptureStatusSchema,
  PortalConnectionSchema,
  UpdatePortalConnectionRequestSchema,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  externalOrders,
  jobs,
  portalCaptureRuns,
  portalConnections,
  supplierOrders,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { PORTAL_ADAPTERS, registeredAdapters } from './adapter';
import { runCapture } from './capture';
import { dbCaptureStore } from './store';
import { sealPortalSecret, unsealPortalSecret, vaultKeyFromConfig } from './vault';

const READ = 'portal_capture:read';
const WRITE = 'portal_capture:write';
const MANAGE = 'portal_capture:manage';

const UUID = z.uuid();
const ConnectionParams = z.object({ connectionId: UUID });
const OrderParams = z.object({ orderId: UUID });
const OrdersQuery = z.object({
  status: z.enum(['captured', 'converted']).optional(),
});

type ConnectionRow = typeof portalConnections.$inferSelect;
type RunRow = typeof portalCaptureRuns.$inferSelect;
type ExternalOrderRow = typeof externalOrders.$inferSelect;

function connectionDto(row: ConnectionRow) {
  return {
    id: row.id,
    portalKey: row.portalKey,
    portalName: row.portalName,
    loginIdentifier: row.loginIdentifier,
    // The secret itself is never returned — only whether one is stored.
    hasSecret: row.secretSealed.length > 0,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
  };
}

function runDto(row: RunRow, connection: ConnectionRow | undefined) {
  const errors = z
    .array(z.object({ orderRef: z.string().nullable().optional(), message: z.string() }))
    .safeParse(row.errors);
  return {
    id: row.id,
    connectionId: row.connectionId,
    portalKey: connection?.portalKey ?? '',
    portalName: connection?.portalName ?? '',
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    ordersFound: row.ordersFound,
    ordersNew: row.ordersNew,
    ordersRevised: row.ordersRevised,
    errors: errors.success ? errors.data : [],
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

function externalOrderDto(row: ExternalOrderRow, portalKey: string) {
  const parsed = z.array(ExternalOrderLineSchema).safeParse(row.lines);
  const lines = parsed.success ? parsed.data : [];
  return {
    id: row.id,
    connectionId: row.connectionId,
    portalKey,
    builderName: row.builderName,
    builderPoNumber: row.builderPoNumber,
    orderedOn: row.orderedOn,
    lines,
    totalMinor: row.totalMinor,
    mappedLineCount: lines.filter((l) => l.mappingStatus === 'mapped').length,
    unmappedLineCount: lines.filter((l) => l.mappingStatus === 'unmapped').length,
    revisionCount: row.revisionCount,
    lastCapturedAt: row.lastCapturedAt.toISOString(),
    status: row.status,
    convertedOrderId: row.convertedOrderId,
    note: row.note,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadConnection(tx: Tx, orgId: string, id: string, lock = false) {
  const base = tx
    .select()
    .from(portalConnections)
    .where(and(eq(portalConnections.orgId, orgId), eq(portalConnections.id, id)));
  const [row] = lock ? await base.for('update') : await base;
  if (!row) throw problem('not_found');
  return row;
}

async function connectionsById(tx: Tx, orgId: string) {
  const rows = await tx.select().from(portalConnections).where(eq(portalConnections.orgId, orgId));
  return new Map(rows.map((r) => [r.id, r] as const));
}

const portalCaptureModule: FastifyPluginAsyncZod = async (app) => {
  const vaultKey = () => vaultKeyFromConfig(app.config.storage.encryptionKey);

  app.get(
    '/portal-capture/status',
    {
      config: { permission: READ },
      schema: {
        tags: ['portalCapture'],
        summary: 'Capture framework status: vault configuration and registered portal adapters.',
        response: { 200: PortalCaptureStatusSchema },
      },
    },
    async () => {
      const adapters = registeredAdapters();
      return {
        vaultConfigured: vaultKey() !== null,
        adapters,
        note:
          adapters.length === 0
            ? 'No portal adapters are connected yet. Adapters are added per builder portal after verification against a real supplier-authorized account.'
            : `${adapters.length} portal adapter(s) registered.`,
      };
    },
  );

  app.post(
    '/portal-capture/connections',
    {
      config: { permission: MANAGE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['portalCapture'],
        body: CreatePortalConnectionRequestSchema,
        summary:
          'Store a builder-portal connection. The secret is sealed at rest and never returned.',
        response: { 201: PortalConnectionSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const key = vaultKey();
      if (!key) {
        throw problem(
          'dependency_unavailable',
          'The credential vault is not configured: set STORAGE_ENCRYPTION_KEY (base64 32-byte key) on the API before storing portal secrets.',
        );
      }
      const created = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .insert(portalConnections)
          .values({
            orgId,
            portalKey: request.body.portalKey,
            portalName: request.body.portalName,
            loginIdentifier: request.body.loginIdentifier,
            secretSealed: sealPortalSecret(key, request.body.secret),
          })
          .returning();
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'portal_capture.connection_created',
          resourceType: 'portal_connection',
          resourceId: row.id,
          after: { portalKey: row.portalKey, portalName: row.portalName },
        });
        return row;
      });
      return reply.code(201).send(connectionDto(created));
    },
  );

  app.get(
    '/portal-capture/connections',
    {
      config: { permission: READ },
      schema: {
        tags: ['portalCapture'],
        summary: 'Builder-portal connections, newest first. Secrets are never returned.',
        response: { 200: z.object({ items: z.array(PortalConnectionSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(portalConnections)
          .where(eq(portalConnections.orgId, orgId))
          .orderBy(desc(portalConnections.createdAt))
          .limit(200);
        return { items: rows.map(connectionDto) };
      });
    },
  );

  app.patch(
    '/portal-capture/connections/:connectionId',
    {
      config: { permission: MANAGE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['portalCapture'],
        params: ConnectionParams,
        body: UpdatePortalConnectionRequestSchema,
        summary: 'Update a connection (rename, change login, rotate the stored secret).',
        response: { 200: PortalConnectionSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const b = request.body;
      if (b.secret !== undefined && !vaultKey()) {
        throw problem(
          'dependency_unavailable',
          'The credential vault is not configured: set STORAGE_ENCRYPTION_KEY (base64 32-byte key) on the API before storing portal secrets.',
        );
      }
      const updated = await tenantTx(request, async (tx) => {
        const existing = await loadConnection(tx, orgId, request.params.connectionId, true);
        const [row] = await tx
          .update(portalConnections)
          .set({
            ...(b.portalName !== undefined && { portalName: b.portalName }),
            ...(b.loginIdentifier !== undefined && { loginIdentifier: b.loginIdentifier }),
            ...(b.secret !== undefined && { secretSealed: sealPortalSecret(vaultKey()!, b.secret) }),
            revision: existing.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(portalConnections.orgId, orgId), eq(portalConnections.id, existing.id)))
          .returning();
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'portal_capture.connection_updated',
          resourceType: 'portal_connection',
          resourceId: row.id,
          after: { portalKey: row.portalKey, secretRotated: b.secret !== undefined },
        });
        return row;
      });
      return connectionDto(updated);
    },
  );

  app.delete(
    '/portal-capture/connections/:connectionId',
    {
      config: { permission: MANAGE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['portalCapture'],
        params: ConnectionParams,
        summary:
          'Delete a connection and its stored secret (capture runs and captured orders for it are removed too).',
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const existing = await loadConnection(tx, orgId, request.params.connectionId, true);
        await tx
          .delete(portalConnections)
          .where(and(eq(portalConnections.orgId, orgId), eq(portalConnections.id, existing.id)));
        await auditRequest(request, tx, {
          orgId,
          action: 'portal_capture.connection_deleted',
          resourceType: 'portal_connection',
          resourceId: existing.id,
          before: { portalKey: existing.portalKey, portalName: existing.portalName },
        });
        return { ok: true };
      });
    },
  );

  app.post(
    '/portal-capture/connections/:connectionId/run',
    {
      config: { permission: WRITE, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['portalCapture'],
        params: ConnectionParams,
        summary:
          'Run one capture now for this connection. With no adapter registered for the portal, the run honestly reports no_adapters.',
        response: { 200: CaptureRunSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const connection = await tenantTx(request, (tx) =>
        loadConnection(tx, orgId, request.params.connectionId),
      );
      const adapter = PORTAL_ADAPTERS.get(connection.portalKey) ?? null;
      let credentials: { loginIdentifier: string; secret: string } | null = null;
      const key = vaultKey();
      if (adapter && key) {
        try {
          credentials = {
            loginIdentifier: connection.loginIdentifier,
            secret: unsealPortalSecret(key, connection.secretSealed),
          };
        } catch {
          credentials = null;
        }
      }
      const store = dbCaptureStore((fn) => tenantTx(request, fn), orgId);
      const outcome = await runCapture({
        store,
        connection: { id: connection.id, portalKey: connection.portalKey },
        adapter,
        credentials,
        trigger: 'manual',
      });
      await tenantTx(request, async (tx) => {
        await auditRequest(request, tx, {
          orgId,
          action: 'portal_capture.run',
          resourceType: 'portal_capture_run',
          resourceId: outcome.runId,
          after: {
            portalKey: connection.portalKey,
            status: outcome.status,
            ordersNew: outcome.ordersNew,
            ordersRevised: outcome.ordersRevised,
          },
        });
      });
      return tenantTx(request, async (tx) => {
        const [run] = await tx
          .select()
          .from(portalCaptureRuns)
          .where(and(eq(portalCaptureRuns.orgId, orgId), eq(portalCaptureRuns.id, outcome.runId)));
        if (!run) throw problem('internal');
        return runDto(run, connection);
      });
    },
  );

  app.get(
    '/portal-capture/runs',
    {
      config: { permission: READ },
      schema: {
        tags: ['portalCapture'],
        summary: 'Capture run history, newest first.',
        response: { 200: z.object({ items: z.array(CaptureRunSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const byId = await connectionsById(tx, orgId);
        const rows = await tx
          .select()
          .from(portalCaptureRuns)
          .where(eq(portalCaptureRuns.orgId, orgId))
          .orderBy(desc(portalCaptureRuns.createdAt))
          .limit(100);
        return { items: rows.map((r) => runDto(r, byId.get(r.connectionId))) };
      });
    },
  );

  app.get(
    '/portal-capture/external-orders',
    {
      config: { permission: READ },
      schema: {
        tags: ['portalCapture'],
        querystring: OrdersQuery,
        summary: 'Captured external orders with per-line SKU mapping status, newest capture first.',
        response: { 200: z.object({ items: z.array(ExternalOrderSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const byId = await connectionsById(tx, orgId);
        const conditions = [eq(externalOrders.orgId, orgId)];
        if (request.query.status) conditions.push(eq(externalOrders.status, request.query.status));
        const rows = await tx
          .select()
          .from(externalOrders)
          .where(and(...conditions))
          .orderBy(desc(externalOrders.lastCapturedAt))
          .limit(200);
        return {
          items: rows.map((r) => externalOrderDto(r, byId.get(r.connectionId)?.portalKey ?? '')),
        };
      });
    },
  );

  app.post(
    '/portal-capture/external-orders/:orderId/convert',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['portalCapture'],
        params: OrderParams,
        body: ConvertExternalOrderRequestSchema,
        summary:
          'Convert a captured external order into a draft supplier order (human-confirmed). Idempotent: converting again returns the same draft — never two POs.',
        response: { 200: ExternalOrderSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const converted = await tenantTx(request, async (tx) => {
        const [order] = await tx
          .select()
          .from(externalOrders)
          .where(and(eq(externalOrders.orgId, orgId), eq(externalOrders.id, request.params.orderId)))
          .for('update');
        if (!order) throw problem('not_found');
        // Idempotent: an already-converted order returns its existing draft.
        if (order.status === 'converted' && order.convertedOrderId) return order;
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.orgId, orgId), eq(jobs.id, request.body.jobId)));
        if (!job) throw problem('not_found');
        const parsed = z.array(ExternalOrderLineSchema).safeParse(order.lines);
        const lines = parsed.success ? parsed.data : [];
        if (lines.length === 0) {
          throw problem('validation_failed', 'This captured order has no lines to convert.');
        }
        const [draft] = await tx
          .insert(supplierOrders)
          .values({
            orgId,
            jobId: request.body.jobId,
            supplierName: order.builderName,
            origin: 'external_capture',
            reference: request.body.reference ?? order.builderPoNumber,
            lines: lines.map((l) => ({
              label: l.label,
              quantity: l.quantity,
              unit: l.unit,
              unitPriceMinor: l.unitPriceMinor,
            })),
            totalMinor: order.totalMinor,
            status: 'draft',
          })
          .returning();
        if (!draft) throw problem('internal');
        const [row] = await tx
          .update(externalOrders)
          .set({
            status: 'converted',
            convertedOrderId: draft.id,
            revision: order.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(externalOrders.orgId, orgId), eq(externalOrders.id, order.id)))
          .returning();
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'portal_capture.order_converted',
          resourceType: 'external_order',
          resourceId: row.id,
          after: { convertedOrderId: draft.id, builderPoNumber: order.builderPoNumber },
        });
        return row;
      });
      return tenantTx(request, async (tx) => {
        const byId = await connectionsById(tx, orgId);
        return externalOrderDto(converted, byId.get(converted.connectionId)?.portalKey ?? '');
      });
    },
  );
};

export default portalCaptureModule;
