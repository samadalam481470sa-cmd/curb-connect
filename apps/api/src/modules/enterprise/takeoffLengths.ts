import { createHash } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  computeTakeoffLength,
  EnterpriseTakeoffCategory,
  EnterpriseTakeoffCategoryInput,
  EnterpriseTakeoffLength,
  EnterpriseTakeoffLengthInput,
  EnterpriseTakeoffLengthPage,
} from '@fieldline/contracts';
import {
  enterpriseTakeoffCategories as categories,
  enterpriseTakeoffLengths as lengths,
} from '../../db/schema/enterpriseTakeoff';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { audit, checkEnabled, checkProject } from './access';
import { currentCalibration, readSheet, type TakeoffSheetScope } from './takeoffCalibration';

const Project = z.object({ projectId: z.uuid() });
const Sheet = Project.extend({ planId: z.uuid(), sheetId: z.uuid() });
const root = '/enterprise/projects/:projectId/takeoff';
const sheetPath = root + '/plan-sets/:planId/sheets/:sheetId/lengths';
const write = {
  permission: 'estimate:write',
  rateLimit: { max: 30, timeWindow: '1 minute' },
} as const;

function categoryScope(orgId: string, projectId: string) {
  return and(eq(categories.orgId, orgId), eq(categories.projectId, projectId));
}

function lengthScope({ orgId, projectId, planId, sheetId }: TakeoffSheetScope) {
  return and(
    eq(lengths.orgId, orgId),
    eq(lengths.projectId, projectId),
    eq(lengths.planId, planId),
    eq(lengths.sheetId, sheetId),
  );
}

function dto(row: typeof lengths.$inferSelect, calibrationId?: string) {
  return {
    id: row.id,
    sheetId: row.sheetId,
    calibrationId: row.calibrationId,
    categoryId: row.categoryId,
    vertices: row.vertices,
    drawingLength: row.drawingLength,
    length: row.length,
    unit: row.unit,
    requiresReview: row.calibrationId !== calibrationId,
    createdAt: row.createdAt.toISOString(),
  };
}

const takeoffLengths: FastifyPluginAsyncZod = async (app) => {
  app.post(
    root + '/categories',
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: Project,
        body: EnterpriseTakeoffCategoryInput,
        response: { 200: EnterpriseTakeoffCategory, 201: EnterpriseTakeoffCategory },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const { name } = request.body;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const [prior] = await tx
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(and(categoryScope(orgId, projectId), sql`${categories.nameKey} = lower(${name})`));
        if (prior) return { row: prior, created: false };
        const [row] = await tx
          .insert(categories)
          .values({
            orgId,
            projectId,
            name,
            createdByUserId: userId,
          })
          .returning({ id: categories.id, name: categories.name });
        if (!row) throw new Error('Takeoff category insertion failed.');
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_category',
          row.id,
          'takeoff_category.created',
          null,
          row,
        );
        return { row, created: true };
      });
      return reply.code(result.created ? 201 : 200).send(result.row);
    },
  );

  app.get(
    sheetPath,
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: Sheet,
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: EnterpriseTakeoffLengthPage },
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
          .from(lengths)
          .where(and(lengthScope(scope), beforeCursor(lengths.createdAt, lengths.id, cursor)))
          .orderBy(desc(msTrunc(lengths.createdAt)), desc(lengths.id))
          .limit(limit + 1);
        const options = await tx
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(categoryScope(orgId, scope.projectId))
          .orderBy(asc(categories.name));
        return {
          ...pageResult(
            rows,
            limit,
            ({ createdAt, id }) => ({ at: createdAt, id }),
            (row) => dto(row, calibration?.id),
          ),
          categories: options,
        };
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
        body: EnterpriseTakeoffLengthInput,
        response: { 200: EnterpriseTakeoffLength, 201: EnterpriseTakeoffLength },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const { calibrationId, categoryId, vertices, clientRequestId } = request.body;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ calibrationId, categoryId, vertices }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        const sheet = await readSheet(tx, scope);
        const calibration = await currentCalibration(tx, scope);
        const [prior] = await tx
          .select()
          .from(lengths)
          .where(and(lengthScope(scope), eq(lengths.clientRequestId, clientRequestId)));
        if (prior) {
          if (prior.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved a different measurement.');
          return { row: dto(prior, calibration?.id), created: false };
        }

        if (!calibration || calibration.id !== calibrationId)
          throw problem('conflict', 'Load the current saved calibration for this sheet and retry.');
        const [category] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(and(categoryScope(orgId, scope.projectId), eq(categories.id, categoryId)));
        if (!category)
          throw problem('not_found', 'Choose a measurement category from this project.');
        let computed: ReturnType<typeof computeTakeoffLength>;
        try {
          computed = computeTakeoffLength(vertices, calibration.result.scale, sheet);
        } catch (error) {
          if (error instanceof RangeError) throw problem('validation_failed', error.message);
          throw error;
        }
        const [row] = await tx
          .insert(lengths)
          .values({
            ...scope,
            calibrationId,
            categoryId,
            vertices,
            ...computed,
            unit: calibration.input.unit,
            clientRequestId,
            requestHash,
            createdByUserId: userId,
          })
          .returning();
        if (!row) throw new Error('Takeoff length insertion failed.');
        const measurement = dto(row, calibration.id);
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_length',
          row.id,
          'takeoff_length.created',
          null,
          measurement,
        );
        return { row: measurement, created: true };
      });
      return reply.code(result.created ? 201 : 200).send(result.row);
    },
  );
};

export default takeoffLengths;
