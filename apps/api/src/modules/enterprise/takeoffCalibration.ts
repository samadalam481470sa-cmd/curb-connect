import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  EnterpriseTakeoffCalibration,
  EnterpriseTakeoffCalibrationInput,
  EnterpriseTakeoffCalibrationState,
} from '@fieldline/contracts';
import { enterpriseTakeoffCalibrations as calibrations } from '../../db/schema/enterpriseTakeoff';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { checkEnabled, checkProject } from './access';

import {
  calibrationDto,
  calibrationParams as Params,
  calibrationPath as path,
  calibrationScope,
  computeCalibrationResult,
  currentCalibration,
  insertTakeoffCalibration,
  readSheet,
} from './takeoffCalibrationData';
import { readCalibrationLock } from './takeoffCalibrationLockState';

export { currentCalibration, readSheet, type TakeoffSheetScope } from './takeoffCalibrationData';

const takeoffCalibration: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: Params,
        response: { 200: EnterpriseTakeoffCalibrationState },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const row = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await readSheet(tx, scope);
        return currentCalibration(tx, scope);
      });
      const revision = row?.revision ?? 0;
      setEtag(reply, revision);
      return { revision, calibration: row ? calibrationDto(row) : null };
    },
  );

  app.post(
    path,
    {
      config: { permission: 'estimate:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: Params,
        body: EnterpriseTakeoffCalibrationInput,
        response: { 200: EnterpriseTakeoffCalibration, 201: EnterpriseTakeoffCalibration },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const expected = parseIfMatch(request);
      const { clientRequestId, ...input } = request.body;
      const hash = createHash('sha256').update(JSON.stringify({ input, expected })).digest('hex');
      const saved = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        const sheet = await readSheet(tx, scope);

        const [prior] = await tx
          .select()
          .from(calibrations)
          .where(and(calibrationScope(scope), eq(calibrations.clientRequestId, clientRequestId)));
        if (prior) {
          if (prior.requestHash !== hash)
            throw problem('conflict', 'This request already saved a different calibration.');
          return { row: prior, created: false };
        }
        const current = await currentCalibration(tx, scope);
        const revision = current?.revision ?? 0;
        assertRevision(revision, expected);
        if ((await readCalibrationLock(tx, scope, current?.id)).effective)
          throw problem('conflict', 'The sheet scale is locked. Request estimator lead approval.');
        const row = await insertTakeoffCalibration(tx, scope, userId, {
          current,
          input,
          result: computeCalibrationResult(input, sheet),
          requestHash: hash,
          clientRequestId,
        });
        return { row, created: true };
      });
      setEtag(reply, saved.row.revision);
      return reply.code(saved.created ? 201 : 200).send(calibrationDto(saved.row));
    },
  );
};

export default takeoffCalibration;
