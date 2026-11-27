// Critical-path routes for the projectManagement module (blueprint gap 1):
// CPM computation over the job's schedule tasks + dependency links, a
// non-persisting reschedule simulation, dependency CRUD and schedule
// baselines with variance comparison. Registered from index.ts.
import {
  BaselineCompareResponseSchema,
  CreateScheduleBaselineRequestSchema,
  CreateScheduleDependencyRequestSchema,
  CriticalPathResponseSchema,
  ScheduleBaselineSchema,
  ScheduleDependencySchema,
  SimulateMoveRequestSchema,
  SimulateMoveResponseSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  jobs,
  scheduleBaselineTasks,
  scheduleBaselines,
  scheduleDependencies,
  scheduleTasks,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import {
  compareToBaseline,
  computeCriticalPath,
  simulateMove,
  type CpmDependencyInput,
  type CpmTaskInput,
} from './criticalPath';
import { validateTaskDates } from './workflow';

const UUID = z.uuid();
const JobParams = z.object({ jobId: UUID });
const BaselineParams = z.object({ jobId: UUID, baselineId: UUID });
const IdParams = z.object({ id: UUID });

async function requireJob(tx: Tx, orgId: string, jobId: string) {
  const [job] = await tx.select().from(jobs).where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)));
  if (!job) throw problem('not_found');
  return job;
}

async function loadGraph(tx: Tx, orgId: string, jobId: string) {
  const taskRows = await tx
    .select()
    .from(scheduleTasks)
    .where(and(eq(scheduleTasks.orgId, orgId), eq(scheduleTasks.jobId, jobId)))
    .orderBy(asc(scheduleTasks.sortOrder), asc(scheduleTasks.startsOn))
    .limit(500);
  const depRows = await tx
    .select()
    .from(scheduleDependencies)
    .where(and(eq(scheduleDependencies.orgId, orgId), eq(scheduleDependencies.jobId, jobId)))
    .limit(1000);
  const tasks: CpmTaskInput[] = taskRows.map((r) => ({
    id: r.id,
    title: r.title,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    predecessorTaskId: r.predecessorTaskId,
  }));
  const deps: CpmDependencyInput[] = depRows.map((d) => ({
    predecessorTaskId: d.predecessorTaskId,
    successorTaskId: d.successorTaskId,
    lagDays: d.lagDays,
  }));
  return { taskRows, depRows, tasks, deps };
}

const dependencyDto = (r: typeof scheduleDependencies.$inferSelect) => ({
  id: r.id,
  jobId: r.jobId,
  predecessorTaskId: r.predecessorTaskId,
  successorTaskId: r.successorTaskId,
  lagDays: r.lagDays,
  createdAt: r.createdAt.toISOString(),
});

