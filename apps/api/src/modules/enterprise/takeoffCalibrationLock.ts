import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  DecideTakeoffCalibrationChange,
  SetTakeoffCalibrationLock,
  SubmitTakeoffCalibrationChange,
  TAKEOFF_SCALE_WARNING_PERCENT,
  TakeoffCalibrationChange,
  TakeoffCalibrationChangePage,
  TakeoffCalibrationLock,
  TakeoffCalibrationLockRevision,
} from '@fieldline/contracts';
import {
  enterpriseTakeoffCalibrationChangeRequests as requests,
  enterpriseTakeoffCalibrationLockRevisions as locks,
  enterpriseTakeoffCalibrations as calibrations,
} from '../../db/schema/enterpriseTakeoff';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';
import {
  calibrationParams,
  calibrationPath,
  computeCalibrationResult,
  currentCalibration,
  insertTakeoffCalibration,
  readSheet,
} from './takeoffCalibrationData';
import { lockRevisionDto, readCalibrationLock } from './takeoffCalibrationLockState';
import { sheetScope } from './takeoffMeasurements';

const lockPath = calibrationPath + '/lock';
const changePath = calibrationPath + '/change-requests';
const lead = {
  permission: 'takeoff:approve_calibration',
  rateLimit: { max: 30, timeWindow: '1 minute' },
} as const;
const read = { permission: 'job:read' } as const;
const write = {
  permission: 'estimate:write',
  rateLimit: { max: 30, timeWindow: '1 minute' },
} as const;

type ChangeRow = typeof requests.$inferSelect;
type BaseScale = typeof calibrations.$inferSelect;

function digest(value: object) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function changeDto(row: ChangeRow, base: BaseScale): z.infer<typeof TakeoffCalibrationChange> {
  return {
    id: row.id,
    revision: row.revision,
    baseCalibrationId: row.baseCalibrationId,
    baseCalibrationRevision: base.revision,
    previous: { scale: base.result.scale, unit: base.input.unit },
    appliedCalibrationId: row.appliedCalibrationId,
    proposed: { ...row.input, ...row.computedResult },
    reason: row.reason,
    status: row.status,
    submittedByUserId: row.submittedByUserId,
    submittedAt: row.submittedAt.toISOString(),
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionReason: row.decisionReason,
  };
}

