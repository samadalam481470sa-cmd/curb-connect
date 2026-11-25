// `roof` module: traced roof measurements (blueprint "Roof analysis API", MANUAL source path).
//
//   POST /roof/measurements                      trace -> property, roof order, report, version 1
//   GET  /roof/measurements                      recent measurements for this company
//   GET  /roof/measurements/:id                  current version with lon/lat rings and totals
//   POST /roof/measurements/:id/revisions        corrected geometry -> next immutable version
//   POST /roof/measurements/:id/approve          freeze the version (every facet needs a pitch)
//   POST /roof/measurements/:id/estimates        price the approved version -> estimate revision
//   GET  /roof/measurements/:id/estimates        estimates priced from this measurement
//   POST /roof/auto-detect                       candidate facets from satellite + vision (nothing stored)
//   POST /roof/measurements/:id/auto-detect      same, at the saved property's pinned location
//   POST /roof/measurements/:id/auto-detect/confirm  contractor-confirmed candidates -> revision (source AUTO)
//
// The client sends lon/lat rings, pitches and its own unit prices. Areas, quantities and money are
// always recomputed here with @fieldline/geometry and @fieldline/pricing. Orders, report versions
// and estimates follow the state machines in @fieldline/contracts; versions lock on submit (DB
// trigger), so an approved measurement can only change through a new version.
import {
  CreateRoofEstimateRequestSchema,
  CreateRoofMeasurementRequestSchema,
  roofOrderMachine,
  RoofEstimateListSchema,
  RoofEstimateRecordSchema,
  type RoofEstimateRecord,
  RoofMeasurementDetailSchema,
  RoofMeasurementListSchema,
  type RoofOrderStatus,
  roofReportVersionMachine,
  type RoofReportVersionStatus,
  ReviseRoofMeasurementRequestSchema,
  type TracedFacetInput,
  UuidSchema,
} from '@fieldline/contracts';
import { and, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { GoogleSolarProvider } from '../imagery/providers';
import {
  AUTO_DETECT_DISCLAIMER,
  AutoDetectConfirmRequestSchema,
  AutoDetectResponseSchema,
  autoDetectResponse,
  autoDetectWarningText,
  AutoDetectUnavailable,
  detectRoofOutline,
  IMAGERY_SOURCE,
  meanConfidence,
  provenanceOf,
  SatelliteImageUnavailable,
  toTracedFacets,
  type AutoDetectProvenance,
  type AutoDetectResponse,
} from './autoDetect';
import { sectionsFromInsights } from './satellite';
import type { Tx } from '../../db/runtime';
import {
  estimateRevisions,
  estimates,
  materialTakeoffs,
  priceBookRevisions,
  priceBooks,
  priceItems,
  properties,
  roofEdges,
  roofFacets,
  roofOrderEvents,
  roofOrders,
  roofReports,
  roofAnalysisJobs,
  roofReportVersions,
  ROOF_ANALYSIS_JOB_STATUSES,
  roofVertices,
} from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { idempotent } from '../../http/idempotency';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { computeRoofEstimate, jsonSafe } from '../../services/roof-estimate';
import {
  measureTrace,
  type TraceMeasurement,
  TraceTotalsSchema,
  TRACE_WARNINGS,
  traceView,
} from '../../services/roof-trace';
import { requestRoofAnalysis, type RoofAnalysisJobRow } from '../imagery/roof-analysis';

const Params = z.object({ id: UuidSchema });
const PRICE_BOOK_NAME = 'Roof measurement prices';

function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** Per-company, per-year human sequence; the advisory lock serializes concurrent creates. */
async function nextNumber(
  tx: Tx,
  orgId: string,
  kind: 'roof_orders' | 'estimates',
  prefix: string,
): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${kind}:${orgId}`}))`);
  const table = kind === 'roof_orders' ? roofOrders : estimates;
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.orgId, orgId));
  return `${prefix}-${new Date().getFullYear()}-${String((row?.count ?? 0) + 1).padStart(4, '0')}`;
}

function assertOrderTransition(from: RoofOrderStatus, to: RoofOrderStatus) {
  if (!roofOrderMachine.canTransition(from, to)) {
    throw problem(
      'invalid_transition',
      `This measurement is ${from.replace('_', ' ')}; it cannot move to ${to.replace('_', ' ')}.`,
    );
  }
}

function assertVersionTransition(from: RoofReportVersionStatus, to: RoofReportVersionStatus) {
  if (!roofReportVersionMachine.canTransition(from, to)) {
    throw problem('invalid_transition', `Measurement version is ${from}; it cannot become ${to}.`);
  }
}

