// `roof` module (RF-006, RF-021..RF-030, RR-031..RR-040, COS-201..COS-225 roofing parts, ADD-020..ADD-039).
//   orders    POST /roof/orders (Idempotency-Key: one order per duplicate submit), transitions with
//             immutable events, honest SLA classes, credit reservation released on failure.
//   geometry  PATCH /roof/reports/{id}/geometry (If-Match geometry revision) -> RoofGeometryEdited
//             on the shared command bus; the version's command log replays deterministically.
//   review    submit -> review task (claim leases, optional second review) -> approved version.
//   quantity  takeoff (packages/pricing), append-only overrides with reason + approver.
//   outputs   PDF/CSV/JSON exports from a frozen snapshot (rights-gated imagery), version compare,
//             quote preview (good/better/best) and conversion into a shared roof estimate.
import {
  CommandReceiptSchema,
  ExportRecordDtoSchema,
  type ReviewDecision,
  RoofGeometryEditSchema,
  type RoofGeometryState,
  RoofGeometryStateSchema,
  RoofExportRequestSchema,
  RoofOrderCreateSchema,
  RoofOrderDtoSchema,
  RoofOrderEventDtoSchema,
  type RoofOrderStatus,
  RoofOrderTransitionSchema,
  RoofOverrideCreateSchema,
  RoofQuoteRequestSchema,
  RoofTakeoffDtoSchema,
  RoofTakeoffRequestSchema,
  UuidSchema,
} from '@fieldline/contracts';
import { PDF_TEMPLATES_VERSION, renderToBuffer } from '@fieldline/pdf';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { estimates, materialTakeoffs, measurementOverrides, roofOrderEvents, roofOrders, roofReports, roofReportVersions, structures } from '../../db/schema';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { idempotent } from '../../http/idempotency';
import { problem } from '../../http/problem';
import { parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { executeResourceCommand } from '../commands/pipeline';
import { estimateDto } from '../estimates';
import { applyRevision, nextEstimateNumber } from '../estimates/service';
import { createExport, scheduleExport } from '../exports';
import { exportDto, registerExportSubject } from '../exports/service';
import { assertUse, parseLicense } from '../imagery/rights';
import { isCalibrated, requireImagery } from '../imagery/service';
import { loadProperty } from '../properties/service';
import { cancelOpenTasks, createReviewTask, registerReviewSubject } from '../reviews/service';
import { loadGeometryAggregate, registerRoofCommands, scopeOf } from './commands';
import { geometryState, loadOps, opsToCommands, replayCommands } from './geometry';
import { priceTier, quoteInputs } from './quote';
import {
  type Actor,
  consumeCredit,
  createReport,
  markRoofEstimatesStale,
  newDraftFrom,
  nextOrderNumber,
  orderDto,
  recordEvent,
  reportForOrder,
  requireOrder,
  requireReport,
  requireVersion,
  reserveCredit,
  type RoofOrderRow,
  type RoofVersionRow,
  setVersionStatus,
  transitionOrder,
} from './service';
import { computeSla } from './sla';
import { buildReportSnapshot, reportCsv, reportJson } from './snapshot';
import { computeTakeoff, OVERRIDE_SUBJECT, requireValidGeometry } from './takeoff';

registerRoofCommands();

const IdParams = z.object({ id: UuidSchema });
const VERSION_SUBJECT = 'roof_report_version';

function actorOf(request: FastifyRequest): Actor & { membershipId: string } {
  const org = requireOrg(request);
  return { orgId: org.orgId, userId: org.userId, membershipId: org.membershipId, correlationId: request.id };
}

/** Geometry state of any version (draft: replay the log; locked: frozen snapshot). */
async function versionState(tx: Tx, orgId: string, v: RoofVersionRow, order: RoofOrderRow): Promise<RoofGeometryState> {
  const scope = await scopeOf(tx, orgId, order);
  if (v.status !== 'draft' && v.geometry) return { ...(v.geometry as RoofGeometryState), versionStatus: v.status };
  const r = replayCommands(opsToCommands(await loadOps(tx, orgId, v.id)), scope.excludedStructureIds);
  return geometryState(r, {
    reportId: v.roofReportId,
    versionId: v.id,
    versionNumber: v.versionNumber,
    versionStatus: v.status,
    geometryRevision: v.geometryRevision,
    scopeStructureIds: scope.scopeStructureIds,
    excludedStructureIds: scope.excludedStructureIds,
  });
}

/** Enter `measuring`: make sure there is a report with a draft version. */
async function enterMeasuring(tx: Tx, actor: Actor, order: RoofOrderRow, reason: string): Promise<RoofOrderRow> {
  const next = await transitionOrder(tx, actor, order, 'measuring', reason);
  if (!(await reportForOrder(tx, actor.orgId, order.id))) await createReport(tx, actor.orgId, next);
  return next;
}

// ------------------------------------------------------------------ review outcome (RR-033, ADD-036)
registerReviewSubject(VERSION_SUBJECT, {
  async validate(tx, task, actor) {
    const v = await requireVersion(tx, actor.orgId, task.subjectId);
    const report = await requireReport(tx, actor.orgId, v.roofReportId);
    const order = await requireOrder(tx, actor.orgId, report.roofOrderId);
    // Separation of duties for assisted measurement: whoever traced/submitted does not approve it.
    if (order.mode === 'assisted' && v.submittedByUserId === actor.userId) {
      throw problem('approval_separation_of_duties', 'The person who submitted this measurement cannot review it.');
    }
  },
  async onDecision(tx, task, actor, decision: ReviewDecision) {
    const a: Actor = { orgId: actor.orgId, userId: actor.userId };
    const v = await requireVersion(tx, actor.orgId, task.subjectId);
    const report = await requireReport(tx, actor.orgId, v.roofReportId, true);
    let order = await requireOrder(tx, actor.orgId, report.roofOrderId, true);
    if (v.status !== 'submitted') throw problem('conflict', `Version ${v.versionNumber} is ${v.status}; a newer decision already applied.`);
    if (decision === 'approved') {
      // Earlier approved/issued versions of this report are superseded, never edited.
      const older = await tx.select().from(roofReportVersions).where(and(eq(roofReportVersions.orgId, actor.orgId), eq(roofReportVersions.roofReportId, report.id), inArray(roofReportVersions.status, ['approved', 'issued'])));
      for (const o of older) await setVersionStatus(tx, actor.orgId, o, 'superseded');
      await setVersionStatus(tx, actor.orgId, v, 'approved', { approvedAt: actor.now, approvedByUserId: actor.userId });
      await tx.update(roofReports).set({ status: 'approved', revision: report.revision + 1 }).where(eq(roofReports.id, report.id));
      order = await transitionOrder(tx, a, order, 'approved', 'review approved', { reviewTaskId: task.id, versionId: v.id });
      await consumeCredit(tx, actor.orgId, order);
      return;
    }
    if (decision === 'escalated') {
      await createReviewTask(tx, { orgId: actor.orgId, kind: 'roof_second_review', subjectType: VERSION_SUBJECT, subjectId: v.id, requiresSecondReview: false, dueAt: task.dueAt, priority: 'urgent' });
      return;
    }
    await setVersionStatus(tx, actor.orgId, v, 'rejected');
    if (decision === 'rejected') {
      await tx.update(roofReports).set({ status: 'cancelled', revision: report.revision + 1 }).where(eq(roofReports.id, report.id));
      await transitionOrder(tx, a, order, 'failed', `review rejected: ${task.comments ?? 'no comment'}`, { reviewTaskId: task.id }, { failureReason: 'measurement rejected in review' });
      return;
    }
    // changes / clarification / recapture: a new draft continues from the reviewed command log.
    const fresh = await requireReport(tx, actor.orgId, report.id);
    await newDraftFrom(tx, actor.orgId, fresh, v, actor.userId);
    if (decision === 'clarification_requested') await transitionOrder(tx, a, order, 'clarification_needed', task.comments ?? 'clarification requested', { reviewTaskId: task.id });
    else await transitionOrder(tx, a, order, 'measuring', task.comments ?? decision, { reviewTaskId: task.id });
  },
});

// ------------------------------------------------------------------ exports (RR-036, RR-038)
registerExportSubject(VERSION_SUBJECT, {
  formats: ['pdf', 'csv', 'json'],
  async render(tx, orgId, subjectId, format) {
    const v = await requireVersion(tx, orgId, subjectId);
    const bundle = await buildReportSnapshot(tx, orgId, v);
    if (format === 'pdf') {
      const pdf = await renderToBuffer(bundle.snapshot);
      return { body: pdf.buffer, contentType: 'application/pdf', extension: 'pdf', templateVersion: pdf.templateVersion, contentChecksum: pdf.contentChecksum };
    }
    const text = format === 'csv' ? reportCsv(bundle) : `${JSON.stringify(reportJson(bundle), null, 2)}\n`;
    return {
      body: Buffer.from(text, 'utf8'),
      contentType: format === 'csv' ? 'text/csv' : 'application/json',
      extension: format,
      templateVersion: `roof-export@1/${PDF_TEMPLATES_VERSION}`,
      contentChecksum: createHash('sha256').update(text).digest('hex'),
    };
  },
});

/** Transitions a person may request directly; the rest happen through submit/review/convert. */
const MANUAL_TARGETS: readonly RoofOrderStatus[] = ['clarification_needed', 'failed', 'cancelled', 'refunded', 'won', 'invoiced', 'paid', 'measuring'];

const roofModule: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------- orders
  app.post(
    '/roof/orders',
    {
      config: { permission: 'roof_order:create' },
      schema: {
        tags: ['roof'],
        summary: 'Create (and submit) a roof measurement order (Idempotency-Key required: one order per duplicate submit)',
        body: RoofOrderCreateSchema,
        response: { 201: RoofOrderDtoSchema },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const b = request.body;
      return idempotent(request, reply, { required: true }, async (tx) => {
        const property = await loadProperty(tx, actor.orgId, b.propertyId);
        if (!property) throw problem('not_found', 'Property not found.');
        // RF-021 D: address scope -- every structure belongs to the property and is confirmed in scope.
        const rows = await tx.select().from(structures).where(and(eq(structures.orgId, actor.orgId), inArray(structures.id, b.structureIds)));
        const bad = b.structureIds.filter((id) => {
          const s = rows.find((r) => r.id === id);
          return !s || s.propertyId !== b.propertyId || !s.scopeConfirmed || s.scopeStatus === 'excluded';
        });
        if (bad.length) {
          throw problem('validation_failed', 'Every structure must belong to the property and be confirmed in scope.', { errors: bad.map((id) => ({ path: 'body.structureIds', message: `${id} is not a confirmed in-scope structure of this property` })) });
        }
        let imageryOk = false;
        if (b.imageryAssetId) {
          const img = await requireImagery(tx, actor.orgId, b.imageryAssetId);
          if (img.propertyId !== b.propertyId) throw problem('validation_failed', 'The imagery belongs to another property.');
          // RF-022 S: tracing/measuring derives geometry from pixels; visualization-only sources are refused.
          assertUse(parseLicense(img.rights), 'analyze');
          if (!isCalibrated(img)) throw problem('validation_failed', 'The imagery has no georeference/scale; calibrate it or use a plan before measuring.');
          imageryOk = true;
        }
        const now = new Date();
        const speed = b.deliverySpeed ?? (b.mode === 'diy' ? 'instant_diy' : 'standard');
        if (b.mode === 'diy' && speed !== 'instant_diy') throw problem('validation_failed', 'DIY orders use the instant_diy delivery speed.');
        if (b.mode === 'assisted' && speed === 'instant_diy') throw problem('validation_failed', 'Assisted orders are queued (standard or priority), never instant.');
        const sla = computeSla({ mode: b.mode, speed, now, timeZone: b.timeZone, complexStructures: b.structureIds.length });
        const [created] = await tx
          .insert(roofOrders)
          .values({
            orgId: actor.orgId,
            number: await nextOrderNumber(tx, actor.orgId),
            propertyId: b.propertyId,
            jobId: b.jobId ?? null,
            mode: b.mode,
            deliverySpeed: speed,
            status: 'draft',
            structureIds: b.structureIds,
            imageryAssetId: b.imageryAssetId ?? null,
            requestedByMembershipId: actor.membershipId,
            instructions: b.instructions ?? null,
            dueAt: sla.dueAt ? new Date(sla.dueAt) : null,
          })
          .returning();
        let order = created!;
        // RF-021 R: immutable input snapshot + SLA policy frozen on the first event.
        await recordEvent(tx, actor, order.id, null, 'draft', 'created', { input: b, sla, idempotencyKey: request.headers['idempotency-key'] ?? null });
        if (!b.draft) {
          if (b.mode === 'assisted') {
            const reservationId = await reserveCredit(tx, actor.orgId, order.id);
            const [u] = await tx.update(roofOrders).set({ usageReservationId: reservationId }).where(eq(roofOrders.id, order.id)).returning();
            order = u!;
          }
          order = await transitionOrder(tx, actor, order, 'ordered', 'submitted', { creditReservationId: order.usageReservationId });
          // DIY can trace on a plan/manual entry without imagery; assisted waits for licensed imagery.
          if (b.mode === 'diy' || imageryOk) order = await enterMeasuring(tx, actor, order, b.mode === 'diy' ? 'DIY tracing' : 'licensed imagery attached');
          else order = await transitionOrder(tx, actor, order, 'imagery_pending', 'waiting for licensed imagery');
        }
        await auditRequest(request, tx, { orgId: actor.orgId, action: 'roof_order.created', resourceType: 'roof_order', resourceId: order.id, after: { number: order.number, mode: order.mode, status: order.status, sla } });
        return { status: 201, body: await orderDto(tx, order) };
      });
    },
  );

  app.get(
    '/roof/orders',
    {
      config: { permission: 'roof_order:read' },
      schema: { tags: ['roof'], querystring: z.object({ propertyId: UuidSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }), response: { 200: z.object({ items: z.array(RoofOrderDtoSchema), nextCursor: z.string().nullable() }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx.select().from(roofOrders).where(and(eq(roofOrders.orgId, org.orgId), request.query.propertyId ? eq(roofOrders.propertyId, request.query.propertyId) : undefined)).orderBy(desc(roofOrders.createdAt)).limit(request.query.limit);
        const items = [];
        for (const r of rows) items.push(await orderDto(tx, r));
        return { items, nextCursor: null };
      });
    },
  );

  app.get(
    '/roof/orders/:id',
    { config: { permission: 'roof_order:read' }, schema: { tags: ['roof'], params: IdParams, response: { 200: RoofOrderDtoSchema } } },
    async (request, reply) => {
      const org = requireOrg(request);
      const dto = await tenantTx(request, async (tx) => orderDto(tx, await requireOrder(tx, org.orgId, request.params.id)));
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  app.get(
    '/roof/orders/:id/events',
    { config: { permission: 'roof_order:read' }, schema: { tags: ['roof'], summary: 'Immutable transition log', params: IdParams, response: { 200: z.object({ items: z.array(RoofOrderEventDtoSchema) }) } } },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await requireOrder(tx, org.orgId, request.params.id);
        const rows = await tx.select().from(roofOrderEvents).where(and(eq(roofOrderEvents.orgId, org.orgId), eq(roofOrderEvents.roofOrderId, request.params.id))).orderBy(asc(roofOrderEvents.occurredAt), asc(roofOrderEvents.createdAt));
        return { items: rows.map((e) => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, actorType: e.actorType, actorUserId: e.actorUserId, reason: e.reason, data: e.data, occurredAt: e.occurredAt.toISOString() })) };
      });
    },
  );

  app.post(
    '/roof/orders/:id/transition',
    { config: { permission: 'roof_order:transition' }, schema: { tags: ['roof'], params: IdParams, body: RoofOrderTransitionSchema, response: { 200: RoofOrderDtoSchema } } },
    async (request) => {
      const actor = actorOf(request);
      const b = request.body;
      if (b.to === 'cancelled') assertCan(request, 'roof_order:cancel');
      if (!MANUAL_TARGETS.includes(b.to)) throw problem('invalid_transition', `${b.to} is reached through submit, review or quote conversion, not a manual transition.`);
      return tenantTx(request, async (tx) => {
        const order = await requireOrder(tx, actor.orgId, request.params.id, true);
        if (order.revision !== b.expectedRevision) throw problem('precondition_failed', `The order is at revision ${order.revision}.`);
        if (b.to === 'measuring' && order.status === 'review_required') throw problem('invalid_transition', 'A submitted measurement returns to measuring only through a review decision.');
        if (b.to === 'measuring' && order.status === 'failed' && order.mode === 'assisted') throw problem('invalid_transition', 'A failed assisted order has had its credit released; create a new order.');
        const next = b.to === 'measuring' ? await enterMeasuring(tx, actor, order, b.reason ?? 'resumed') : await transitionOrder(tx, actor, order, b.to, b.reason ?? null, null, b.to === 'failed' ? { failureReason: b.reason ?? 'failed' } : {});
        if (b.to === 'cancelled' || b.to === 'failed') {
          const report = await reportForOrder(tx, actor.orgId, order.id);
          if (report?.currentVersionId) await cancelOpenTasks(tx, actor.orgId, VERSION_SUBJECT, report.currentVersionId);
        }
        await auditRequest(request, tx, { orgId: actor.orgId, action: 'roof_order.transitioned', resourceType: 'roof_order', resourceId: order.id, before: { status: order.status }, after: { status: next.status }, reason: b.reason ?? null });
        return orderDto(tx, next);
      });
    },
  );

  app.post(
    '/roof/orders/:id/imagery',
    {
      config: { permission: 'imagery:order' },
      schema: { tags: ['roof'], summary: 'Attach licensed, calibrated imagery (imagery_pending -> measuring)', params: IdParams, body: z.object({ imageryAssetId: UuidSchema, expectedRevision: z.number().int().positive() }), response: { 200: RoofOrderDtoSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      return tenantTx(request, async (tx) => {
        const order = await requireOrder(tx, actor.orgId, request.params.id, true);
        if (order.revision !== request.body.expectedRevision) throw problem('precondition_failed', `The order is at revision ${order.revision}.`);
        const img = await requireImagery(tx, actor.orgId, request.body.imageryAssetId);
        if (img.propertyId !== order.propertyId) throw problem('validation_failed', 'The imagery belongs to another property.');
        assertUse(parseLicense(img.rights), 'analyze');
        if (!isCalibrated(img)) throw problem('validation_failed', 'The imagery has no georeference/scale.');
        const [u] = await tx.update(roofOrders).set({ imageryAssetId: img.id }).where(eq(roofOrders.id, order.id)).returning();
        const next = order.status === 'imagery_pending' || order.status === 'clarification_needed' ? await enterMeasuring(tx, actor, u!, 'licensed imagery attached') : u!;
        await auditRequest(request, tx, { orgId: actor.orgId, action: 'roof_order.imagery_attached', resourceType: 'roof_order', resourceId: order.id, after: { imageryAssetId: img.id, provider: img.provider } });
        return orderDto(tx, next);
      });
    },
  );

  // ---------------------------------------------------------------- reports + geometry
  app.get(
    '/roof/reports/:id',
    { config: { permission: 'roof_report:read' }, schema: { tags: ['roof'], summary: 'Current version geometry, totals and topology issues (ETag = geometry revision)', params: IdParams, response: { 200: RoofGeometryStateSchema } } },
    async (request, reply) => {
      const org = requireOrg(request);
      const state = await tenantTx(request, async (tx) => {
        const agg = await loadGeometryAggregate(tx, org.orgId, request.params.id, false);
        if (!agg) throw problem('not_found');
        return versionState(tx, org.orgId, agg.version, agg.order);
      });
      setEtag(reply, state.geometryRevision);
      return state;
    },
  );

  app.patch(
    '/roof/reports/:id/geometry',
    {
      config: { permission: 'roof_report:edit_geometry' },
      schema: {
        tags: ['roof'],
        summary: 'Apply geometry editor commands (If-Match: geometry revision; runs RoofGeometryEdited on the command bus)',
        params: IdParams,
        body: RoofGeometryEditSchema,
        response: { 200: z.object({ receipt: CommandReceiptSchema, geometry: RoofGeometryStateSchema }) },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const expected = parseIfMatch(request);
      const { receipt } = await executeResourceCommand(request, reply, {
        type: 'RoofGeometryEdited',
        aggregateId: request.params.id,
        expectedRevision: expected,
        payload: { client_op_id: request.body.clientOpId, commands: request.body.commands },
      });
      const geometry = await tenantTx(request, async (tx) => {
        const agg = await loadGeometryAggregate(tx, org.orgId, request.params.id, false);
        return versionState(tx, org.orgId, agg!.version, agg!.order);
      });
      setEtag(reply, geometry.geometryRevision);
      return { receipt, geometry };
    },
  );

  app.post(
    '/roof/reports/:id/submit',
    {
      config: { permission: 'roof_report:submit' },
      schema: { tags: ['roof'], summary: 'Freeze the draft version and send it to the review queue', params: IdParams, body: z.object({ expectedGeometryRevision: z.number().int().nonnegative() }), response: { 200: z.object({ version: RoofGeometryStateSchema, reviewTaskId: UuidSchema, requiresSecondReview: z.boolean() }) } },
    },
    async (request) => {
      const actor = actorOf(request);
      return tenantTx(request, async (tx) => {
        const agg = await loadGeometryAggregate(tx, actor.orgId, request.params.id, true);
        if (!agg) throw problem('not_found');
        const { version, order, report } = agg;
        if (version.status !== 'draft') throw problem('invalid_transition', `Version ${version.versionNumber} is already ${version.status}.`);
        if (version.geometryRevision !== request.body.expectedGeometryRevision) throw problem('precondition_failed', `The geometry is at revision ${version.geometryRevision}.`);
        if (order.status !== 'measuring') throw problem('invalid_transition', `The order is ${order.status}, not measuring.`);
        const state = requireValidGeometry(await versionState(tx, actor.orgId, version, order));
        // RF-030 B: release is blocked while mandatory values are unknown or conflicting.
        const scope = await scopeOf(tx, actor.orgId, order);
        const blockers = [
          ...state.facets.filter((f) => f.pitch === null).map((f) => ({ path: `facets.${f.id}.pitch`, message: 'pitch is unknown' })),
          ...state.edges.filter((e) => e.conflict).map((e) => ({ path: `edges.${e.id}`, message: `edge label conflict: ${e.conflict}` })),
          ...state.structures.filter((s) => s.included && !s.measured && !scope.unmeasuredAllowed.includes(s.structureId)).map((s) => ({ path: `structures.${s.structureId}`, message: 'in-scope structure has no facets; draw it or mark it unmeasured' })),
        ];
        if (blockers.length) throw problem('measurement_unknown', 'The measurement is incomplete.', { errors: blockers });
        const frozen = { ...state, versionStatus: 'submitted' as const };
        await setVersionStatus(tx, actor.orgId, version, 'submitted', { geometry: frozen, submittedAt: new Date(), submittedByUserId: actor.userId });
        await tx.update(roofReports).set({ status: 'in_review', revision: report.revision + 1 }).where(eq(roofReports.id, report.id));
        await transitionOrder(tx, actor, order, 'review_required', 'measurement submitted', { versionId: version.id, totals: state.property });
        // RR-033 B: second review for complex or low-confidence roofs.
        const lowConfidence = state.facets.some((f) => f.pitch?.confidence !== null && f.pitch?.confidence !== undefined && f.pitch.confidence < 0.7);
        const requiresSecondReview = order.mode === 'assisted' && (state.property.facetCount > 12 || state.structures.filter((s) => s.measured).length > 1 || lowConfidence || state.issues.length > 0);
        const task = await createReviewTask(tx, {
          orgId: actor.orgId,
          kind: 'roof_measurement',
          subjectType: VERSION_SUBJECT,
          subjectId: version.id,
          requiresSecondReview,
          dueAt: order.dueAt,
          priority: order.deliverySpeed === 'priority' ? 'high' : 'normal',
          checklist: { facets_match_imagery: false, pitches_supported: false, edges_classified: false, scope_confirmed: false },
        });
        await auditRequest(request, tx, { orgId: actor.orgId, action: 'roof_report.submitted', resourceType: 'roof_report_version', resourceId: version.id, after: { versionNumber: version.versionNumber, totals: state.property, reviewTaskId: task.id } });
        return { version: frozen, reviewTaskId: task.id, requiresSecondReview };
      });
    },
  );

  app.post(
    '/roof/reports/:id/revisions',
    {
      config: { permission: 'roof_report:edit_geometry' },
      schema: { tags: ['roof'], summary: 'Start a corrected revision of an approved/issued report (history kept; dependent estimates go stale)', params: IdParams, body: z.object({ reason: z.string().min(3).max(2000) }), response: { 201: RoofGeometryStateSchema } },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const state = await tenantTx(request, async (tx) => {
        const agg = await loadGeometryAggregate(tx, actor.orgId, request.params.id, true);
        if (!agg) throw problem('not_found');
        if (agg.version.status !== 'approved' && agg.version.status !== 'issued') throw problem('invalid_transition', `Only an approved or issued report can be revised (current version is ${agg.version.status}).`);
        let order = await requireOrder(tx, actor.orgId, agg.order.id, true);
        if (order.status === 'quoted') order = await transitionOrder(tx, actor, order, 'approved', `revision: ${request.body.reason}`);
        if (order.status !== 'approved') throw problem('invalid_transition', `A ${order.status} order cannot be re-measured; use a change order.`);
        order = await transitionOrder(tx, actor, order, 'review_required', `revision: ${request.body.reason}`);
        order = await transitionOrder(tx, actor, order, 'measuring', `revision: ${request.body.reason}`);
        const draft = await newDraftFrom(tx, actor.orgId, agg.report, agg.version, actor.userId);
        const stale = await markRoofEstimatesStale(tx, actor.orgId, order.id, 'roof_report_revised');
        await auditRequest(request, tx, { orgId: actor.orgId, action: 'roof_report.revision_started', resourceType: 'roof_report', resourceId: agg.report.id, after: { fromVersionId: agg.version.id, draftVersionId: draft.id, staleEstimateIds: stale }, reason: request.body.reason });
        return versionState(tx, actor.orgId, draft, order);
      });
      reply.status(201);
      return state;
    },
  );

  app.post(
    '/roof/reports/:id/issue',
    { config: { permission: 'roof_report:issue' }, schema: { tags: ['roof'], params: IdParams, response: { 200: RoofGeometryStateSchema } } },
    async (request) => {
      const actor = actorOf(request);
      return tenantTx(request, async (tx) => {
        const agg = await loadGeometryAggregate(tx, actor.orgId, request.params.id, true);
        if (!agg) throw problem('not_found');
        if (agg.version.status !== 'approved') throw problem('invalid_transition', 'Only an approved version can be issued.');
        const v = await setVersionStatus(tx, actor.orgId, agg.version, 'issued');
        await tx.update(roofReports).set({ status: 'issued', issuedVersionId: v.id, revision: agg.report.revision + 1 }).where(eq(roofReports.id, agg.report.id));
        await auditRequest(request, tx, { orgId: actor.orgId, action: 'roof_report.issued', resourceType: 'roof_report_version', resourceId: v.id });
        return { ...(v.geometry as RoofGeometryState), versionStatus: 'issued' as const };
      });
    },
  );

  app.get(
    '/roof/reports/:id/versions',
    {
      config: { permission: 'roof_report:read' },
      schema: { tags: ['roof'], params: IdParams, response: { 200: z.object({ items: z.array(z.object({ id: UuidSchema, versionNumber: z.number(), status: z.string(), geometryRevision: z.number(), supersedesVersionId: UuidSchema.nullable(), submittedAt: z.string().nullable(), approvedAt: z.string().nullable(), totals: z.unknown() })) }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await requireReport(tx, org.orgId, request.params.id);
        const rows = await tx.select().from(roofReportVersions).where(and(eq(roofReportVersions.orgId, org.orgId), eq(roofReportVersions.roofReportId, request.params.id))).orderBy(asc(roofReportVersions.versionNumber));
        return {
          items: rows.map((v) => ({ id: v.id, versionNumber: v.versionNumber, status: v.status, geometryRevision: v.geometryRevision, supersedesVersionId: v.supersedesVersionId, submittedAt: v.submittedAt?.toISOString() ?? null, approvedAt: v.approvedAt?.toISOString() ?? null, totals: v.totals })),
        };
      });
    },
  );

  app.get(
    '/roof/report-versions/:id',
    { config: { permission: 'roof_report:read' }, schema: { tags: ['roof'], params: IdParams, response: { 200: RoofGeometryStateSchema } } },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const v = await requireVersion(tx, org.orgId, request.params.id);
        const report = await requireReport(tx, org.orgId, v.roofReportId);
        return versionState(tx, org.orgId, v, await requireOrder(tx, org.orgId, report.roofOrderId));
      });
    },
  );

  // RR-037 A / ADD-034: visible differences in boundaries, pitch and quantities.
  app.get(
    '/roof/reports/:id/compare',
    {
      config: { permission: 'roof_report:read' },
      schema: { tags: ['roof'], params: IdParams, querystring: z.object({ from: UuidSchema, to: UuidSchema }), response: { 200: z.object({ from: z.number(), to: z.number(), facets: z.array(z.record(z.string(), z.unknown())), edgeTotals: z.record(z.string(), z.unknown()), property: z.record(z.string(), z.unknown()) }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const report = await requireReport(tx, org.orgId, request.params.id);
        const order = await requireOrder(tx, org.orgId, report.roofOrderId);
        const [a, b] = [await requireVersion(tx, org.orgId, request.query.from), await requireVersion(tx, org.orgId, request.query.to)];
        if (a.roofReportId !== report.id || b.roofReportId !== report.id) throw problem('validation_failed', 'Both versions must belong to this report.');
        const [sa, sb] = [await versionState(tx, org.orgId, a, order), await versionState(tx, org.orgId, b, order)];
        const ids = [...new Set([...sa.facets.map((f) => f.id), ...sb.facets.map((f) => f.id)])].sort();
        const facets = ids.flatMap((id): Record<string, unknown>[] => {
          const fa = sa.facets.find((f) => f.id === id);
          const fb = sb.facets.find((f) => f.id === id);
          if (fa && !fb) return [{ id, change: 'removed', before: fa.slopedAreaM2 }];
          if (!fa && fb) return [{ id, change: 'added', after: fb.slopedAreaM2 }];
          const changed = JSON.stringify(fa!.vertexIds) !== JSON.stringify(fb!.vertexIds) || fa!.netPlanAreaM2 !== fb!.netPlanAreaM2 || fa!.pitch?.risePer12 !== fb!.pitch?.risePer12;
          return changed ? [{ id, change: 'modified', planAreaM2: { before: fa!.netPlanAreaM2, after: fb!.netPlanAreaM2 }, slopedAreaM2: { before: fa!.slopedAreaM2, after: fb!.slopedAreaM2 }, risePer12: { before: fa!.pitch?.risePer12 ?? null, after: fb!.pitch?.risePer12 ?? null } }] : [];
        });
        const edgeTotals = Object.fromEntries(
          Object.keys({ ...sa.edgeTotals, ...sb.edgeTotals })
            .map((k) => [k, { before: sa.edgeTotals[k]?.trueLengthM ?? null, after: sb.edgeTotals[k]?.trueLengthM ?? null }] as const)
            .filter(([, d]) => d.before !== d.after),
        );
        return { from: a.versionNumber, to: b.versionNumber, facets, edgeTotals, property: { before: sa.property, after: sb.property } };
      });
    },
  );

  // ---------------------------------------------------------------- overrides (RF-030)
  app.post(
    '/roof/report-versions/:id/overrides',
    {
      config: { permission: 'measurement:override' },
      schema: { tags: ['roof'], summary: 'Append-only measurement override with reason (approver recorded)', params: IdParams, body: RoofOverrideCreateSchema, response: { 201: z.object({ id: UuidSchema, field: z.string(), supersedesId: UuidSchema.nullable(), approvedByUserId: UuidSchema.nullable() }) } },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const org = requireOrg(request);
      const b = request.body;
      const out = await tenantTx(request, async (tx) => {
        const v = await requireVersion(tx, actor.orgId, request.params.id);
        if (v.status !== 'draft' && v.status !== 'submitted') throw problem('immutable_record', `Version ${v.versionNumber} is ${v.status}; start a new revision to change measurements.`);
        const report = await requireReport(tx, actor.orgId, v.roofReportId);
        const state = await versionState(tx, actor.orgId, v, await requireOrder(tx, actor.orgId, report.roofOrderId));
        let previous: unknown;
        if (b.field === 'facet.planAreaM2') {
          const f = state.facets.find((x) => x.id === b.target);
          if (!f) throw problem('not_found', `No facet ${b.target}.`);
          previous = f.netPlanAreaM2;
          if (b.newValue.state === 'known' && b.newValue.unit !== 'm2') throw problem('validation_failed', 'Plan area overrides are in m2.');
        } else {
          const t = state.edgeTotals[b.target];
          if (!t) throw problem('not_found', `No edge type ${b.target}.`);
          previous = t.trueLengthM;
          if (b.newValue.state === 'known' && b.newValue.unit !== 'm') throw problem('validation_failed', 'Edge length overrides are in m.');
        }
        const field = `${b.field}:${b.target}`;
        const [prior] = await tx.select({ id: measurementOverrides.id }).from(measurementOverrides).where(and(eq(measurementOverrides.orgId, actor.orgId), eq(measurementOverrides.subjectType, OVERRIDE_SUBJECT), eq(measurementOverrides.subjectId, v.id), eq(measurementOverrides.field, field))).orderBy(desc(measurementOverrides.createdAt)).limit(1);
        // Approver: a reviewer-capable actor approves at entry; otherwise the version's review approves it.
        const approvedBy = org.permissions.has('roof_report:approve') ? actor.userId : null;
        const [row] = await tx
          .insert(measurementOverrides)
          .values({
            orgId: actor.orgId,
            subjectType: OVERRIDE_SUBJECT,
            subjectId: v.id,
            field,
            previousValue: { value: previous },
            newValue: { ...b.newValue, approval: { approvedByUserId: approvedBy, status: approvedBy ? 'approved' : 'pending_review' } },
            unit: b.newValue.state === 'known' ? b.newValue.unit : null,
            source: b.newValue.state === 'known' ? b.newValue.source : 'user_entered',
            reason: b.reason,
            actorUserId: actor.userId,
            supersedesId: prior?.id ?? null,
          })
          .returning();
        await auditRequest(request, tx, { orgId: actor.orgId, action: 'measurement.overridden', resourceType: 'roof_report_version', resourceId: v.id, before: { [field]: previous }, after: { [field]: b.newValue, approvedBy }, reason: b.reason });
        return { id: row!.id, field, supersedesId: prior?.id ?? null, approvedByUserId: approvedBy };
      });
      reply.status(201);
      return out;
    },
  );

  // ---------------------------------------------------------------- takeoff (RR-034/035)
  app.post(
    '/roof/report-versions/:id/takeoff',
    { config: { permission: 'roof_takeoff:write' }, schema: { tags: ['roof'], summary: 'Material takeoff (exact vs pack quantities, waste once, unresolved lines)', params: IdParams, body: RoofTakeoffRequestSchema, response: { 201: RoofTakeoffDtoSchema } } },
    async (request, reply) => {
      const actor = actorOf(request);
      const out = await tenantTx(request, async (tx) => {
        const v = await requireVersion(tx, actor.orgId, request.params.id);
        const report = await requireReport(tx, actor.orgId, v.roofReportId);
        const state = requireValidGeometry(await versionState(tx, actor.orgId, v, await requireOrder(tx, actor.orgId, report.roofOrderId)));
        const t = await computeTakeoff(tx, actor.orgId, v.id, state, request.body);
        if (t.selection.status !== 'selected') throw problem('measurement_unknown');
        const [row] = await tx
          .insert(materialTakeoffs)
          .values({
            orgId: actor.orgId,
            reportVersionId: v.id,
            wastePolicyId: t.wastePolicyId,
            wasteFraction: t.selection.wasteRate.toString(),
            wasteSource: t.selection.source === 'override' ? 'human_entered' : 'rule_recommendation',
            lines: { lines: t.lines, area: t.takeoff.property, edgeLf: t.edgeLf, recommendation: t.recommendation, overridesApplied: t.applied, geometryRevision: state.geometryRevision, wasteReason: t.selection.reason },
            engineVersion: t.engineVersion,
            createdByUserId: actor.userId,
          })
          .returning();
        await auditRequest(request, tx, { orgId: actor.orgId, action: 'roof_takeoff.created', resourceType: 'material_takeoff', resourceId: row!.id, after: { versionId: v.id, wasteFraction: row!.wasteFraction, wasteSource: row!.wasteSource, unresolved: t.lines.filter((l) => l.status === 'unresolved').length } });
        return {
          id: row!.id,
          reportVersionId: v.id,
          wasteFraction: t.selection.wasteRate.toString(),
          wasteSource: row!.wasteSource,
          recommendation: t.recommendation,
          area: t.takeoff.property,
          edgeLf: t.edgeLf,
          lines: t.lines as unknown as Record<string, unknown>[],
          unresolvedCount: t.lines.filter((l) => l.status === 'unresolved').length,
          engineVersion: row!.engineVersion,
          overridesApplied: t.applied,
          createdAt: row!.createdAt.toISOString(),
        };
      });
      reply.status(201);
      return out;
    },
  );

  // ---------------------------------------------------------------- exports
  app.post(
    '/roof/reports/:id/exports',
    { config: { permission: 'export:create' }, schema: { tags: ['roof'], summary: 'Generate a PDF/CSV/JSON export asynchronously from a frozen version', params: IdParams, body: RoofExportRequestSchema, response: { 202: ExportRecordDtoSchema } } },
    async (request, reply) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const report = await requireReport(tx, org.orgId, request.params.id);
        const versionId = request.body.versionId ?? report.issuedVersionId ?? report.currentVersionId;
        const v = versionId ? await requireVersion(tx, org.orgId, versionId) : null;
        if (!v || v.roofReportId !== report.id) throw problem('not_found', 'Version not found on this report.');
        // RF-036 R: exports come from a stable snapshot; a draft keeps changing.
        if (v.status === 'draft') throw problem('invalid_transition', 'Submit the version before exporting; drafts are not stable snapshots.');
        return createExport(request, tx, { subjectType: VERSION_SUBJECT, subjectId: v.id, format: request.body.format, options: { versionNumber: v.versionNumber, reportId: report.id, destination: request.body.destination ?? 'download' } });
      });
      scheduleExport(request, row);
      reply.status(202);
      return exportDto(row);
    },
  );

  // ---------------------------------------------------------------- quotes (RR-040)
  async function approvedVersion(tx: Tx, orgId: string, reportId: string, versionId?: string) {
    const report = await requireReport(tx, orgId, reportId);
    const v = await requireVersion(tx, orgId, versionId ?? report.issuedVersionId ?? report.currentVersionId!);
    if (v.roofReportId !== report.id) throw problem('not_found');
    if (v.status !== 'approved' && v.status !== 'issued') throw problem('gate_blocked', 'Only an approved report version can be converted into a quote.');
    return { report, v, order: await requireOrder(tx, orgId, report.roofOrderId, true) };
  }

  function confirmations(b: z.infer<typeof RoofQuoteRequestSchema>) {
    if (!b.confirmations.pricingDate || !b.confirmations.waste) throw problem('validation_failed', 'Confirm the pricing date and the waste decision before quoting.', { errors: [{ path: 'body.confirmations', message: 'both must be true' }] });
  }

  app.post(
    '/roof/reports/:id/quote-preview',
    { config: { permission: 'estimate:write' }, schema: { tags: ['roof'], summary: 'Price good/better/best tiers from an approved report (no writes)', params: IdParams, body: RoofQuoteRequestSchema, response: { 200: z.object({ versionId: UuidSchema, inputs: z.record(z.string(), z.unknown()), tiers: z.array(z.record(z.string(), z.unknown())) }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      const canViewCost = org.permissions.has('estimate:view_cost');
      confirmations(request.body);
      return tenantTx(request, async (tx) => {
        const { v, order } = await approvedVersion(tx, org.orgId, request.params.id, request.body.versionId);
        const q = await quoteInputs(tx, org.orgId, v);
        const tiers = [];
        for (const t of request.body.tiers) {
          const c = await priceTier(tx, org.orgId, order.propertyId, q.inputs, t.lines, [`Roof report ${order.number} v${v.versionNumber}`, `tier ${t.tier}`], request.body.priceBookRevisionId ?? null);
          const gating = c.values.gatingResult as { quoteKind: string; blockers: unknown[]; warnings: unknown[] };
          tiers.push({
            tier: t.tier,
            label: t.label,
            status: c.status,
            quoteKind: gating.quoteKind,
            totalMinor: c.values.totalMinor ?? null,
            lowTotalMinor: c.values.lowTotalMinor ?? null,
            highTotalMinor: c.values.highTotalMinor ?? null,
            currency: c.values.currency,
            blockers: gating.blockers,
            warnings: gating.warnings,
            priceBookRevisionId: c.values.priceBookRevisionId,
            ...(canViewCost ? { lines: c.values.lines } : {}),
          });
        }
        return { versionId: v.id, inputs: q.inputs, tiers };
      });
    },
  );

  app.post(
    '/roof/reports/:id/convert',
    { config: { permission: 'estimate:write' }, schema: { tags: ['roof'], summary: 'Convert an approved report into a shared roof estimate (Idempotency-Key required)', params: IdParams, body: RoofQuoteRequestSchema, response: { 201: z.record(z.string(), z.unknown()) } } },
    async (request, reply) => {
      const actor = actorOf(request);
      const b = request.body;
      confirmations(b);
      const tier = b.tiers.find((t) => t.tier === (b.selectedTier ?? b.tiers[0]!.tier));
      if (!tier) throw problem('validation_failed', 'selectedTier must be one of the given tiers.');
      return idempotent(request, reply, { required: true }, async (tx) => {
        const { v, order } = await approvedVersion(tx, actor.orgId, request.params.id, b.versionId);
        const q = await quoteInputs(tx, actor.orgId, v);
        const computed = await priceTier(tx, actor.orgId, order.propertyId, q.inputs, tier.lines, [`Roof report ${order.number} v${v.versionNumber} (${v.id})`, `tier ${tier.tier}: ${tier.label}`, ...(q.takeoffId ? [`takeoff ${q.takeoffId} waste ${q.wasteFraction}`] : ['no takeoff: order area unknown'])], b.priceBookRevisionId ?? null);
        const [e] = await tx
          .insert(estimates)
          .values({ orgId: actor.orgId, number: await nextEstimateNumber(tx, actor.orgId), productLine: 'roof', roofOrderId: order.id, jobId: order.jobId, propertyId: order.propertyId, status: 'draft_ai', revision: 0 })
          .returning();
        const applied = await applyRevision(tx, { orgId: actor.orgId, userId: actor.userId! }, e!, computed);
        let o = order;
        if (o.status === 'approved') o = await transitionOrder(tx, actor, o, 'quoted', `estimate ${e!.number} (${tier.tier})`, { estimateId: e!.id, reportVersionId: v.id });
        const dto = await estimateDto(tx, request, applied.estimate);
        await auditRequest(request, tx, { orgId: actor.orgId, action: 'estimate.created_from_roof_report', resourceType: 'estimate', resourceId: e!.id, after: { reportVersionId: v.id, tier: tier.tier, inputHash: applied.revision.inputHash, quoteKind: applied.revision.quoteKind, orderStatus: o.status } });
        return { status: 201, body: { ...dto, reportVersionId: v.id, tier: tier.tier } };
      });
    },
  );
};

export default roofModule;
