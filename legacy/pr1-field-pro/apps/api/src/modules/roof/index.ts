/**
 * `roof` module: draft roof orders, GeoJSON geometry on report versions, and server-side takeoff.
 * Auto-scan uses licensed OSM building footprints + optional Google Solar pitch/area (not basemap ML).
 */
import {
  CreateRoofOrderRequestSchema,
  PageQuerySchema,
  RoofOrderListSchema,
  RoofOrderSchema,
  UuidSchema,
} from '@fieldline/contracts';
import { GEOMETRY_VERSION } from '@fieldline/geometry';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  properties,
  roofOrderEvents,
  roofOrders,
  roofReports,
  roofReportVersions,
  structures,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { afterCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { pointEwkt } from '../properties/geo';
import {
  calculateRoofFromGeoJson,
  RoofCalculateBodySchema,
  RoofGeometryInputSchema,
  roundRoofTotals,
} from './geometry-calc';
import {
  RoofScanRequestSchema,
  RoofScanResponseSchema,
  runRoofScan,
} from './scan';

const IdParams = z.object({ id: UuidSchema });

const CreateOrderBodySchema = CreateRoofOrderRequestSchema.partial({
  propertyId: true,
  structureIds: true,
  mode: true,
})
  .extend({
    propertyId: UuidSchema.optional(),
    mode: z.enum(['diy', 'assisted']).default('diy'),
    structureIds: z.array(UuidSchema).default([]),
    address: z
      .object({
        originalQuery: z.string().trim().min(3).max(300),
        line1: z.string().max(200).optional(),
        locality: z.string().max(120).optional(),
        region: z.string().max(120).optional(),
        postalCode: z.string().max(20).optional(),
        countryCode: z.string().length(2).optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      })
      .optional(),
    instructions: z.string().max(4000).optional(),
  })
  .refine((b) => b.propertyId || b.address, {
    message: 'propertyId or address is required',
  });

const PutGeometryBodySchema = z.object({
  geometry: RoofGeometryInputSchema,
  pitches: z
    .array(
      z.object({
        facetIndex: z.number().int().nonnegative(),
        pitchRise: z.number().min(0),
        pitchRun: z.number().positive(),
      }),
    )
    .optional(),
});

const RoofOrderDtoSchema = RoofOrderSchema;
const CalcResponseSchema = z.object({
  planAreaM2: z.number(),
  planAreaFt2: z.number(),
  slopedAreaM2: z.number(),
  slopedAreaFt2: z.number(),
  perimeterM: z.number(),
  perimeterFt: z.number(),
  squares: z.number(),
  edgeLengthsM: z.array(z.number()),
  facets: z.array(z.record(z.string(), z.unknown())),
  georef: z.record(z.string(), z.unknown()),
  issues: z.array(z.object({ code: z.string(), message: z.string() })),
  reportVersionId: UuidSchema,
  geometryVersion: z.string(),
});

type OrderRow = typeof roofOrders.$inferSelect;

function orderDto(row: OrderRow, reportIds: string[] = []) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    number: row.number,
    propertyId: row.propertyId,
    jobId: row.jobId,
    mode: row.mode,
    deliverySpeed: row.deliverySpeed,
    status: row.status,
    structureIds: row.structureIds ?? [],
    imageryAssetId: row.imageryAssetId,
    instructions: row.instructions,
    dueAt: row.dueAt?.toISOString() ?? null,
    price:
      row.priceMinor != null
        ? { amountMinor: row.priceMinor, currency: row.currency ?? 'USD' }
        : null,
    failureReason: row.failureReason,
    reportIds,
  };
}

async function nextOrderNumber(tx: Tx, orgId: string): Promise<string> {
  const [row] = await tx
    .select({ n: count() })
    .from(roofOrders)
    .where(eq(roofOrders.orgId, orgId));
  const seq = Number(row?.n ?? 0) + 1;
  return `RO-${String(seq).padStart(5, '0')}`;
}