/** Walks the order through each allowed step, writing one immutable event per step. */
async function moveOrder(
  tx: Tx,
  ctx: { orgId: string; userId: string; correlationId: string },
  orderId: string,
  from: RoofOrderStatus,
  path: readonly RoofOrderStatus[],
  reason: string,
): Promise<RoofOrderStatus> {
  let current = from;
  for (const next of path) {
    assertOrderTransition(current, next);
    await tx.insert(roofOrderEvents).values({
      orgId: ctx.orgId,
      roofOrderId: orderId,
      fromStatus: current,
      toStatus: next,
      actorType: 'user',
      actorUserId: ctx.userId,
      reason,
      correlationId: ctx.correlationId,
      // clock_timestamp(), not now(): steps written in one transaction must stay in order.
      occurredAt: sql`clock_timestamp()`,
    });
    current = next;
  }
  if (current !== from) {
    await tx
      .update(roofOrders)
      .set({ status: current, revision: sql`${roofOrders.revision} + 1` })
      .where(eq(roofOrders.id, orderId));
  }
  return current;
}

/** Writes one draft version with its relational topology rows (facets, vertices, edges). */
async function insertVersion(
  tx: Tx,
  orgId: string,
  reportId: string,
  versionNumber: number,
  measured: TraceMeasurement,
  supersedesVersionId: string | null,
  provenance?: AutoDetectProvenance,
) {
  const [version] = await tx
    .insert(roofReportVersions)
    .values({
      orgId,
      roofReportId: reportId,
      versionNumber,
      status: 'draft',
      geometryRevision: measured.geometry.geometryRevision,
      geometry: measured.geometry,
      totals: measured.totals,
      georef: measured.geometry.georef,
      crs: 'LOCAL_ENU_M',
      // Manual traces record only the trace engine. A confirmed auto-detect additionally
      // records its provenance here (model, detected-at, per-facet confidences) so the AUTO
      // origin survives even though the version source literal stays 'user_entered' — the
      // contractor confirmed every value, and the contracts schema only allows that literal.
      engineVersions: {
        trace: measured.totals.engine,
        ...(provenance ? { autoDetect: provenance } : {}),
      },
      validation: { issues: [] },
      unresolvedIssues: measured.totals.unresolvedFacetKeys.map((key) => ({
        code: 'missing_pitch',
        facetKey: key,
      })),
      supersedesVersionId,
    })
    .returning();
  if (!version) throw new Error('Insert returned no row.');

  const g = measured.geometry;
  await tx.insert(roofVertices).values(
    g.vertices.map((v) => ({
      orgId,
      reportVersionId: version.id,
      key: v.id,
      x: v.x,
      y: v.y,
      z: v.z,
      source: v.source,
    })),
  );
  const figures = new Map(measured.totals.facets.map((f) => [f.key, f]));
  await tx.insert(roofFacets).values(
    g.facets.map((f) => {
      const m = figures.get(f.id)!;
      return {
        orgId,
        reportVersionId: version.id,
        key: f.id,
        label: f.label ?? null,
        surfaceType: f.surfaceType,
        vertexKeys: f.vertexIds,
        pitchRise: f.pitch ? f.pitch.rise.toFixed(4) : null,
        pitchRun: '12',
        pitchRatio: f.pitch ? (f.pitch.rise / 12).toFixed(6) : null,
        pitchSource: f.pitch ? ('user_entered' as const) : null,
        planAreaM2: m.planAreaM2.toFixed(6),
        slopedAreaM2: m.slopedAreaM2 === null ? null : m.slopedAreaM2.toFixed(6),
        areaSource: 'imagery_derived' as const,
        needsReview: f.needsReview,
      };
    }),
  );
  const vById = new Map(g.vertices.map((v) => [v.id, v]));
  await tx.insert(roofEdges).values(
    g.edges.map((e) => {
      const a = vById.get(e.from)!;
      const b = vById.get(e.to)!;
      return {
        orgId,
        reportVersionId: version.id,
        key: e.id,
        fromVertexKey: e.from,
        toVertexKey: e.to,
        leftFacetKey: e.leftFacet,
        rightFacetKey: e.rightFacet,
        edgeType: e.type,
        lengthM: Math.hypot(b.x - a.x, b.y - a.y).toFixed(6),
      };
    }),
  );
  return version;
}

interface Loaded {
  order: typeof roofOrders.$inferSelect;
  report: typeof roofReports.$inferSelect;
  version: typeof roofReportVersions.$inferSelect;
  address: string;
}

/** Loads (and optionally row-locks) a measurement; RLS makes another company's id a 404. */
async function loadMeasurement(tx: Tx, id: string, lock = false): Promise<Loaded> {
  const base = tx.select().from(roofOrders).where(eq(roofOrders.id, id));
  const [order] = lock ? await base.for('update') : await base;
  if (!order) throw problem('not_found');
  const [report] = await tx
    .select()
    .from(roofReports)
    .where(eq(roofReports.roofOrderId, order.id))
    .orderBy(desc(roofReports.createdAt))
    .limit(1);
  if (!report?.currentVersionId)
    throw problem('not_found', 'This roof order has no traced measurement.');
  const [version] = await tx
    .select()
    .from(roofReportVersions)
    .where(eq(roofReportVersions.id, report.currentVersionId));
  if (!version) throw problem('not_found');
  const [property] = await tx
    .select({ label: properties.label, originalQuery: properties.originalQuery })
    .from(properties)
    .where(eq(properties.id, order.propertyId));
  return { order, report, version, address: property?.label ?? property?.originalQuery ?? '' };
}

