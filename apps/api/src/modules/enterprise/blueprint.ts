// Enterprise Blueprint API: tenant-scoped records for the 157 indexed work packages.
// Reads the catalog from @fieldline/contracts; the server validates every field key and lifecycle
// status so a client cannot invent a stage or smuggle a field outside the package contract.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  computeEnterpriseFieldValues,
  enterpriseFieldSchema,
  findWorkPackage,
  isWorkPackageStatus,
  workPackageFieldKeys,
  type EnterpriseFieldDefinition,
  type EnterpriseFieldSchema,
  type EnterpriseFieldValues,
  type EnterpriseWorkPackage,
} from '@fieldline/contracts';
import {
  enterpriseProjects,
  enterpriseSettings,
  enterpriseAuditEvents,
} from '../../db/schema/enterprise';
import { enterpriseBlueprintRecords } from '../../db/schema/enterpriseBlueprint';
import { memberships } from '../../db/schema/team';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { problem } from '../../http/problem';

const CodeParams = z.object({ code: z.string().regex(/^\d{3}$/) });
const RecordParams = z.object({ id: z.uuid() });
const FieldValues = z.record(
  z.string().trim().min(1).max(60),
  z.union([z.string().trim().max(10000), z.number().finite()]),
);

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

function validateFields(pkg: EnterpriseWorkPackage, fields: EnterpriseFieldValues) {
  const allowed = new Set(workPackageFieldKeys(pkg));
  const unknown = Object.keys(fields).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw problem(
      'validation_failed',
      'Unknown field keys for this work package: ' + unknown.join(', ') + '.',
    );
  }
}

function invalidField(field: EnterpriseFieldDefinition, detail: string): never {
  throw problem('validation_failed', `${field.label}: ${detail}`);
}

function validateFieldValue(
  field: Exclude<EnterpriseFieldDefinition, { type: 'computed' }>,
  raw: string | number,
): string | number {
  if (field.type === 'text') {
    if (typeof raw !== 'string') invalidField(field, 'enter a text value.');
    const value = raw.trim();
    if (!value) invalidField(field, 'is required.');
    if (value.length > (field.maxLength ?? 2000))
      invalidField(field, `must be at most ${field.maxLength ?? 2000} characters.`);
    return value;
  }
  if (field.type === 'money') {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw))
      invalidField(field, 'must be a whole number of minor units (for example, cents).');
    if (field.minMinor !== undefined && raw < field.minMinor)
      invalidField(field, `must be at least ${field.minMinor} minor units.`);
    if (field.maxMinor !== undefined && raw > field.maxMinor)
      invalidField(field, `must be at most ${field.maxMinor} minor units.`);
    return raw;
  }
  if (field.type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw))
      invalidField(field, 'must be a finite number.');
    if (field.min !== undefined && raw < field.min)
      invalidField(field, `must be at least ${field.min}.`);
    if (field.max !== undefined && raw > field.max)
      invalidField(field, `must be at most ${field.max}.`);
    return raw;
  }
  if (field.type === 'date') {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
      invalidField(field, 'must be an ISO date (YYYY-MM-DD).');
    const parsed = Date.parse(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== raw)
      invalidField(field, 'must be a real calendar date.');
    if (field.min !== undefined && raw < field.min)
      invalidField(field, `must be on or after ${field.min}.`);
    if (field.max !== undefined && raw > field.max)
      invalidField(field, `must be on or before ${field.max}.`);
    return raw;
  }
  if (field.type === 'enum') {
    if (typeof raw !== 'string' || !field.options.some((option) => option.value === raw))
      invalidField(
        field,
        `must be one of: ${field.options.map((option) => option.value).join(', ')}.`,
      );
    return raw;
  }
  if (typeof raw !== 'string' || !z.uuid().safeParse(raw).success)
    invalidField(field, 'must be a UUID reference.');
  return raw;
}