export const registerCriticalPathRoutes = (app: Parameters<FastifyPluginAsyncZod>[0]) => {
  app.get(
    '/pm/jobs/:jobId/schedule/critical-path',
    {
      config: { permission: 'schedule:read' },
      schema: {
        tags: ['project-management'],
        params: JobParams,
        summary:
          'Critical-path computation for a job schedule (float per task, critical path, project end). Computed dates are estimates from entered dates.',
        response: { 200: CriticalPathResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await requireJob(tx, orgId, request.params.jobId);
        const { depRows, tasks, deps } = await loadGraph(tx, orgId, request.params.jobId);
        const result = computeCriticalPath(tasks, deps);
        if (!result.ok) return result;
        return { ...result, dependencies: depRows.map(dependencyDto) };
      });
    },
  );

  app.post(
    '/pm/jobs/:jobId/schedule/simulate-move',
    {
      config: { permission: 'schedule:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['project-management'],
        params: JobParams,
        body: SimulateMoveRequestSchema,
        summary:
          'Simulate moving one task to new dates: downstream impact and new project end, without saving anything.',
        response: { 200: SimulateMoveResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const dateError = validateTaskDates(request.body.startsOn, request.body.endsOn);
      if (dateError) throw problem('validation_failed', dateError);
      return tenantTx(request, async (tx) => {
        await requireJob(tx, orgId, request.params.jobId);
        const { tasks, deps } = await loadGraph(tx, orgId, request.params.jobId);
        return simulateMove(tasks, deps, request.body.taskId, request.body.startsOn, request.body.endsOn);
      });
    },
  );

  app.post(
    '/pm/jobs/:jobId/schedule/dependencies',
    {
      config: { permission: 'schedule:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: {
        tags: ['project-management'],
        params: JobParams,
        body: CreateScheduleDependencyRequestSchema,
        summary: 'Add a finish-to-start dependency link between two tasks on the same job.',
        response: { 201: ScheduleDependencySchema },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      if (request.body.predecessorTaskId === request.body.successorTaskId) {
        throw problem('validation_failed', 'A task cannot depend on itself.');
      }
      const row = await tenantTx(request, async (tx) => {
        await requireJob(tx, orgId, request.params.jobId);
        const found = await tx
          .select({ id: scheduleTasks.id })
          .from(scheduleTasks)
          .where(
            and(
              eq(scheduleTasks.orgId, orgId),
              eq(scheduleTasks.jobId, request.params.jobId),
              eq(scheduleTasks.id, request.body.predecessorTaskId),
            ),
          );
        const foundSucc = await tx
          .select({ id: scheduleTasks.id })
          .from(scheduleTasks)
          .where(
            and(
              eq(scheduleTasks.orgId, orgId),
              eq(scheduleTasks.jobId, request.params.jobId),
              eq(scheduleTasks.id, request.body.successorTaskId),
            ),
          );
        if (found.length === 0 || foundSucc.length === 0) {
          throw problem('validation_failed', 'Both tasks must be on the same job.');
        }
        // Reject links that would create a cycle before persisting them.
        const { tasks, deps } = await loadGraph(tx, orgId, request.params.jobId);
        const trial = computeCriticalPath(tasks, [
          ...deps,
          {
            predecessorTaskId: request.body.predecessorTaskId,
            successorTaskId: request.body.successorTaskId,
            lagDays: request.body.lagDays,
          },
        ]);
        if (!trial.ok && trial.reason === 'cycle') {
          throw problem('validation_failed', 'That dependency would create a cycle in the schedule.');
        }
        const [created] = await tx
          .insert(scheduleDependencies)
          .values({
            orgId,
            jobId: request.params.jobId,
            predecessorTaskId: request.body.predecessorTaskId,
            successorTaskId: request.body.successorTaskId,
            lagDays: request.body.lagDays,
            createdByUserId: userId,
          })
          .onConflictDoNothing()
          .returning();
        if (!created) throw problem('conflict', 'That dependency already exists.');
        await auditRequest(request, tx, {
          orgId,
          action: 'pm.dependency_created',
          resourceType: 'schedule_dependency',
          resourceId: created.id,
          after: { predecessorTaskId: created.predecessorTaskId, successorTaskId: created.successorTaskId },
        });
        return created;
      });
      return reply.code(201).send(dependencyDto(row));
    },
  );

  app.delete(
    '/pm/schedule/dependencies/:id',
    {
      config: { permission: 'schedule:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: {
        tags: ['project-management'],
        params: IdParams,
        summary: 'Remove a dependency link.',
        response: { 200: ScheduleDependencySchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [deleted] = await tx
          .delete(scheduleDependencies)
          .where(and(eq(scheduleDependencies.orgId, orgId), eq(scheduleDependencies.id, request.params.id)))
          .returning();
        if (!deleted) throw problem('not_found');
        await auditRequest(request, tx, {
          orgId,
          action: 'pm.dependency_deleted',
          resourceType: 'schedule_dependency',
          resourceId: deleted.id,
        });
        return deleted;
      });
      return dependencyDto(row);
    },
  );

  app.post(
    '/pm/jobs/:jobId/schedule/baselines',
    {
      config: { permission: 'schedule:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['project-management'],
        params: JobParams,
        body: CreateScheduleBaselineRequestSchema,
        summary: 'Capture an immutable baseline snapshot of the job’s current task dates.',
        response: { 201: ScheduleBaselineSchema },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        await requireJob(tx, orgId, request.params.jobId);
        const taskRows = await tx
          .select()
          .from(scheduleTasks)
          .where(and(eq(scheduleTasks.orgId, orgId), eq(scheduleTasks.jobId, request.params.jobId)))
          .limit(500);
        if (taskRows.length === 0) {
          throw problem('validation_failed', 'This job has no schedule tasks to baseline.');
        }
        const [baseline] = await tx
          .insert(scheduleBaselines)
          .values({
            orgId,
            jobId: request.params.jobId,
            name: request.body.name,
            note: request.body.note ?? null,
            createdByUserId: userId,
          })
          .returning();
        if (!baseline) throw problem('internal');
        await tx.insert(scheduleBaselineTasks).values(
          taskRows.map((t) => ({
            orgId,
            baselineId: baseline.id,
            taskId: t.id,
            title: t.title,
            startsOn: t.startsOn,
            endsOn: t.endsOn,
            progressPercent: t.progressPercent,
          })),
        );
        await auditRequest(request, tx, {
          orgId,
          action: 'pm.baseline_created',
          resourceType: 'schedule_baseline',
          resourceId: baseline.id,
          after: { name: baseline.name, taskCount: taskRows.length },
        });
        return { baseline, taskCount: taskRows.length };
      });
      return reply.code(201).send({
        id: result.baseline.id,
        jobId: result.baseline.jobId,
        name: result.baseline.name,
        note: result.baseline.note,
        capturedAt: result.baseline.capturedAt.toISOString(),
        taskCount: result.taskCount,
      });
    },
  );

  app.get(
    '/pm/jobs/:jobId/schedule/baselines',
    {
      config: { permission: 'schedule:read' },
      schema: {
        tags: ['project-management'],
        params: JobParams,
        summary: 'List schedule baselines for a job, newest first.',
        response: { 200: z.object({ items: z.array(ScheduleBaselineSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await requireJob(tx, orgId, request.params.jobId);
        const rows = await tx
          .select()
          .from(scheduleBaselines)
          .where(and(eq(scheduleBaselines.orgId, orgId), eq(scheduleBaselines.jobId, request.params.jobId)))
          .orderBy(desc(scheduleBaselines.capturedAt))
          .limit(50);
        const items = [];
        for (const row of rows) {
          const counted = await tx
            .select({ id: scheduleBaselineTasks.id })
            .from(scheduleBaselineTasks)
            .where(
              and(eq(scheduleBaselineTasks.orgId, orgId), eq(scheduleBaselineTasks.baselineId, row.id)),
            );
          items.push({
            id: row.id,
            jobId: row.jobId,
            name: row.name,
            note: row.note,
            capturedAt: row.capturedAt.toISOString(),
            taskCount: counted.length,
          });
        }
        return { items };
      });
    },
  );

  app.get(
    '/pm/jobs/:jobId/schedule/baselines/:baselineId/compare',
    {
      config: { permission: 'schedule:read' },
      schema: {
        tags: ['project-management'],
        params: BaselineParams,
        summary: 'Compare current task dates against a baseline (variance in days per task).',
        response: { 200: BaselineCompareResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await requireJob(tx, orgId, request.params.jobId);
        const [baseline] = await tx
          .select()
          .from(scheduleBaselines)
          .where(
            and(
              eq(scheduleBaselines.orgId, orgId),
              eq(scheduleBaselines.jobId, request.params.jobId),
              eq(scheduleBaselines.id, request.params.baselineId),
            ),
          );
        if (!baseline) throw problem('not_found');
        const snapshot = await tx
          .select()
          .from(scheduleBaselineTasks)
          .where(
            and(
              eq(scheduleBaselineTasks.orgId, orgId),
              eq(scheduleBaselineTasks.baselineId, baseline.id),
            ),
          )
          .limit(500);
        const { tasks } = await loadGraph(tx, orgId, request.params.jobId);
        return {
          baseline: {
            id: baseline.id,
            jobId: baseline.jobId,
            name: baseline.name,
            note: baseline.note,
            capturedAt: baseline.capturedAt.toISOString(),
            taskCount: snapshot.length,
          },
          rows: compareToBaseline(
            tasks,
            snapshot.map((s) => ({
              taskId: s.taskId,
              title: s.title,
              startsOn: s.startsOn,
              endsOn: s.endsOn,
            })),
          ),
        };
      });
    },
  );
};