function summaryOf(l: Loaded) {
  const totals = TraceTotalsSchema.parse(l.version.totals);
  return {
    id: l.order.id,
    number: l.order.number,
    status: l.order.status,
    address: l.address,
    versionNumber: l.version.versionNumber,
    versionStatus: l.version.status,
    planSqFt: Math.round(totals.planAreaM2 * 10.763910416709722 * 10) / 10,
    squares: totals.roofingSquares === null ? null : Math.round(totals.roofingSquares * 100) / 100,
    createdAt: iso(l.order.createdAt)!,
    updatedAt: iso(l.order.updatedAt)!,
  };
}

const AutoDetectEngineSchema = z
  .object({
    autoDetect: z
      .object({
        model: z.string().nullable(),
        detectedAt: z.string().nullable(),
        confidences: z.record(z.string(), z.number()),
      })
      .passthrough(),
  })
  .passthrough();

function detailOf(l: Loaded) {
  const view = traceView(l.version.geometry, l.version.totals);
  const auto = AutoDetectEngineSchema.safeParse(l.version.engineVersions);
  return {
    ...summaryOf(l),
    propertyId: l.order.propertyId,
    version: {
      id: l.version.id,
      versionNumber: l.version.versionNumber,
      status: l.version.status,
      facets: view.facets,
      totals: view.totals,
      source: 'user_entered' as const,
      warnings: [
        ...TRACE_WARNINGS,
        // A confirmed auto-detect keeps its provenance label on every read; manual traces
        // (no autoDetect key) are untouched.
        ...(auto.success
          ? [autoDetectWarningText(auto.data.autoDetect.model, auto.data.autoDetect.confidences)]
          : []),
        ...(view.totals.complete
          ? []
          : [
              `${view.totals.facetsMissingPitch.length} facet(s) have no pitch, so sloped area and squares are unknown.`,
            ]),
      ],
      createdAt: iso(l.version.createdAt)!,
      approvedAt: iso(l.version.approvedAt),
    },
  };
}

const LineView = z.object({
  code: z.string(),
  description: z.string(),
  category: z.string(),
  status: z.enum(['priced', 'unresolved']),
  quantity: z.record(z.string(), z.string()).nullable(),
  unit: z.string(),
  unitRate: z.record(z.string(), z.string()).nullable(),
  extended: z.record(z.string(), z.object({ minor: z.string() })).nullable(),
  formula: z.string(),
});

function estimateOf(
  e: typeof estimates.$inferSelect,
  r: typeof estimateRevisions.$inferSelect,
): RoofEstimateRecord {
  const inputs = z
    .object({ measurementVersionNumber: z.number().int() })
    .passthrough()
    .parse(r.inputs);
  const gating = z
    .object({ warnings: z.array(z.string()) })
    .passthrough()
    .parse(r.gatingResult);
  return {
    id: e.id,
    number: e.number,
    measurementId: e.roofOrderId!,
    status: r.status,
    revisionNumber: r.revisionNumber,
    quoteKind: r.quoteKind,
    isBinding: r.isBinding,
    currency: r.currency,
    subtotalMinor: r.subtotalMinor,
    taxMinor: r.taxMinor,
    totalMinor: r.totalMinor,
    lines: z
      .array(LineView)
      .parse(r.lines)
      .map((l) => ({
        code: l.code,
        description: l.description,
        category: l.category,
        status: l.status,
        quantity: l.quantity?.base ?? null,
        unit: l.unit,
        unitRate: l.unitRate?.base ?? null,
        extendedMinor: l.extended?.base ? Number(l.extended.base.minor) : null,
        formula: l.formula,
      })),
    measurementVersionNumber: inputs.measurementVersionNumber,
    warnings: gating.warnings,
    engineVersion: r.engineVersion,
    createdAt: iso(r.createdAt)!,
  };
}

const RoofAnalysisJobDto = z.object({
  id: UuidSchema,
  propertyId: UuidSchema,
  roofOrderId: UuidSchema.nullable(),
  status: z.enum(ROOF_ANALYSIS_JOB_STATUSES),
  provider: z.string(),
  confirmedAddress: z.string(),
  confirmedLatitude: z.number(),
  confirmedLongitude: z.number(),
  cached: z.boolean(),
  /** Normalized provider insights; null until a run succeeds. */
  result: z.unknown().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});

