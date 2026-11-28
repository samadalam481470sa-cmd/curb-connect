// `projectManagement` module (Phase E, items 20-24, 26-27): job-linked RFIs, submittals,
// schedule tasks with Gantt data, daily logs, drawings with versions and markup, punch items,
// safety/quality checklists, crew scheduling (existing crews/schedules tables) and a fleet
// registry with manual check-ins. Everything is tenant-scoped and permission-checked.
// Honesty rules: weather is manual-entry only (no feed connected), fleet locations are manual
// check-ins only (no GPS/telematics in this repo), checklist starters make no compliance claim.
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  checklistRuns, checklistTemplates, crewMembers, crews, customers, dailyLogs, dispatches,
  drawingMarkups, drawingVersions, drawings, fleetAssets, fleetCheckIns, jobs, pmRfis,
  pmSubmittals, punchItems, scheduleTasks, schedules,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { createWorkAssignment } from '../../services/assignments';
import {
  buildGantt, canTransition, checklistCompletion, findCrewConflicts, FLEET_NEXT, isOverdue,
  maintenanceDue, nextVersionNumber, normalizeTaskProgress, PUNCH_NEXT, RFI_NEXT,
  STARTER_CHECKLISTS, SUBMITTAL_NEXT, TASK_NEXT, validMarkupPoint, validateTaskDates,
  type FleetStatus, type PunchStatus, type RfiStatus, type SubmittalStatus, type TaskStatus,
} from './workflow';
import { buildCrewBoard } from './crewBoard';
import { registerCriticalPathRoutes } from './criticalPathRoutes';

const UUID = z.uuid();
const JobParams = z.object({ jobId: UUID });
const IdParams = z.object({ id: UUID });
const RefList = z.array(z.object({
  label: z.string().trim().min(1).max(200),
  reference: z.string().trim().min(1).max(500),
})).max(50).default([]);
const today = () => new Date().toISOString().slice(0, 10);

async function requireJob(tx: Tx, orgId: string, jobId: string) {
  const [job] = await tx.select().from(jobs).where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)));
  if (!job) throw problem('not_found');
  return job;
}

const rfiDto = (r: typeof pmRfis.$inferSelect) => ({
  ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  respondedAt: r.respondedAt?.toISOString() ?? null,
  overdue: isOverdue(r.dueOn, r.status === 'closed' || r.status === 'answered', today()),
});
const submittalDto = (r: typeof pmSubmittals.$inferSelect) => ({
  ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  overdue: isOverdue(r.dueOn, ['approved', 'approved_as_noted', 'rejected'].includes(r.status), today()),
});
const taskDto = (r: typeof scheduleTasks.$inferSelect) => ({
  ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  overdue: isOverdue(r.endsOn, r.status === 'complete', today()),
});
const logDto = (r: typeof dailyLogs.$inferSelect) => ({
  ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});
const punchDto = (r: typeof punchItems.$inferSelect) => ({
  ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  verifiedAt: r.verifiedAt?.toISOString() ?? null,
  overdue: isOverdue(r.dueOn, r.status === 'verified', today()),
});
const fleetDto = (r: typeof fleetAssets.$inferSelect, lastCheckIn?: typeof fleetCheckIns.$inferSelect) => ({
  ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  maintenanceDue: maintenanceDue(r.maintenanceDueOn, today()),
  lastCheckIn: lastCheckIn ? {
    locationText: lastCheckIn.locationText, jobId: lastCheckIn.jobId,
    odometer: lastCheckIn.odometer, checkedInAt: lastCheckIn.checkedInAt.toISOString(),
  } : null,
});

