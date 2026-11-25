import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  DecideEnterpriseTakeoffReview,
  EnterpriseTakeoffMeasurementKind,
  EnterpriseTakeoffReview,
  EnterpriseTakeoffReviewHistory,
  SubmitEnterpriseTakeoffReview,
  TAKEOFF_SCALE_WARNING_PERCENT,
} from '@fieldline/contracts';
import { enterpriseTakeoffReviews as reviews } from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';
import { currentCalibration, type TakeoffSheetScope } from './takeoffCalibration';
import {
  readMeasurement,
  sheetScope,
  type MeasurementSnapshot,
  type TakeoffMeasurementKind,
} from './takeoffMeasurements';

const Measurement = z.object({
  projectId: z.uuid(),
  planId: z.uuid(),
  sheetId: z.uuid(),
  kind: EnterpriseTakeoffMeasurementKind,
  measurementId: z.uuid(),
});
const Review = Measurement.extend({ reviewId: z.uuid() });
const path =
  '/enterprise/projects/:projectId/takeoff/plan-sets/:planId/sheets/:sheetId/measurements/:kind/:measurementId/reviews';
const rateLimit = { max: 30, timeWindow: '1 minute' } as const;
type Row = typeof reviews.$inferSelect;

function measurementReviews(scope: TakeoffSheetScope, kind: TakeoffMeasurementKind, id: string) {
  return and(
    sheetScope(reviews, scope),
    eq(reviews.measurementKind, kind),
    eq(reviews.measurementId, id),
  );
}