function jobDto(row: RoofAnalysisJobRow) {
  return {
    id: row.id,
    propertyId: row.propertyId,
    roofOrderId: row.roofOrderId,
    status: row.status,
    provider: row.provider,
    confirmedAddress: row.confirmedAddress,
    confirmedLatitude: row.confirmedLatitude,
    confirmedLongitude: row.confirmedLongitude,
    cached: row.cached,
    result: row.result ?? null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Shared revision flow: measure the facets, supersede the current version, write the next
 * draft version. Used by manual revisions and by auto-detect confirmation alike, so a
 * confirmed auto-detect goes through exactly the same versioning, locking and order
 * transitions as a hand edit. Audit stays with the caller (different actions).
 */
async function applyRevision(
  tx: Tx,
  ctx: { orgId: string; userId: string; correlationId: string },
  loaded: Loaded,
  facets: TracedFacetInput[],
  opts: { reason: string; provenance?: AutoDetectProvenance },
): Promise<{
  version: typeof roofReportVersions.$inferSelect;
  measured: TraceMeasurement;
}> {
  const measured = measureTrace(facets, loaded.version.geometryRevision + 1);
  assertVersionTransition(loaded.version.status, 'superseded');
  // An approved or quoted measurement goes back to review; its estimates stay pinned to the
  // version they priced.
  const path: RoofOrderStatus[] =
    loaded.order.status === 'quoted'
      ? ['approved', 'review_required']
      : loaded.order.status === 'approved'
        ? ['review_required']
        : [];
  await moveOrder(tx, ctx, loaded.order.id, loaded.order.status, path, opts.reason);
  await tx
    .update(roofReportVersions)
    .set({ status: 'superseded' })
    .where(eq(roofReportVersions.id, loaded.version.id));
  const version = await insertVersion(
    tx,
    ctx.orgId,
    loaded.report.id,
    loaded.version.versionNumber + 1,
    measured,
    loaded.version.id,
    opts.provenance,
  );
  await tx
    .update(roofReports)
    .set({
      currentVersionId: version.id,
      status: 'drafting',
      revision: sql`${roofReports.revision} + 1`,
    })
    .where(eq(roofReports.id, loaded.report.id));
  return { version, measured };
}

/** Runs auto-detect for one property centre; imagery/model failures become an honest 200. */
async function runAutoDetect(
  config: {
    homeAi: { baseUrl: string; apiKey: string | undefined; model: string } | null;
    openModel: { baseUrl: string; apiKey: string | undefined; model: string } | null;
  },
  center: { lon: number; lat: number },
): Promise<AutoDetectResponse> {
  const detectedAt = new Date();
  try {
    const result = await detectRoofOutline(
      { homeAi: config.homeAi, openModel: config.openModel },
      center,
    );
    return autoDetectResponse(result, detectedAt);
  } catch (err) {
    if (err instanceof SatelliteImageUnavailable || err instanceof AutoDetectUnavailable) {
      return {
        status: 'unavailable' as const,
        message:
          err instanceof SatelliteImageUnavailable
            ? 'Satellite imagery could not be fetched right now. Trace the roof on the map instead.'
            : err.message,
        model: null,
        imagerySource: IMAGERY_SOURCE,
        imageryDate: null,
        detectedAt: detectedAt.toISOString(),
        facets: [],
        disclaimer: AUTO_DETECT_DISCLAIMER,
      };
    }
    throw err;
  }
}

const roofModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/roof/measurements',
    {
      config: { permission: 'roof_order:create', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Save a traced roof measurement (property, roof order, report version 1)',
        headers: z.object({ 'idempotency-key': z.string().optional() }).loose(),
        body: CreateRoofMeasurementRequestSchema,
        response: { 201: RoofMeasurementDetailSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const measured = measureTrace(request.body.facets, 0);
      // A retried save with the same Idempotency-Key replays the first response.
      return idempotent(request, reply, {}, async (tx) => {
        const now = new Date();
        const [property] = await tx
          .insert(properties)
          .values({
            orgId: org.orgId,
            label: request.body.address,
            originalQuery: request.body.address,
            // The contractor picked the building by tracing it; the traced centre is the pin.
            confirmedLocation: `SRID=4326;POINT(${measured.center.lon} ${measured.center.lat})`,
            confirmedByUserId: org.userId,
            confirmedAt: now,
            notes: request.body.note ?? null,
          })
          .returning({ id: properties.id });
        if (!property) throw new Error('Insert returned no row.');

        const number = await nextNumber(tx, org.orgId, 'roof_orders', 'RM');
        const [order] = await tx
          .insert(roofOrders)
          .values({
            orgId: org.orgId,
            number,
            propertyId: property.id,
            mode: 'diy',
            deliverySpeed: 'instant_diy',
            status: 'draft',
            requestedByMembershipId: org.membershipId,
            instructions: request.body.note ?? null,
          })
          .returning();
        if (!order) throw new Error('Insert returned no row.');
        await moveOrder(
          tx,
          { ...org, correlationId: request.id },
          order.id,
          'draft',
          ['ordered', 'measuring', 'review_required'],
          'Traced by contractor on imagery',
        );

        const [report] = await tx
          .insert(roofReports)
          .values({ orgId: org.orgId, roofOrderId: order.id, status: 'drafting' })
          .returning();
        if (!report) throw new Error('Insert returned no row.');
        const version = await insertVersion(tx, org.orgId, report.id, 1, measured, null);
        await tx
          .update(roofReports)
          .set({ currentVersionId: version.id })
          .where(eq(roofReports.id, report.id));

        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'roof.measurement_created',
          resourceType: 'roof_order',
          resourceId: order.id,
          after: {
            number,
            facets: measured.geometry.facets.length,
            planAreaM2: measured.totals.planAreaM2,
            complete: measured.totals.complete,
          },
        });
        return { status: 201, body: detailOf(await loadMeasurement(tx, order.id)) };
      });
    },
  );

  app.get(
    '/roof/measurements',
    {
      config: { permission: 'roof_order:read' },
      schema: {
        tags: ['roof'],
        summary: 'Recent traced roof measurements for this company',
        response: { 200: RoofMeasurementListSchema },
      },
    },
    async (request) =>
      tenantTx(request, async (tx) => {
        const rows = await tx
          .select({
            order: roofOrders,
            report: roofReports,
            version: roofReportVersions,
            label: properties.label,
            originalQuery: properties.originalQuery,
          })
          .from(roofOrders)
          .innerJoin(roofReports, eq(roofReports.roofOrderId, roofOrders.id))
          .innerJoin(roofReportVersions, eq(roofReportVersions.id, roofReports.currentVersionId))
          .innerJoin(properties, eq(properties.id, roofOrders.propertyId))
          .where(eq(roofOrders.mode, 'diy'))
          .orderBy(desc(roofOrders.updatedAt))
          .limit(50);
        return {
          items: rows.map((r) =>
            summaryOf({
              order: r.order,
              report: r.report,
              version: r.version,
              address: r.label ?? r.originalQuery,
            }),
          ),
        };
      }),
  );

  app.get(
    '/roof/measurements/:id',
    {
      config: { permission: 'roof_report:read' },
      schema: {
        tags: ['roof'],
        summary: 'A traced roof measurement with its current version',
        params: Params,
        response: { 200: RoofMeasurementDetailSchema },
      },
    },
    async (request) =>
      tenantTx(request, async (tx) => detailOf(await loadMeasurement(tx, request.params.id))),
  );

  app.post(
    '/roof/measurements/:id/revisions',
    {
      config: {
        permission: 'roof_report:edit_geometry',
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['roof'],
        summary: 'Submit corrected geometry or pitches as the next measurement version',
        params: Params,
        body: ReviseRoofMeasurementRequestSchema,
        response: { 201: RoofMeasurementDetailSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const detail = await tenantTx(request, async (tx) => {
        const l = await loadMeasurement(tx, request.params.id, true);
        if (l.version.versionNumber !== request.body.baseVersionNumber) {
          throw problem(
            'revision_conflict',
            `This measurement is now at version ${l.version.versionNumber}. Reload it before editing.`,
          );
        }
        const { version, measured } = await applyRevision(
          tx,
          { ...org, correlationId: request.id },
          l,
          request.body.facets,
          { reason: 'Measurement geometry revised' },
        );
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'roof.measurement_revised',
          resourceType: 'roof_order',
          resourceId: l.order.id,
          before: { versionNumber: l.version.versionNumber },
          after: {
            versionNumber: version.versionNumber,
            planAreaM2: measured.totals.planAreaM2,
            complete: measured.totals.complete,
          },
          reason: request.body.note ?? null,
        });
        return detailOf(await loadMeasurement(tx, l.order.id));
      });
      return reply.code(201).send(detail);
    },
  );

  app.post(
    '/roof/auto-detect',
    {
      config: { permission: 'roof_order:read', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Detect candidate roof facets from satellite imagery (nothing is stored)',
        body: z.object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          address: z.string().trim().min(3).max(300).optional(),
        }),
        response: { 200: AutoDetectResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      return runAutoDetect(request.server.config, {
        lon: request.body.longitude,
        lat: request.body.latitude,
      });
    },
  );

  app.post(
    '/roof/measurements/:id/auto-detect',
    {
      config: { permission: 'roof_order:read', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Detect candidate roof facets at the saved measurement’s pinned location',
        params: Params,
        response: { 200: AutoDetectResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const center = await tenantTx(request, async (tx) => {
        const l = await loadMeasurement(tx, request.params.id);
        const [property] = await tx
          .select({ confirmedLocation: properties.confirmedLocation })
          .from(properties)
          .where(eq(properties.id, l.order.propertyId));
        const match = /POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/.exec(
          property?.confirmedLocation ?? '',
        );
        if (!match) {
          throw problem(
            'validation_failed',
            'This measurement has no pinned property location. Fly to the job address on the map and save the measurement again.',
          );
        }
        return { lon: Number(match[1]), lat: Number(match[2]) };
      });
      return runAutoDetect(request.server.config, center);
    },
  );

  app.post(
    '/roof/measurements/:id/auto-detect/confirm',
    {
      config: {
        permission: 'roof_report:edit_geometry',
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['roof'],
        summary:
          'Confirm accepted auto-detected facets as the next measurement version (source AUTO)',
        params: Params,
        body: AutoDetectConfirmRequestSchema,
        response: { 201: RoofMeasurementDetailSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const detail = await tenantTx(request, async (tx) => {
        const l = await loadMeasurement(tx, request.params.id, true);
        if (l.version.versionNumber !== body.baseVersionNumber) {
          throw problem(
            'revision_conflict',
            `This measurement is now at version ${l.version.versionNumber}. Reload it before editing.`,
          );
        }
        const provenance = provenanceOf(body);
        const { version, measured } = await applyRevision(
          tx,
          { ...org, correlationId: request.id },
          l,
          toTracedFacets(body),
          { reason: 'Auto-detected outline confirmed by contractor', provenance },
        );
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'roof.measurement_auto_detect_confirmed',
          resourceType: 'roof_order',
          resourceId: l.order.id,
          before: { versionNumber: l.version.versionNumber },
          after: {
            versionNumber: version.versionNumber,
            planAreaM2: measured.totals.planAreaM2,
            complete: measured.totals.complete,
            source: 'auto',
            model: provenance.model,
            meanConfidence: meanConfidence(provenance),
            facetCount: body.facets.length,
          },
          reason:
            body.note ??
            `Auto-detected outline confirmed by contractor${provenance.model ? ` (model ${provenance.model})` : ''}. Not survey-grade — verify on site.`,
        });
        return detailOf(await loadMeasurement(tx, l.order.id));
      });
      return reply.code(201).send(detail);
    },
  );

  app.post(
    '/roof/measurements/:id/approve',
    {
      config: { permission: 'roof_report:approve', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Approve the current measurement version (requires a pitch on every facet)',
        params: Params,
        response: { 200: RoofMeasurementDetailSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const l = await loadMeasurement(tx, request.params.id, true);
        const totals = TraceTotalsSchema.parse(l.version.totals);
        if (!totals.complete) {
          const labels = totals.facets
            .filter((f) => totals.unresolvedFacetKeys.includes(f.key))
            .map((f) => f.label ?? f.key);
          throw problem(
            'precondition_failed',
            `Enter a pitch for ${labels.join(', ')} before approving. Sloped area is unknown without it.`,
          );
        }
        assertVersionTransition(l.version.status, 'submitted');
        const now = new Date();
        await tx
          .update(roofReportVersions)
          .set({ status: 'submitted', submittedAt: now, submittedByUserId: org.userId })
          .where(eq(roofReportVersions.id, l.version.id));
        assertVersionTransition('submitted', 'approved');
        await tx
          .update(roofReportVersions)
          .set({ status: 'approved', approvedAt: now, approvedByUserId: org.userId })
          .where(eq(roofReportVersions.id, l.version.id));
        await tx
          .update(roofReports)
          .set({ status: 'approved', revision: sql`${roofReports.revision} + 1` })
          .where(eq(roofReports.id, l.report.id));
        await moveOrder(
          tx,
          { ...org, correlationId: request.id },
          l.order.id,
          l.order.status,
          ['approved'],
          `Version ${l.version.versionNumber} approved`,
        );
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'roof.measurement_approved',
          resourceType: 'roof_order',
          resourceId: l.order.id,
          after: {
            versionNumber: l.version.versionNumber,
            slopedAreaM2: totals.slopedAreaM2,
            roofingSquares: totals.roofingSquares,
          },
        });
        return detailOf(await loadMeasurement(tx, l.order.id));
      });
    },
  );

  app.post(
    '/roof/measurements/:id/estimates',
    {
      config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Price the approved measurement with the company’s own unit prices',
        params: Params,
        headers: z.object({ 'idempotency-key': z.string().optional() }).loose(),
        body: CreateRoofEstimateRequestSchema,
        response: { 201: RoofEstimateRecordSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      // Required: a double-submitted estimate would allocate a second number and price book revision.
      return idempotent(request, reply, { required: true }, async (tx) => {
        const l = await loadMeasurement(tx, request.params.id, true);
        if (l.version.status !== 'approved') {
          throw problem(
            'precondition_failed',
            'Approve the measurement first. Estimates are priced only from an approved version.',
          );
        }
        if (request.body.redeck && request.body.prices.deckSheetMinor === null) {
          throw problem('validation_failed', 'Re-deck needs a price per deck sheet.');
        }
        const totals = TraceTotalsSchema.parse(l.version.totals);

        // The prices entered for this estimate become a price book revision, so the estimate pins
        // exactly what it priced. Only members who may approve price books mark it approved.
        let [book] = await tx.select().from(priceBooks).where(eq(priceBooks.name, PRICE_BOOK_NAME));
        if (!book) {
          [book] = await tx
            .insert(priceBooks)
            .values({
              orgId: org.orgId,
              name: PRICE_BOOK_NAME,
              productLine: 'roof',
              currency: 'USD',
            })
            .returning();
        }
        if (!book) throw new Error('Insert returned no row.');
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`price_book:${book.id}`}))`);
        const [last] = await tx
          .select({ n: max(priceBookRevisions.revisionNumber) })
          .from(priceBookRevisions)
          .where(eq(priceBookRevisions.priceBookId, book.id));
        const frac = (p: number) => (p / 100).toFixed(6);
        const [pbRevision] = await tx
          .insert(priceBookRevisions)
          .values({
            orgId: org.orgId,
            priceBookId: book.id,
            revisionNumber: (last?.n ?? 0) + 1,
            status: 'draft',
            effectiveFrom: new Date().toISOString().slice(0, 10),
            overheadRate: frac(request.body.overheadPercent),
            marginStrategy: 'target_margin',
            marginRate: frac(request.body.marginPercent),
            taxRate: frac(request.body.taxPercent),
            notes: `Entered for a roof estimate. Source: ${request.body.priceSource}`,
          })
          .returning();
        if (!pbRevision) throw new Error('Insert returned no row.');

        const computed = computeRoofEstimate(totals, request.body, {
          priceRevisionLabel: pbRevision.id,
          actorUserId: org.userId,
        });
        await tx.insert(priceItems).values(
          computed.priceItems.map((item, i) => ({
            orgId: org.orgId,
            priceBookRevisionId: pbRevision.id,
            code: item.code,
            label: item.label,
            category: item.category,
            costComponent: item.costComponent,
            unit: item.unit,
            unitRate: item.unitRate,
            taxable: item.category === 'material',
            sortOrder: i,
            metadata: { source: request.body.priceSource },
          })),
        );
        if (org.permissions.has('price_book:approve')) {
          await tx
            .update(priceBookRevisions)
            .set({ status: 'approved', approvedAt: new Date(), approvedByUserId: org.userId })
            .where(eq(priceBookRevisions.id, pbRevision.id));
        } else {
          await tx
            .update(priceBookRevisions)
            .set({ status: 'pending_approval' })
            .where(eq(priceBookRevisions.id, pbRevision.id));
        }

        const priced = computed.result.status === 'priced';
        const warnings = [
          ...TRACE_WARNINGS,
          'Edge materials (starter strip, ridge cap, drip edge, flashing) are not included: traced edges are unclassified.',
          ...computed.result.flags.map((f) => f.message),
          ...(priced
            ? []
            : ['Some critical lines are unpriced; no total is shown until they are priced.']),
        ];
        const status = priced ? 'pricing_ready' : 'review_required';
        const number = await nextNumber(tx, org.orgId, 'estimates', 'EST');
        const [estimate] = await tx
          .insert(estimates)
          .values({
            orgId: org.orgId,
            number,
            productLine: 'roof',
            roofOrderId: l.order.id,
            status,
          })
          .returning();
        if (!estimate) throw new Error('Insert returned no row.');
        const [revision] = await tx
          .insert(estimateRevisions)
          .values({
            orgId: org.orgId,
            estimateId: estimate.id,
            revisionNumber: 1,
            status,
            priceBookRevisionId: pbRevision.id,
            inputs: {
              measurementVersionId: l.version.id,
              measurementVersionNumber: l.version.versionNumber,
              request: request.body,
              materials: jsonSafe(computed.materials),
            },
            scenarios: jsonSafe(computed.result.scenarios ?? {}),
            lines: jsonSafe(computed.result.lines),
            currency: 'USD',
            subtotalMinor: computed.subtotalMinor,
            taxMinor: computed.taxMinor,
            totalMinor: computed.totalMinor,
            lowTotalMinor: computed.lowTotalMinor,
            highTotalMinor: computed.highTotalMinor,
            engineVersion: computed.result.engineVersion,
            gatingResult: { blockers: [], warnings, quoteKind: 'review_required' },
            // Contractor-traced, not field verified: never a binding firm quote from here.
            quoteKind: 'review_required',
            isBinding: false,
            assumptions: [
              `Waste ${request.body.wastePercent}%: ${request.body.wasteReason}`,
              `Prices: ${request.body.priceSource}`,
            ],
            createdByUserId: org.userId,
          })
          .returning();
        if (!revision) throw new Error('Insert returned no row.');
        await tx
          .update(estimates)
          .set({ currentRevisionId: revision.id })
          .where(eq(estimates.id, estimate.id));
        await tx.insert(materialTakeoffs).values({
          orgId: org.orgId,
          reportVersionId: l.version.id,
          wasteFraction: Number(computed.wasteFraction).toFixed(6),
          wasteSource: 'human_entered',
          lines: jsonSafe(computed.materials),
          engineVersion: computed.result.engineVersion,
          createdByUserId: org.userId,
        });
        if (l.order.status === 'approved') {
          await moveOrder(
            tx,
            { ...org, correlationId: request.id },
            l.order.id,
            'approved',
            ['quoted'],
            `Estimate ${number} created`,
          );
        }
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'roof.estimate_created',
          resourceType: 'estimate',
          resourceId: estimate.id,
          after: {
            number,
            measurementVersionNumber: l.version.versionNumber,
            totalMinor: computed.totalMinor,
            status,
          },
        });
        return {
          status: 201,
          body: estimateOf({ ...estimate, currentRevisionId: revision.id }, revision),
        };
      });
    },
  );

  app.get(
    '/roof/measurements/:id/estimates',
    {
      config: { permission: 'estimate:read' },
      schema: {
        tags: ['roof'],
        summary: 'Estimates priced from this measurement',
        params: Params,
        response: { 200: RoofEstimateListSchema },
      },
    },
    async (request) =>
      tenantTx(request, async (tx) => {
        const [order] = await tx
          .select({ id: roofOrders.id })
          .from(roofOrders)
          .where(eq(roofOrders.id, request.params.id));
        if (!order) throw problem('not_found');
        const list = await tx
          .select()
          .from(estimates)
          .where(eq(estimates.roofOrderId, order.id))
          .orderBy(desc(estimates.createdAt));
        const ids = list.map((e) => e.currentRevisionId).filter((v): v is string => v !== null);
        const revs = ids.length
          ? await tx.select().from(estimateRevisions).where(inArray(estimateRevisions.id, ids))
          : [];
        const byId = new Map(revs.map((r) => [r.id, r]));
        return {
          items: list.flatMap((e) => {
            const r = e.currentRevisionId ? byId.get(e.currentRevisionId) : undefined;
            return r ? [estimateOf(e, r)] : [];
          }),
        };
      }),
  );

  app.post(
    '/roof/satellite-sections',
    {
      config: { permission: 'roof_order:read', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Roof sections and pitch from Google satellite data (estimate until measured)',
        body: z.object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        }),
        response: {
          200: z.object({
            status: z.enum(['found', 'not_configured', 'not_found', 'unavailable']),
            message: z.string(),
            totalSqFt: z.number(),
            imageryDate: z.string().nullable(),
            imageryQuality: z.string().nullable(),
            sections: z.array(
              z.object({
                name: z.string(),
                slopedSqFt: z.number(),
                planSqFt: z.number().nullable(),
                pitch: z.number(),
                azimuthDegrees: z.number().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      requireOrg(request);
      const empty = { totalSqFt: 0, imageryDate: null, imageryQuality: null, sections: [] };
      const provider = new GoogleSolarProvider({ apiKey: app.config.imagery.googleSolarApiKey });
      if (provider.status().state !== 'configured') {
        return {
          ...empty,
          status: 'not_configured' as const,
          message:
            'Satellite roof measuring needs GOOGLE_SOLAR_API_KEY on the API service. Trace the roof on the map or enter sections instead.',
        };
      }
      const result = await provider.findBuildingInsights(request.body);
      if (!result.ok) {
        return {
          ...empty,
          status: result.code === 'not_found' ? ('not_found' as const) : ('unavailable' as const),
          message: result.message,
        };
      }
      const { sections, totalSqFt } = sectionsFromInsights(result.value);
      return {
        status: sections.length ? ('found' as const) : ('not_found' as const),
        message: sections.length
          ? `Google satellite data found ${sections.length} roof sections. Estimate only until the roof is measured on site.`
          : 'Google has no roof sections for this spot. Trace the roof on the map instead.',
        totalSqFt,
        imageryDate: result.value.imageryDate,
        imageryQuality: result.value.imageryQuality,
        sections,
      };
    },
  );

  app.post(
    '/roof/analysis-jobs',
    {
      config: { permission: 'roof_order:create' },
      schema: {
        tags: ['roof'],
        summary: 'Queue a Google Solar analysis for a property with a confirmed address/pin',
        body: z.object({
          propertyId: UuidSchema,
          roofOrderId: UuidSchema.optional(),
        }),
        response: { 202: z.object({ job: RoofAnalysisJobDto }) },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const job = await tenantTx(request, async (tx) => {
        const created = await requestRoofAnalysis(tx, {
          orgId: org.orgId,
          propertyId: request.body.propertyId,
          roofOrderId: request.body.roofOrderId ?? null,
          requestedByUserId: org.userId,
          correlationId: request.id,
        });
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'roof.analysis_requested',
          resourceType: 'roof_analysis_job',
          resourceId: created.id,
          after: {
            propertyId: created.propertyId,
            roofOrderId: created.roofOrderId,
            provider: created.provider,
            confirmedAddress: created.confirmedAddress,
          },
        });
        return created;
      });
      reply.status(202);
      return { job: jobDto(job) };
    },
  );

  app.get(
    '/roof/analysis-jobs/:id',
    {
      config: { permission: 'roof_order:read' },
      schema: {
        tags: ['roof'],
        summary: 'Roof analysis status, cache indicator and normalized insights',
        params: z.object({ id: UuidSchema }),
        response: { 200: z.object({ job: RoofAnalysisJobDto }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const [job] = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(roofAnalysisJobs)
          .where(
            and(eq(roofAnalysisJobs.orgId, org.orgId), eq(roofAnalysisJobs.id, request.params.id)),
          )
          .limit(1),
      );
      if (!job) throw problem('not_found');
      return { job: jobDto(job) };
    },
  );
};

export default roofModule;
