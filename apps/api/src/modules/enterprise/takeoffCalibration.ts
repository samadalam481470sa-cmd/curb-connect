import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  computeTakeoffCalibration,
  EnterpriseTakeoffCalibration,
  EnterpriseTakeoffCalibrationInput,
  EnterpriseTakeoffCalibrationState,
} from '@fieldline/contracts';
import {
  enterpriseTakeoffCalibrations as calibrations,
  enterpriseTakeoffPlanSheets as sheets,
} from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';

const Params = z.object({ projectId: z.uuid(), planId: z.uuid(), sheetId: z.uuid() });
const path =
  '/enterprise/projects/:projectId/takeoff/plan-sets/:planId/sheets/:sheetId/calibration';
type Scope = z.infer<typeof Params> & { orgId: string };

function calibrationScope({ orgId, projectId, planId, sheetId }: Scope) {
  return and(
    eq(calibrations.orgId, orgId),
    eq(calibrations.projectId, projectId),
    eq(calibrations.planId, planId),
    eq(calibrations.sheetId, sheetId),
  );
}

async function readSheet(tx: Tx, { orgId, projectId, planId, sheetId }: Scope) {
  const [sheet] = await tx
    .select({ widthPoints: sheets.widthPoints, heightPoints: sheets.heightPoints })
    .from(sheets)
    .where(
      and(
        eq(sheets.orgId, orgId),
        eq(sheets.projectId, projectId),
        eq(sheets.planId, planId),
        eq(sheets.id, sheetId),
      ),
    );
  if (!sheet) throw problem('not_found');
  return sheet;
}

async function currentCalibration(tx: Tx, scope: Scope) {
  const [row] = await tx
    .select()
    .from(calibrations)
    .where(calibrationScope(scope))
    .orderBy(desc(calibrations.revision))
    .limit(1);
  return row;
}

function dto(row: typeof calibrations.$inferSelect) {
  return {
    id: row.id,
    sheetId: row.sheetId,
    revision: row.revision,
    ...row.input,
    ...row.result,
    createdAt: row.createdAt.toISOString(),
  };
}

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
      return { revision, calibration: row ? dto(row) : null };
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
        let result: ReturnType<typeof computeTakeoffCalibration>;
        try {
          result = computeTakeoffCalibration(input, sheet);
        } catch (error) {
          if (error instanceof RangeError) throw problem('validation_failed', error.message);
          throw error;
        }
        const [row] = await tx
          .insert(calibrations)
          .values({
            ...scope,
            revision: revision + 1,
            input,
            result,
            requestHash: hash,
            clientRequestId,
            createdByUserId: userId,
          })
          .returning();
        if (!row) throw new Error('Takeoff calibration insertion failed.');
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_sheet',
          scope.sheetId,
          'takeoff_sheet.calibrated',
          current ? dto(current) : null,
          dto(row),
        );
        return { row, created: true };
      });
      setEtag(reply, saved.row.revision);
      return reply.code(saved.created ? 201 : 200).send(dto(saved.row));
    },
  );
};

export default takeoffCalibration;
