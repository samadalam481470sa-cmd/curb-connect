import { createHash } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EnterpriseSchedulePreview,
  EnterpriseScheduleSnapshot,
  EnterpriseScheduleTaskInput,
  EnterpriseScheduleTemplates,
  EnterpriseScheduleTemplatePlacement,
  EnterpriseScheduleTemplatePreview,
} from '@fieldline/contracts';
import {
  enterpriseScheduleBaselines as baselines,
  enterpriseScheduleTasks as tasks,
  enterpriseScheduleTemplates as templates,
  enterpriseScheduleTemplateApplications as applications,
} from '../../db/schema/enterpriseSchedule';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { buildGantt, dayDiff, parseDay } from '../projectManagement/workflow';
import { audit, checkEnabled, checkProject } from './access';

const ProjectParams = z.object({ projectId: z.uuid() });
const TaskParams = ProjectParams.extend({ id: z.uuid() });
const MAX_TASKS = 500;
const DAY_MS = 86_400_000;

type Task = typeof tasks.$inferSelect;
type Baseline = typeof baselines.$inferSelect;
type Template = typeof templates.$inferSelect;

function prepareTemplate(
  template: Template,
  existing: Task[],
  startsOn: string,
  projectId: string,
  userId: string,
) {
  if (existing.length + template.tasks.length > MAX_TASKS)
    throw problem('conflict', 'The template would put this schedule over 500 tasks.');

  const ids = new Map(template.tasks.map((task) => [task.key, crypto.randomUUID()]));
  const added = template.tasks.map((task): Task => ({
    id: ids.get(task.key)!,
    title: task.title,
    phase: task.phase,
    startsOn: shifted(startsOn, task.startOffset),
    endsOn: shifted(startsOn, task.endOffset),
    predecessorId: task.predecessorKey ? ids.get(task.predecessorKey)! : null,
    lagDays: task.lagDays,
    progressPercent: 0,
    actualStartOn: null,
    actualFinishOn: null,
    revision: 1,
    clientRequestId: crypto.randomUUID(),
    orgId: template.orgId,
    projectId,
    createdByUserId: userId,
    updatedAt: new Date(),
  }));
  const dates = forecast(added);
  const token = createHash('sha256')
    .update(
      JSON.stringify([
        projectId,
        template.id,
        startsOn,
        existing.map(({ id, revision }) => [id, revision]),
      ]),
    )
    .digest('hex');
  return {
    rows: added,
    token,
    items: added.map((row, index) => ({
      key: template.tasks[index]!.key,
      title: row.title,
      phase: row.phase,
      ...dates.get(row.id)!,
    })),
  };
}

async function getTemplate(tx: Tx, orgId: string, templateId: string) {
  const [row] = await tx
    .select()
    .from(templates)
    .where(and(eq(templates.orgId, orgId), eq(templates.id, templateId)));
  if (!row) throw problem('not_found');
  return row;
}

function projectTasks(tx: Tx, orgId: string, projectId: string) {
  return tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.projectId, projectId)))
    .orderBy(asc(tasks.startsOn), asc(tasks.id));
}

function shifted(date: string, days: number): string {
  return new Date(parseDay(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function forecast(rows: readonly Task[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const dates = new Map<string, { startOn: string; endOn: string }>();
  const visiting = new Set<string>();

  function visit(row: Task) {
    const cached = dates.get(row.id);
    if (cached) return cached;
    if (visiting.has(row.id))
      throw problem('conflict', 'A task cannot depend on itself or one of its successors.');
    visiting.add(row.id);
    let startOn = row.startsOn;
    if (row.predecessorId) {
      const predecessor = byId.get(row.predecessorId);
      if (!predecessor)
        throw problem('validation_failed', 'Select a predecessor from this project.');
      const earliest = shifted(visit(predecessor).endOn, 1 + row.lagDays);
      if (earliest > startOn) startOn = earliest;
    }
    const endOn = shifted(startOn, dayDiff(row.startsOn, row.endsOn));
    if (endOn > '2200-12-31')
      throw problem('validation_failed', 'This dependency moves a forecast date past 2200.');
    const result = { startOn, endOn };
    dates.set(row.id, result);
    visiting.delete(row.id);
    return result;
  }

  for (const row of rows) visit(row);
  return dates;
}

function snapshot(
  rows: Task[],
  baselineHistory: Pick<Baseline, 'id' | 'label' | 'createdAt'>[],
  baseline: Baseline | null,
) {
  const predicted = forecast(rows);
  const baselineDates = new Map(baseline?.tasks.map((task) => [task.id, task.endOn]));
  const gantt = buildGantt(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      startsOn: predicted.get(row.id)!.startOn,
      endsOn: predicted.get(row.id)!.endOn,
      progressPercent: row.progressPercent,
      predecessorTaskId: row.predecessorId,
    })),
  );
  return {
    items: rows.map((row, index) => {
      const bar = gantt.bars[index]!;
      const baselineEndOn = baselineDates.get(row.id) ?? null;
      return {
        ...row,
        forecastStartOn: bar.startsOn,
        forecastEndOn: bar.endsOn,
        leftPercent: bar.leftPercent,
        widthPercent: bar.widthPercent,
        baselineEndOn,
        varianceDays: baselineEndOn ? dayDiff(baselineEndOn, bar.endsOn) : null,
      };
    }),
    chartStart: gantt.chartStart,
    chartEnd: gantt.chartEnd,
    baselines: baselineHistory.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
    })),
    selectedBaselineId: baseline?.id ?? null,
  };
}

