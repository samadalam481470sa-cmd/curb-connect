// Enterprise Blueprint API: tenant-scoped records for the 157 indexed work packages.
// Reads the catalog from @fieldline/contracts; the server validates every field key and lifecycle
// status so a client cannot invent a stage or smuggle a field outside the package contract.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  findWorkPackage,
  isWorkPackageStatus,
  workPackageFieldKeys,
  type EnterpriseWorkPackage,
} from '@fieldline/contracts';
import {
  enterpriseProjects,
  enterpriseSettings,
  enterpriseAuditEvents,
} from '../../db/schema/enterprise';
import { enterpriseBlueprintRecords } from '../../db/schema/enterpriseBlueprint';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { problem } from '../../http/problem';

const CodeParams = z.object({ code: z.string().regex(/^\d{3}$/) });
const RecordParams = z.object({ id: z.uuid() });
const FieldValues = z.record(z.string().trim().min(1).max(60), z.string().max(2000));

const createInput = z.object({
  title: z.string().trim().min(2).max(255),
  fields: FieldValues.default({}),
  notes: z.string().trim().max(10000).optional(),
  projectId: z.uuid().optional(),
  clientRequestId: z.string().trim().min(8).max(80).optional(),
});
const updateInput = z
  .object({
    status: z.string().trim().min(1).max(60).optional(),
    fields: FieldValues.optional(),
    notes: z.string().trim().max(10000).optional(),
  })
  .refine(
    (body) => body.status !== undefined || body.fields !== undefined || body.notes !== undefined,
    {
      message: 'Provide a status, fields or notes change.',
    },
  );

async function checkEnabled(tx: Tx, orgId: string) {
  const [settings] = await tx
    .select()
    .from(enterpriseSettings)
    .where(eq(enterpriseSettings.orgId, orgId));
  if (!settings?.enabled)
    throw problem('forbidden', 'Enable the Enterprise Suite for your company first.');
}

async function checkProject(tx: Tx, orgId: string, projectId: string) {
  const [project] = await tx
    .select({ id: enterpriseProjects.id })
    .from(enterpriseProjects)
    .where(and(eq(enterpriseProjects.orgId, orgId), eq(enterpriseProjects.id, projectId)));
  if (!project)
    throw problem('validation_failed', 'The selected commercial project is not in this company.');
}

function operablePackage(code: string): EnterpriseWorkPackage {
  const pkg = findWorkPackage(code);
  if (!pkg) throw problem('not_found');
  if (pkg.specification === 'indexed') {
    throw problem(
      'validation_failed',
      'This work package is indexed only in the supplied blueprint extract; its detailed pages are required before records can be created.',
    );
  }
  return pkg;
}

function validateFields(pkg: EnterpriseWorkPackage, fields: Record<string, string>) {
  const allowed = new Set(workPackageFieldKeys(pkg));
  const unknown = Object.keys(fields).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw problem(
      'validation_failed',
      'Unknown field keys for this work package: ' + unknown.join(', ') + '.',
    );
  }
}

async function audit(
  tx: Tx,
  orgId: string,
  userId: string,
  objectId: string,
  action: string,
  beforeState?: unknown,
  afterState?: unknown,
) {
  await tx.insert(enterpriseAuditEvents).values({
    orgId,
    actorUserId: userId,
    objectType: 'blueprint_record',
    objectId,
    action,
    beforeState: beforeState ?? null,
    afterState: afterState ?? null,
  });
}

const enterpriseBlueprintModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/enterprise/blueprint',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        summary: 'Blueprint coverage and record counts per work package',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const byPackage = await tx
          .select({
            packageCode: enterpriseBlueprintRecords.packageCode,
            total: sql<number>`count(*)::int`,
            updatedAt: sql<Date>`max(${enterpriseBlueprintRecords.updatedAt})`,
          })
          .from(enterpriseBlueprintRecords)
          .where(eq(enterpriseBlueprintRecords.orgId, org.orgId))
          .groupBy(enterpriseBlueprintRecords.packageCode);
        const byStatus = await tx
          .select({ status: enterpriseBlueprintRecords.status, total: sql<number>`count(*)::int` })
          .from(enterpriseBlueprintRecords)
          .where(eq(enterpriseBlueprintRecords.orgId, org.orgId))
          .groupBy(enterpriseBlueprintRecords.status);
        return {
          byPackage: byPackage.map((row) => ({
            packageCode: row.packageCode,
            total: row.total,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
          })),
          byStatus,
          totalRecords: byPackage.reduce((sum, row) => sum + row.total, 0),
        };
      });
    },
  );

  app.get(
    '/enterprise/blueprint/:code/records',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: CodeParams,
        summary: 'List records for one work package',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const code = String(request.params.code);
      const pkg = findWorkPackage(code);
      if (!pkg) throw problem('not_found');
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const items = await tx
          .select()
          .from(enterpriseBlueprintRecords)
          .where(
            and(
              eq(enterpriseBlueprintRecords.orgId, org.orgId),
              eq(enterpriseBlueprintRecords.packageCode, code),
            ),
          )
          .orderBy(desc(enterpriseBlueprintRecords.updatedAt))
          .limit(100);
        return { items };
      });
    },
  );

  app.post(
    '/enterprise/blueprint/:code/records',
    {
      config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: CodeParams, body: createInput },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const code = String(request.params.code);
      const pkg = operablePackage(code);
      validateFields(pkg, request.body.fields);
      const created = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        if (request.body.projectId) await checkProject(tx, org.orgId, request.body.projectId);
        if (request.body.clientRequestId) {
          const [existing] = await tx
            .select()
            .from(enterpriseBlueprintRecords)
            .where(
              and(
                eq(enterpriseBlueprintRecords.orgId, org.orgId),
                eq(enterpriseBlueprintRecords.clientRequestId, request.body.clientRequestId),
              ),
            );
          if (existing) return { record: existing, created: false };
        }
        const [row] = await tx
          .insert(enterpriseBlueprintRecords)
          .values({
            orgId: org.orgId,
            projectId: request.body.projectId ?? null,
            packageCode: code,
            title: request.body.title,
            status: pkg.lifecycle[0] ?? 'draft',
            fields: request.body.fields,
            notes: request.body.notes ?? null,
            clientRequestId: request.body.clientRequestId ?? null,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw new Error('Blueprint record insert failed');
        await audit(tx, org.orgId, org.userId, row.id, 'blueprint.record_created', null, row);
        return { record: row, created: true };
      });
      return reply.code(created.created ? 201 : 200).send(created.record);
    },
  );

  app.patch(
    '/enterprise/blueprint/records/:id',
    {
      config: { permission: 'job:write', rateLimit: { max: 90, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: RecordParams, body: updateInput },
    },
    async (request) => {
      const org = requireOrg(request);
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [row] = await tx
          .select()
          .from(enterpriseBlueprintRecords)
          .where(
            and(
              eq(enterpriseBlueprintRecords.orgId, org.orgId),
              eq(enterpriseBlueprintRecords.id, request.params.id),
            ),
          )
          .for('update');
        if (!row) throw problem('not_found');
        assertRevision(row.revision, revision);
        const pkg = findWorkPackage(row.packageCode);
        if (!pkg)
          throw problem(
            'conflict',
            'This record references a work package that is no longer in the catalog.',
          );
        if (request.body.status !== undefined && !isWorkPackageStatus(pkg, request.body.status)) {
          throw problem('validation_failed', 'Status is not part of this work package lifecycle.');
        }
        if (request.body.fields) validateFields(pkg, request.body.fields);
        const nextFields = request.body.fields
          ? { ...row.fields, ...request.body.fields }
          : row.fields;
        const [updated] = await tx
          .update(enterpriseBlueprintRecords)
          .set({
            status: request.body.status ?? row.status,
            fields: nextFields,
            notes: request.body.notes ?? row.notes,
            revision: row.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(enterpriseBlueprintRecords.id, row.id))
          .returning();
        await audit(tx, org.orgId, org.userId, row.id, 'blueprint.record_updated', row, updated);
        return updated;
      });
    },
  );
};

export default enterpriseBlueprintModule;