function validateTypedFields(
  schema: EnterpriseFieldSchema,
  fields: EnterpriseFieldValues,
  options: { required: boolean },
): EnterpriseFieldValues {
  const definitions = new Map(schema.fields.map((field) => [field.key, field]));
  const normalized: EnterpriseFieldValues = {};
  for (const [key, raw] of Object.entries(fields)) {
    const field = definitions.get(key);
    if (!field) {
      throw problem('validation_failed', 'Unknown field keys for this work package: ' + key + '.');
    }
    if (field.type === 'computed') {
      throw problem(
        'validation_failed',
        `${field.label} is computed by the server and cannot be supplied.`,
      );
    }
    if (typeof raw === 'string' && raw.trim() === '' && !field.required) continue;
    normalized[key] = validateFieldValue(field, raw);
  }
  if (options.required) {
    for (const field of schema.fields) {
      if (field.type === 'computed' || !field.required) continue;
      if (normalized[field.key] === undefined) invalidField(field, 'is required.');
    }
  }
  return normalized;
}

async function validateTypedReferences(
  tx: Tx,
  orgId: string,
  schema: EnterpriseFieldSchema,
  fields: EnterpriseFieldValues,
) {
  for (const field of schema.fields) {
    if (field.type !== 'reference') continue;
    const value = fields[field.key];
    if (typeof value !== 'string') continue;
    if (field.target === 'project') {
      const [project] = await tx
        .select({ id: enterpriseProjects.id })
        .from(enterpriseProjects)
        .where(and(eq(enterpriseProjects.orgId, orgId), eq(enterpriseProjects.id, value)));
      if (!project) invalidField(field, 'must reference a commercial project in this company.');
      continue;
    }
    if (field.target === 'user') {
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.orgId, orgId),
            eq(memberships.userId, value),
            eq(memberships.status, 'active'),
          ),
        );
      if (!member) invalidField(field, 'must reference an active member of this company.');
      continue;
    }
    const conditions = [
      eq(enterpriseBlueprintRecords.orgId, orgId),
      eq(enterpriseBlueprintRecords.id, value),
    ];
    if (field.packageCodes?.length)
      conditions.push(inArray(enterpriseBlueprintRecords.packageCode, [...field.packageCodes]));
    const [record] = await tx
      .select({ id: enterpriseBlueprintRecords.id })
      .from(enterpriseBlueprintRecords)
      .where(and(...conditions));
    if (!record) invalidField(field, 'must reference a record in this company.');
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
      const schema = enterpriseFieldSchema(code);
      let fields = request.body.fields;
      let typedFields: EnterpriseFieldValues | null = null;
      if (schema) {
        typedFields = validateTypedFields(schema, fields, { required: true });
        fields = computeEnterpriseFieldValues(schema, typedFields);
      } else {
        validateFields(pkg, fields);
      }
      const typedProjectId =
        typedFields && typeof typedFields.project === 'string' ? typedFields.project : undefined;
      if (request.body.projectId && typedProjectId && request.body.projectId !== typedProjectId) {
        throw problem(
          'validation_failed',
          'The project field and projectId must reference the same project.',
        );
      }
      const projectId = request.body.projectId ?? typedProjectId;
      const created = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        if (schema && typedFields)
          await validateTypedReferences(tx, org.orgId, schema, typedFields);
        if (projectId) await checkProject(tx, org.orgId, projectId);
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
            projectId: projectId ?? null,
            packageCode: code,
            title: request.body.title,
            status: pkg.lifecycle[0] ?? 'draft',
            fields,
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
        const schema = enterpriseFieldSchema(row.packageCode);
        let nextFields = row.fields;
        let nextProjectId = row.projectId;
        if (request.body.fields) {
          if (schema) {
            const normalized = validateTypedFields(schema, request.body.fields, {
              required: false,
            });
            await validateTypedReferences(tx, org.orgId, schema, normalized);
            if (typeof normalized.project === 'string') nextProjectId = normalized.project;
            nextFields = computeEnterpriseFieldValues(schema, {
              ...row.fields,
              ...normalized,
            });
          } else {
            validateFields(pkg, request.body.fields);
            nextFields = { ...row.fields, ...request.body.fields };
          }
        }
        const [updated] = await tx
          .update(enterpriseBlueprintRecords)
          .set({
            status: request.body.status ?? row.status,
            projectId: nextProjectId,
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