async function loadOrderBundle(tx: Tx, orgId: string, id: string) {
  const [order] = await tx
    .select()
    .from(roofOrders)
    .where(and(eq(roofOrders.orgId, orgId), eq(roofOrders.id, id)));
  if (!order) return null;
  const reports = await tx
    .select({ id: roofReports.id })
    .from(roofReports)
    .where(and(eq(roofReports.orgId, orgId), eq(roofReports.roofOrderId, id)));
  return { order, reportIds: reports.map((r) => r.id) };
}

async function ensureDraftVersion(tx: Tx, orgId: string, orderId: string, structureId: string | null) {
  let [report] = await tx
    .select()
    .from(roofReports)
    .where(and(eq(roofReports.orgId, orgId), eq(roofReports.roofOrderId, orderId)))
    .limit(1);
  if (!report) {
    const [created] = await tx
      .insert(roofReports)
      .values({
        orgId,
        roofOrderId: orderId,
        structureId,
        status: 'drafting',
      })
      .returning();
    report = created!;
  }
  let [version] = await tx
    .select()
    .from(roofReportVersions)
    .where(
      and(
        eq(roofReportVersions.orgId, orgId),
        eq(roofReportVersions.roofReportId, report.id),
        eq(roofReportVersions.status, 'draft'),
      ),
    )
    .orderBy(desc(roofReportVersions.versionNumber))
    .limit(1);
  if (!version) {
    const [created] = await tx
      .insert(roofReportVersions)
      .values({
        orgId,
        roofReportId: report.id,
        versionNumber: 1,
        status: 'draft',
        engineVersions: { geometry: GEOMETRY_VERSION },
      })
      .returning();
    version = created!;
    await tx
      .update(roofReports)
      .set({ currentVersionId: version.id, revision: report.revision + 1 })
      .where(eq(roofReports.id, report.id));
  }
  return { report, version };
}

const roofModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/roof/scan',
    {
      config: {
        permission: 'roof_order:read',
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['roof'],
        summary:
          'Auto-scan a building roof outline (OSM footprint + optional Google Solar pitch/area). Results require review.',
        body: RoofScanRequestSchema,
        response: { 200: RoofScanResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      return runRoofScan(request.body, {
        googleSolarApiKey:
          process.env.GOOGLE_SOLAR_API_KEY?.trim() ||
          process.env.GOOGLE_MAPS_API_KEY?.trim() ||
          null,
      });
    },
  );

  app.post(
    '/roof/orders',
    {
      config: { permission: 'roof_order:create' },
      schema: {
        tags: ['roof'],
        summary: 'Create a draft roof order (propertyId or inline address)',
        body: CreateOrderBodySchema,
        response: { 201: RoofOrderDtoSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const dto = await tenantTx(request, async (tx) => {
        let propertyId = body.propertyId ?? null;
        if (!propertyId && body.address) {
          const a = body.address;
          const location =
            a.lat != null && a.lng != null ? pointEwkt(a.lng, a.lat) : null;
          const [prop] = await tx
            .insert(properties)
            .values({
              orgId: org.orgId,
              originalQuery: a.originalQuery,
              line1: a.line1 ?? null,
              locality: a.locality ?? null,
              region: a.region ?? null,
              postalCode: a.postalCode ?? null,
              countryCode: a.countryCode ?? 'US',
              location,
            })
            .returning({ id: properties.id });
          propertyId = prop!.id;
        }
        if (!propertyId) throw problem('validation_failed', 'propertyId or address is required');

        let structureIds = body.structureIds ?? [];
        if (structureIds.length === 0) {
          const [st] = await tx
            .insert(structures)
            .values({
              orgId: org.orgId,
              propertyId,
              label: 'Main',
              kind: 'main_house',
            })
            .returning({ id: structures.id });
          structureIds = [st!.id];
        }

        const number = await nextOrderNumber(tx, org.orgId);
        const [order] = await tx
          .insert(roofOrders)
          .values({
            orgId: org.orgId,
            number,
            propertyId,
            jobId: body.jobId ?? null,
            mode: body.mode ?? 'diy',
            deliverySpeed: body.deliverySpeed ?? 'standard',
            status: 'draft',
            structureIds,
            instructions: body.instructions ?? null,
            requestedByMembershipId: org.membershipId,
          })
          .returning();
        await tx.insert(roofOrderEvents).values({
          orgId: org.orgId,
          roofOrderId: order!.id,
          fromStatus: null,
          toStatus: 'draft',
          actorType: 'user',
          actorUserId: org.userId,
          reason: 'created',
          correlationId: request.id,
        });
        await ensureDraftVersion(tx, org.orgId, order!.id, structureIds[0] ?? null);
        const out = orderDto(order!, []);
        const bundle = await loadOrderBundle(tx, org.orgId, order!.id);
        const full = orderDto(bundle!.order, bundle!.reportIds);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'roof_order.created',
          resourceType: 'roof_order',
          resourceId: order!.id,
          after: full,
        });
        return full;
      });
      reply.status(201);
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  app.get(
    '/roof/orders',
    {
      config: { permission: 'roof_order:read' },
      schema: {
        tags: ['roof'],
        summary: 'List roof orders',
        querystring: PageQuerySchema,
        response: { 200: RoofOrderListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, cursor } = request.query;
      const after = decodeCursor(cursor);
      const rows = await tenantTx(request, async (tx) => {
        const orders = await tx
          .select()
          .from(roofOrders)
          .where(
            and(
              eq(roofOrders.orgId, org.orgId),
              afterCursor(roofOrders.createdAt, roofOrders.id, after),
            ),
          )
          .orderBy(asc(msTrunc(roofOrders.createdAt)), asc(roofOrders.id))
          .limit(limit + 1);
        const ids = orders.map((o) => o.id);
        const reports =
          ids.length === 0
            ? []
            : await tx
                .select({ id: roofReports.id, roofOrderId: roofReports.roofOrderId })
                .from(roofReports)
                .where(
                  and(eq(roofReports.orgId, org.orgId), inArray(roofReports.roofOrderId, ids)),
                );
        const byOrder = new Map<string, string[]>();
        for (const r of reports) {
          const list = byOrder.get(r.roofOrderId) ?? [];
          list.push(r.id);
          byOrder.set(r.roofOrderId, list);
        }
        return orders.map((o) => ({ order: o, reportIds: byOrder.get(o.id) ?? [] }));
      });
      return pageResult(
        rows,
        limit,
        (r) => ({ at: r.order.createdAt, id: r.order.id }),
        (r) => orderDto(r.order, r.reportIds),
      );
    },
  );

  app.get(
    '/roof/orders/:id',
    {
      config: { permission: 'roof_order:read' },
      schema: {
        tags: ['roof'],
        summary: 'Get a roof order',
        params: IdParams,
        response: { 200: RoofOrderDtoSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const bundle = await tenantTx(request, (tx) =>
        loadOrderBundle(tx, org.orgId, request.params.id),
      );
      if (!bundle) throw problem('not_found');
      setEtag(reply, bundle.order.revision);
      return orderDto(bundle.order, bundle.reportIds);
    },
  );

  app.put(
    '/roof/orders/:id/geometry',
    {
      config: { permission: 'roof_report:edit_geometry' },
      schema: {
        tags: ['roof'],
        summary: 'Store GeoJSON Polygon/MultiPolygon (WGS84) + planar meters snapshot on draft version',
        params: IdParams,
        body: PutGeometryBodySchema,
        response: {
          200: z.object({
            reportVersionId: UuidSchema,
            geometryRevision: z.number().int(),
            georef: z.record(z.string(), z.unknown()),
            issues: z.array(z.object({ code: z.string(), message: z.string() })),
          }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const body = request.body;
      return tenantTx(request, async (tx) => {
        const bundle = await loadOrderBundle(tx, org.orgId, request.params.id);
        if (!bundle) throw problem('not_found');
        const structureId = bundle.order.structureIds[0] ?? null;
        const { version } = await ensureDraftVersion(
          tx,
          org.orgId,
          bundle.order.id,
          structureId,
        );
        if (version.status !== 'draft') {
          throw problem('immutable_record', 'Only draft report versions accept geometry edits.');
        }
        const calc = calculateRoofFromGeoJson(body.geometry, body.pitches ?? []);
        const geometryPayload = {
          type: 'geojson_wgs84',
          geojson: body.geometry,
          planarMeters: calc.planarRingsM,
          pitches: body.pitches ?? [],
        };
        const [updated] = await tx
          .update(roofReportVersions)
          .set({
            geometry: geometryPayload,
            georef: calc.georef,
            geometryRevision: version.geometryRevision + 1,
            unresolvedIssues: calc.issues,
            engineVersions: { geometry: GEOMETRY_VERSION },
            revision: version.revision + 1,
          })
          .where(eq(roofReportVersions.id, version.id))
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'roof_report.geometry_updated',
          resourceType: 'roof_report_version',
          resourceId: version.id,
          after: { geometryRevision: updated!.geometryRevision },
        });
        return {
          reportVersionId: updated!.id,
          geometryRevision: updated!.geometryRevision,
          georef: calc.georef,
          issues: calc.issues,
        };
      });
    },
  );

  app.post(
    '/roof/orders/:id/calculate',
    {
      config: { permission: 'roof_takeoff:write' },
      schema: {
        tags: ['roof'],
        summary:
          'Calculate plan/sloped area, perimeter, edges and squares from stored or provided geometry',
        params: IdParams,
        body: RoofCalculateBodySchema,
        response: { 200: CalcResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const body = request.body;
      return tenantTx(request, async (tx) => {
        const bundle = await loadOrderBundle(tx, org.orgId, request.params.id);
        if (!bundle) throw problem('not_found');
        const structureId = bundle.order.structureIds[0] ?? null;
        const { version } = await ensureDraftVersion(
          tx,
          org.orgId,
          bundle.order.id,
          structureId,
        );

        let geometry = body.geometry;
        let pitches = body.pitches;
        if (!geometry) {
          const stored = version.geometry as {
            geojson?: z.infer<typeof RoofGeometryInputSchema>;
            pitches?: typeof pitches;
          } | null;
          if (!stored?.geojson) {
            throw problem(
              'validation_failed',
              'No geometry on this order. PUT /v1/roof/orders/:id/geometry first, or pass geometry in the body.',
            );
          }
          geometry = stored.geojson;
          if (!pitches?.length && stored.pitches?.length) pitches = stored.pitches;
        }

        const calc = calculateRoofFromGeoJson(geometry, pitches ?? []);
        if (calc.issues.some((i) => i.code === 'self_intersection' || i.code === 'zero_area')) {
          throw problem('geometry_invalid', calc.issues.map((i) => i.message).join('; '));
        }
        const rounded = roundRoofTotals(calc);
        const totals = {
          planAreaM2: rounded.planAreaM2,
          slopedAreaM2: rounded.slopedAreaM2,
          perimeterM: rounded.perimeterM,
          squares: rounded.squares,
          facets: rounded.facets,
          edgeLengthsM: rounded.edgeLengthsM,
          planAreaFt2: rounded.planAreaFt2,
          slopedAreaFt2: rounded.slopedAreaFt2,
        };
        const [updated] = await tx
          .update(roofReportVersions)
          .set({
            geometry: {
              type: 'geojson_wgs84',
              geojson: geometry,
              planarMeters: calc.planarRingsM,
              pitches: pitches ?? [],
            },
            georef: calc.georef,
            totals,
            unresolvedIssues: calc.issues,
            engineVersions: { geometry: GEOMETRY_VERSION },
            revision: version.revision + 1,
          })
          .where(eq(roofReportVersions.id, version.id))
          .returning({ id: roofReportVersions.id });

        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'roof_order.calculated',
          resourceType: 'roof_order',
          resourceId: bundle.order.id,
          after: { totals, reportVersionId: updated!.id },
        });

        return {
          ...rounded,
          reportVersionId: updated!.id,
          geometryVersion: GEOMETRY_VERSION,
        };
      });
    },
  );
};

export default roofModule;
