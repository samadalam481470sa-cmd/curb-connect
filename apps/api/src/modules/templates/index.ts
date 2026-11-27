// `templates` module: estimate templates that scope a job in one pass — budget lines
// into the job-cost ledger, schedule tasks into the PM schedule, and a client
// questionnaire the builder can answer with the customer (feeding the design center
// conversation). Every amount comes from the template the builder wrote; unpriced
// lines are skipped and counted, never filled in.
import {
  AnswerQuestionnaireRequestSchema,
  ApplyTemplateRequestSchema,
  ApplyTemplateResponseSchema,
  CreateEstimateTemplateRequestSchema,
  EstimateTemplateListSchema,
  EstimateTemplateSchema,
  JobQuestionnaireListSchema,
  JobQuestionnaireSchema,
  type TemplateBudgetLine,
  type TemplateQuestion,
  type TemplateScheduleTask,
} from '@fieldline/contracts';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  estimateTemplates,
  jobCostBudgets,
  jobQuestionnaires,
  jobs,
  scheduleTasks,
} from '../../db/schema';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';

const READ = 'estimate:read';
const WRITE = 'estimate:write';

const IdParams = z.object({ id: z.uuid() });

type TemplateRow = typeof estimateTemplates.$inferSelect;
type QuestionnaireRow = typeof jobQuestionnaires.$inferSelect;

