import { and, asc, desc, eq, exists, inArray, isNull, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EnterpriseTakeoffCondition,
  EnterpriseTakeoffConditionAssignment,
  EnterpriseTakeoffConditionAssignmentInput,
  EnterpriseTakeoffConditionInput,
  EnterpriseTakeoffConditionWorkspace,
} from '@fieldline/contracts';
import {
  enterpriseTakeoffAreas as areas,
  enterpriseTakeoffConditionAssignments as assignments,
  enterpriseTakeoffConditions as conditions,
  enterpriseTakeoffCountSets as counts,
  enterpriseTakeoffLengths as lengths,
} from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';
import { readSheet, type TakeoffSheetScope } from './takeoffCalibration';
import { readMeasurement, sheetScope, type TakeoffMeasurementKind } from './takeoffMeasurements';

const Project = z.object({ projectId: z.uuid() });
const Sheet = Project.extend({ planId: z.uuid(), sheetId: z.uuid() });
const root = '/enterprise/projects/:projectId/takeoff';
const sheetPath = root + '/plan-sets/:planId/sheets/:sheetId/conditions';
const write = {
  permission: 'estimate:write',
  rateLimit: { max: 30, timeWindow: '1 minute' },
} as const;

function projectConditions(orgId: string, projectId: string) {
  return and(eq(conditions.orgId, orgId), eq(conditions.projectId, projectId));
}

function assignmentScope(scope: TakeoffSheetScope) {
  return sheetScope(assignments, scope);
}

async function getCondition(tx: Tx, orgId: string, projectId: string, id: string) {
  const [entry] = await tx
    .select()
    .from(conditions)
    .where(and(projectConditions(orgId, projectId), eq(conditions.id, id)));
  if (!entry) throw problem('not_found', 'Choose a condition from this project.');
  return entry;
}

function assignmentDto(row: typeof assignments.$inferSelect) {
  return {
    id: row.id,
    measurementKind: row.measurementKind,
    measurementId: row.measurementId,
    conditionId: row.conditionId,
    floorId: row.floorId,
    roomId: row.roomId,
    createdAt: row.createdAt.toISOString(),
  };
}

const conditionColumns = {
  id: conditions.id,
  kind: conditions.kind,
  name: conditions.name,
  parentFloorId: conditions.parentFloorId,
};

