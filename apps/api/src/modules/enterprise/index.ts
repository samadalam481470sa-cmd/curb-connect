// Enterprise Suite API: tenant-scoped opt-in, isolated projects, RFIs, change orders, submittals,
// and a preliminary schedule of values. Does not touch the public roofing project tables.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateEnterprisePunchItem,
  EnterprisePunchItem,
  EnterprisePunchPage,
  EnterprisePunchStatus,
  ENTERPRISE_PUNCH_TRANSITIONS,
  UpdateEnterprisePunchItem,
} from '@fieldline/contracts';
import {
  enterpriseSettings,
  enterpriseProjects,
  enterpriseRfis,
  enterpriseChangeOrders,
  enterpriseSubmittals,
  enterpriseSovLines,
  enterpriseAuditEvents,
  enterprisePunchItems,
} from '../../db/schema/enterprise';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { problem } from '../../http/problem';
import {
  calculateSov,
  canTransition,
  RFI_NEXT,
  CO_NEXT,
  SUBMITTAL_NEXT,
  type RfiStatus,
  type CoStatus,
  type SubmittalStatus,
} from './workflow';
import enterpriseBlueprintModule from './blueprint';
import { audit, checkEnabled, checkProject } from './access';
import enterpriseScheduleModule from './schedule';
import enterpriseDocumentModule from './documents';
import enterpriseChangePricingModule from './changePricing';
import enterpriseDailyLogModule from './dailyLog';
import enterpriseBiddingModule from './bidding';
import enterprisePurchasingModule from './purchasing';

