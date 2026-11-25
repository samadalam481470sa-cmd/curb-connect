import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EnterpriseTakeoffArea,
  EnterpriseTakeoffAreaInput,
  EnterpriseTakeoffAreaPage,
} from '@fieldline/contracts';
import { computeTakeoffArea } from '@fieldline/geometry';
import { enterpriseTakeoffAreas as areas } from '../../db/schema/enterpriseTakeoff';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { audit, checkEnabled, checkProject } from './access';
import { currentCalibration, readSheet, type TakeoffSheetScope } from './takeoffCalibration';

const Project = z.object({ projectId: z.uuid() });
const Sheet = Project.extend({ planId: z.uuid(), sheetId: z.uuid() });
const root = '/enterprise/projects/:projectId/takeoff';
const sheetPath = root + '/plan-sets/:planId/sheets/:sheetId/areas';
const write = {
  permission: 'estimate:write',
  rateLimit: { max: 30, timeWindow: '1 minute' },
} as const;

function areaScope({ orgId, projectId, planId, sheetId }: TakeoffSheetScope) {
  return and(
    eq(areas.orgId, orgId),
    eq(areas.projectId, projectId),
    eq(areas.planId, planId),
    eq(areas.sheetId, sheetId),
  );
}

function dto(row: typeof areas.$inferSelect, calibrationId?: string) {
  return {
    id: row.id,
    sheetId: row.sheetId,
    calibrationId: row.calibrationId,
    exterior: row.exterior,
    holes: row.holes,
    exteriorArea: row.exteriorArea,
    deductedArea: row.deductedArea,
    netArea: row.netArea,
    exteriorPerimeter: row.exteriorPerimeter,
    deductionPerimeter: row.deductionPerimeter,
    unit: row.unit,
    requiresReview: row.calibrationId !== calibrationId,
    createdAt: row.createdAt.toISOString(),
  };
}

const takeoffAreas: FastifyPluginAsyncZod = async (app) => {
  app.get(
    sheetPath,
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: Sheet,
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: EnterpriseTakeoffAreaPage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await readSheet(tx, scope);
        const calibration = await currentCalibration(tx, scope);
        const limit = 30;
        const rows = await tx
          .select()
          .from(areas)
          .where(and(areaScope(scope), beforeCursor(areas.createdAt, areas.id, cursor)))
          .orderBy(desc(msTrunc(areas.createdAt)), desc(areas.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          ({ createdAt, id }) => ({ at: createdAt, id }),
          (row) => dto(row, calibration?.id),
        );
      });
    },
  );

  app.post(
    sheetPath,
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: Sheet,
        body: EnterpriseTakeoffAreaInput,
        response: { 200: EnterpriseTakeoffArea, 201: EnterpriseTakeoffArea },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const { calibrationId, exterior, holes, clientRequestId } = request.body;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ calibrationId, exterior, holes }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        const sheet = await readSheet(tx, scope);
        const calibration = await currentCalibration(tx, scope);
        const [prior] = await tx
          .select()
          .from(areas)
          .where(and(areaScope(scope), eq(areas.clientRequestId, clientRequestId)));
        if (prior) {
          if (prior.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved a different measurement.');
          return { row: dto(prior, calibration?.id), created: false };
        }

        if (!calibration || calibration.id !== calibrationId)
          throw problem('conflict', 'Load the current saved calibration for this sheet and retry.');
        let computed: ReturnType<typeof computeTakeoffArea>;
        try {
          computed = computeTakeoffArea(exterior, holes, calibration.result.scale, sheet);
        } catch (error) {
          if (error instanceof RangeError) throw problem('validation_failed', error.message);
          throw error;
        }
        const [row] = await tx
          .insert(areas)
          .values({
            ...scope,
            calibrationId,
            exterior,
            holes,
            ...computed,
            unit: calibration.input.unit,
            clientRequestId,
            requestHash,
            createdByUserId: userId,
          })
          .returning();
        if (!row) throw new Error('Takeoff area insertion failed.');
        const measurement = dto(row, calibration.id);
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_area',
          row.id,
          'takeoff_area.created',
          null,
          measurement,
        );
        return { row: measurement, created: true };
      });
      return reply.code(result.created ? 201 : 200).send(result.row);
    },
  );
};

export default takeoffAreas;
