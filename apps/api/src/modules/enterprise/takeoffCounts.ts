import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EnterpriseTakeoffCount,
  EnterpriseTakeoffCountInput,
  EnterpriseTakeoffCountList,
} from '@fieldline/contracts';
import {
  enterpriseTakeoffCategories as categories,
  enterpriseTakeoffCountMarkers as markers,
  enterpriseTakeoffCountSets as sets,
} from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';
import { readSheet, type TakeoffSheetScope } from './takeoffCalibration';

const Params = z.object({ projectId: z.uuid(), planId: z.uuid(), sheetId: z.uuid() });
const MarkerParams = Params.extend({ countId: z.uuid(), markerId: z.uuid() });
const path = '/enterprise/projects/:projectId/takeoff/plan-sets/:planId/sheets/:sheetId/counts';
const write = {
  permission: 'estimate:write',
  rateLimit: { max: 30, timeWindow: '1 minute' },
} as const;

function setScope({ orgId, projectId, planId, sheetId }: TakeoffSheetScope) {
  return and(
    eq(sets.orgId, orgId),
    eq(sets.projectId, projectId),
    eq(sets.planId, planId),
    eq(sets.sheetId, sheetId),
  );
}

function markerScope({ orgId, projectId, planId, sheetId }: TakeoffSheetScope) {
  return and(
    eq(markers.orgId, orgId),
    eq(markers.projectId, projectId),
    eq(markers.planId, planId),
    eq(markers.sheetId, sheetId),
  );
}

async function setMarkers(tx: Tx, scope: TakeoffSheetScope, ids: string[]) {
  if (!ids.length) return [];
  return tx
    .select()
    .from(markers)
    .where(and(markerScope(scope), inArray(markers.countSetId, ids)))
    .orderBy(asc(markers.ordinal));
}

function dto(row: typeof sets.$inferSelect, points: (typeof markers.$inferSelect)[]) {
  return {
    id: row.id,
    sheetId: row.sheetId,
    categoryId: row.categoryId,
    symbol: row.symbol,
    total: points.filter((point) => !point.removedAt).length,
    revision: row.revision,
    markers: points.map((point) => ({
      id: point.id,
      point: { x: point.x, y: point.y },
      removedAt: point.removedAt?.toISOString() ?? null,
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

const takeoffCounts: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: Params,
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: EnterpriseTakeoffCountList },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await readSheet(tx, scope);
        const limit = 15;
        const rows = await tx
          .select()
          .from(sets)
          .where(and(setScope(scope), beforeCursor(sets.createdAt, sets.id, cursor)))
          .orderBy(desc(msTrunc(sets.createdAt)), desc(sets.id))
          .limit(limit + 1);
        const points = await setMarkers(
          tx,
          scope,
          rows.slice(0, limit).map(({ id }) => id),
        );
        const options = await tx
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(and(eq(categories.orgId, orgId), eq(categories.projectId, scope.projectId)))
          .orderBy(asc(categories.name));
        return {
          ...pageResult(
            rows,
            limit,
            ({ id, createdAt }) => ({ at: createdAt, id }),
            (row) =>
              dto(
                row,
                points.filter((point) => point.countSetId === row.id),
              ),
          ),
          categories: options,
        };
      });
    },
  );

  app.post(
    path,
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: Params,
        body: EnterpriseTakeoffCountInput,
        response: { 200: EnterpriseTakeoffCount, 201: EnterpriseTakeoffCount },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const { categoryId, symbol, points, clientRequestId } = request.body;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ categoryId, symbol, points }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        const sheet = await readSheet(tx, scope);
        const [prior] = await tx
          .select()
          .from(sets)
          .where(and(setScope(scope), eq(sets.clientRequestId, clientRequestId)));
        if (prior) {
          if (prior.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved a different count.');
          return { record: dto(prior, await setMarkers(tx, scope, [prior.id])), created: false };
        }
        if (points.some(({ x, y }) => x > sheet.widthPoints || y > sheet.heightPoints))
          throw problem('validation_failed', 'Place markers inside the sheet.');
        const [category] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.orgId, orgId),
              eq(categories.projectId, scope.projectId),
              eq(categories.id, categoryId),
            ),
          );
        if (!category)
          throw problem('not_found', 'Choose a measurement category from this project.');
        const [set] = await tx
          .insert(sets)
          .values({
            ...scope,
            categoryId,
            symbol,
            clientRequestId,
            requestHash,
            activeCount: points.length,
            createdByUserId: userId,
          })
          .returning();
        if (!set) throw new Error('Takeoff count insertion failed.');
        const rows = await tx
          .insert(markers)
          .values(
            points.map(({ x, y }, index) => ({
              ...scope,
              countSetId: set.id,
              ordinal: index + 1,
              x,
              y,
            })),
          )
          .returning();
        const record = dto(
          set,
          rows.sort((a, b) => a.ordinal - b.ordinal),
        );
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_count',
          set.id,
          'takeoff_count.created',
          null,
          record,
        );
        return { record, created: true };
      });
      setEtag(reply, result.record.revision);
      return reply.code(result.created ? 201 : 200).send(result.record);
    },
  );

  app.post(
    path + '/:countId/markers/:markerId/remove',
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: MarkerParams,
        response: { 200: EnterpriseTakeoffCount },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { countId, markerId, ...sheet } = request.params;
      const scope = { orgId, ...sheet };
      const revision = parseIfMatch(request);
      const record = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const [set] = await tx
          .select()
          .from(sets)
          .where(and(setScope(scope), eq(sets.id, countId)))
          .for('update');
        if (!set) throw problem('not_found');
        const points = await setMarkers(tx, scope, [set.id]);
        const point = points.find(({ id }) => id === markerId);
        if (!point) throw problem('not_found');
        if (point.removedAt) return dto(set, points);
        assertRevision(set.revision, revision);
        const removedAt = new Date();
        const [removed] = await tx
          .update(markers)
          .set({ removedAt, removedByUserId: userId })
          .where(and(markerScope(scope), eq(markers.countSetId, set.id), eq(markers.id, markerId)))
          .returning();
        const [updated] = await tx
          .update(sets)
          .set({ revision: set.revision + 1, activeCount: set.activeCount - 1 })
          .where(and(setScope(scope), eq(sets.id, set.id)))
          .returning();
        if (!updated || !removed) throw new Error('Takeoff marker removal failed.');
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_count',
          set.id,
          'takeoff_count.marker_removed',
          point,
          removed,
        );
        return dto(
          updated,
          points.map((existing) => (existing.id === markerId ? removed : existing)),
        );
      });
      setEtag(reply, record.revision);
      return record;
    },
  );
};

export default takeoffCounts;