const projectManagementModule: FastifyPluginAsyncZod = async (app) => {
  registerCriticalPathRoutes(app);
  // ------------------------------------------------------------ RFIs (20)
  app.get('/pm/jobs/:jobId/rfis', {
    config: { permission: 'job:read' },
    schema: { tags: ['project-management'], params: JobParams, summary: 'RFIs for a job' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const rows = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      return tx.select().from(pmRfis)
        .where(and(eq(pmRfis.orgId, orgId), eq(pmRfis.jobId, request.params.jobId)))
        .orderBy(asc(pmRfis.number)).limit(200);
    });
    return { items: rows.map(rfiDto) };
  });

  app.post('/pm/jobs/:jobId/rfis', {
    config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: JobParams,
      body: z.object({
        subject: z.string().trim().min(2).max(300),
        question: z.string().trim().min(3).max(10000),
        assignedTo: z.string().trim().max(200).nullable().optional(),
        dueOn: z.iso.date().nullable().optional(),
        costImpact: z.boolean().default(false),
        scheduleImpactDays: z.number().int().min(0).max(3650).default(0),
        attachmentRefs: RefList,
      }),
    },
  }, async (request, reply) => {
    const { orgId, userId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      const [last] = await tx.select({ number: pmRfis.number }).from(pmRfis)
        .where(and(eq(pmRfis.orgId, orgId), eq(pmRfis.jobId, request.params.jobId)))
        .orderBy(desc(pmRfis.number)).limit(1);
      const [created] = await tx.insert(pmRfis).values({
        orgId, jobId: request.params.jobId, number: (last?.number ?? 0) + 1,
        subject: request.body.subject, question: request.body.question,
        assignedTo: request.body.assignedTo ?? null, dueOn: request.body.dueOn ?? null,
        costImpact: request.body.costImpact, scheduleImpactDays: request.body.scheduleImpactDays,
        attachmentRefs: request.body.attachmentRefs, createdByUserId: userId,
      }).returning();
      if (!created) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.rfi_created', resourceType: 'pm_rfi', resourceId: created.id, after: { number: created.number, subject: created.subject } });
      return created;
    });
    return reply.code(201).send(rfiDto(row));
  });

  app.patch('/pm/rfis/:id/status', {
    config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: IdParams,
      body: z.object({
        status: z.enum(['draft', 'open', 'answered', 'closed']),
        officialResponse: z.string().trim().max(10000).optional(),
        assignedTo: z.string().trim().max(200).nullable().optional(),
        dueOn: z.iso.date().nullable().optional(),
      }),
    },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const revision = parseIfMatch(request);
    const row = await tenantTx(request, async (tx) => {
      const [current] = await tx.select().from(pmRfis)
        .where(and(eq(pmRfis.orgId, orgId), eq(pmRfis.id, request.params.id))).for('update');
      if (!current) throw problem('not_found');
      assertRevision(current.revision, revision);
      if (!canTransition(RFI_NEXT, current.status as RfiStatus, request.body.status)) {
        throw problem('conflict', 'That RFI status change is not allowed.');
      }
      if (request.body.status === 'answered' && !request.body.officialResponse?.trim()) {
        throw problem('validation_failed', 'An official response is required to answer an RFI.');
      }
      const [updated] = await tx.update(pmRfis).set({
        status: request.body.status,
        officialResponse: request.body.officialResponse ?? current.officialResponse,
        respondedAt: request.body.status === 'answered' ? new Date() : current.respondedAt,
        assignedTo: request.body.assignedTo !== undefined ? request.body.assignedTo : current.assignedTo,
        dueOn: request.body.dueOn !== undefined ? request.body.dueOn : current.dueOn,
        revision: current.revision + 1, updatedAt: new Date(),
      }).where(eq(pmRfis.id, current.id)).returning();
      if (!updated) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.rfi_status', resourceType: 'pm_rfi', resourceId: current.id, before: { status: current.status }, after: { status: updated.status } });
      return updated;
    });
    return rfiDto(row);
  });

  // ------------------------------------------------------------ Submittals (20)
  app.get('/pm/jobs/:jobId/submittals', {
    config: { permission: 'job:read' },
    schema: { tags: ['project-management'], params: JobParams, summary: 'Submittals for a job' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const rows = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      return tx.select().from(pmSubmittals)
        .where(and(eq(pmSubmittals.orgId, orgId), eq(pmSubmittals.jobId, request.params.jobId)))
        .orderBy(desc(pmSubmittals.createdAt)).limit(200);
    });
    return { items: rows.map(submittalDto) };
  });

  app.post('/pm/jobs/:jobId/submittals', {
    config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: JobParams,
      body: z.object({
        number: z.string().trim().min(1).max(80),
        title: z.string().trim().min(2).max(300),
        specSection: z.string().trim().max(50).default(''),
        reviewer: z.string().trim().max(200).nullable().optional(),
        dueOn: z.iso.date().nullable().optional(),
        documentReference: z.string().trim().max(500).nullable().optional(),
        attachmentRefs: RefList,
      }),
    },
  }, async (request, reply) => {
    const { orgId, userId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      const [created] = await tx.insert(pmSubmittals).values({
        orgId, jobId: request.params.jobId, number: request.body.number, title: request.body.title,
        specSection: request.body.specSection, reviewer: request.body.reviewer ?? null,
        dueOn: request.body.dueOn ?? null, documentReference: request.body.documentReference ?? null,
        attachmentRefs: request.body.attachmentRefs, createdByUserId: userId,
      }).returning();
      if (!created) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.submittal_created', resourceType: 'pm_submittal', resourceId: created.id, after: { number: created.number, title: created.title } });
      return created;
    });
    return reply.code(201).send(submittalDto(row));
  });

  app.patch('/pm/submittals/:id/status', {
    config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: IdParams,
      body: z.object({
        status: z.enum(['required', 'submitted', 'under_review', 'approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected']),
        documentReference: z.string().trim().max(500).nullable().optional(),
      }),
    },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const revision = parseIfMatch(request);
    const row = await tenantTx(request, async (tx) => {
      const [current] = await tx.select().from(pmSubmittals)
        .where(and(eq(pmSubmittals.orgId, orgId), eq(pmSubmittals.id, request.params.id))).for('update');
      if (!current) throw problem('not_found');
      assertRevision(current.revision, revision);
      if (!canTransition(SUBMITTAL_NEXT, current.status as SubmittalStatus, request.body.status)) {
        throw problem('conflict', 'That submittal status change is not allowed.');
      }
      const docRef = request.body.documentReference !== undefined ? request.body.documentReference : current.documentReference;
      if (request.body.status === 'submitted' && !docRef?.trim()) {
        throw problem('validation_failed', 'Add a document reference before submitting.');
      }
      const [updated] = await tx.update(pmSubmittals).set({
        status: request.body.status, documentReference: docRef,
        currentRevision: current.status === 'revise_and_resubmit' && request.body.status === 'submitted'
          ? current.currentRevision + 1 : current.currentRevision,
        revision: current.revision + 1, updatedAt: new Date(),
      }).where(eq(pmSubmittals.id, current.id)).returning();
      if (!updated) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.submittal_status', resourceType: 'pm_submittal', resourceId: current.id, before: { status: current.status }, after: { status: updated.status } });
      return updated;
    });
    return submittalDto(row);
  });

  // ------------------------------------------------------------ Schedule tasks + Gantt (21)
  app.get('/pm/jobs/:jobId/schedule', {
    config: { permission: 'schedule:read' },
    schema: { tags: ['project-management'], params: JobParams, summary: 'Schedule tasks with Gantt layout for a job; ?updatedSince=<ISO> returns only changed tasks (no Gantt) for offline delta sync',
      querystring: z.object({ updatedSince: z.string().datetime().optional() }) },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const since = request.query.updatedSince ? new Date(request.query.updatedSince) : null;
    const rows = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      return tx.select().from(scheduleTasks)
        .where(and(eq(scheduleTasks.orgId, orgId), eq(scheduleTasks.jobId, request.params.jobId),
          since ? sql`${scheduleTasks.updatedAt} > ${since}` : undefined))
        .orderBy(asc(scheduleTasks.sortOrder), asc(scheduleTasks.startsOn)).limit(500);
    });
    if (since) {
      return { items: rows.map(taskDto), gantt: [], deletedIds: [], serverTime: new Date().toISOString() };
    }
    const gantt = buildGantt(rows.map((r) => ({
      id: r.id, title: r.title, startsOn: r.startsOn, endsOn: r.endsOn,
      progressPercent: r.progressPercent, predecessorTaskId: r.predecessorTaskId,
    })));
    return { items: rows.map(taskDto), gantt, deletedIds: [], serverTime: new Date().toISOString() };
  });

  app.post('/pm/jobs/:jobId/schedule/tasks', {
    config: { permission: 'schedule:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: JobParams,
      body: z.object({
        title: z.string().trim().min(2).max(300),
        startsOn: z.iso.date(), endsOn: z.iso.date(),
        progressPercent: z.number().int().min(0).max(100).default(0),
        predecessorTaskId: UUID.nullable().optional(),
        crewId: UUID.nullable().optional(),
        /** Cost code this task's spend rolls up under (builder-entered). */
        costCode: z.string().trim().min(1).max(60).nullable().optional(),
        sortOrder: z.number().int().min(0).max(100000).default(0),
        notes: z.string().trim().max(2000).nullable().optional(),
      }),
    },
  }, async (request, reply) => {
    const { orgId } = requireOrg(request);
    const dateError = validateTaskDates(request.body.startsOn, request.body.endsOn);
    if (dateError) throw problem('validation_failed', dateError);
    const normalized = normalizeTaskProgress('not_started', request.body.progressPercent);
    const row = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      if (request.body.predecessorTaskId) {
        const [pred] = await tx.select().from(scheduleTasks).where(and(
          eq(scheduleTasks.orgId, orgId), eq(scheduleTasks.id, request.body.predecessorTaskId),
          eq(scheduleTasks.jobId, request.params.jobId)));
        if (!pred) throw problem('validation_failed', 'Predecessor task must be on the same job.');
      }
      if (request.body.crewId) {
        const [crew] = await tx.select().from(crews)
          .where(and(eq(crews.orgId, orgId), eq(crews.id, request.body.crewId)));
        if (!crew) throw problem('validation_failed', 'Crew not found.');
      }
      const [created] = await tx.insert(scheduleTasks).values({
        orgId, jobId: request.params.jobId, title: request.body.title,
        startsOn: request.body.startsOn, endsOn: request.body.endsOn,
        progressPercent: normalized.progressPercent, status: normalized.status,
        predecessorTaskId: request.body.predecessorTaskId ?? null,
        crewId: request.body.crewId ?? null, sortOrder: request.body.sortOrder,
        costCode: request.body.costCode ?? null,
        notes: request.body.notes ?? null,
      }).returning();
      if (!created) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.task_created', resourceType: 'schedule_task', resourceId: created.id, after: { title: created.title } });
      return created;
    });
    return reply.code(201).send(taskDto(row));
  });

  app.patch('/pm/schedule/tasks/:id', {
    config: { permission: 'schedule:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: IdParams,
      body: z.object({
        status: z.enum(['not_started', 'in_progress', 'complete', 'on_hold']).optional(),
        progressPercent: z.number().int().min(0).max(100).optional(),
        startsOn: z.iso.date().optional(), endsOn: z.iso.date().optional(),
        title: z.string().trim().min(2).max(300).optional(),
        costCode: z.string().trim().min(1).max(60).nullable().optional(),
      }),
    },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const revision = parseIfMatch(request);
    const row = await tenantTx(request, async (tx) => {
      const [current] = await tx.select().from(scheduleTasks)
        .where(and(eq(scheduleTasks.orgId, orgId), eq(scheduleTasks.id, request.params.id))).for('update');
      if (!current) throw problem('not_found');
      assertRevision(current.revision, revision);
      const startsOn = request.body.startsOn ?? current.startsOn;
      const endsOn = request.body.endsOn ?? current.endsOn;
      const dateError = validateTaskDates(startsOn, endsOn);
      if (dateError) throw problem('validation_failed', dateError);
      const nextStatus = request.body.status ?? (current.status as TaskStatus);
      if (request.body.status && !canTransition(TASK_NEXT, current.status as TaskStatus, nextStatus)) {
        throw problem('conflict', 'That task status change is not allowed.');
      }
      const normalized = normalizeTaskProgress(nextStatus, request.body.progressPercent ?? current.progressPercent);
      const [updated] = await tx.update(scheduleTasks).set({
        title: request.body.title ?? current.title, startsOn, endsOn,
        status: normalized.status, progressPercent: normalized.progressPercent,
        costCode: request.body.costCode !== undefined ? request.body.costCode : current.costCode,
        revision: current.revision + 1, updatedAt: new Date(),
      }).where(eq(scheduleTasks.id, current.id)).returning();
      if (!updated) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.task_updated', resourceType: 'schedule_task', resourceId: current.id, before: { status: current.status, progressPercent: current.progressPercent }, after: { status: updated.status, progressPercent: updated.progressPercent } });
      return updated;
    });
    return taskDto(row);
  });

  // Per-trade assignment: hand one schedule task to a connected contracting company.
  // The assignment flow enforces the active-connection rule; the task then shows who
  // owns the scope (display name snapshot from the assignment).
  app.post('/pm/schedule/tasks/:id/assign', {
    config: { permission: 'schedule:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: IdParams,
      body: z.object({
        partnerOrgId: UUID,
        title: z.string().trim().min(2).max(300).optional(),
        description: z.string().trim().max(2000).optional(),
        dueOn: z.iso.date().optional(),
      }),
      summary: 'Assign one schedule task to a connected company',
    },
  }, async (request) => {
    const org = requireOrg(request);
    assertCan(request, 'assignment:write');
    const task = await tenantTx(request, async (tx) => {
      const [row] = await tx.select().from(scheduleTasks)
        .where(and(eq(scheduleTasks.orgId, org.orgId), eq(scheduleTasks.id, request.params.id)));
      if (!row) throw problem('not_found');
      return row;
    });
    const assignment = await createWorkAssignment(request, {
      orgId: org.orgId,
      userId: org.userId,
      partnerOrgId: request.body.partnerOrgId,
      kind: 'task',
      title: request.body.title ?? task.title,
      description: request.body.description ?? task.notes ?? null,
      subjectType: 'schedule_task',
      subjectId: task.id,
      dueOn: request.body.dueOn ?? task.endsOn,
      payload: {
        scheduleWindow: { startsOn: task.startsOn, endsOn: task.endsOn },
        budgetSource: 'none',
        snapshotAt: new Date().toISOString(),
      },
    });
    return tenantTx(request, async (tx) => {
      const [updated] = await tx.update(scheduleTasks).set({
        assigneeOrgId: assignment.partnerOrgId,
        assigneeDisplayName: assignment.partnerDisplayName,
        revision: sql`${scheduleTasks.revision}+1`, updatedAt: new Date(),
      }).where(and(eq(scheduleTasks.orgId, org.orgId), eq(scheduleTasks.id, task.id))).returning();
      await auditRequest(request, tx, { orgId: org.orgId, action: 'pm.task_assigned',
        resourceType: 'schedule_task', resourceId: task.id,
        after: { assignmentId: assignment.id, partnerOrgId: assignment.partnerOrgId } });
      return { ...taskDto(updated!), assignmentId: assignment.id };
    });
  });

  // ------------------------------------------------------------ Daily logs (22)
  app.get('/pm/jobs/:jobId/daily-logs', {
    config: { permission: 'job:read' },
    schema: { tags: ['project-management'], params: JobParams, summary: 'Daily logs for a job' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const rows = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      return tx.select().from(dailyLogs)
        .where(and(eq(dailyLogs.orgId, orgId), eq(dailyLogs.jobId, request.params.jobId)))
        .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.createdAt)).limit(200);
    });
    return { items: rows.map(logDto), weatherSource: 'manual entry only — no weather feed is connected' };
  });

  app.post('/pm/jobs/:jobId/daily-logs', {
    config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: JobParams,
      body: z.object({
        logDate: z.iso.date(),
        crewId: UUID.nullable().optional(),
        crewCount: z.number().int().min(0).max(10000).nullable().optional(),
        workDone: z.string().trim().min(3).max(10000),
        weatherNotes: z.string().trim().max(1000).nullable().optional(),
        delays: z.string().trim().max(2000).nullable().optional(),
        notes: z.string().trim().max(5000).nullable().optional(),
        photoRefs: RefList,
      }),
    },
  }, async (request, reply) => {
    const { orgId, userId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      if (request.body.crewId) {
        const [crew] = await tx.select().from(crews)
          .where(and(eq(crews.orgId, orgId), eq(crews.id, request.body.crewId)));
        if (!crew) throw problem('validation_failed', 'Crew not found.');
      }
      const [created] = await tx.insert(dailyLogs).values({
        orgId, jobId: request.params.jobId, logDate: request.body.logDate,
        crewId: request.body.crewId ?? null, crewCount: request.body.crewCount ?? null,
        workDone: request.body.workDone, weatherNotes: request.body.weatherNotes ?? null,
        delays: request.body.delays ?? null, notes: request.body.notes ?? null,
        photoRefs: request.body.photoRefs, createdByUserId: userId,
      }).returning();
      if (!created) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.daily_log_created', resourceType: 'daily_log', resourceId: created.id, after: { logDate: created.logDate } });
      return created;
    });
    return reply.code(201).send(logDto(row));
  });

  // ------------------------------------------------------------ Drawings (23)
  app.get('/pm/jobs/:jobId/drawings', {
    config: { permission: 'job:read' },
    schema: { tags: ['project-management'], params: JobParams, summary: 'Drawings with version history for a job' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const result = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      const sheets = await tx.select().from(drawings)
        .where(and(eq(drawings.orgId, orgId), eq(drawings.jobId, request.params.jobId)))
        .orderBy(asc(drawings.title)).limit(200);
      const versions = sheets.length ? await tx.select().from(drawingVersions)
        .where(eq(drawingVersions.orgId, orgId)).orderBy(asc(drawingVersions.versionNumber)) : [];
      const byDrawing = new Map<string, typeof versions>();
      for (const v of versions) {
        const list = byDrawing.get(v.drawingId) ?? [];
        list.push(v); byDrawing.set(v.drawingId, list);
      }
      return sheets.map((d) => ({
        ...d, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
        versions: (byDrawing.get(d.id) ?? []).map((v) => ({
          ...v, createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString(),
          isCurrent: d.currentVersionId === v.id,
        })),
      }));
    });
    return { items: result };
  });

  app.post('/pm/jobs/:jobId/drawings', {
    config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: JobParams,
      body: z.object({
        title: z.string().trim().min(2).max(300),
        discipline: z.string().trim().max(100).nullable().optional(),
        sheetNumber: z.string().trim().max(80).nullable().optional(),
        fileReference: z.string().trim().min(1).max(500),
        fileName: z.string().trim().max(300).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
      }),
    },
  }, async (request, reply) => {
    const { orgId, userId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      const [sheet] = await tx.insert(drawings).values({
        orgId, jobId: request.params.jobId, title: request.body.title,
        discipline: request.body.discipline ?? null, sheetNumber: request.body.sheetNumber ?? null,
      }).returning();
      if (!sheet) throw problem('internal');
      const [version] = await tx.insert(drawingVersions).values({
        orgId, drawingId: sheet.id, versionNumber: 1, fileReference: request.body.fileReference,
        fileName: request.body.fileName ?? null, notes: request.body.notes ?? null, uploadedByUserId: userId,
      }).returning();
      if (!version) throw problem('internal');
      const [updated] = await tx.update(drawings).set({ currentVersionId: version.id, updatedAt: new Date() })
        .where(eq(drawings.id, sheet.id)).returning();
      if (!updated) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.drawing_created', resourceType: 'drawing', resourceId: sheet.id, after: { title: sheet.title, version: 1 } });
      return { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString(), versions: [{ ...version, createdAt: version.createdAt.toISOString(), updatedAt: version.updatedAt.toISOString(), isCurrent: true }] };
    });
    return reply.code(201).send(row);
  });

  app.post('/pm/drawings/:id/versions', {
    config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: IdParams,
      body: z.object({
        fileReference: z.string().trim().min(1).max(500),
        fileName: z.string().trim().max(300).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
        makeCurrent: z.boolean().default(true),
      }),
    },
  }, async (request, reply) => {
    const { orgId, userId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      const [sheet] = await tx.select().from(drawings)
        .where(and(eq(drawings.orgId, orgId), eq(drawings.id, request.params.id))).for('update');
      if (!sheet) throw problem('not_found');
      const existing = await tx.select({ versionNumber: drawingVersions.versionNumber })
        .from(drawingVersions).where(and(eq(drawingVersions.orgId, orgId), eq(drawingVersions.drawingId, sheet.id)));
      const versionNumber = nextVersionNumber(existing.map((v) => v.versionNumber));
      const [version] = await tx.insert(drawingVersions).values({
        orgId, drawingId: sheet.id, versionNumber, fileReference: request.body.fileReference,
        fileName: request.body.fileName ?? null, notes: request.body.notes ?? null, uploadedByUserId: userId,
      }).returning();
      if (!version) throw problem('internal');
      if (request.body.makeCurrent) {
        await tx.update(drawings).set({ currentVersionId: version.id, revision: sheet.revision + 1, updatedAt: new Date() })
          .where(eq(drawings.id, sheet.id));
      }
      await auditRequest(request, tx, { orgId, action: 'pm.drawing_version_added', resourceType: 'drawing', resourceId: sheet.id, after: { versionNumber } });
      return { ...version, createdAt: version.createdAt.toISOString(), updatedAt: version.updatedAt.toISOString(), isCurrent: request.body.makeCurrent };
    });
    return reply.code(201).send(row);
  });

  app.get('/pm/drawing-versions/:id/markups', {
    config: { permission: 'job:read' },
    schema: { tags: ['project-management'], params: IdParams, summary: 'Markup pins on a drawing version' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const rows = await tenantTx(request, async (tx) => {
      const [version] = await tx.select().from(drawingVersions)
        .where(and(eq(drawingVersions.orgId, orgId), eq(drawingVersions.id, request.params.id)));
      if (!version) throw problem('not_found');
      return tx.select().from(drawingMarkups)
        .where(and(eq(drawingMarkups.orgId, orgId), eq(drawingMarkups.versionId, version.id)))
        .orderBy(asc(drawingMarkups.createdAt)).limit(500);
    });
    return { items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })) };
  });

  app.post('/pm/drawing-versions/:id/markups', {
    config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: IdParams,
      body: z.object({
        xPercent: z.number().min(0).max(100), yPercent: z.number().min(0).max(100),
        note: z.string().trim().min(1).max(2000),
        authorName: z.string().trim().max(200).nullable().optional(),
      }),
    },
  }, async (request, reply) => {
    const { orgId, userId } = requireOrg(request);
    if (!validMarkupPoint(request.body.xPercent, request.body.yPercent)) {
      throw problem('validation_failed', 'Markup position must be within the sheet (0-100%).');
    }
    const row = await tenantTx(request, async (tx) => {
      const [version] = await tx.select().from(drawingVersions)
        .where(and(eq(drawingVersions.orgId, orgId), eq(drawingVersions.id, request.params.id)));
      if (!version) throw problem('not_found');
      const [created] = await tx.insert(drawingMarkups).values({
        orgId, versionId: version.id, xPercent: request.body.xPercent, yPercent: request.body.yPercent,
        note: request.body.note, authorName: request.body.authorName ?? null, createdByUserId: userId,
      }).returning();
      if (!created) throw problem('internal');
      return { ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() };
    });
    return reply.code(201).send(row);
  });

  // ------------------------------------------------------------ Punch lists (24)
  app.get('/pm/jobs/:jobId/punch-items', {
    config: { permission: 'job:read' },
    schema: { tags: ['project-management'], params: JobParams, summary: 'Punch items for a job' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const rows = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      return tx.select().from(punchItems)
        .where(and(eq(punchItems.orgId, orgId), eq(punchItems.jobId, request.params.jobId)))
        .orderBy(desc(punchItems.createdAt)).limit(300);
    });
    return { items: rows.map(punchDto) };
  });

  app.post('/pm/jobs/:jobId/punch-items', {
    config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: JobParams,
      body: z.object({
        title: z.string().trim().min(2).max(300),
        description: z.string().trim().max(5000).nullable().optional(),
        location: z.string().trim().max(200).nullable().optional(),
        assigneeName: z.string().trim().max(200).nullable().optional(),
        dueOn: z.iso.date().nullable().optional(),
        photoRefs: RefList,
      }),
    },
  }, async (request, reply) => {
    const { orgId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      const [created] = await tx.insert(punchItems).values({
        orgId, jobId: request.params.jobId, title: request.body.title,
        description: request.body.description ?? null, location: request.body.location ?? null,
        assigneeName: request.body.assigneeName ?? null, dueOn: request.body.dueOn ?? null,
        photoRefs: request.body.photoRefs,
      }).returning();
      if (!created) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.punch_created', resourceType: 'punch_item', resourceId: created.id, after: { title: created.title } });
      return created;
    });
    return reply.code(201).send(punchDto(row));
  });

  app.patch('/pm/punch-items/:id/status', {
    config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: IdParams,
      body: z.object({ status: z.enum(['open', 'in_progress', 'ready_for_review', 'verified', 'rejected']) }),
    },
  }, async (request) => {
    const { orgId, userId } = requireOrg(request);
    const revision = parseIfMatch(request);
    const row = await tenantTx(request, async (tx) => {
      const [current] = await tx.select().from(punchItems)
        .where(and(eq(punchItems.orgId, orgId), eq(punchItems.id, request.params.id))).for('update');
      if (!current) throw problem('not_found');
      assertRevision(current.revision, revision);
      if (!canTransition(PUNCH_NEXT, current.status as PunchStatus, request.body.status)) {
        throw problem('conflict', 'That punch item status change is not allowed.');
      }
      const [updated] = await tx.update(punchItems).set({
        status: request.body.status,
        verifiedByUserId: request.body.status === 'verified' ? userId : current.verifiedByUserId,
        verifiedAt: request.body.status === 'verified' ? new Date() : current.verifiedAt,
        revision: current.revision + 1, updatedAt: new Date(),
      }).where(eq(punchItems.id, current.id)).returning();
      if (!updated) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.punch_status', resourceType: 'punch_item', resourceId: current.id, before: { status: current.status }, after: { status: updated.status } });
      return updated;
    });
    return punchDto(row);
  });

  // ------------------------------------------------------------ Checklists (24)
  app.get('/pm/checklist-templates', {
    config: { permission: 'job:read' },
    schema: { tags: ['project-management'], summary: 'Checklist templates plus editable starters' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const rows = await tenantTx(request, (tx) => tx.select().from(checklistTemplates)
      .where(eq(checklistTemplates.orgId, orgId)).orderBy(asc(checklistTemplates.name)).limit(100));
    return {
      items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
      starters: Object.values(STARTER_CHECKLISTS),
      note: 'Starter checklists are editable starting points only; they make no safety or quality compliance claim.',
    };
  });

  app.post('/pm/checklist-templates', {
    config: { permission: 'job:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'],
      body: z.object({
        name: z.string().trim().min(2).max(200),
        kind: z.enum(['safety', 'quality', 'general']).default('quality'),
        items: z.array(z.object({ label: z.string().trim().min(1).max(300), required: z.boolean().default(true) })).min(1).max(100),
      }),
    },
  }, async (request, reply) => {
    const { orgId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      const [created] = await tx.insert(checklistTemplates).values({
        orgId, name: request.body.name, kind: request.body.kind, items: request.body.items,
      }).returning();
      if (!created) throw problem('internal');
      return { ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() };
    });
    return reply.code(201).send(row);
  });

  app.get('/pm/jobs/:jobId/checklist-runs', {
    config: { permission: 'job:read' },
    schema: { tags: ['project-management'], params: JobParams, summary: 'Checklist runs for a job' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const rows = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      return tx.select().from(checklistRuns)
        .where(and(eq(checklistRuns.orgId, orgId), eq(checklistRuns.jobId, request.params.jobId)))
        .orderBy(desc(checklistRuns.createdAt)).limit(200);
    });
    return {
      items: rows.map((r) => ({
        ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
        signedAt: r.signedAt?.toISOString() ?? null,
        completion: checklistCompletion((r.answers as { label: string; required: boolean; done: boolean }[]) ?? []),
      })),
    };
  });

  app.post('/pm/jobs/:jobId/checklist-runs', {
    config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: JobParams,
      body: z.object({
        templateId: UUID.nullable().optional(),
        starterKey: z.enum(['safety', 'quality']).nullable().optional(),
        title: z.string().trim().min(2).max(200).optional(),
        runDate: z.iso.date().nullable().optional(),
      }),
    },
  }, async (request, reply) => {
    const { orgId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.params.jobId);
      let title = request.body.title;
      let kind: string;
      let items: { label: string; required: boolean }[];
      if (request.body.templateId) {
        const [template] = await tx.select().from(checklistTemplates)
          .where(and(eq(checklistTemplates.orgId, orgId), eq(checklistTemplates.id, request.body.templateId)));
        if (!template) throw problem('validation_failed', 'Checklist template not found.');
        title = title ?? template.name; kind = template.kind;
        items = template.items as { label: string; required: boolean }[];
      } else if (request.body.starterKey) {
        const starter = STARTER_CHECKLISTS[request.body.starterKey]!;
        title = title ?? starter.name; kind = starter.kind; items = starter.items;
      } else {
        throw problem('validation_failed', 'Choose a checklist template or a starter checklist.');
      }
      const [created] = await tx.insert(checklistRuns).values({
        orgId, jobId: request.params.jobId, templateId: request.body.templateId ?? null,
        title: title!, kind, runDate: request.body.runDate ?? null,
        answers: items.map((i) => ({ ...i, done: false })),
      }).returning();
      if (!created) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.checklist_run_created', resourceType: 'checklist_run', resourceId: created.id, after: { title: created.title, kind } });
      return created;
    });
    return reply.code(201).send({
      ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      signedAt: null, completion: checklistCompletion(row.answers as never[]),
    });
  });

  app.patch('/pm/checklist-runs/:id', {
    config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: IdParams,
      body: z.object({
        answers: z.array(z.object({
          label: z.string().trim().min(1).max(300), required: z.boolean(),
          done: z.boolean(), note: z.string().trim().max(1000).optional(),
        })).max(100).optional(),
        signWithName: z.string().trim().min(2).max(200).optional(),
      }),
    },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const revision = parseIfMatch(request);
    const row = await tenantTx(request, async (tx) => {
      const [current] = await tx.select().from(checklistRuns)
        .where(and(eq(checklistRuns.orgId, orgId), eq(checklistRuns.id, request.params.id))).for('update');
      if (!current) throw problem('not_found');
      assertRevision(current.revision, revision);
      if (current.status === 'signed') throw problem('conflict', 'A signed checklist cannot be changed.');
      const answers = request.body.answers ?? (current.answers as never[]);
      const completion = checklistCompletion(answers as never[]);
      let status = completion.complete ? 'completed' : 'in_progress';
      let signedByName = current.signedByName;
      let signedAt = current.signedAt;
      if (request.body.signWithName) {
        if (!completion.complete) throw problem('validation_failed', 'Finish every required item before signing.');
        status = 'signed'; signedByName = request.body.signWithName; signedAt = new Date();
      }
      const [updated] = await tx.update(checklistRuns).set({
        answers, status, signedByName, signedAt,
        revision: current.revision + 1, updatedAt: new Date(),
      }).where(eq(checklistRuns.id, current.id)).returning();
      if (!updated) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.checklist_run_updated', resourceType: 'checklist_run', resourceId: current.id, before: { status: current.status }, after: { status: updated.status } });
      return updated;
    });
    return {
      ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      signedAt: row.signedAt?.toISOString() ?? null,
      completion: checklistCompletion(row.answers as never[]),
    };
  });

  // ------------------------------------------------------------ Crew scheduling (26)
  app.get('/pm/crews', {
    config: { permission: 'crew:read' },
    schema: { tags: ['project-management'], summary: 'Crews with members' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const result = await tenantTx(request, async (tx) => {
      const crewRows = await tx.select().from(crews).where(eq(crews.orgId, orgId))
        .orderBy(asc(crews.name)).limit(100);
      const members = crewRows.length ? await tx.select().from(crewMembers)
        .where(eq(crewMembers.orgId, orgId)) : [];
      return crewRows.map((c) => ({
        ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
        members: members.filter((m) => m.crewId === c.id).map((m) => ({
          ...m, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString(),
        })),
      }));
    });
    return { items: result };
  });

  app.post('/pm/crews', {
    config: { permission: 'crew:manage', rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'],
      body: z.object({
        name: z.string().trim().min(2).max(120),
        trade: z.enum(['roofing', 'curb_cutting', 'concrete', 'general']),
        capacityPerDay: z.number().int().min(1).max(100).default(1),
        members: z.array(z.object({
          displayName: z.string().trim().min(1).max(120),
          certifications: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
        })).max(50).default([]),
      }),
    },
  }, async (request, reply) => {
    const { orgId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      const [crew] = await tx.insert(crews).values({
        orgId, name: request.body.name, trade: request.body.trade, capacityPerDay: request.body.capacityPerDay,
      }).returning();
      if (!crew) throw problem('internal');
      for (const m of request.body.members) {
        await tx.insert(crewMembers).values({
          orgId, crewId: crew.id, displayName: m.displayName, certifications: m.certifications,
        });
      }
      await auditRequest(request, tx, { orgId, action: 'pm.crew_created', resourceType: 'crew', resourceId: crew.id, after: { name: crew.name } });
      return crew;
    });
    return reply.code(201).send({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
  });

  app.get('/pm/crew-schedule', {
    config: { permission: 'schedule:read' },
    schema: {
      tags: ['project-management'], summary: 'Crew bookings across jobs',
      querystring: z.object({ crewId: UUID.optional(), jobId: UUID.optional() }),
    },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const rows = await tenantTx(request, (tx) => {
      let q = tx.select().from(schedules).where(eq(schedules.orgId, orgId));
      if (request.query.crewId) q = tx.select().from(schedules)
        .where(and(eq(schedules.orgId, orgId), eq(schedules.crewId, request.query.crewId)));
      if (request.query.jobId) q = tx.select().from(schedules)
        .where(and(eq(schedules.orgId, orgId), eq(schedules.jobId, request.query.jobId)));
      return q.orderBy(asc(schedules.startsAt)).limit(300);
    });
    return {
      items: rows.map((r) => ({
        ...r, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(),
        createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
      })),
    };
  });

  // Unified crew board (SupplyPro GM): one view across every job — manual and issued —
  // with crew bookings, conflicts, and dispatch status. Aggregates the per-job schedule
  // rows through buildCrewBoard (which reuses findCrewConflicts); booking itself stays
  // on POST /pm/crew-schedule.
  app.get('/pm/crew-board', {
    config: { permission: 'schedule:read' },
    schema: { tags: ['project-management'], summary: 'Unified crew board across all jobs' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const board = await tenantTx(request, async (tx) => {
      const crewRows = await tx.select().from(crews).where(eq(crews.orgId, orgId))
        .orderBy(asc(crews.name)).limit(100);
      const jobRows = await tx.select({
        id: jobs.id, number: jobs.number, title: jobs.title,
        productLine: jobs.productLine, origin: jobs.origin,
        customerName: customers.displayName, stageKey: jobs.stageKey, status: jobs.status,
      }).from(jobs)
        .leftJoin(customers, and(eq(customers.orgId, orgId), eq(customers.id, jobs.customerId)))
        .where(and(eq(jobs.orgId, orgId), sql`${jobs.deletedAt} IS NULL`))
        .orderBy(desc(jobs.createdAt)).limit(200);
      const scheduleRows = await tx.select().from(schedules).where(eq(schedules.orgId, orgId))
        .orderBy(asc(schedules.startsAt)).limit(500);
      const dispatchRows = await tx.select().from(dispatches).where(eq(dispatches.orgId, orgId))
        .orderBy(desc(dispatches.createdAt)).limit(200);
      return buildCrewBoard({
        crews: crewRows.map((c) => ({
          id: c.id, name: c.name, trade: c.trade, active: c.active, capacityPerDay: c.capacityPerDay,
        })),
        jobs: jobRows.map((j) => ({
          id: j.id, number: j.number, title: j.title, productLine: j.productLine,
          origin: j.origin, customerName: j.customerName, stage: j.stageKey, status: j.status,
        })),
        schedules: scheduleRows.map((s) => ({
          id: s.id, jobId: s.jobId, crewId: s.crewId, status: s.status,
          startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), notes: s.notes,
        })),
        dispatches: dispatchRows.map((d) => ({
          id: d.id, jobId: d.jobId, scheduleId: d.scheduleId, crewId: d.crewId,
          status: d.status, blockedReasons: d.blockedReasons,
        })),
      });
    });
    return board;
  });

  app.post('/pm/crew-schedule', {
    config: { permission: 'schedule:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'],
      body: z.object({
        jobId: UUID, crewId: UUID,
        startsAt: z.iso.datetime(), endsAt: z.iso.datetime(),
        status: z.enum(['tentative', 'confirmed']).default('tentative'),
        notes: z.string().trim().max(2000).nullable().optional(),
        allowConflict: z.boolean().default(false),
      }),
    },
  }, async (request, reply) => {
    const { orgId } = requireOrg(request);
    if (request.body.endsAt <= request.body.startsAt) {
      throw problem('validation_failed', 'End time must be after the start time.');
    }
    const result = await tenantTx(request, async (tx) => {
      await requireJob(tx, orgId, request.body.jobId);
      const [crew] = await tx.select().from(crews)
        .where(and(eq(crews.orgId, orgId), eq(crews.id, request.body.crewId)));
      if (!crew) throw problem('validation_failed', 'Crew not found.');
      const existing = await tx.select().from(schedules)
        .where(and(eq(schedules.orgId, orgId), eq(schedules.crewId, request.body.crewId)));
      const conflicts = findCrewConflicts(
        { crewId: request.body.crewId, startsAt: request.body.startsAt, endsAt: request.body.endsAt },
        existing.map((s) => ({ id: s.id, crewId: s.crewId ?? '', startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), status: s.status })),
      );
      if (conflicts.length > 0 && !request.body.allowConflict) {
        throw problem('conflict', `That crew is already booked at that time (${conflicts.length} overlapping booking${conflicts.length > 1 ? 's' : ''}). Resend with allowConflict to double-book on purpose.`);
      }
      const [created] = await tx.insert(schedules).values({
        orgId, jobId: request.body.jobId, crewId: request.body.crewId,
        startsAt: new Date(request.body.startsAt), endsAt: new Date(request.body.endsAt),
        status: request.body.status, notes: request.body.notes ?? null,
      }).returning();
      if (!created) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.crew_booked', resourceType: 'schedule', resourceId: created.id, after: { jobId: created.jobId, crewId: created.crewId, conflicts: conflicts.length } });
      return { booking: created, conflicts: conflicts.map((c) => c.id) };
    });
    return reply.code(201).send({
      ...result.booking, startsAt: result.booking.startsAt.toISOString(), endsAt: result.booking.endsAt.toISOString(),
      createdAt: result.booking.createdAt.toISOString(), updatedAt: result.booking.updatedAt.toISOString(),
      conflictBookingIds: result.conflicts,
    });
  });

  // ------------------------------------------------------------ Fleet (27) — manual only
  app.get('/pm/fleet', {
    config: { permission: 'crew:read' },
    schema: { tags: ['project-management'], summary: 'Fleet registry with last manual check-in' },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const result = await tenantTx(request, async (tx) => {
      const assets = await tx.select().from(fleetAssets).where(eq(fleetAssets.orgId, orgId))
        .orderBy(asc(fleetAssets.name)).limit(200);
      const checkIns = assets.length ? await tx.select().from(fleetCheckIns)
        .where(eq(fleetCheckIns.orgId, orgId)).orderBy(desc(fleetCheckIns.checkedInAt)) : [];
      const latest = new Map<string, typeof fleetCheckIns.$inferSelect>();
      for (const c of checkIns) if (!latest.has(c.assetId)) latest.set(c.assetId, c);
      return assets.map((a) => fleetDto(a, latest.get(a.id)));
    });
    return { items: result, locationSource: 'manual check-ins only — no GPS or telematics feed is connected' };
  });

  app.post('/pm/fleet', {
    config: { permission: 'crew:manage', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'],
      body: z.object({
        name: z.string().trim().min(2).max(200),
        kind: z.enum(['vehicle', 'equipment', 'trailer', 'tool']).default('vehicle'),
        identifier: z.string().trim().max(120).nullable().optional(),
        assignedJobId: UUID.nullable().optional(),
        maintenanceDueOn: z.iso.date().nullable().optional(),
        maintenanceNotes: z.string().trim().max(2000).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
      }),
    },
  }, async (request, reply) => {
    const { orgId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      if (request.body.assignedJobId) await requireJob(tx, orgId, request.body.assignedJobId);
      const [created] = await tx.insert(fleetAssets).values({
        orgId, name: request.body.name, kind: request.body.kind,
        identifier: request.body.identifier ?? null, assignedJobId: request.body.assignedJobId ?? null,
        maintenanceDueOn: request.body.maintenanceDueOn ?? null,
        maintenanceNotes: request.body.maintenanceNotes ?? null, notes: request.body.notes ?? null,
      }).returning();
      if (!created) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.fleet_asset_created', resourceType: 'fleet_asset', resourceId: created.id, after: { name: created.name, kind: created.kind } });
      return created;
    });
    return reply.code(201).send(fleetDto(row));
  });

  app.patch('/pm/fleet/:id', {
    config: { permission: 'crew:manage', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: IdParams,
      body: z.object({
        status: z.enum(['in_service', 'maintenance', 'out_of_service', 'retired']).optional(),
        assignedJobId: UUID.nullable().optional(),
        maintenanceDueOn: z.iso.date().nullable().optional(),
        maintenanceNotes: z.string().trim().max(2000).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
      }),
    },
  }, async (request) => {
    const { orgId } = requireOrg(request);
    const revision = parseIfMatch(request);
    const row = await tenantTx(request, async (tx) => {
      const [current] = await tx.select().from(fleetAssets)
        .where(and(eq(fleetAssets.orgId, orgId), eq(fleetAssets.id, request.params.id))).for('update');
      if (!current) throw problem('not_found');
      assertRevision(current.revision, revision);
      if (request.body.status && !canTransition(FLEET_NEXT, current.status as FleetStatus, request.body.status)) {
        throw problem('conflict', 'That fleet status change is not allowed.');
      }
      if (request.body.assignedJobId) await requireJob(tx, orgId, request.body.assignedJobId);
      const [updated] = await tx.update(fleetAssets).set({
        status: request.body.status ?? current.status,
        assignedJobId: request.body.assignedJobId !== undefined ? request.body.assignedJobId : current.assignedJobId,
        maintenanceDueOn: request.body.maintenanceDueOn !== undefined ? request.body.maintenanceDueOn : current.maintenanceDueOn,
        maintenanceNotes: request.body.maintenanceNotes !== undefined ? request.body.maintenanceNotes : current.maintenanceNotes,
        notes: request.body.notes !== undefined ? request.body.notes : current.notes,
        revision: current.revision + 1, updatedAt: new Date(),
      }).where(eq(fleetAssets.id, current.id)).returning();
      if (!updated) throw problem('internal');
      await auditRequest(request, tx, { orgId, action: 'pm.fleet_asset_updated', resourceType: 'fleet_asset', resourceId: current.id, before: { status: current.status }, after: { status: updated.status } });
      return updated;
    });
    return fleetDto(row);
  });

  app.post('/pm/fleet/:id/check-ins', {
    config: { permission: 'crew:manage', rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['project-management'], params: IdParams,
      body: z.object({
        locationText: z.string().trim().min(2).max(300),
        jobId: UUID.nullable().optional(),
        odometer: z.number().int().min(0).max(10_000_000).nullable().optional(),
        notes: z.string().trim().max(1000).nullable().optional(),
      }),
    },
  }, async (request, reply) => {
    const { orgId, userId } = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      const [asset] = await tx.select().from(fleetAssets)
        .where(and(eq(fleetAssets.orgId, orgId), eq(fleetAssets.id, request.params.id)));
      if (!asset) throw problem('not_found');
      if (request.body.jobId) await requireJob(tx, orgId, request.body.jobId);
      const [created] = await tx.insert(fleetCheckIns).values({
        orgId, assetId: asset.id, locationText: request.body.locationText,
        jobId: request.body.jobId ?? null, odometer: request.body.odometer ?? null,
        notes: request.body.notes ?? null, checkedInByUserId: userId,
      }).returning();
      if (!created) throw problem('internal');
      return { ...created, checkedInAt: created.checkedInAt.toISOString(), createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() };
    });
    return reply.code(201).send(row);
  });
};

export default projectManagementModule;
