import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EnterpriseDailyLog,
  EnterpriseDailyLogInput,
  EnterpriseDailyLogPage,
  EnterpriseDailyLogStatus,
  EnterpriseScheduleDate,
} from '@fieldline/contracts';
import { enterpriseDailyLogs as logs } from '../../db/schema/enterpriseDailyLog';
import { enterpriseScheduleTasks } from '../../db/schema/enterpriseSchedule';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';

const ProjectParams = z.object({ projectId: z.uuid() });
const LogParams = ProjectParams.extend({ logId: z.uuid() });
const path = '/enterprise/projects/:projectId/daily-logs';
const response = { 200: EnterpriseDailyLog };
const writes = { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } } as const;
type Log = typeof logs.$inferSelect;

function dto(row: Log) {
  return {
    ...row,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

function projectScope(orgId: string, projectId: string) {
  return and(eq(logs.orgId, orgId), eq(logs.projectId, projectId));
}

async function lockedLog(
  tx: Tx,
  orgId: string,
  projectId: string,
  logId: string,
  revision: number,
) {
  const [row] = await tx
    .select()
    .from(logs)
    .where(and(projectScope(orgId, projectId), eq(logs.id, logId)))
    .for('update');
  if (!row) throw problem('not_found');
  assertRevision(row.revision, revision);
  return row;
}

async function checkTask(tx: Tx, orgId: string, projectId: string, taskId: string | null) {
  if (!taskId) return;
  const task = enterpriseScheduleTasks;
  const [match] = await tx
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.orgId, orgId), eq(task.projectId, projectId)));
  if (!match) throw problem('validation_failed', 'Choose a schedule task from this project.');
}

function checkEditable(row: Log) {
  if (row.status !== 'draft' && row.status !== 'changes_requested')
    throw problem('conflict', 'This report is locked for review or has been approved.');
}

const enterpriseDailyLogModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        querystring: z.object({
          workDate: EnterpriseScheduleDate.optional(),
          status: EnterpriseDailyLogStatus.optional(),
          cursor: z.string().max(256).optional(),
        }),
        response: { 200: EnterpriseDailyLogPage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      const { workDate, status, cursor } = request.query;
      const position = decodeCursor(cursor);
      const limit = 30;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const rows = await tx
          .select()
          .from(logs)
          .where(
            and(
              projectScope(orgId, projectId),
              workDate ? eq(logs.workDate, workDate) : undefined,
              status ? eq(logs.status, status) : undefined,
              beforeCursor(logs.createdAt, logs.id, position),
            ),
          )
          .orderBy(desc(msTrunc(logs.createdAt)), desc(logs.id))
          .limit(limit + 1);
        return pageResult(rows, limit, (row) => ({ at: row.createdAt, id: row.id }), dto);
      });
    },
  );

  app.post(
    path,
    {
      config: writes,
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        body: EnterpriseDailyLogInput.safeExtend({ clientRequestId: z.uuid() }),
        response: { ...response, 201: EnterpriseDailyLog },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const scope = projectScope(orgId, projectId);
        const [existing] = await tx
          .select()
          .from(logs)
          .where(and(scope, eq(logs.clientRequestId, request.body.clientRequestId)));
        if (existing) {
          if (existing.workDate !== request.body.workDate)
            throw problem('conflict', 'This request ID belongs to a different report.');
          return { row: existing, created: false };
        }

        const [sameDay] = await tx
          .select({ id: logs.id })
          .from(logs)
          .where(and(scope, eq(logs.workDate, request.body.workDate)));
        if (sameDay) throw problem('conflict', 'This project already has a report for that date.');
        await checkTask(tx, orgId, projectId, request.body.scheduleTaskId);
        const [created] = await tx
          .insert(logs)
          .values({ ...request.body, orgId, projectId, createdByUserId: userId })
          .returning();
        if (!created) throw new Error('Daily report insertion failed.');
        await audit(tx, orgId, userId, 'daily_log', created.id, 'daily_log.created', null, created);
        return { row: created, created: true };
      });
      return reply.code(result.created ? 201 : 200).send(dto(result.row));
    },
  );

  app.put(
    path + '/:logId',
    {
      config: writes,
      schema: { tags: ['enterprise'], params: LogParams, body: EnterpriseDailyLogInput, response },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, logId } = request.params;
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const row = await lockedLog(tx, orgId, projectId, logId, revision);
        checkEditable(row);
        if (row.workDate !== request.body.workDate)
          throw problem('validation_failed', 'A daily report keeps its original work date.');
        await checkTask(tx, orgId, projectId, request.body.scheduleTaskId);
        const [updated] = await tx
          .update(logs)
          .set({ ...request.body, revision: row.revision + 1 })
          .where(and(projectScope(orgId, projectId), eq(logs.id, logId)))
          .returning();
        if (!updated) throw problem('not_found');
        await audit(tx, orgId, userId, 'daily_log', logId, 'daily_log.updated', row, updated);
        return dto(updated);
      });
    },
  );

  app.post(
    path + '/:logId/submit',
    {
      config: writes,
      schema: { tags: ['enterprise'], params: LogParams, response },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, logId } = request.params;
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const row = await lockedLog(tx, orgId, projectId, logId, revision);
        checkEditable(row);
        const [updated] = await tx
          .update(logs)
          .set({ status: 'submitted', submittedAt: new Date(), revision: row.revision + 1 })
          .where(and(projectScope(orgId, projectId), eq(logs.id, logId)))
          .returning();
        if (!updated) throw problem('not_found');
        await audit(tx, orgId, userId, 'daily_log', logId, 'daily_log.submitted', row, updated);
        return dto(updated);
      });
    },
  );

  app.post(
    path + '/:logId/review',
    {
      config: { permission: 'review_task:decide', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: LogParams,
        response,
        body: z.object({
          decision: z.enum(['approved', 'changes_requested']),
          note: z.string().trim().min(3).max(1000),
        }),
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, logId } = request.params;
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const row = await lockedLog(tx, orgId, projectId, logId, revision);
        if (row.status !== 'submitted')
          throw problem('conflict', 'Only a submitted daily report can be reviewed.');
        const [updated] = await tx
          .update(logs)
          .set({
            status: request.body.decision,
            reviewNote: request.body.note,
            reviewedAt: new Date(),
            revision: row.revision + 1,
          })
          .where(and(projectScope(orgId, projectId), eq(logs.id, logId)))
          .returning();
        if (!updated) throw problem('not_found');
        await audit(tx, orgId, userId, 'daily_log', logId, 'daily_log.reviewed', row, updated);
        return dto(updated);
      });
    },
  );
};

export default enterpriseDailyLogModule;
