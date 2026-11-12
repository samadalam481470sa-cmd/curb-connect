// Enterprise Suite API: tenant-scoped opt-in, isolated projects, RFIs, change orders, submittals,
// and a preliminary schedule of values. Does not touch the public roofing project tables.
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  enterpriseSettings, enterpriseProjects, enterpriseRfis,
  enterpriseChangeOrders, enterpriseSubmittals, enterpriseSovLines, enterpriseAuditEvents,
} from '../../db/schema/enterprise';
import type { Tx } from '../../db/runtime';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { problem } from '../../http/problem';
import { calculateSov, canTransition, RFI_NEXT, CO_NEXT, SUBMITTAL_NEXT,
  type RfiStatus, type CoStatus, type SubmittalStatus } from './workflow';

const UUID = z.uuid();
const PositiveMinor = z.number().int().safe().min(0).max(1_000_000_000_000);
const SignedMinor = z.number().int().safe().min(-1_000_000_000_000).max(1_000_000_000_000);
const ProjectParams = z.object({ projectId: UUID });
const ResourceParams = z.object({ id: UUID });
const projectInput = z.object({
  name: z.string().trim().min(2).max(255), originalContractMinor: PositiveMinor.default(0),
});
const rfiInput = z.object({
  subject: z.string().trim().min(2).max(255),
  question: z.string().trim().min(3).max(10000),
  ballInCourt: z.string().trim().min(2).max(255),
  costImpact: z.boolean().default(false),
  scheduleImpactDays: z.number().int().min(-3650).max(3650).default(0),
});
const coInput = z.object({
  number: z.string().trim().min(1).max(50), title: z.string().trim().min(2).max(255),
  description: z.string().trim().min(3).max(10000),
  amountDeltaMinor: SignedMinor,
  scheduleImpactDays: z.number().int().min(-3650).max(3650).default(0),
});
const submittalInput = z.object({
  number: z.string().trim().min(1).max(50), title: z.string().trim().min(2).max(255),
  reviewer: z.string().trim().min(2).max(255),
  specSection: z.string().trim().max(50).default(''),
  documentReference: z.string().trim().max(500).optional(),
});
const sovInput = z.object({
  lineNumber: z.number().int().min(1).max(100000),
  costCode: z.string().trim().min(2).max(20),
  description: z.string().trim().min(2).max(1000),
  scheduledMinor: PositiveMinor,
  previousMinor: PositiveMinor.default(0),
  currentMinor: PositiveMinor.default(0),
  storedMinor: PositiveMinor.default(0),
  retainageBps: z.number().int().min(0).max(10000).default(1000),
}).refine((row) => row.previousMinor + row.currentMinor + row.storedMinor <= row.scheduledMinor, {
  message: 'Total completed plus stored value cannot exceed scheduled value.',
});
const statusInput = z.object({
  status: z.string().min(2).max(40),
  officialResponse: z.string().trim().max(10000).optional(),
});

async function checkEnabled(tx: Tx, orgId: string) {
  const [settings] = await tx.select().from(enterpriseSettings)
    .where(eq(enterpriseSettings.orgId, orgId));
  if (!settings?.enabled) throw problem('forbidden', 'Enable the Enterprise Suite for your company first.');
}

async function checkProject(tx: Tx, orgId: string, projectId: string, lock = false) {
  const query = tx.select().from(enterpriseProjects).where(and(
    eq(enterpriseProjects.orgId, orgId), eq(enterpriseProjects.id, projectId),
  ));
  const [project] = lock ? await query.for('update') : await query;
  if (!project) throw problem('not_found');
  return project;
}

async function audit(tx: Tx, orgId: string, userId: string, kind: string, objectId: string,
  action: string, beforeState?: unknown, afterState?: unknown) {
  await tx.insert(enterpriseAuditEvents).values({
    orgId, actorUserId: userId, objectType: kind, objectId, action,
    beforeState: beforeState ?? null, afterState: afterState ?? null,
  });
}