function templateDto(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    budgetLines: (row.budgetLines as TemplateBudgetLine[] | null) ?? [],
    scheduleTasks: (row.scheduleTasks as TemplateScheduleTask[] | null) ?? [],
    questionnaire: (row.questionnaire as TemplateQuestion[] | null) ?? [],
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function questionnaireDto(row: QuestionnaireRow) {
  return {
    id: row.id,
    jobId: row.jobId,
    templateId: row.templateId,
    title: row.title,
    questions: (row.questions as TemplateQuestion[] | null) ?? [],
    answers: (row.answers as { key: string; value: string | null }[] | null) ?? [],
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const templatesModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/estimate-templates',
    {
      config: { permission: READ },
      schema: {
        tags: ['templates'],
        summary: 'Estimate templates, newest first',
        response: { 200: EstimateTemplateListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(estimateTemplates)
          .where(eq(estimateTemplates.orgId, orgId))
          .orderBy(desc(estimateTemplates.createdAt))
          .limit(200),
      );
      return { items: rows.map(templateDto) };
    },
  );

  app.post(
    '/estimate-templates',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['templates'],
        summary: 'Create an estimate template (budget lines + schedule tasks + questionnaire)',
        body: CreateEstimateTemplateRequestSchema,
        response: { 201: EstimateTemplateSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(estimateTemplates)
          .values({
            orgId: org.orgId,
            name: request.body.name,
            description: request.body.description ?? null,
            budgetLines: request.body.budgetLines,
            scheduleTasks: request.body.scheduleTasks,
            questionnaire: request.body.questionnaire,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'estimate_template.created',
          resourceType: 'estimate_template',
          resourceId: created.id,
          after: { name: created.name },
        });
        return created;
      });
      reply.code(201);
      return templateDto(row);
    },
  );

  app.patch(
    '/estimate-templates/:id',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['templates'],
        summary: 'Update a template (name, description, lines, tasks, questionnaire, active)',
        params: IdParams,
        body: CreateEstimateTemplateRequestSchema.partial().extend({
          active: z.boolean().optional(),
        }),
        response: { 200: EstimateTemplateSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(estimateTemplates)
          .where(and(eq(estimateTemplates.orgId, org.orgId), eq(estimateTemplates.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        const [updated] = await tx
          .update(estimateTemplates)
          .set({
            name: request.body.name ?? existing.name,
            description:
              request.body.description === undefined ? existing.description : request.body.description,
            budgetLines: request.body.budgetLines ?? existing.budgetLines,
            scheduleTasks: request.body.scheduleTasks ?? existing.scheduleTasks,
            questionnaire: request.body.questionnaire ?? existing.questionnaire,
            active: request.body.active ?? existing.active,
            updatedAt: new Date(),
          })
          .where(eq(estimateTemplates.id, existing.id))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'estimate_template.updated',
          resourceType: 'estimate_template',
          resourceId: updated.id,
        });
        return updated;
      });
      return templateDto(row);
    },
  );

  app.post(
    '/estimate-templates/:id/apply',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['templates'],
        summary: 'Apply a template to a job: budget lines + schedule tasks + questionnaire in one pass',
        params: IdParams,
        body: ApplyTemplateRequestSchema,
        response: { 200: ApplyTemplateResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      // Applying writes into job cost and the schedule — both permissions required.
      assertCan(request, 'job_cost:write');
      assertCan(request, 'schedule:write');
      return tenantTx(request, async (tx) => {
        const [template] = await tx
          .select()
          .from(estimateTemplates)
          .where(and(eq(estimateTemplates.orgId, org.orgId), eq(estimateTemplates.id, request.params.id)))
          .limit(1);
        if (!template) throw problem('not_found');
        if (!template.active) throw problem('conflict', 'This template is inactive. Reactivate it to apply it.');
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.orgId, org.orgId), eq(jobs.id, request.body.jobId), isNull(jobs.deletedAt)))
          .limit(1);
        if (!job) throw problem('validation_failed', 'That job does not exist in this company.');

        const budgetLines = (template.budgetLines as TemplateBudgetLine[] | null) ?? [];
        const existingBudgets = await tx
          .select({ costCode: jobCostBudgets.costCode })
          .from(jobCostBudgets)
          .where(and(eq(jobCostBudgets.orgId, org.orgId), eq(jobCostBudgets.jobId, job.id)));
        const existingCodes = new Set(existingBudgets.map((b) => b.costCode));
        let budgetLinesCreated = 0;
        let budgetLinesSkipped = 0;
        for (const line of budgetLines) {
          // Unpriced lines and cost codes already on the job are skipped and counted —
          // never overwritten, never given an invented amount.
          if (line.budgetMinor === null || existingCodes.has(line.costCode)) {
            budgetLinesSkipped += 1;
            continue;
          }
          await tx.insert(jobCostBudgets).values({
            orgId: org.orgId,
            jobId: job.id,
            costCode: line.costCode,
            label: line.label,
            budgetMinor: line.budgetMinor,
          });
          existingCodes.add(line.costCode);
          budgetLinesCreated += 1;
        }

        const tasks = (template.scheduleTasks as TemplateScheduleTask[] | null) ?? [];
        let scheduleTasksCreated = 0;
        for (const [index, task] of tasks.entries()) {
          const startsOn = addDays(request.body.startDate, task.startOffsetDays);
          const endsOn = addDays(startsOn, task.durationDays - 1);
          await tx.insert(scheduleTasks).values({
            orgId: org.orgId,
            jobId: job.id,
            title: task.title,
            startsOn,
            endsOn,
            sortOrder: index,
          });
          scheduleTasksCreated += 1;
        }

        const questions = (template.questionnaire as TemplateQuestion[] | null) ?? [];
        let questionnaireId: string | null = null;
        if (questions.length > 0) {
          const [questionnaire] = await tx
            .insert(jobQuestionnaires)
            .values({
              orgId: org.orgId,
              jobId: job.id,
              templateId: template.id,
              title: template.name,
              questions,
              answers: [],
            })
            .returning();
          questionnaireId = questionnaire?.id ?? null;
        }

        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'estimate_template.applied',
          resourceType: 'estimate_template',
          resourceId: template.id,
          after: { jobId: job.id, budgetLinesCreated, budgetLinesSkipped, scheduleTasksCreated, questionnaireId },
        });
        return {
          templateId: template.id,
          jobId: job.id,
          budgetLinesCreated,
          budgetLinesSkipped,
          scheduleTasksCreated,
          questionnaireId,
        };
      });
    },
  );

  app.get(
    '/jobs/:jobId/questionnaires',
    {
      config: { permission: READ },
      schema: {
        tags: ['templates'],
        summary: 'Client questionnaires generated for a job',
        params: z.object({ jobId: z.uuid() }),
        response: { 200: JobQuestionnaireListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(jobQuestionnaires)
          .where(and(eq(jobQuestionnaires.orgId, orgId), eq(jobQuestionnaires.jobId, request.params.jobId)))
          .orderBy(desc(jobQuestionnaires.createdAt))
          .limit(100),
      );
      return { items: rows.map(questionnaireDto) };
    },
  );

  app.patch(
    '/questionnaires/:id/answers',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['templates'],
        summary: 'Record questionnaire answers (marks it answered when every question has one)',
        params: IdParams,
        body: AnswerQuestionnaireRequestSchema,
        response: { 200: JobQuestionnaireSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(jobQuestionnaires)
          .where(and(eq(jobQuestionnaires.orgId, org.orgId), eq(jobQuestionnaires.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        if (existing.status === 'closed') throw problem('conflict', 'This questionnaire is closed.');
        const questions = (existing.questions as TemplateQuestion[] | null) ?? [];
        const known = new Set(questions.map((q) => q.key));
        for (const answer of request.body.answers) {
          if (!known.has(answer.key)) {
            throw problem('validation_failed', `Unknown question key: ${answer.key}`);
          }
        }
        const answeredKeys = new Set(
          request.body.answers.filter((a) => a.value !== null && a.value !== '').map((a) => a.key),
        );
        const complete = questions.every((q) => answeredKeys.has(q.key));
        const [updated] = await tx
          .update(jobQuestionnaires)
          .set({
            answers: request.body.answers,
            status: complete ? 'answered' : 'open',
            updatedAt: new Date(),
          })
          .where(eq(jobQuestionnaires.id, existing.id))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'job_questionnaire.answered',
          resourceType: 'job_questionnaire',
          resourceId: updated.id,
          after: { status: updated.status },
        });
        return updated;
      });
      return questionnaireDto(row);
    },
  );
};

export default templatesModule;