const takeoffConditions: FastifyPluginAsyncZod = async (app) => {
  app.post(
    root + '/conditions',
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: Project,
        body: EnterpriseTakeoffConditionInput,
        response: { 200: EnterpriseTakeoffCondition, 201: EnterpriseTakeoffCondition },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const { name, kind, parentFloorId } = request.body;
      const saved = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        if (parentFloorId) {
          const parent = await getCondition(tx, orgId, projectId, parentFloorId);
          if (parent.kind !== 'floor')
            throw problem('validation_failed', 'Choose the room’s project floor.');
        }
        const [prior] = await tx
          .select(conditionColumns)
          .from(conditions)
          .where(
            and(
              projectConditions(orgId, projectId),
              eq(conditions.kind, kind),
              sql`${conditions.nameKey} = lower(${name})`,
              parentFloorId
                ? eq(conditions.parentFloorId, parentFloorId)
                : isNull(conditions.parentFloorId),
            ),
          );
        if (prior) return { entry: prior, created: false };
        const [entry] = await tx
          .insert(conditions)
          .values({
            orgId,
            projectId,
            kind,
            name,
            parentFloorId,
            createdByUserId: userId,
          })
          .returning(conditionColumns);
        if (!entry) throw new Error('Takeoff condition insertion failed.');
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_condition',
          entry.id,
          'takeoff_condition.created',
          null,
          entry,
        );
        return { entry, created: true };
      });
      return reply.code(saved.created ? 201 : 200).send(saved.entry);
    },
  );

  app.get(
    sheetPath,
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: Sheet,
        querystring: z.object({
          floorId: z.uuid().optional(),
          cursor: z.string().max(256).optional(),
        }),
        response: { 200: EnterpriseTakeoffConditionWorkspace },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const { floorId } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await readSheet(tx, scope);
        if (floorId && (await getCondition(tx, orgId, scope.projectId, floorId)).kind !== 'floor')
          throw problem('validation_failed', 'Select a project floor to filter measurements.');
        const measured = unionAll(
          tx
            .select({
              id: lengths.id,
              kind: sql<TakeoffMeasurementKind>`'length'::text`.as('kind'),
              value: lengths.length,
              unit: sql<string | null>`${lengths.unit}`.as('unit'),
              revision: sql<number>`1`.as('revision'),
              createdAt: lengths.createdAt,
            })
            .from(lengths)
            .where(sheetScope(lengths, scope)),
          tx
            .select({
              id: areas.id,
              kind: sql<TakeoffMeasurementKind>`'area'::text`.as('kind'),
              value: areas.netArea,
              unit: sql<string | null>`${areas.unit}`.as('unit'),
              revision: sql<number>`1`.as('revision'),
              createdAt: areas.createdAt,
            })
            .from(areas)
            .where(sheetScope(areas, scope)),
          tx
            .select({
              id: counts.id,
              kind: sql<TakeoffMeasurementKind>`'count'::text`.as('kind'),
              value: counts.activeCount,
              unit: sql<string | null>`null::text`.as('unit'),
              revision: counts.revision,
              createdAt: counts.createdAt,
            })
            .from(counts)
            .where(sheetScope(counts, scope)),
        ).as('sheet_measurements');
        const limits = 30;
        const rows = await tx
          .select()
          .from(measured)
          .where(
            and(
              beforeCursor(measured.createdAt, measured.id, cursor),
              floorId
                ? exists(
                    tx
                      .select({ id: assignments.id })
                      .from(assignments)
                      .where(
                        and(
                          assignmentScope(scope),
                          eq(assignments.floorId, floorId),
                          eq(assignments.measurementId, measured.id),
                          eq(assignments.measurementKind, measured.kind),
                        ),
                      ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(msTrunc(measured.createdAt)), desc(measured.id))
          .limit(limits + 1);
        const tags = rows.length
          ? await tx
              .select()
              .from(assignments)
              .where(
                and(
                  assignmentScope(scope),
                  inArray(
                    assignments.measurementId,
                    rows.slice(0, limits).map(({ id }) => id),
                  ),
                ),
              )
              .orderBy(asc(assignments.createdAt))
          : [];
        const taxonomy = await tx
          .select(conditionColumns)
          .from(conditions)
          .where(projectConditions(orgId, scope.projectId))
          .orderBy(asc(conditions.kind), asc(conditions.name));
        const page = pageResult(
          rows,
          limits,
          ({ createdAt, id }) => ({ at: createdAt, id }),
          (measure) => ({
            ...measure,
            conditions: tags
              .filter(
                (tag) => tag.measurementId === measure.id && tag.measurementKind === measure.kind,
              )
              .map(assignmentDto),
          }),
        );
        return { measurements: page.items, conditions: taxonomy, nextCursor: page.nextCursor };
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
        body: EnterpriseTakeoffConditionAssignmentInput,
        response: {
          200: EnterpriseTakeoffConditionAssignment,
          201: EnterpriseTakeoffConditionAssignment,
        },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const revision = parseIfMatch(request);
      const { measurementId, measurementKind, conditionId, roomId, floorId } = request.body;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId, true);
        const current = await readMeasurement(tx, scope, measurementKind, measurementId, true);
        const tag = await getCondition(tx, orgId, scope.projectId, conditionId);
        const selectedRoom = roomId
          ? await getCondition(tx, orgId, scope.projectId, roomId)
          : undefined;
        const selectedFloor = floorId
          ? await getCondition(tx, orgId, scope.projectId, floorId)
          : undefined;
        if (
          (selectedRoom && selectedRoom.kind !== 'room') ||
          (selectedFloor && selectedFloor.kind !== 'floor')
        )
          throw problem(
            'validation_failed',
            'Choose a room and floor from the project’s condition list.',
          );
        if (tag.kind === 'room' && selectedRoom && tag.id !== selectedRoom.id)
          throw problem('validation_failed', 'The selected room differs from the room condition.');
        const room = selectedRoom ?? (tag.kind === 'room' ? tag : undefined);
        if (selectedFloor && tag.kind === 'floor' && tag.id !== selectedFloor.id)
          throw problem(
            'validation_failed',
            'The selected floor differs from the floor condition.',
          );
        const floor =
          selectedFloor?.id ?? (tag.kind === 'floor' ? tag.id : room?.parentFloorId) ?? null;
        if (room && floor !== room.parentFloorId)
          throw problem('validation_failed', 'The room belongs to a different project floor.');
        const assignedRoom = room?.id ?? null;
        const [prior] = await tx
          .select()
          .from(assignments)
          .where(
            and(
              assignmentScope(scope),
              eq(assignments.measurementKind, measurementKind),
              eq(assignments.measurementId, measurementId),
              eq(assignments.conditionId, conditionId),
            ),
          );
        if (prior) {
          if (prior.floorId !== floor || prior.roomId !== assignedRoom)
            throw problem(
              'conflict',
              'This measurement condition is already assigned to another location.',
            );
          return { entry: prior, created: false };
        }
        assertRevision(current.revision, revision);
        const [entry] = await tx
          .insert(assignments)
          .values({
            ...scope,
            conditionId,
            floorId: floor,
            roomId: assignedRoom,
            createdByUserId: userId,
            lengthId: measurementKind === 'length' ? measurementId : null,
            areaId: measurementKind === 'area' ? measurementId : null,
            countId: measurementKind === 'count' ? measurementId : null,
          })
          .returning();
        if (!entry) throw new Error('Takeoff condition assignment failed.');
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_measurement',
          measurementId,
          'takeoff_measurement.condition_applied',
          null,
          assignmentDto(entry),
        );
        return { entry, created: true };
      });
      return reply.code(result.created ? 201 : 200).send(assignmentDto(result.entry));
    },
  );
};

export default takeoffConditions;