function dto(row: Row): z.infer<typeof EnterpriseTakeoffReview> {
  return {
    id: row.id,
    measurementId: row.measurementId,
    measurementKind: row.measurementKind,
    measurementRevision: row.measurementRevision,
    calibrationId: row.calibrationId,
    quantity: row.quantity,
    unit: row.unit,
    status: row.status,
    revision: row.revision,
    submitNote: row.submitNote,
    submittedByUserId: row.submittedByUserId,
    createdAt: row.createdAt.toISOString(),
    reviewNote: row.reviewNote,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

export async function calibrationBlock(
  tx: Tx,
  scope: TakeoffSheetScope,
  measurement: MeasurementSnapshot,
) {
  if (!measurement.calibrationId) return null;
  const scale = await currentCalibration(tx, scope);
  if (scale?.id !== measurement.calibrationId) return 'stale_calibration' as const;
  const errorPercent = scale.result.verificationResult?.errorPercent ?? 0;
  return errorPercent >= TAKEOFF_SCALE_WARNING_PERCENT ? ('incorrect_scale' as const) : null;
}

const takeoffReviews: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: Measurement,
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: EnterpriseTakeoffReviewHistory },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { kind, measurementId, ...sheet } = request.params;
      const scope = { orgId, ...sheet };
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const source = await readMeasurement(tx, scope, kind, measurementId);
        const approvalBlock = await calibrationBlock(tx, scope, source);
        const limit = 20;
        const sortTime = msTrunc(reviews.createdAt);
        const rows = await tx
          .select()
          .from(reviews)
          .where(
            and(
              measurementReviews(scope, kind, measurementId),
              beforeCursor(reviews.createdAt, reviews.id, cursor),
            ),
          )
          .orderBy(desc(sortTime), desc(reviews.id))
          .limit(limit + 1);
        const page = pageResult(rows, limit, (row) => ({ at: row.createdAt, id: row.id }), dto);
        return {
          measurementRevision: source.revision,
          approvalBlock,
          reviews: page.items,
          nextCursor: page.nextCursor,
        };
      });
    },
  );

  app.post(
    path,
    {
      config: { permission: 'estimate:write', rateLimit },
      schema: {
        tags: ['enterprise'],
        params: Measurement,
        body: SubmitEnterpriseTakeoffReview,
        response: { 200: EnterpriseTakeoffReview, 201: EnterpriseTakeoffReview },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { kind, measurementId, ...sheet } = request.params;
      const scope = { orgId, ...sheet };
      const expected = parseIfMatch(request);
      const { note, clientRequestId } = request.body;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        const [prior] = await tx
          .select()
          .from(reviews)
          .where(and(sheetScope(reviews, scope), eq(reviews.clientRequestId, clientRequestId)));
        if (prior) {
          if (
            prior.measurementKind !== kind ||
            prior.measurementId !== measurementId ||
            prior.submittedByUserId !== userId ||
            prior.submitNote !== note ||
            prior.measurementRevision !== expected
          ) {
            throw problem('conflict', 'This request already created a different review.');
          }
          return { record: prior, created: false };
        }
        const source = await readMeasurement(tx, scope, kind, measurementId, true);
        assertRevision(source.revision, expected);
        const [active] = await tx
          .select({ id: reviews.id })
          .from(reviews)
          .where(
            and(
              measurementReviews(scope, kind, measurementId),
              eq(reviews.measurementRevision, source.revision),
              inArray(reviews.status, ['review_required', 'approved']),
            ),
          );
        if (active)
          throw problem(
            'conflict',
            'This measurement revision already has an open or approved review.',
          );
        const [record] = await tx
          .insert(reviews)
          .values({
            ...scope,
            lengthId: kind === 'length' ? measurementId : null,
            areaId: kind === 'area' ? measurementId : null,
            countId: kind === 'count' ? measurementId : null,
            measurementRevision: source.revision,
            quantity: source.quantity,
            unit: source.unit,
            calibrationId: source.calibrationId,
            submitNote: note,
            submittedByUserId: userId,
            clientRequestId,
          })
          .returning();
        if (!record) throw new Error('Takeoff review insertion failed.');
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_measurement_review',
          record.id,
          'takeoff.review_requested',
          null,
          dto(record),
        );
        return { record, created: true };
      });
      setEtag(reply, result.record.revision);
      return reply.code(result.created ? 201 : 200).send(dto(result.record));
    },
  );

  app.post(
    path + '/:reviewId/decide',
    {
      config: { permission: 'review_task:decide', rateLimit },
      schema: {
        tags: ['enterprise'],
        params: Review,
        body: DecideEnterpriseTakeoffReview,
        response: { 200: EnterpriseTakeoffReview },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { kind, measurementId, reviewId, ...sheet } = request.params;
      const scope = { orgId, ...sheet };
      const expected = parseIfMatch(request);
      const { decision, note } = request.body;
      const record = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        const filter = and(
          measurementReviews(scope, kind, measurementId),
          eq(reviews.id, reviewId),
        );
        const [prior] = await tx.select().from(reviews).where(filter).for('update');
        if (!prior) throw problem('not_found');
        if (
          prior.status !== 'review_required' &&
          prior.revision === expected + 1 &&
          prior.status === decision &&
          prior.reviewNote === note &&
          prior.reviewedByUserId === userId
        )
          return prior;
        assertRevision(prior.revision, expected);
        if (prior.status !== 'review_required')
          throw problem('conflict', 'This review was already decided.');
        if (decision === 'approved') {
          const source = await readMeasurement(tx, scope, kind, measurementId, true);
          assertRevision(source.revision, prior.measurementRevision);
          const blocked = await calibrationBlock(tx, scope, source);
          if (blocked === 'stale_calibration')
            throw problem(
              'conflict',
              'The sheet scale changed. Create a measurement with the current calibration.',
            );
          if (blocked === 'incorrect_scale')
            throw problem(
              'validation_failed',
              'The calibration check found an incorrect scale. Verify and correct the calibration before approving.',
            );
        }
        const [updated] = await tx
          .update(reviews)
          .set({
            status: decision,
            revision: prior.revision + 1,
            reviewNote: note,
            reviewedByUserId: userId,
            reviewedAt: new Date(),
          })
          .where(filter)
          .returning();
        if (!updated) throw new Error('Takeoff review decision failed.');
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_measurement_review',
          updated.id,
          decision === 'approved' ? 'takeoff.approved' : 'takeoff.changes_requested',
          dto(prior),
          dto(updated),
        );
        return updated;
      });
      setEtag(reply, record.revision);
      return dto(record);
    },
  );
};

export default takeoffReviews;