const takeoffCalibrationLock: FastifyPluginAsyncZod = async (app) => {
  app.get(
    lockPath,
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: calibrationParams,
        response: { 200: TakeoffCalibrationLock },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const scope = { ...request.params, orgId };
      const setting = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await readSheet(tx, scope);
        const current = await currentCalibration(tx, scope);
        return readCalibrationLock(tx, scope, current?.id, 20);
      });
      setEtag(reply, setting.revision);
      return setting;
    },
  );

  app.put(
    lockPath,
    {
      config: lead,
      schema: {
        tags: ['enterprise'],
        params: calibrationParams,
        body: SetTakeoffCalibrationLock,
        response: { 200: TakeoffCalibrationLockRevision },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const scope = { ...request.params, orgId };
      const expected = parseIfMatch(request);
      const { mode, reason, clientRequestId } = request.body;
      const requestHash = digest({ mode, reason, expected });
      const changed = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        await readSheet(tx, scope);
        const [prior] = await tx
          .select()
          .from(locks)
          .where(and(sheetScope(locks, scope), eq(locks.clientRequestId, clientRequestId)));
        if (prior) {
          if (prior.requestHash !== requestHash || prior.createdByUserId !== userId)
            throw problem('conflict', 'This request already changed a different lock setting.');
          return lockRevisionDto(prior);
        }
        const scale = await currentCalibration(tx, scope);
        const before = await readCalibrationLock(tx, scope, scale?.id);
        assertRevision(before.revision, expected);
        const [saved] = await tx
          .insert(locks)
          .values({
            ...scope,
            mode,
            reason,
            revision: before.revision + 1,
            clientRequestId,
            requestHash,
            createdByUserId: userId,
          })
          .returning();
        if (!saved) throw new Error('Sheet calibration lock insertion failed.');
        const after = await readCalibrationLock(tx, scope, scale?.id);
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_sheet',
          scope.sheetId,
          'takeoff_sheet.calibration_lock_changed',
          before,
          after,
        );
        return lockRevisionDto(saved);
      });
      setEtag(reply, changed.revision);
      return changed;
    },
  );

  app.get(
    changePath,
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: calibrationParams,
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: TakeoffCalibrationChangePage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const scope = { ...request.params, orgId };
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await readSheet(tx, scope);
        const limit = 20;
        const rows = await tx
          .select({ change: requests, base: calibrations })
          .from(requests)
          .innerJoin(calibrations, eq(requests.baseCalibrationId, calibrations.id))
          .where(
            and(
              sheetScope(requests, scope),
              beforeCursor(requests.submittedAt, requests.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(requests.submittedAt)), desc(requests.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          ({ change }) => ({ at: change.submittedAt, id: change.id }),
          ({ change, base }) => changeDto(change, base),
        );
      });
    },
  );

  app.post(
    changePath,
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: calibrationParams,
        body: SubmitTakeoffCalibrationChange,
        response: { 200: TakeoffCalibrationChange, 201: TakeoffCalibrationChange },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const scope = { ...request.params, orgId };
      const expected = parseIfMatch(request);
      const { input, reason, clientRequestId } = request.body;
      const requestHash = digest({ input, reason, expected });
      const outcome = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        const sheet = await readSheet(tx, scope);
        const [prior] = await tx
          .select({ row: requests, base: calibrations })
          .from(requests)
          .innerJoin(calibrations, eq(requests.baseCalibrationId, calibrations.id))
          .where(and(sheetScope(requests, scope), eq(requests.clientRequestId, clientRequestId)));
        if (prior) {
          if (prior.row.requestHash !== requestHash || prior.row.submittedByUserId !== userId)
            throw problem(
              'conflict',
              'This request already proposed a different calibration change.',
            );
          return { change: changeDto(prior.row, prior.base), replay: true };
        }
        const current = await currentCalibration(tx, scope);
        assertRevision(current?.revision ?? 0, expected);
        if (!current || !(await readCalibrationLock(tx, scope, current.id)).effective)
          throw problem('conflict', 'This sheet can be recalibrated directly.');
        const computedResult = computeCalibrationResult(input, sheet);
        const [saved] = await tx
          .insert(requests)
          .values({
            ...scope,
            baseCalibrationId: current.id,
            input,
            computedResult,
            reason,
            clientRequestId,
            requestHash,
            submittedByUserId: userId,
          })
          .returning();
        if (!saved) throw new Error('Sheet calibration request insertion failed.');
        const change = changeDto(saved, current);
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_calibration_change',
          saved.id,
          'takeoff_sheet.calibration_change_requested',
          null,
          change,
        );
        return { change, replay: false };
      });
      setEtag(reply, outcome.change.revision);
      return reply.code(outcome.replay ? 200 : 201).send(outcome.change);
    },
  );

  app.post(
    changePath + '/:changeId/decide',
    {
      config: lead,
      schema: {
        tags: ['enterprise'],
        params: calibrationParams.extend({ changeId: z.uuid() }),
        body: DecideTakeoffCalibrationChange,
        response: { 200: TakeoffCalibrationChange },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { changeId, ...sheet } = request.params;
      const scope = { ...sheet, orgId };
      const expected = parseIfMatch(request);
      const { decision, reason } = request.body;
      const outcome = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        const filter = and(sheetScope(requests, scope), eq(requests.id, changeId));
        const [found] = await tx
          .select({ row: requests, base: calibrations })
          .from(requests)
          .innerJoin(calibrations, eq(requests.baseCalibrationId, calibrations.id))
          .where(filter);
        if (!found) throw problem('not_found');
        const { row, base } = found;
        if (
          row.status === decision &&
          row.revision === expected + 1 &&
          row.decidedByUserId === userId &&
          row.decisionReason === reason
        )
          return changeDto(row, base);
        assertRevision(row.revision, expected);
        if (row.status !== 'pending')
          throw problem('conflict', 'This calibration request was already decided.');

        let appliedCalibrationId: string | null = null;
        if (decision === 'approved') {
          const current = await currentCalibration(tx, scope);
          if (!current || current.id !== row.baseCalibrationId)
            throw problem(
              'conflict',
              'The sheet scale has changed. Review a new request for the current calibration.',
            );
          if (
            (row.computedResult.verificationResult?.errorPercent ?? 0) >=
            TAKEOFF_SCALE_WARNING_PERCENT
          )
            throw problem(
              'validation_failed',
              'Resolve the incorrect check dimension before approving this scale.',
            );
          const saved = await insertTakeoffCalibration(tx, scope, userId, {
            current,
            input: row.input,
            result: row.computedResult,
            clientRequestId: row.id,
            requestHash: digest({ changeId, expected }),
          });
          appliedCalibrationId = saved.id;
        }
        const [saved] = await tx
          .update(requests)
          .set({
            status: decision,
            revision: 2,
            appliedCalibrationId,
            decisionReason: reason,
            decidedByUserId: userId,
            decidedAt: new Date(),
          })
          .where(filter)
          .returning();
        if (!saved) throw new Error('Sheet calibration decision update failed.');
        const change = changeDto(saved, base);
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_calibration_change',
          changeId,
          'takeoff_sheet.calibration_change_' + decision,
          changeDto(row, base),
          change,
        );
        return change;
      });
      setEtag(reply, outcome.revision);
      return outcome;
    },
  );
};

export default takeoffCalibrationLock;