const enterpriseModule: FastifyPluginAsyncZod = async (app) => {
  app.get('/enterprise/status', {
    config: { permission: 'org:read' },
    schema: { tags: ['enterprise'], summary: 'Enterprise add-on enrollment' },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      const [settings] = await tx.select().from(enterpriseSettings)
        .where(eq(enterpriseSettings.orgId, org.orgId));
      return { enabled: settings?.enabled ?? false, canManage: org.permissions.has('org:settings_update') };
    });
  });

  app.put('/enterprise/status', {
    config: { permission: 'org:settings_update', rateLimit: { max: 15, timeWindow: '1 minute' } },
    schema: { tags: ['enterprise'], body: z.object({ enabled: z.boolean() }) },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      const [settings] = await tx.insert(enterpriseSettings).values({
        orgId: org.orgId, enabled: request.body.enabled, updatedByUserId: org.userId,
      }).onConflictDoUpdate({
        target: enterpriseSettings.orgId,
        set: { enabled: request.body.enabled, updatedAt: new Date(), updatedByUserId: org.userId },
      }).returning();
      await audit(tx, org.orgId, org.userId, 'suite', org.orgId,
        'suite.enrollment_updated', null, { enabled: settings?.enabled });
      return { enabled: settings?.enabled ?? false, canManage: true };
    });
  });

  app.get('/enterprise/projects', {
    config: { permission: 'job:read' },
    schema: { tags: ['enterprise'], summary: 'List separate commercial projects' },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await checkEnabled(tx, org.orgId);
      const projects = await tx.select().from(enterpriseProjects)
        .where(eq(enterpriseProjects.orgId, org.orgId))
        .orderBy(desc(enterpriseProjects.createdAt)).limit(100);
      return { items: projects };
    });
  });

  app.post('/enterprise/projects', {
    config: { permission: 'job:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['enterprise'], body: projectInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const project = await tenantTx(request, async (tx) => {
      await checkEnabled(tx, org.orgId);
      const [item] = await tx.insert(enterpriseProjects).values({
        orgId: org.orgId, name: request.body.name, originalContractMinor: request.body.originalContractMinor,
        createdByUserId: org.userId,
      }).returning();
      if (!item) throw new Error('Enterprise project insert failed');
      await audit(tx, org.orgId, org.userId, 'project', item.id, 'project.created', null, item);
      return item;
    });
    return reply.code(201).send(project);
  });

  app.get('/enterprise/projects/:projectId/records', {
    config: { permission: 'job:read' },
    schema: { tags: ['enterprise'], params: ProjectParams },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await checkEnabled(tx, org.orgId);
      const p = await checkProject(tx, org.orgId, request.params.projectId);
      const [rfis, changeOrders, submittals, sovLines] = await Promise.all([
        tx.select().from(enterpriseRfis).where(and(eq(enterpriseRfis.orgId, org.orgId),
          eq(enterpriseRfis.projectId, p.id))).orderBy(enterpriseRfis.rfiNumber),
        tx.select().from(enterpriseChangeOrders).where(and(eq(enterpriseChangeOrders.orgId, org.orgId),
          eq(enterpriseChangeOrders.projectId, p.id))).orderBy(desc(enterpriseChangeOrders.createdAt)),
        tx.select().from(enterpriseSubmittals).where(and(eq(enterpriseSubmittals.orgId, org.orgId),
          eq(enterpriseSubmittals.projectId, p.id))).orderBy(desc(enterpriseSubmittals.createdAt)),
        tx.select().from(enterpriseSovLines).where(and(eq(enterpriseSovLines.orgId, org.orgId),
          eq(enterpriseSovLines.projectId, p.id))).orderBy(enterpriseSovLines.lineNumber),
      ]);
      const approved = changeOrders.filter((row) => row.status === 'approved')
        .reduce((sum, row) => sum + row.amountDeltaMinor, 0);
      const summary = calculateSov(sovLines, p.originalContractMinor, approved);
      return { project: p, rfis, changeOrders, submittals, sovLines, summary };
    });
  });

  app.post('/enterprise/projects/:projectId/rfis', {
    config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['enterprise'], params: ProjectParams, body: rfiInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const item = await tenantTx(request, async (tx) => {
      await checkEnabled(tx, org.orgId);
      // Lock the project row; concurrent RFI creates in this project serialize.
      await checkProject(tx, org.orgId, request.params.projectId, true);
      const [last] = await tx.select({ number: enterpriseRfis.rfiNumber }).from(enterpriseRfis)
        .where(and(eq(enterpriseRfis.orgId, org.orgId), eq(enterpriseRfis.projectId, request.params.projectId)))
        .orderBy(desc(enterpriseRfis.rfiNumber)).limit(1);
      const [row] = await tx.insert(enterpriseRfis).values({
        orgId: org.orgId, projectId: request.params.projectId, rfiNumber: (last?.number ?? 0) + 1,
        ...request.body, createdByUserId: org.userId,
      }).returning();
      if (!row) throw new Error('RFI insert failed');
      await audit(tx, org.orgId, org.userId, 'rfi', row.id, 'rfi.created', null, row);
      return row;
    });
    return reply.code(201).send(item);
  });

  app.patch('/enterprise/rfis/:id/status', {
    config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: { tags: ['enterprise'], params: ResourceParams, body: statusInput },
  }, async (request) => {
    const org = requireOrg(request);
    const revision = parseIfMatch(request);
    return tenantTx(request, async (tx) => {
      await checkEnabled(tx, org.orgId);
      const [row] = await tx.select().from(enterpriseRfis).where(and(
        eq(enterpriseRfis.orgId, org.orgId), eq(enterpriseRfis.id, request.params.id),
      )).for('update');
      if (!row) throw problem('not_found');
      assertRevision(row.revision, revision);
      const next = request.body.status;
      if (!canTransition(RFI_NEXT, row.status as RfiStatus, next)) throw problem('conflict', 'Invalid RFI transition.');
      if (next === 'answered' || next === 'closed') assertCan(request, 'review_task:decide');
      if ((next === 'answered' || (next === 'closed' && row.status === 'open')) &&
        !request.body.officialResponse?.trim()) {
        throw problem('validation_failed', 'An official answer is required.');
      }
      const [updated] = await tx.update(enterpriseRfis).set({
        status: next, officialResponse: request.body.officialResponse ?? row.officialResponse,
        answeredAt: next === 'answered' ? new Date() : row.answeredAt,
        revision: row.revision + 1, updatedAt: new Date(),
      }).where(eq(enterpriseRfis.id, row.id)).returning();
      await audit(tx, org.orgId, org.userId, 'rfi', row.id,
        'rfi.status_changed', { status: row.status }, { status: next });
      return updated;
    });
  });

  app.post('/enterprise/projects/:projectId/change-orders', {
    config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['enterprise'], params: ProjectParams, body: coInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const item = await tenantTx(request, async (tx) => {
      await checkEnabled(tx, org.orgId);
      await checkProject(tx, org.orgId, request.params.projectId);
      const [row] = await tx.insert(enterpriseChangeOrders).values({
        ...request.body, projectId: request.params.projectId,
        orgId: org.orgId, createdByUserId: org.userId,
      }).returning();
      if (!row) throw new Error('Change order insert failed');
      await audit(tx, org.orgId, org.userId, 'change_order', row.id, 'pco.created', null, row);
      return row;
    });
    return reply.code(201).send(item);
  });

  app.patch('/enterprise/change-orders/:id/status', {
    config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: { tags: ['enterprise'], params: ResourceParams, body: statusInput },
  }, async (request) => {
    const org = requireOrg(request);
    const revision = parseIfMatch(request);
    return tenantTx(request, async (tx) => {
      await checkEnabled(tx, org.orgId);
      const [row] = await tx.select().from(enterpriseChangeOrders).where(and(
        eq(enterpriseChangeOrders.orgId, org.orgId), eq(enterpriseChangeOrders.id, request.params.id),
      )).for('update');
      if (!row) throw problem('not_found');
      assertRevision(row.revision, revision);
      const next = request.body.status;
      if (!canTransition(CO_NEXT, row.status as CoStatus, next)) throw problem('conflict', 'Invalid PCO transition.');
      if (next === 'approved') assertCan(request, 'org:settings_update');
      const [updated] = await tx.update(enterpriseChangeOrders).set({
        status: next, approvedAt: next === 'approved' ? new Date() : row.approvedAt,
        approvedByUserId: next === 'approved' ? org.userId : row.approvedByUserId,
        revision: row.revision + 1, updatedAt: new Date(),
      }).where(eq(enterpriseChangeOrders.id, row.id)).returning();
      await audit(tx, org.orgId, org.userId, 'change_order', row.id,
        'co.status_changed', { status: row.status }, { status: next });
      return updated;
    });
  });

  app.post('/enterprise/projects/:projectId/submittals', {
    config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['enterprise'], params: ProjectParams, body: submittalInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const item = await tenantTx(request, async (tx) => {
      await checkEnabled(tx, org.orgId);
      await checkProject(tx, org.orgId, request.params.projectId);
      const [row] = await tx.insert(enterpriseSubmittals).values({
        ...request.body, projectId: request.params.projectId, orgId: org.orgId,
        createdByUserId: org.userId,
      }).returning();
      if (!row) throw new Error('Submittal insert failed');
      await audit(tx, org.orgId, org.userId, 'submittal', row.id, 'submittal.created', null, row);
      return row;
    });
    return reply.code(201).send(item);
  });

  app.patch('/enterprise/submittals/:id/status', {
    config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: { tags: ['enterprise'], params: ResourceParams, body: statusInput },
  }, async (request) => {
    const org = requireOrg(request);
    const revision = parseIfMatch(request);
    return tenantTx(request, async (tx) => {
      await checkEnabled(tx, org.orgId);
      const [row] = await tx.select().from(enterpriseSubmittals).where(and(
        eq(enterpriseSubmittals.orgId, org.orgId), eq(enterpriseSubmittals.id, request.params.id),
      )).for('update');
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
      const [updated] = await tx.update(enterpriseSubmittals).set({
        status: next, revision: row.revision + 1,
        currentRevision: row.status === 'revise_and_resubmit' && next === 'submitted'
          ? row.currentRevision + 1 : row.currentRevision,
        updatedAt: new Date(),
      }).where(eq(enterpriseSubmittals.id, row.id)).returning();
      await audit(tx, org.orgId, org.userId, 'submittal', row.id,
        'submittal.status_changed', { status: row.status }, { status: next });
      return updated;
    });
  });

  app.post('/enterprise/projects/:projectId/sov', {
    config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['enterprise'], params: ProjectParams, body: sovInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const item = await tenantTx(request, async (tx) => {
      await checkEnabled(tx, org.orgId);
      await checkProject(tx, org.orgId, request.params.projectId);
      const [row] = await tx.insert(enterpriseSovLines).values({
        ...request.body, projectId: request.params.projectId, orgId: org.orgId,
      }).returning();
      if (!row) throw new Error('SOV insert failed');
      await audit(tx, org.orgId, org.userId, 'sov', row.id, 'sov.line_added', null, row);
      return row;
    });
    return reply.code(201).send(item);
  });
};

export default enterpriseModule;