const UUID = z.uuid();
const PositiveMinor = z.number().int().safe().min(0).max(1_000_000_000_000);
const SignedMinor = z.number().int().safe().min(-1_000_000_000_000).max(1_000_000_000_000);
const ProjectParams = z.object({ projectId: UUID });
const ResourceParams = z.object({ id: UUID });
const projectInput = z.object({
  name: z.string().trim().min(2).max(255),
  originalContractMinor: PositiveMinor.default(0),
});
const rfiInput = z.object({
  subject: z.string().trim().min(2).max(255),
  question: z.string().trim().min(3).max(10000),
  ballInCourt: z.string().trim().min(2).max(255),
  costImpact: z.boolean().default(false),
  scheduleImpactDays: z.number().int().min(-3650).max(3650).default(0),
});
const coInput = z.object({
  number: z.string().trim().min(1).max(50),
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().min(3).max(10000),
  amountDeltaMinor: SignedMinor,
  scheduleImpactDays: z.number().int().min(-3650).max(3650).default(0),
});
const coQueueQuery = z.object({
  projectId: UUID.optional(),
  status: z.enum(Object.keys(CO_NEXT) as CoStatus[]).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const submittalInput = z.object({
  number: z.string().trim().min(1).max(50),
  title: z.string().trim().min(2).max(255),
  reviewer: z.string().trim().min(2).max(255),
  specSection: z.string().trim().max(50).default(''),
  documentReference: z.string().trim().max(500).optional(),
});
const sovInput = z
  .object({
    lineNumber: z.number().int().min(1).max(100000),
    costCode: z.string().trim().min(2).max(20),
    description: z.string().trim().min(2).max(1000),
    scheduledMinor: PositiveMinor,
    previousMinor: PositiveMinor.default(0),
    currentMinor: PositiveMinor.default(0),
    storedMinor: PositiveMinor.default(0),
    retainageBps: z.number().int().min(0).max(10000).default(1000),
  })
  .refine((row) => row.previousMinor + row.currentMinor + row.storedMinor <= row.scheduledMinor, {
    message: 'Total completed plus stored value cannot exceed scheduled value.',
  });
const statusInput = z.object({
  status: z.string().min(2).max(40),
  officialResponse: z.string().trim().max(10000).optional(),
});

const enterpriseModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/enterprise/status',
    {
      config: { permission: 'org:read' },
      schema: { tags: ['enterprise'], summary: 'Enterprise add-on enrollment' },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [settings] = await tx
          .select()
          .from(enterpriseSettings)
          .where(eq(enterpriseSettings.orgId, org.orgId));
        return {
          enabled: settings?.enabled ?? false,
          canManage: org.permissions.has('org:settings_update'),
        };
      });
    },
  );

  app.put(
    '/enterprise/status',
    {
      config: { permission: 'org:settings_update', rateLimit: { max: 15, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], body: z.object({ enabled: z.boolean() }) },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [settings] = await tx
          .insert(enterpriseSettings)
          .values({
            orgId: org.orgId,
            enabled: request.body.enabled,
            updatedByUserId: org.userId,
          })
          .onConflictDoUpdate({
            target: enterpriseSettings.orgId,
            set: {
              enabled: request.body.enabled,
              updatedAt: new Date(),
              updatedByUserId: org.userId,
            },
          })
          .returning();
        await audit(
          tx,
          org.orgId,
          org.userId,
          'suite',
          org.orgId,
          'suite.enrollment_updated',
          null,
          { enabled: settings?.enabled },
        );
        return { enabled: settings?.enabled ?? false, canManage: true };
      });
    },
  );

  app.get(
    '/enterprise/projects',
    {
      config: { permission: 'job:read' },
      schema: { tags: ['enterprise'], summary: 'List separate commercial projects' },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const projects = await tx
          .select()
          .from(enterpriseProjects)
          .where(eq(enterpriseProjects.orgId, org.orgId))
          .orderBy(desc(enterpriseProjects.createdAt))
          .limit(100);
        return { items: projects };
      });
    },
  );

  app.post(
    '/enterprise/projects',
    {
      config: { permission: 'job:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], body: projectInput },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const project = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [item] = await tx
          .insert(enterpriseProjects)
          .values({
            orgId: org.orgId,
            name: request.body.name,
            originalContractMinor: request.body.originalContractMinor,
            createdByUserId: org.userId,
          })
          .returning();
        if (!item) throw new Error('Enterprise project insert failed');
        await audit(tx, org.orgId, org.userId, 'project', item.id, 'project.created', null, item);
        return item;
      });
      return reply.code(201).send(project);
    },
  );

  app.get(
    '/enterprise/projects/:projectId/records',
    {
      config: { permission: 'job:read' },
      schema: { tags: ['enterprise'], params: ProjectParams },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const p = await checkProject(tx, org.orgId, request.params.projectId);
        const [rfis, changeOrders, submittals, sovLines] = await Promise.all([
          tx
            .select()
            .from(enterpriseRfis)
            .where(and(eq(enterpriseRfis.orgId, org.orgId), eq(enterpriseRfis.projectId, p.id)))
            .orderBy(enterpriseRfis.rfiNumber),
          tx
            .select()
            .from(enterpriseChangeOrders)
            .where(
              and(
                eq(enterpriseChangeOrders.orgId, org.orgId),
                eq(enterpriseChangeOrders.projectId, p.id),
              ),
            )
            .orderBy(desc(enterpriseChangeOrders.createdAt)),
          tx
            .select()
            .from(enterpriseSubmittals)
            .where(
              and(
                eq(enterpriseSubmittals.orgId, org.orgId),
                eq(enterpriseSubmittals.projectId, p.id),
              ),
            )
            .orderBy(desc(enterpriseSubmittals.createdAt)),
          tx
            .select()
            .from(enterpriseSovLines)
            .where(
              and(eq(enterpriseSovLines.orgId, org.orgId), eq(enterpriseSovLines.projectId, p.id)),
            )
            .orderBy(enterpriseSovLines.lineNumber),
        ]);
        const approved = changeOrders
          .filter((row) => row.status === 'approved')
          .reduce((sum, row) => sum + row.amountDeltaMinor, 0);
        const summary = calculateSov(sovLines, p.originalContractMinor, approved);
        return { project: p, rfis, changeOrders, submittals, sovLines, summary };
      });
    },
  );

  app.post(
    '/enterprise/projects/:projectId/rfis',
    {
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: ProjectParams, body: rfiInput },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const item = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        // Lock the project row; concurrent RFI creates in this project serialize.
        await checkProject(tx, org.orgId, request.params.projectId, true);
        const [last] = await tx
          .select({ number: enterpriseRfis.rfiNumber })
          .from(enterpriseRfis)
          .where(
            and(
              eq(enterpriseRfis.orgId, org.orgId),
              eq(enterpriseRfis.projectId, request.params.projectId),
            ),
          )
          .orderBy(desc(enterpriseRfis.rfiNumber))
          .limit(1);
        const [row] = await tx
          .insert(enterpriseRfis)
          .values({
            orgId: org.orgId,
            projectId: request.params.projectId,
            rfiNumber: (last?.number ?? 0) + 1,
            ...request.body,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw new Error('RFI insert failed');
        await audit(tx, org.orgId, org.userId, 'rfi', row.id, 'rfi.created', null, row);
        return row;
      });
      return reply.code(201).send(item);
    },
  );

  app.patch(
    '/enterprise/rfis/:id/status',
    {
      config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: ResourceParams, body: statusInput },
    },
    async (request) => {
      const org = requireOrg(request);
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [row] = await tx
          .select()
          .from(enterpriseRfis)
          .where(and(eq(enterpriseRfis.orgId, org.orgId), eq(enterpriseRfis.id, request.params.id)))
          .for('update');
        if (!row) throw problem('not_found');
        assertRevision(row.revision, revision);
        const next = request.body.status;
        if (!canTransition(RFI_NEXT, row.status as RfiStatus, next))
          throw problem('conflict', 'Invalid RFI transition.');
        if (next === 'answered' || next === 'closed') assertCan(request, 'review_task:decide');
        if (
          (next === 'answered' || (next === 'closed' && row.status === 'open')) &&
          !request.body.officialResponse?.trim()
        ) {
          throw problem('validation_failed', 'An official answer is required.');
        }
        const [updated] = await tx
          .update(enterpriseRfis)
          .set({
            status: next,
            officialResponse: request.body.officialResponse ?? row.officialResponse,
            answeredAt: next === 'answered' ? new Date() : row.answeredAt,
            revision: row.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(enterpriseRfis.id, row.id))
          .returning();
        await audit(
          tx,
          org.orgId,
          org.userId,
          'rfi',
          row.id,
          'rfi.status_changed',
          { status: row.status },
          { status: next },
        );
        return updated;
      });
    },
  );

  app.get(
    '/enterprise/change-orders',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        summary: 'Search the company change order queue',
        querystring: coQueueQuery,
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { projectId, status, search, cursor, limit } = request.query;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        if (projectId) await checkProject(tx, org.orgId, projectId);
        const orders = enterpriseChangeOrders;
        const position = decodeCursor(cursor);
        const rows = await tx
          .select({ order: orders, projectName: enterpriseProjects.name })
          .from(orders)
          .innerJoin(
            enterpriseProjects,
            and(
              eq(enterpriseProjects.id, orders.projectId),
              eq(enterpriseProjects.orgId, orders.orgId),
            ),
          )
          .where(
            and(
              eq(orders.orgId, org.orgId),
              projectId ? eq(orders.projectId, projectId) : undefined,
              status ? eq(orders.status, status) : undefined,
              search
                ? sql`strpos(lower(concat_ws(' ', ${orders.number}, ${orders.title}, ${enterpriseProjects.name})), lower(${search})) > 0`
                : undefined,
              beforeCursor(orders.createdAt, orders.id, position),
            ),
          )
          .orderBy(desc(msTrunc(orders.createdAt)), desc(orders.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          ({ order }) => ({ at: order.createdAt, id: order.id }),
          (row) => row,
        );
      });
    },
  );

  app.get(
    '/enterprise/change-orders/:id',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: ResourceParams,
        summary: 'Read a change order and its audit history',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { id } = request.params;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [order] = await tx
          .select()
          .from(enterpriseChangeOrders)
          .where(
            and(eq(enterpriseChangeOrders.orgId, org.orgId), eq(enterpriseChangeOrders.id, id)),
          );
        if (!order) throw problem('not_found');
        const project = await checkProject(tx, org.orgId, order.projectId);
        const events = enterpriseAuditEvents;
        const history = await tx
          .select({
            id: events.id,
            actorUserId: events.actorUserId,
            action: events.action,
            createdAt: events.createdAt,
            previousStatus: sql<string | null>`${events.beforeState}->>'status'`,
            status: sql<string | null>`${events.afterState}->>'status'`,
            revision: sql<number | null>`(${events.afterState}->>'revision')::integer`,
          })
          .from(events)
          .where(
            and(
              eq(events.orgId, org.orgId),
              eq(events.objectId, id),
              eq(events.objectType, 'change_order'),
            ),
          )
          .orderBy(desc(events.createdAt), desc(events.id));
        return { order, projectName: project.name, history };
      });
    },
  );

  app.post(
    '/enterprise/projects/:projectId/change-orders',
    {
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: ProjectParams, body: coInput },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const item = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        await checkProject(tx, org.orgId, request.params.projectId);
        const [row] = await tx
          .insert(enterpriseChangeOrders)
          .values({
            ...request.body,
            projectId: request.params.projectId,
            orgId: org.orgId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw new Error('Change order insert failed');
        await audit(tx, org.orgId, org.userId, 'change_order', row.id, 'pco.created', null, row);
        return row;
      });
      return reply.code(201).send(item);
    },
  );

  app.patch(
    '/enterprise/change-orders/:id/status',
    {
      config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: ResourceParams, body: statusInput },
    },
    async (request) => {
      const org = requireOrg(request);
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [row] = await tx
          .select()
          .from(enterpriseChangeOrders)
          .where(
            and(
              eq(enterpriseChangeOrders.orgId, org.orgId),
              eq(enterpriseChangeOrders.id, request.params.id),
            ),
          )
          .for('update');
        if (!row) throw problem('not_found');
        assertRevision(row.revision, revision);
        const next = request.body.status;
        if (!canTransition(CO_NEXT, row.status as CoStatus, next))
          throw problem('conflict', 'Invalid PCO transition.');
        if (next === 'approved') assertCan(request, 'org:settings_update');
        const [updated] = await tx
          .update(enterpriseChangeOrders)
          .set({
            status: next,
            approvedAt: next === 'approved' ? new Date() : row.approvedAt,
            approvedByUserId: next === 'approved' ? org.userId : row.approvedByUserId,
            revision: row.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(enterpriseChangeOrders.id, row.id))
          .returning();
        await audit(
          tx,
          org.orgId,
          org.userId,
          'change_order',
          row.id,
          'co.status_changed',
          { status: row.status, revision: row.revision },
          { status: next, revision: updated?.revision },
        );
        return updated;
      });
    },
  );

  app.get(
    '/enterprise/projects/:projectId/punch-items',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        querystring: z.object({
          status: EnterprisePunchStatus.optional(),
          cursor: z.string().max(256).optional(),
        }),
        response: { 200: EnterprisePunchPage },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { projectId } = request.params;
      const { cursor, status } = request.query;
      const position = decodeCursor(cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        await checkProject(tx, org.orgId, projectId);
        const items = enterprisePunchItems;
        const limit = 30;
        const rows = await tx
          .select()
          .from(items)
          .where(
            and(
              eq(items.orgId, org.orgId),
              eq(items.projectId, projectId),
              status ? eq(items.status, status) : undefined,
              beforeCursor(items.createdAt, items.id, position),
            ),
          )
          .orderBy(desc(msTrunc(items.createdAt)), desc(items.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          (row) => ({ at: row.createdAt, id: row.id }),
          (row) => row,
        );
      });
    },
  );

  app.post(
    '/enterprise/projects/:projectId/punch-items',
    {
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        body: CreateEnterprisePunchItem,
        response: { 200: EnterprisePunchItem, 201: EnterprisePunchItem },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const { projectId } = request.params;
      const { clientRequestId } = request.body;
      const items = enterprisePunchItems;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        await checkProject(tx, org.orgId, projectId);
        const [inserted] = await tx
          .insert(items)
          .values({ ...request.body, orgId: org.orgId, projectId, createdByUserId: org.userId })
          .onConflictDoNothing({ target: [items.orgId, items.projectId, items.clientRequestId] })
          .returning();
        if (inserted) {
          await audit(
            tx,
            org.orgId,
            org.userId,
            'punch_item',
            inserted.id,
            'punch.created',
            null,
            inserted,
          );
          return { item: inserted, created: true };
        }
        const [existing] = await tx
          .select()
          .from(items)
          .where(
            and(
              eq(items.orgId, org.orgId),
              eq(items.projectId, projectId),
              eq(items.clientRequestId, clientRequestId),
            ),
          );
        if (!existing) throw new Error('Could not recover the retried punch item.');
        return { item: existing, created: false };
      });
      return reply.code(result.created ? 201 : 200).send(result.item);
    },
  );

  app.patch(
    '/enterprise/punch-items/:id/status',
    {
      config: { auth: 'org', rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: ResourceParams,
        body: UpdateEnterprisePunchItem,
        response: { 200: EnterprisePunchItem },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const revision = parseIfMatch(request);
      const { status, reviewNote } = request.body;
      const items = enterprisePunchItems;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [item] = await tx
          .select()
          .from(items)
          .where(and(eq(items.orgId, org.orgId), eq(items.id, request.params.id)))
          .for('update');
        if (!item) throw problem('not_found');
        const isReview = item.status === 'ready_for_review';
        assertCan(request, isReview ? 'review_task:decide' : 'job:write');
        assertRevision(item.revision, revision);
        if (!canTransition(ENTERPRISE_PUNCH_TRANSITIONS, item.status, status)) {
          throw problem('conflict', 'This punch item cannot move to the requested status.');
        }
        if (isReview && !reviewNote) throw problem('validation_failed', 'Enter a review note.');
        if (!isReview && reviewNote)
          throw problem('validation_failed', 'Review notes are recorded during review.');
        const [updated] = await tx
          .update(items)
          .set({
            status,
            reviewNote: reviewNote ?? item.reviewNote,
            revision: item.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(items.orgId, org.orgId), eq(items.id, item.id)))
          .returning();
        if (!updated) throw new Error('Punch item update failed.');
        await audit(
          tx,
          org.orgId,
          org.userId,
          'punch_item',
          item.id,
          'punch.status_changed',
          item,
          updated,
        );
        return updated;
      });
    },
  );

  app.post(
    '/enterprise/projects/:projectId/submittals',
    {
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: ProjectParams, body: submittalInput },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const item = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        await checkProject(tx, org.orgId, request.params.projectId);
        const [row] = await tx
          .insert(enterpriseSubmittals)
          .values({
            ...request.body,
            projectId: request.params.projectId,
            orgId: org.orgId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw new Error('Submittal insert failed');
        await audit(tx, org.orgId, org.userId, 'submittal', row.id, 'submittal.created', null, row);
        return row;
      });
      return reply.code(201).send(item);
    },
  );

  app.patch(
    '/enterprise/submittals/:id/status',
    {
      config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: ResourceParams, body: statusInput },
    },
    async (request) => {
      const org = requireOrg(request);
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [row] = await tx
          .select()
          .from(enterpriseSubmittals)
          .where(
            and(
              eq(enterpriseSubmittals.orgId, org.orgId),
              eq(enterpriseSubmittals.id, request.params.id),
            ),
          )
          .for('update');
        if (!row) throw problem('not_found');
        assertRevision(row.revision, revision);
        const next = request.body.status;
        if (!canTransition(SUBMITTAL_NEXT, row.status as SubmittalStatus, next)) {
          throw problem('conflict', 'Invalid submittal transition.');
        }
        if (next === 'submitted' && !row.documentReference?.trim()) {
          throw problem('validation_failed', 'Add a document reference before submission.');
        }
        if (['approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected'].includes(next)) {
          assertCan(request, 'review_task:decide');
        }
        const [updated] = await tx
          .update(enterpriseSubmittals)
          .set({
            status: next,
            revision: row.revision + 1,
            currentRevision:
              row.status === 'revise_and_resubmit' && next === 'submitted'
                ? row.currentRevision + 1
                : row.currentRevision,
            updatedAt: new Date(),
          })
          .where(eq(enterpriseSubmittals.id, row.id))
          .returning();
        await audit(
          tx,
          org.orgId,
          org.userId,
          'submittal',
          row.id,
          'submittal.status_changed',
          { status: row.status },
          { status: next },
        );
        return updated;
      });
    },
  );

  app.post(
    '/enterprise/projects/:projectId/sov',
    {
      config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: ProjectParams, body: sovInput },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const item = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        await checkProject(tx, org.orgId, request.params.projectId);
        const [row] = await tx
          .insert(enterpriseSovLines)
          .values({
            ...request.body,
            projectId: request.params.projectId,
            orgId: org.orgId,
          })
          .returning();
        if (!row) throw new Error('SOV insert failed');
        await audit(tx, org.orgId, org.userId, 'sov', row.id, 'sov.line_added', null, row);
        return row;
      });
      return reply.code(201).send(item);
    },
  );

  // Blueprint work-package records live in their own child plugin so the route file stays focused.
  await app.register(enterpriseBlueprintModule);
  await app.register(enterpriseScheduleModule);
  await app.register(enterpriseDocumentModule);
  await app.register(enterpriseChangePricingModule);
  await app.register(enterpriseDailyLogModule);
  await app.register(enterpriseBiddingModule);
  await app.register(enterprisePurchasingModule);
};

export default enterpriseModule;
