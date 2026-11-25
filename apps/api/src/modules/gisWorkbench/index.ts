// GIS Workbench (the QGIS-desktop equivalent built for the web).
//
//   POST /gis/layers/parcels   CAD parcels with outlines for the map view (Collin + Dallas services)
//   POST /gis/layers/streams   USGS NHD flowlines for the map view
//   POST /gis/layers/roofs     the company's saved traced roofs whose pins fall in the map view
//   POST /gis/print            render the current view as a DRAFT plan sheet PDF (never a survey)
//
// (Registered under the /v1 prefix by the coordinator; see apps/api/src/modules/registry.ts.)
//
// Honesty rules, enforced here:
// - Layers come only from the live publishers (county CAD, USGS NHD) or the company's own saved
//   measurements; a down upstream is `upstream_unavailable`, never invented rows.
// - Record caps are said plainly (`truncated`), and a view too wide for view-scale queries is
//   refused with the reason instead of being silently capped.
// - Saved roofs whose stored geometry cannot be read are counted (`unreadable`), never placed.
// - The plan sheet says DRAFT — not a survey — on its face, and carries every source note.
import {
  GisLayerQuerySchema,
  GisParcelsResponseSchema,
  GisPrintRequestSchema,
  GisPrintResponseSchema,
  GisRoofsResponseSchema,
  GisStreamsResponseSchema,
  type GisRoofFeature,
} from '@fieldline/contracts';
import { renderToBuffer, type MapPlanSheetSnapshot } from '@fieldline/pdf';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { properties, roofOrders, roofReports, roofReportVersions } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { traceView } from '../../services/roof-trace';
import {
  bboxContains,
  checkBbox,
  fetchParcelsInBbox,
  fetchStreamsInBbox,
  PARCELS_SOURCE,
  PARCELS_SOURCE_URL,
  ROOFS_SOURCE,
  STREAMS_SOURCE,
  STREAMS_SOURCE_URL,
} from './layers';

const MAX_ROOF_MEASUREMENTS = 200;

const gisWorkbenchModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/gis/layers/parcels',
    {
      config: { permission: 'estimate:read', rateLimit: { max: 30, timeWindow: '1 minute' } },
      bodyLimit: 1024,
      schema: {
        tags: ['gis workbench'],
        summary: 'CAD parcels with outlines intersecting the map view (Collin + Dallas services)',
        body: GisLayerQuerySchema,
        response: { 200: GisParcelsResponseSchema },
      },
    },
    async (request, reply) => {
      requireOrg(request);
      reply.header('cache-control', 'private, no-store');
      const check = checkBbox(request.body.bbox);
      if (!check.ok) throw problem('bad_request', check.reason);
      const result = await fetchParcelsInBbox(check.bbox);
      return {
        status: result.status,
        source: PARCELS_SOURCE,
        sourceUrl: PARCELS_SOURCE_URL,
        checkedAt: new Date().toISOString(),
        truncated: result.truncated,
        featureCount: result.features.length,
        message: result.message,
        features: result.features,
      };
    },
  );

  app.post(
    '/gis/layers/streams',
    {
      config: { permission: 'estimate:read', rateLimit: { max: 30, timeWindow: '1 minute' } },
      bodyLimit: 1024,
      schema: {
        tags: ['gis workbench'],
        summary: 'USGS NHD flowlines intersecting the map view',
        body: GisLayerQuerySchema,
        response: { 200: GisStreamsResponseSchema },
      },
    },
    async (request, reply) => {
      requireOrg(request);
      reply.header('cache-control', 'private, no-store');
      const check = checkBbox(request.body.bbox);
      if (!check.ok) throw problem('bad_request', check.reason);
      const result = await fetchStreamsInBbox(check.bbox);
      return {
        status: result.status,
        source: STREAMS_SOURCE,
        sourceUrl: STREAMS_SOURCE_URL,
        checkedAt: new Date().toISOString(),
        truncated: result.truncated,
        featureCount: result.features.length,
        message: result.message,
        features: result.features,
      };
    },
  );

  app.post(
    '/gis/layers/roofs',
    {
      config: { permission: 'roof_order:read', rateLimit: { max: 30, timeWindow: '1 minute' } },
      bodyLimit: 1024,
      schema: {
        tags: ['gis workbench'],
        summary: 'Saved traced roofs whose property pins fall in the map view',
        body: GisLayerQuerySchema,
        response: { 200: GisRoofsResponseSchema },
      },
    },
    async (request, reply) => {
      requireOrg(request);
      reply.header('cache-control', 'private, no-store');
      const check = checkBbox(request.body.bbox);
      if (!check.ok) throw problem('bad_request', check.reason);
      const bbox = check.bbox;
      return tenantTx(request, async (tx) => {
        const pin = sql`coalesce(${properties.confirmedLocation}, ${properties.location})`;
        const rows = await tx
          .select({
            orderId: roofOrders.id,
            geometry: roofReportVersions.geometry,
            totals: roofReportVersions.totals,
            label: properties.label,
            originalQuery: properties.originalQuery,
            lat: sql<number | null>`ST_Y((${pin})::geometry)`,
            lon: sql<number | null>`ST_X((${pin})::geometry)`,
          })
          .from(roofOrders)
          .innerJoin(roofReports, eq(roofReports.roofOrderId, roofOrders.id))
          .innerJoin(roofReportVersions, eq(roofReportVersions.id, roofReports.currentVersionId))
          .innerJoin(properties, eq(properties.id, roofOrders.propertyId))
          .where(
            and(
              eq(roofOrders.mode, 'diy'),
              sql`ST_X((${pin})::geometry) BETWEEN ${bbox.west} AND ${bbox.east}`,
              sql`ST_Y((${pin})::geometry) BETWEEN ${bbox.south} AND ${bbox.north}`,
            ),
          )
          .orderBy(desc(roofOrders.updatedAt))
          .limit(MAX_ROOF_MEASUREMENTS);
        const features: GisRoofFeature[] = [];
        let unreadable = 0;
        for (const row of rows) {
          if (row.lat === null || row.lon === null || !bboxContains(row.lon, row.lat, bbox)) continue;
          let facets;
          try {
            facets = traceView(row.geometry, row.totals).facets;
          } catch {
            unreadable += 1;
            continue;
          }
          const address = row.label ?? row.originalQuery;
          for (const facet of facets) {
            const ring = facet.ring.map((p) => [p.lon, p.lat]);
            const first = ring[0];
            if (!first || ring.length < 3) continue;
            features.push({
              type: 'Feature',
              geometry: { type: 'Polygon', coordinates: [[...ring, first]] },
              properties: {
                layer: 'roofs',
                measurementId: row.orderId,
                address,
                label: facet.label,
                planSqFt: facet.planSqFt,
                slopedSqFt: facet.slopedSqFt,
                pitchRise: facet.pitchRise,
                needsReview: facet.needsReview,
              },
            });
          }
        }
        return {
          status: features.length > 0 ? ('ok' as const) : ('empty' as const),
          source: ROOFS_SOURCE,
          checkedAt: new Date().toISOString(),
          unreadable,
          featureCount: features.length,
          message:
            features.length > 0
              ? `${features.length} traced roof facets in this view.`
              : 'No saved traced roofs have a property pin in this view. Trace a roof in Roof Measurements and it will appear here.',
          features,
        };
      });
    },
  );

  app.post(
    '/gis/print',
    {
      bodyLimit: 8 * 1024 * 1024,
      config: { permission: 'export:create', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['gis workbench'],
        summary: 'Render the current workbench view as a DRAFT plan sheet PDF (never a survey)',
        body: GisPrintRequestSchema,
        response: { 200: GisPrintResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const body = request.body;
      const now = new Date();
      const documentId = `MAP-${now.toISOString().slice(0, 10)}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
      const snapshot: MapPlanSheetSnapshot = {
        kind: 'map_plan_sheet',
        meta: {
          documentId,
          revision: 1,
          issuedAt: now.toISOString(),
          organization: { name: body.organizationName },
          productName: 'Field Pro',
        },
        title: body.title,
        pageSize: body.pageSize === 'letter' ? 'LETTER' : body.pageSize === 'legal' ? 'LEGAL' : 'TABLOID',
        orientation: body.orientation,
        mapImageDataUrl: body.mapImageDataUrl,
        centerLat: body.centerLat,
        centerLon: body.centerLon,
        zoom: body.zoom,
        bearing: body.bearing,
        scaleBarLabel: body.scaleBarLabel,
        scaleBarWidthFraction: body.scaleBarWidthFraction,
        legend: body.legend,
        layerSummary: body.layerSummary,
        sourceNotes: body.sourceNotes,
      };
      const rendered = await renderToBuffer(snapshot);
      return {
        filename: `${documentId}.pdf`,
        contentBase64: rendered.buffer.toString('base64'),
        sha256Hex: rendered.sha256,
        pages: rendered.pageCount,
      };
    },
  );
};

export default gisWorkbenchModule;