function previewEdit(rows: Task[], task: Task, body: EnterpriseScheduleTaskInput) {
  const previous = forecast(rows);
  const proposed = forecast(rows.map((row) => (row.id === task.id ? { ...row, ...body } : row)));
  const affected = rows.flatMap((row) => {
    const before = previous.get(row.id)!;
    const after = proposed.get(row.id)!;
    if (before.startOn === after.startOn && before.endOn === after.endOn) return [];
    return [
      {
        id: row.id,
        title: row.id === task.id ? body.title : row.title,
        beforeStartOn: before.startOn,
        beforeEndOn: before.endOn,
        afterStartOn: after.startOn,
        afterEndOn: after.endOn,
      },
    ];
  });
  const token = createHash('sha256')
    .update(JSON.stringify([task.id, rows.map(({ id, revision }) => [id, revision]), body]))
    .digest('hex');
  return { token, affected };
}

const enterpriseScheduleModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/enterprise/projects/:projectId/schedule',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        querystring: z.object({ baselineId: z.uuid().optional() }),
        response: { 200: EnterpriseScheduleSnapshot },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const scope = and(eq(baselines.orgId, orgId), eq(baselines.projectId, projectId));
        const history = await tx
          .select({ id: baselines.id, label: baselines.label, createdAt: baselines.createdAt })
          .from(baselines)
          .where(scope)
          .orderBy(desc(baselines.createdAt), desc(baselines.id))
          .limit(30);
        const key = request.query.baselineId ?? history[0]?.id;
        const [baseline] = key
          ? await tx
              .select()
              .from(baselines)
              .where(and(scope, eq(baselines.id, key)))
          : [];
        if (request.query.baselineId && !baseline) throw problem('not_found');
        if (baseline && !history.some((row) => row.id === baseline.id)) history.push(baseline);
        return snapshot(await projectTasks(tx, orgId, projectId), history, baseline ?? null);
      });
    },
  );

  app.post(
    '/enterprise/projects/:projectId/schedule/tasks',
    {
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        body: EnterpriseScheduleTaskInput.safeExtend({ clientRequestId: z.uuid() }),
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const body = request.body;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const rows = await projectTasks(tx, orgId, projectId);
        const existing = rows.find((row) => row.clientRequestId === body.clientRequestId);
        if (existing) return { id: existing.id, created: false };
        if (rows.length >= MAX_TASKS)
          throw problem('conflict', 'This project has reached its 500-task schedule limit.');
        const today = new Date().toISOString().slice(0, 10);
        const values = {
          ...body,
          id: crypto.randomUUID(),
          projectId,
          orgId,
          createdByUserId: userId,
          actualStartOn: body.progressPercent > 0 ? today : null,
          actualFinishOn: body.progressPercent === 100 ? today : null,
        };
        forecast([...rows, { ...values, revision: 1, updatedAt: new Date() }]);
        const [created] = await tx.insert(tasks).values(values).returning();
        if (!created) throw new Error('Schedule task insertion failed.');
        await audit(
          tx,
          orgId,
          userId,
          'schedule_task',
          created.id,
          'schedule.task_created',
          null,
          created,
        );
        return { id: created.id, created: true };
      });
      return reply.code(result.created ? 201 : 200).send({ id: result.id });
    },
  );

  app.post(
    '/enterprise/projects/:projectId/schedule/tasks/:id/preview',
    {
      config: { permission: 'job:write' },
      schema: {
        tags: ['enterprise'],
        params: TaskParams,
        body: EnterpriseScheduleTaskInput,
        response: { 200: EnterpriseSchedulePreview },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId, id } = request.params;
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const rows = await projectTasks(tx, orgId, projectId);
        const row = rows.find((task) => task.id === id);
        if (!row) throw problem('not_found');
        assertRevision(row.revision, revision);
        return previewEdit(rows, row, request.body);
      });
    },
  );

  app.patch(
    '/enterprise/projects/:projectId/schedule/tasks/:id',
    {
      config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: TaskParams,
        body: z.object({
          task: EnterpriseScheduleTaskInput,
          previewToken: EnterpriseSchedulePreview.shape.token,
          reason: z.string().trim().min(3).max(500),
        }),
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, id } = request.params;
      const { task, previewToken, reason } = request.body;
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const rows = await projectTasks(tx, orgId, projectId);
        const row = rows.find((current) => current.id === id);
        if (!row) throw problem('not_found');
        assertRevision(row.revision, revision);
        if (previewEdit(rows, row, task).token !== previewToken)
          throw problem(
            'conflict',
            'The schedule or draft changed. Review the impact again before applying.',
          );
        const today = new Date().toISOString().slice(0, 10);
        const [updated] = await tx
          .update(tasks)
          .set({
            ...task,
            actualStartOn: task.progressPercent > 0 ? (row.actualStartOn ?? today) : null,
            actualFinishOn: task.progressPercent === 100 ? (row.actualFinishOn ?? today) : null,
            revision: row.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(tasks.orgId, orgId), eq(tasks.projectId, projectId), eq(tasks.id, id)))
          .returning();
        if (!updated) throw problem('not_found');
        await audit(tx, orgId, userId, 'schedule_task', id, 'schedule.task_updated', row, {
          ...updated,
          reason,
        });
        return { id, revision: updated.revision };
      });
    },
  );

  app.post(
    '/enterprise/projects/:projectId/schedule/baselines',
    {
      config: { permission: 'org:settings_update', rateLimit: { max: 15, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        body: z.object({ label: z.string().trim().min(2).max(160), clientRequestId: z.uuid() }),
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const { label, clientRequestId } = request.body;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const [existing] = await tx
          .select({ id: baselines.id })
          .from(baselines)
          .where(
            and(
              eq(baselines.orgId, orgId),
              eq(baselines.projectId, projectId),
              eq(baselines.clientRequestId, clientRequestId),
            ),
          );
        if (existing) return { id: existing.id, created: false };
        const rows = await projectTasks(tx, orgId, projectId);
        if (!rows.length)
          throw problem('validation_failed', 'Add schedule tasks before saving a baseline.');
        const dates = forecast(rows);
        const [baseline] = await tx
          .insert(baselines)
          .values({
            orgId,
            projectId,
            label,
            clientRequestId,
            createdByUserId: userId,
            tasks: rows.map((row) => ({
              id: row.id,
              revision: row.revision,
              ...dates.get(row.id)!,
            })),
          })
          .returning();
        if (!baseline) throw new Error('Schedule baseline insertion failed.');
        await audit(
          tx,
          orgId,
          userId,
          'schedule_baseline',
          baseline.id,
          'schedule.baseline_saved',
          null,
          { label, taskCount: rows.length },
        );
        return { id: baseline.id, created: true };
      });
      return reply.code(result.created ? 201 : 200).send({ id: result.id });
    },
  );

  app.get(
    '/enterprise/schedule/templates',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: EnterpriseScheduleTemplates },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const cursor = decodeCursor(request.query.cursor);
      const limit = 30;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const rows = await tx
          .select({
            id: templates.id,
            label: templates.label,
            createdAt: templates.createdAt,
            taskCount: sql<number>`jsonb_array_length(${templates.tasks})`,
          })
          .from(templates)
          .where(
            and(
              eq(templates.orgId, orgId),
              beforeCursor(templates.createdAt, templates.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(templates.createdAt)), desc(templates.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          (row) => ({ at: row.createdAt, id: row.id }),
          (row) => ({ ...row, createdAt: row.createdAt.toISOString() }),
        );
      });
    },
  );

  const projectTemplates = '/enterprise/projects/:projectId/schedule/templates';
  app.post(
    projectTemplates,
    {
      config: { permission: 'org:settings_update', rateLimit: { max: 15, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        body: z.object({ label: z.string().trim().min(2).max(160), clientRequestId: z.uuid() }),
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const { label, clientRequestId } = request.body;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const getExisting = () =>
          tx
            .select()
            .from(templates)
            .where(and(eq(templates.orgId, orgId), eq(templates.clientRequestId, clientRequestId)));
        function retry(row: Template) {
          if (row.sourceProjectId !== projectId || row.label !== label)
            throw problem('conflict', 'The template request ID was already used.');
          return { id: row.id, created: false };
        }
        const [existing] = await getExisting();
        if (existing) return retry(existing);
        const rows = await projectTasks(tx, orgId, projectId);
        const first = rows[0];
        if (!first)
          throw problem('validation_failed', 'Add schedule tasks before creating a template.');
        const [created] = await tx
          .insert(templates)
          .values({
            orgId,
            sourceProjectId: projectId,
            label,
            clientRequestId,
            createdByUserId: userId,
            tasks: rows.map((task) => ({
              key: task.id,
              title: task.title,
              phase: task.phase,
              startOffset: dayDiff(first.startsOn, task.startsOn),
              endOffset: dayDiff(first.startsOn, task.endsOn),
              predecessorKey: task.predecessorId,
              lagDays: task.lagDays,
            })),
          })
          .onConflictDoNothing({ target: [templates.orgId, templates.clientRequestId] })
          .returning();
        if (!created) {
          const [prior] = await getExisting();
          if (!prior) throw new Error('Could not recover the retried template.');
          return retry(prior);
        }
        await audit(
          tx,
          orgId,
          userId,
          'schedule_template',
          created.id,
          'schedule.template_saved',
          null,
          { label, taskCount: rows.length },
        );
        return { id: created.id, created: true };
      });
      return reply.code(result.created ? 201 : 200).send({ id: result.id });
    },
  );

  app.post(
    projectTemplates + '/preview',
    {
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        body: EnterpriseScheduleTemplatePlacement,
        response: { 200: EnterpriseScheduleTemplatePreview },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const { templateId, startsOn } = request.body;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const template = await getTemplate(tx, orgId, templateId);
        const existing = await projectTasks(tx, orgId, projectId);
        const { token, items } = prepareTemplate(template, existing, startsOn, projectId, userId);
        return { token, items };
      });
    },
  );

  app.post(
    projectTemplates + '/apply',
    {
      config: { permission: 'job:write', rateLimit: { max: 15, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        body: EnterpriseScheduleTemplatePlacement.extend({
          clientRequestId: z.uuid(),
          previewToken: EnterpriseScheduleTemplatePreview.shape.token,
        }),
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const { templateId, startsOn, clientRequestId, previewToken } = request.body;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const [prior] = await tx
          .select()
          .from(applications)
          .where(
            and(
              eq(applications.orgId, orgId),
              eq(applications.projectId, projectId),
              eq(applications.clientRequestId, clientRequestId),
            ),
          );
        if (prior) {
          if (prior.templateId !== templateId || prior.startsOn !== startsOn)
            throw problem('conflict', 'The template application request ID was already used.');
          return { id: prior.id, taskCount: prior.taskCount, created: false };
        }
        const template = await getTemplate(tx, orgId, templateId);
        const existing = await projectTasks(tx, orgId, projectId);
        const preview = prepareTemplate(template, existing, startsOn, projectId, userId);
        if (preview.token !== previewToken)
          throw problem('conflict', 'The project schedule changed. Preview the template again.');
        await tx.insert(tasks).values(preview.rows);
        const [applied] = await tx
          .insert(applications)
          .values({
            orgId,
            projectId,
            templateId,
            startsOn,
            clientRequestId,
            taskCount: preview.rows.length,
            createdByUserId: userId,
          })
          .returning();
        if (!applied) throw new Error('Template application insertion failed.');
        await audit(
          tx,
          orgId,
          userId,
          'schedule_template_application',
          applied.id,
          'schedule.template_applied',
          null,
          { projectId, templateId, startsOn, taskIds: preview.rows.map(({ id }) => id) },
        );
        return { id: applied.id, taskCount: applied.taskCount, created: true };
      });
      return reply
        .code(result.created ? 201 : 200)
        .send({ id: result.id, taskCount: result.taskCount });
    },
  );
};

export default enterpriseScheduleModule;
